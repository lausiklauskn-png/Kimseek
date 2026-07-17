/*
 * SBKIM — Modul 20: Schlüssel-Safe (SBKIM-Identitäts-Safe)
 *
 * Sichert die SBKIM-Identität (nodeId + privater Knotenschlüssel + Spore)
 * lokal verschlüsselt, gegen Identitäts-Wandern. Krypto-Kern wiederverwendet
 * Modul 02 (exportBackup/importBackup: PBKDF2-SHA256 ≥600k + AES-GCM-256) —
 * der Safe speichert NUR den verschlüsselten Backup-Blob (kein Klartext-
 * Schlüssel at rest). Recovery via Shamir's Secret Sharing ÜBER DAS PASSWORT
 * (k von N, Default 2 von 3 — Klaus 2026-06-20). Der Nutzer verwahrt die
 * Anteile selbst; das System fordert die Sicherung aktiv ein.
 *
 * Spec: docs/components/20_schluessel_safe.md · INTERFACES.md §1 Modul 20.
 *
 * Schnittstelle (window.SbkimSafe):
 *   init(options?)            -> Promise<void>   // autoPrompt Default false
 *   open()                   -> Promise<void>   // Safe-Modal auf Abruf
 *   hasVault()               -> Promise<boolean>
 *   isUnlocked()             -> boolean (sync)
 *   createVault(password)    -> Promise<{ shares: string[] }>
 *   unlock(password)         -> Promise<boolean>
 *   lock()                   -> void
 *   recoverPassword(shares)  -> string | null   (sync)
 *   _meta                    -> Read-Anker
 *
 * Reines Lokal-Modul: KEIN Netz, KEINE Spore-/Briefkasten-Berührung.
 */
(function (global) {
  "use strict";

  // ---- Konstanten ----
  var STORE_NAME = "sbkim_safe";
  var VAULT_KEY = "backup";
  var MIN_PASSWORD_LEN = 8;          // analog Modul 02 BACKUP_PASSWORD_MIN_LEN
  var DEFAULT_SHAMIR_N = 3;
  var DEFAULT_SHAMIR_K = 2;          // 2 von 3 (Klaus 2026-06-20)
  var SHARE_PREFIX = "v1";

  // ---- Modul-Zustand ----
  var ready = false;
  var unlocked = false;
  var shamirN = DEFAULT_SHAMIR_N;
  var shamirK = DEFAULT_SHAMIR_K;
  var autoPromptFlag = false;
  var mountSelector = null;

  function warn(msg, err) {
    if (typeof console !== "undefined" && console.warn) {
      if (err !== undefined) console.warn("[SbkimSafe] " + msg, err);
      else console.warn("[SbkimSafe] " + msg);
    }
  }

  function makeError(name, message) {
    var e = new Error(message);
    e.name = name;
    return e;
  }

  // ================= GF(256) — AES-Feld (Poly 0x11b, Generator 3) =========
  var GF_EXP = new Uint8Array(512);
  var GF_LOG = new Uint8Array(256);
  (function buildTables() {
    function rawMul(a, b) {
      var p = 0;
      for (var i = 0; i < 8; i++) {
        if (b & 1) p ^= a;
        var hi = a & 0x80;
        a = (a << 1) & 0xff;
        if (hi) a ^= 0x1b;
        b >>= 1;
      }
      return p;
    }
    var x = 1;
    for (var i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x = rawMul(x, 3);
    }
    for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }
  function gfInv(a) {
    // a != 0 vorausgesetzt (x-Indizes sind 1..N)
    return GF_EXP[255 - GF_LOG[a]];
  }

  function randomBytes(n) {
    var out = new Uint8Array(n);
    if (global.crypto && typeof global.crypto.getRandomValues === "function") {
      global.crypto.getRandomValues(out);
    } else {
      for (var i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    }
    return out;
  }

  // Teilt ein Geheimnis (Uint8Array) in N Anteile, Schwelle k.
  // Rückgabe: Array von { x:Number(1..N), bytes:Uint8Array(secret.length) }.
  function shamirSplitBytes(secret, n, k) {
    var shares = [];
    for (var s = 0; s < n; s++) shares.push({ x: s + 1, bytes: new Uint8Array(secret.length) });
    for (var bi = 0; bi < secret.length; bi++) {
      // Polynom: coeffs[0] = secret-byte, coeffs[1..k-1] = zufällig.
      var coeffs = new Uint8Array(k);
      coeffs[0] = secret[bi];
      var rnd = randomBytes(k - 1);
      for (var c = 1; c < k; c++) coeffs[c] = rnd[c - 1];
      for (var si = 0; si < n; si++) {
        var x = shares[si].x;
        // Horner-Auswertung des Polynoms an der Stelle x über GF(256).
        var y = 0;
        for (var d = k - 1; d >= 0; d--) {
          y = gfMul(y, x) ^ coeffs[d];
        }
        shares[si].bytes[bi] = y;
      }
    }
    return shares;
  }

  // Rekonstruiert das Geheimnis aus >= k Anteilen (Lagrange an Stelle 0).
  function shamirCombineBytes(shareObjs) {
    var len = shareObjs[0].bytes.length;
    var out = new Uint8Array(len);
    var m = shareObjs.length;
    for (var bi = 0; bi < len; bi++) {
      var acc = 0;
      for (var i = 0; i < m; i++) {
        var xi = shareObjs[i].x;
        var yi = shareObjs[i].bytes[bi];
        // Lagrange-Basis-Koeffizient bei x=0:
        // L_i = prod_{j!=i} x_j / (x_j - x_i)   (GF: minus == xor)
        var num = 1, den = 1;
        for (var j = 0; j < m; j++) {
          if (j === i) continue;
          var xj = shareObjs[j].x;
          num = gfMul(num, xj);
          den = gfMul(den, xj ^ xi);
        }
        var lag = gfMul(num, gfInv(den));
        acc ^= gfMul(yi, lag);
      }
      out[bi] = acc;
    }
    return out;
  }

  // ---- base64url (Browser + node) ----
  function b64urlEncode(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64;
    if (typeof btoa === "function") b64 = btoa(bin);
    else b64 = global.Buffer ? global.Buffer.from(bytes).toString("base64") : "";
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(str) {
    var b64 = String(str).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    if (typeof atob === "function") {
      var bin = atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return global.Buffer ? new Uint8Array(global.Buffer.from(b64, "base64")) : new Uint8Array(0);
  }

  function encodeShare(share) {
    return SHARE_PREFIX + "." + share.x + "." + b64urlEncode(share.bytes);
  }
  function decodeShare(str) {
    var parts = String(str).trim().split(".");
    if (parts.length !== 3 || parts[0] !== SHARE_PREFIX) {
      throw makeError("InvalidShareError", "Anteil-Format ungültig (erwartet v1.<index>.<base64url>).");
    }
    var x = parseInt(parts[1], 10);
    if (!(x >= 1 && x <= 255)) {
      throw makeError("InvalidShareError", "Anteil-Index ungültig: " + parts[1]);
    }
    return { x: x, bytes: b64urlDecode(parts[2]) };
  }

  // ---- Passwort <-> Bytes ----
  function pwToBytes(pw) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(pw);
    var b = global.Buffer ? global.Buffer.from(pw, "utf8") : null;
    return b ? new Uint8Array(b) : new Uint8Array(0);
  }
  function bytesToPw(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
    return global.Buffer ? global.Buffer.from(bytes).toString("utf8") : "";
  }

  // ================= Öffentliche Safe-Logik ============================

  function getStorage() { return global.SbkimStorage || null; }
  function getSpore() { return global.SbkimSpore || null; }

  async function ensureVaultStore() {
    var st = getStorage();
    if (!st) throw makeError("StorageNotAvailableError", "Modul 01 (SbkimStorage) ist nicht geladen.");
    if (typeof st.ensureStore === "function") {
      try { await st.ensureStore(STORE_NAME); } catch (e) { warn("ensureStore(" + STORE_NAME + ") fehlgeschlagen.", e); }
    }
  }

  async function hasVault() {
    var st = getStorage();
    if (!st || typeof st.get !== "function") return false;
    try {
      await ensureVaultStore();
      var blob = await st.get(STORE_NAME, VAULT_KEY);
      return !!blob;
    } catch (e) {
      warn("hasVault-Prüfung fehlgeschlagen.", e);
      return false;
    }
  }

  function isUnlocked() { return unlocked === true; }

  // Erzeugt den Safe aus der aktuellen Identität + die Shamir-Anteile.
  async function createVault(password) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN) {
      throw makeError("WeakPasswordError",
        "Passwort muss mindestens " + MIN_PASSWORD_LEN + " Zeichen lang sein.");
    }
    var sp = getSpore();
    if (!sp || typeof sp.exportBackup !== "function") {
      throw makeError("SporeNotAvailableError", "Modul 02 (SbkimSpore.exportBackup) ist nicht geladen.");
    }
    // Fremdnutzer-Schutz (Klaus-Sichttest B1 2026-07-17): Ohne erzeugte Spore ist
    // der Safe NICHT wiederherstellbar — importBackup verlangt je Identität eine
    // Spore, exportBackup erlaubt sie aber fehlend. Das erzeugte sonst einen Safe,
    // der sich anlegen, aber nie wieder entsperren lässt (stiller Fehlschlag). Hier
    // ein KLARER Fehler statt des stillen unlock-Fehlers. Fail-soft: greift nur, wenn
    // Modul 02 getOwnSpore anbietet (sonst wie bisher — z.B. reine Geheimnis-Ablage).
    if (typeof sp.getOwnSpore === "function") {
      var existingSpore = await sp.getOwnSpore();
      if (!existingSpore) {
        throw makeError("NoSporeError",
          "Der Safe braucht eine erzeugte Identität mit Spore. Bitte zuerst über den " +
            "Andock-Wizard eine Spore erzeugen, dann den Safe anlegen.");
      }
    }
    if (await hasVault()) {
      throw makeError("VaultExistsError",
        "Safe existiert bereits — erst entsperren oder löschen, statt neu anzulegen.");
    }
    // Krypto-Kern: Modul 02 verschlüsselt Identität + Geschwister passwortbasiert.
    var blob = await sp.exportBackup(password);
    var st = getStorage();
    await ensureVaultStore();
    await st.put(STORE_NAME, VAULT_KEY, blob);
    unlocked = true;

    // Shamir-Anteile über das Passwort (k von N).
    var shareObjs = shamirSplitBytes(pwToBytes(password), shamirN, shamirK);
    var shares = shareObjs.map(encodeShare);
    return { shares: shares };
  }

  // Entsperrt/stellt die Identität aus dem Safe wieder her.
  async function unlock(password) {
    if (typeof password !== "string" || password.length === 0) return false;
    var sp = getSpore();
    var st = getStorage();
    if (!sp || typeof sp.importBackup !== "function" || !st) {
      warn("unlock: Modul 02/01 nicht verfügbar.");
      return false;
    }
    try {
      await ensureVaultStore();
      var blob = await st.get(STORE_NAME, VAULT_KEY);
      if (!blob) {
        warn("unlock: kein Safe vorhanden.");
        return false;
      }
      // force:true — die im Safe gesicherte Identität ist maßgeblich.
      await sp.importBackup(blob, password, { force: true });
      unlocked = true;
      return true;
    } catch (e) {
      // Falsches Passwort / defekter Blob → fail-soft, kein Klartext-Hinweis.
      unlocked = false;
      return false;
    }
  }

  function lock() { unlocked = false; }

  // ==========================================================================
  // Generische Geheimnis-Ablage (Bau 2026-07-11) — beliebige KLEINE Geheimnisse
  // (z.B. ein KI-Richter-API-Schlüssel) verschlüsselt im Safe ablegen, damit sie
  // Hard-Reload/App-Schließen überleben, OHNE je im Klartext in localStorage/
  // IndexedDB zu liegen. Echte Krypto, identisches Muster wie Modul 02 Backup:
  // PBKDF2-SHA256 600k → AES-GCM-256, frisches Salt + IV pro Geheimnis.
  // Fremdnutzer-/Marktplatz-sicher: eine andere App auf derselben geteilten
  // Adresse liest nur den Chiffretext, nie den Klartext (ohne das Passwort).
  // Unabhängig vom Identitäts-Vault (kein createVault nötig) — jedes Geheimnis
  // trägt seinen eigenen Umschlag. Fail-soft: falsches Passwort / Manipulation
  // / kein WebCrypto → null, kein Klartext-Hinweis.
  var SECRET_PREFIX = "secret:";
  var SECRET_KDF_ITERATIONS = 600000;   // = Modul 02 BACKUP_KDF_ITERATIONS

  function getSubtle() {
    var c = global.crypto;
    return (c && c.subtle) ? c.subtle : null;
  }
  async function deriveSecretKey(subtle, password, salt) {
    var baseKey = await subtle.importKey("raw", pwToBytes(password), { name: "PBKDF2" }, false, ["deriveKey"]);
    return await subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: SECRET_KDF_ITERATIONS, hash: "SHA-256" },
      baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  function secretKey(name) { return SECRET_PREFIX + String(name); }

  var MAX_HINT_LEN = 140;   // Merkhilfe ist ein kurzes Stichwort, kein Aufsatz.

  async function hasSecret(name) {
    var st = getStorage(); if (!st) return false;
    try { await ensureVaultStore(); return !!(await st.get(STORE_NAME, secretKey(name))); }
    catch (e) { return false; }
  }

  // Legt `plaintext` unter `name` verschlüsselt ab. Wirft nur bei klarem
  // Aufrufer-Fehler (leerer Name/Wert, zu kurzes Passwort, kein WebCrypto).
  // `opts.hint` (optional) ist eine KLARTEXT-Merkhilfe fürs Passwort — sie
  // wird bewusst NICHT verschlüsselt, weil man sie ja VOR dem Passwort lesen
  // können muss. Sie liegt im app-eigenen Speicher (Modul 01 dbSuffix), nicht
  // netzweit; der Aufrufer sorgt dafür, dass sie NICHT das Passwort selbst ist.
  async function putSecret(name, plaintext, password, opts) {
    if (typeof name !== "string" || name.length === 0) throw makeError("InvalidSecretNameError", "Geheimnis-Name muss ein nicht-leerer String sein.");
    if (typeof plaintext !== "string" || plaintext.length === 0) throw makeError("InvalidSecretValueError", "Geheimnis-Wert muss ein nicht-leerer String sein.");
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LEN) throw makeError("WeakPasswordError", "Passwort muss mindestens " + MIN_PASSWORD_LEN + " Zeichen lang sein.");
    var subtle = getSubtle();
    if (!subtle) throw makeError("CryptoUnavailableError", "WebCrypto (crypto.subtle) ist nicht verfügbar.");
    var st = getStorage();
    if (!st) throw makeError("StorageUnavailableError", "Modul 01 (SbkimStorage) ist nicht geladen.");
    await ensureVaultStore();
    var salt = randomBytes(16), iv = randomBytes(12);
    var aesKey = await deriveSecretKey(subtle, password, salt);
    var ctBuf = await subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, pwToBytes(plaintext));
    var blob = {
      v: 1, kdf: "PBKDF2-SHA256", iterations: SECRET_KDF_ITERATIONS, cipher: "AES-GCM-256",
      salt: b64urlEncode(salt), iv: b64urlEncode(iv), ct: b64urlEncode(new Uint8Array(ctBuf)),
    };
    var hint = (opts && typeof opts.hint === "string") ? opts.hint.trim().slice(0, MAX_HINT_LEN) : "";
    if (hint) blob.hint = hint;
    await st.put(STORE_NAME, secretKey(name), blob);
    return true;
  }

  // Liest die Klartext-Merkhilfe zu `name` OHNE Passwort. null, wenn keine
  // hinterlegt ist (oder Speicher fehlt). Nur die Merkhilfe — nie das Geheimnis.
  async function getSecretHint(name) {
    if (typeof name !== "string" || !name.length) return null;
    var st = getStorage(); if (!st) return null;
    try {
      await ensureVaultStore();
      var blob = await st.get(STORE_NAME, secretKey(name));
      return (blob && typeof blob.hint === "string" && blob.hint) ? blob.hint : null;
    } catch (e) { return null; }
  }

  // Entschlüsselt das Geheignis `name`. null bei fehlend / falschem Passwort /
  // Manipulation / kein WebCrypto (fail-soft, kein Klartext-Hinweis).
  async function getSecret(name, password) {
    if (typeof name !== "string" || !name.length || typeof password !== "string" || !password.length) return null;
    var subtle = getSubtle(); var st = getStorage();
    if (!subtle || !st) return null;
    try {
      await ensureVaultStore();
      var blob = await st.get(STORE_NAME, secretKey(name));
      if (!blob || !blob.salt || !blob.iv || !blob.ct) return null;
      var salt = b64urlDecode(blob.salt), iv = b64urlDecode(blob.iv), ct = b64urlDecode(blob.ct);
      var aesKey = await deriveSecretKey(subtle, password, salt);
      var ptBuf = await subtle.decrypt({ name: "AES-GCM", iv: iv }, aesKey, ct);
      return bytesToPw(new Uint8Array(ptBuf));
    } catch (e) { return null; }
  }

  async function removeSecret(name) {
    var st = getStorage();
    if (!st || typeof st.del !== "function") return false;
    try { await ensureVaultStore(); await st.del(STORE_NAME, secretKey(name)); return true; }
    catch (e) { return false; }
  }

  // Rekonstruiert das Passwort aus >= k Shamir-Anteilen. null bei zu wenigen
  // oder ungültigen Anteilen. Reines Lokal-Verfahren.
  function recoverPassword(shares) {
    if (!Array.isArray(shares) || shares.length < shamirK) return null;
    try {
      var objs = [];
      var seenX = {};
      for (var i = 0; i < shares.length; i++) {
        var o = decodeShare(shares[i]);
        if (seenX[o.x]) continue;          // Duplikate ignorieren
        seenX[o.x] = true;
        objs.push(o);
      }
      if (objs.length < shamirK) return null;
      // Genau k Anteile für die Interpolation verwenden.
      var use = objs.slice(0, shamirK);
      // Längen-Konsistenz prüfen.
      var len = use[0].bytes.length;
      for (var j = 1; j < use.length; j++) {
        if (use[j].bytes.length !== len) return null;
      }
      var secret = shamirCombineBytes(use);
      return bytesToPw(secret);
    } catch (e) {
      warn("recoverPassword fehlgeschlagen.", e);
      return null;
    }
  }

  // ================= Auto-Abfrage-UI (Modal, fail-soft) ==================
  // Nicht headless getestet — Sichttest durch Klaus. Reines Trigger-UI;
  // die Logik liegt in den obigen Funktionen.

  function buildModalShell(doc, titleText) {
    var root = doc.createElement("div");
    root.setAttribute("data-sbkim-vault-modal", "");
    root.style.cssText = [
      "position:fixed", "inset:0", "z-index:100000",
      "display:flex", "align-items:center", "justify-content:center",
      "background:rgba(5,5,12,0.72)", "font-family:'Geist',system-ui,sans-serif",
    ].join(";");
    var panel = doc.createElement("div");
    panel.style.cssText = [
      "max-width:420px", "width:calc(100% - 2rem)", "background:#14110a",
      "border:1px solid rgba(201,169,97,0.5)", "border-radius:12px",
      "padding:1.4rem 1.5rem", "color:#F5F5FF", "box-shadow:0 12px 40px rgba(0,0,0,0.6)",
    ].join(";");
    var h = doc.createElement("h2");
    h.textContent = titleText;
    h.style.cssText = "margin:0 0 0.8rem;font-family:'Spectral',Georgia,serif;font-size:1.1rem;color:#C9A961;";
    panel.appendChild(h);
    root.appendChild(panel);
    return { root: root, panel: panel };
  }

  function makeInput(doc, placeholder) {
    var inp = doc.createElement("input");
    inp.type = "password";
    inp.placeholder = placeholder;
    inp.style.cssText = [
      "display:block", "width:100%", "box-sizing:border-box", "margin:0 0 0.6rem",
      "padding:0.55rem 0.7rem", "border-radius:8px", "border:1px solid rgba(201,169,97,0.4)",
      "background:#0d0b06", "color:#F5F5FF", "font-size:0.95rem",
    ].join(";");
    return inp;
  }
  function makeButton(doc, label) {
    var b = doc.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = [
      "background:#C9A961", "color:#1A1306", "border:none", "border-radius:8px",
      "padding:0.55rem 1rem", "font-weight:600", "cursor:pointer", "font-size:0.92rem",
    ].join(";");
    return b;
  }

  function showCreateModal(doc) {
    var ui = buildModalShell(doc, "Schlüssel-Safe einrichten");
    var info = doc.createElement("p");
    info.style.cssText = "margin:0 0 0.9rem;font-size:0.86rem;line-height:1.5;color:rgba(245,245,255,0.85);";
    info.textContent =
      "Wähle ein Passwort (mind. " + MIN_PASSWORD_LEN + " Zeichen). Es verschlüsselt " +
      "deine SBKIM-Identität (Schlüssel + Spore) lokal, damit sie nicht verloren geht.";
    var pw1 = makeInput(doc, "Passwort");
    var pw2 = makeInput(doc, "Passwort wiederholen");
    var msg = doc.createElement("p");
    msg.style.cssText = "margin:0 0 0.6rem;font-size:0.8rem;color:#e0a; min-height:1em;";
    var btn = makeButton(doc, "Safe einrichten");
    ui.panel.appendChild(info);
    ui.panel.appendChild(pw1);
    ui.panel.appendChild(pw2);
    ui.panel.appendChild(msg);
    ui.panel.appendChild(btn);
    doc.body.appendChild(ui.root);

    btn.addEventListener("click", function () {
      msg.textContent = "";
      if (pw1.value.length < MIN_PASSWORD_LEN) { msg.textContent = "Passwort zu kurz (mind. " + MIN_PASSWORD_LEN + ")."; return; }
      if (pw1.value !== pw2.value) { msg.textContent = "Passwörter stimmen nicht überein."; return; }
      btn.disabled = true;
      createVault(pw1.value).then(function (res) {
        showSharesModal(doc, res.shares);
        if (ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
      }).catch(function (e) {
        btn.disabled = false;
        msg.textContent = (e && e.message) ? e.message : "Safe konnte nicht angelegt werden.";
      });
    });
  }

  function showSharesModal(doc, shares) {
    var ui = buildModalShell(doc, "Wiederherstellungs-Anteile sichern");
    var info = doc.createElement("p");
    info.style.cssText = "margin:0 0 0.7rem;font-size:0.86rem;line-height:1.5;color:rgba(245,245,255,0.85);";
    info.textContent =
      "Bewahre diese " + shares.length + " Anteile getrennt auf. Mit " + shamirK +
      " davon kannst du dein Passwort wiederherstellen, falls du es vergisst. " +
      "Ohne Passwort UND ohne genug Anteile ist der Safe nicht wiederherstellbar.";
    var box = doc.createElement("textarea");
    box.readOnly = true;
    box.value = shares.join("\n");
    box.style.cssText = "width:100%;box-sizing:border-box;height:96px;background:#0d0b06;color:#C9A961;border:1px solid rgba(201,169,97,0.4);border-radius:8px;padding:0.5rem;font-family:'Geist Mono',monospace;font-size:0.78rem;margin:0 0 0.7rem;";
    var copyBtn = makeButton(doc, "Anteile kopieren");
    var confirm = doc.createElement("label");
    confirm.style.cssText = "display:flex;gap:0.5rem;align-items:flex-start;margin:0.8rem 0;font-size:0.84rem;color:rgba(245,245,255,0.85);";
    var chk = doc.createElement("input"); chk.type = "checkbox";
    var lbl = doc.createElement("span"); lbl.textContent = "Ich habe die Anteile sicher verwahrt.";
    confirm.appendChild(chk); confirm.appendChild(lbl);
    var done = makeButton(doc, "Fertig"); done.disabled = true; done.style.opacity = "0.5";
    ui.panel.appendChild(info);
    ui.panel.appendChild(box);
    ui.panel.appendChild(copyBtn);
    ui.panel.appendChild(confirm);
    ui.panel.appendChild(done);
    doc.body.appendChild(ui.root);

    copyBtn.addEventListener("click", function () {
      try {
        if (global.navigator && global.navigator.clipboard) global.navigator.clipboard.writeText(box.value);
        else { box.select(); if (doc.execCommand) doc.execCommand("copy"); }
      } catch (e) { warn("Kopieren fehlgeschlagen.", e); }
    });
    chk.addEventListener("change", function () {
      done.disabled = !chk.checked;
      done.style.opacity = chk.checked ? "1" : "0.5";
    });
    done.addEventListener("click", function () {
      if (!chk.checked) return;
      if (ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
    });
  }

  function showUnlockModal(doc) {
    var ui = buildModalShell(doc, "Schlüssel-Safe entsperren");
    var info = doc.createElement("p");
    info.style.cssText = "margin:0 0 0.9rem;font-size:0.86rem;line-height:1.5;color:rgba(245,245,255,0.85);";
    info.textContent = "Gib dein Safe-Passwort ein, um deine SBKIM-Identität zu laden.";
    var pw = makeInput(doc, "Passwort");
    var msg = doc.createElement("p");
    msg.style.cssText = "margin:0 0 0.6rem;font-size:0.8rem;color:#e0a;min-height:1em;";
    var btn = makeButton(doc, "Entsperren");
    ui.panel.appendChild(info);
    ui.panel.appendChild(pw);
    ui.panel.appendChild(msg);
    ui.panel.appendChild(btn);
    doc.body.appendChild(ui.root);

    btn.addEventListener("click", function () {
      msg.textContent = "";
      btn.disabled = true;
      unlock(pw.value).then(function (okv) {
        if (okv) { if (ui.root.parentNode) ui.root.parentNode.removeChild(ui.root); }
        else { btn.disabled = false; msg.textContent = "Falsches Passwort oder Safe defekt."; }
      });
    });
  }

  // Öffnet das Safe-Modal auf Abruf (Einrichten, wenn kein Safe; sonst
  // Entsperren). Das ist der EINZIGE übliche Einstieg: der Host hängt einen
  // Knopf in seine Einstellungen/Tool-Ansicht, der SbkimSafe.open() ruft.
  // KEINE Abfrage beim Seitenstart (Klaus 2026-06-20: App startet immer normal).
  async function open() {
    var doc = global.document;
    if (!doc || !doc.body) return;
    try {
      if (await hasVault()) showUnlockModal(doc);
      else showCreateModal(doc);
    } catch (e) {
      warn("Safe-Öffnen fehlgeschlagen.", e);
    }
  }

  // ================= init =================================================
  async function init(options) {
    if (ready) return; // idempotent
    var opts = (options && typeof options === "object") ? options : {};
    if (typeof opts.shamirN === "number" && opts.shamirN >= 2 && opts.shamirN <= 255) shamirN = opts.shamirN | 0;
    if (typeof opts.shamirK === "number" && opts.shamirK >= 2) shamirK = opts.shamirK | 0;
    if (shamirK > shamirN) { warn("shamirK > shamirN — auf Default 2/3 zurückgesetzt."); shamirN = DEFAULT_SHAMIR_N; shamirK = DEFAULT_SHAMIR_K; }
    // autoPrompt Default FALSE — der Safe wird NICHT beim Seitenstart
    // abgefragt, sondern nur auf Abruf via open() (Klaus 2026-06-20).
    autoPromptFlag = (opts.autoPrompt === true);
    if (typeof opts.mountSelector === "string") mountSelector = opts.mountSelector;
    ready = true;
    if (autoPromptFlag) { try { await open(); } catch (e) { warn("init Auto-Prompt", e); } }
  }

  var SbkimSafe = {
    init: init,
    open: open,
    hasVault: hasVault,
    isUnlocked: isUnlocked,
    createVault: createVault,
    unlock: unlock,
    lock: lock,
    recoverPassword: recoverPassword,
    // Generische Geheimnis-Ablage (z.B. KI-Richter-Schlüssel) — verschlüsselt,
    // überlebt Reload/App-Schließen; andere Apps lesen nur Chiffretext.
    putSecret: putSecret,
    getSecret: getSecret,
    getSecretHint: getSecretHint,
    hasSecret: hasSecret,
    removeSecret: removeSecret,
    // Test-Brücken (KEIN Public-Use): reine Shamir-Funktionen headless prüfbar.
    _shamirSplitBytes: shamirSplitBytes,
    _shamirCombineBytes: shamirCombineBytes,
    _encodeShare: encodeShare,
    _decodeShare: decodeShare,
    _meta: {
      storeName: STORE_NAME,
      minPasswordLen: MIN_PASSWORD_LEN,
      get ready() { return ready; },
      get unlocked() { return unlocked; },
      get shamirN() { return shamirN; },
      get shamirK() { return shamirK; },
    },
  };

  global.SbkimSafe = SbkimSafe;

  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 20 SCHLUESSEL-SAFE bereit, Funktionen: init/open/hasVault/isUnlocked/createVault/unlock/lock/recoverPassword",
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
