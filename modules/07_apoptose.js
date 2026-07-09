/*
 * SBKIM — Modul 07 — Apoptose
 *
 * Composes Modul 01 (Storage) and Modul 02 (Spore) into the second
 * protocol composition: signed self-death with legacy broadcast, foreign
 * legacy reception, and explicit TTL forgetting of silent siblings.
 * Modul 07 itself never computes a cosine, never embeds, never calls
 * SbkimAnastomose.handshake — it orchestrates around the legacy POST
 * endpoint /sbkim/legacy.
 *
 * Public surface (registered on window.SbkimApoptose):
 *   init() -> Promise<void>
 *   prepareSelfApoptose(reason) -> Promise<{ confirmationToken, expiresAt, recipientCount }>
 *   confirmSelfApoptose(token, reason) -> Promise<{ outcome, recipientsNotified, recipientsFailed }>
 *   receiveLegacy(incomingLegacy) -> Promise<LegacyResponse>          // wirft NIEMALS
 *   listLegacy() -> Promise<Array<{ fromNodeId, reason, receivedAt }>>
 *   forgetExpiredSiblings(maxAgeMs) -> Promise<Array<{ nodeId, lastSeen }>>
 *
 * Inoffiziell (Unterstrich-Präfix, nur für tests/manual_check.html):
 *   _invokeReceiveLegacyDirect(legacyMessage) -> alias auf receiveLegacy
 *   _buildSignedLegacyMessage(reason)         -> Build + Sign ohne Versand
 *   _addPseudoSibling({nodeId, domain, endpoint, pubKey, since})
 *                                              -> In-Memory-Override für die
 *                                                 Geschwister-Liste, ohne
 *                                                 IndexedDB anzufassen.
 *                                                 Per Convention nur Tests.
 *   _clearPseudoSiblings()                     -> Override leeren.
 *   _advanceTokenClock(ms)                     -> Test-Bridge für Token-Ablauf
 *                                                 (Token-expiresAt verschieben),
 *                                                 ohne 61 s Realzeit zu warten.
 *   _canonicalize / _base64urlEncode / _base64urlDecode
 *   _signEnvelope / _verifyEnvelope            -> Krypto-Helfer (Panel)
 *
 * Self-check: emits a console.info line on script load (synchronous,
 * before any call). Die irreversible Natur erscheint erst beim Aufruf
 * von prepareSelfApoptose als console.warn — nicht beim Skript-Laden.
 * See INTERFACES.md §1 Modul 07, §2 Vermächtnis, §3 (legacy: /sbkim/legacy)
 * und docs/components/07_apoptose.md für den verbindlichen Vertrag.
 *
 * Krypto-Pfad (canonicalize, base64url, sign, verify) ist bewusst aus
 * Modul 02 / 05 dupliziert — Single-File-PWA-Stil, keine geteilte
 * Library, kein Eingriff in 02/05. Wer das zusammenführen will, hebt
 * eine Pflege-Sitzung.
 *
 * Bau 07.Y transparenter Slot-Pfad + Legacy-Hook (2026-05-20): Modul 07
 * schreibt identitäts-spezifisch in `sbkim_legacy_inbox_<key>` und
 * `sbkim_anastomosis_log_<key>`; liest aus `sbkim_siblings_<key>`.
 * Receiver-Pfad (`receiveLegacy`) nutzt eine `nodeId → key`-Map (im
 * `init()` einmal aus `listIdentities()` × `getOrCreateIdentity(slot)`
 * aufgebaut) zur Persona-Auflösung. **Globale `confirmSelfApoptose`
 * iteriert über ALLE Slots** — sendet pro Slot ein Vermächtnis via
 * `_sendLegacyForIdentity(slot)` und räumt danach pro Slot alle
 * fünf identitäts-spezifischen Stores + Spore + Keys; danach
 * globaler `sbkim_meta["active-identity"]`-Reset + Modul-02-Cache-
 * Invalidate. **`_sendLegacyForIdentity(key)`** ist neuer interner
 * Hook für Bau-02.Y `removeIdentity(key, {force:true})` — sendet das
 * Persona-Vermächtnis an die Geschwister DIESER Persona; KEIN
 * Store-Cleanup (Modul 02 räumt danach). Spec-Quelle: Brief 04 (PR
 * #99, INTERFACES § 1 Modul 07 + § 9.2 + § 9.4) + Bau 02.Y (PR #104).
 */
(function (global) {
  "use strict";

  // ---- Konstanten (gespiegelt aus INTERFACES.md §0 / §3) ----

  var PROTOCOL_VERSION = "0.1";
  var QUERY_TIMEOUT_MS = 4000;
  var ENDPOINT_LEGACY = "/sbkim/legacy";
  var NONCE_BYTES = 16;
  var APOPTOSE_TOKEN_BYTES = 16;
  var APOPTOSE_TOKEN_TTL_MS = 60 * 1000;       // Modul-lokal, UI-Detail

  // Bau 07.Y: identitäts-spezifische Stores via Slot-Suffix. Die fünf
  // Basis-Konstanten + Slot-Helper (siblingsStoreName etc.) bauen den
  // vollen Store-Namen. Modul 07 ist Schreiber für
  // sbkim_legacy_inbox_<key> und sbkim_anastomosis_log_<key>; liest
  // aus sbkim_siblings_<key>. Globaler Self-Apoptose-Cleanup räumt
  // zusätzlich sbkim_hetero_inbox_<key> + sbkim_hetero_outbox_<key>
  // (Modul-06/08-Schreib-Stores) für alle Slots, plus sbkim_keys[slot]
  // + sbkim_spore[slot] + sbkim_meta["active-identity"].
  var SIBLINGS_STORE_BASE = "sbkim_siblings";
  var LOG_STORE_BASE = "sbkim_anastomosis_log";
  var INBOX_STORE_BASE = "sbkim_legacy_inbox";
  var HETERO_INBOX_STORE_BASE = "sbkim_hetero_inbox";
  var HETERO_OUTBOX_STORE_BASE = "sbkim_hetero_outbox";
  var SPORE_STORE = "sbkim_spore";
  var KEYS_STORE = "sbkim_keys";
  var META_STORE = "sbkim_meta";
  var ACTIVE_IDENTITY_META_KEY = "active-identity";
  var DEFAULT_IDENTITY_KEY = "main";

  // Sequenz des per-Slot-Cleanup — Bau 07.Y ersetzt den globalen
  // CLEANUP_ORDER durch eine slot-suffixed Liste (pro Slot in dieser
  // Reihenfolge clearen). Identität (Keys) zuletzt: sie ist die
  // letzte Bastion. Hetero-Outbox additiv (Bau 06.Y / 08.Y; Modul 08
  // schreibt jetzt slot-suffixed dorthin).
  var CLEANUP_ORDER_BASES = [
    SIBLINGS_STORE_BASE,
    LOG_STORE_BASE,
    INBOX_STORE_BASE,
    HETERO_INBOX_STORE_BASE,
    HETERO_OUTBOX_STORE_BASE,
  ];

  var LEGACY_REQUIRED_FIELDS = [
    "fromNodeId",
    "nonce",
    "protocolVersion",
    "reason",
    "senderSpore",
    "signature",
    "timestamp",
  ];

  // ---- Fehler-Erzeugung ----

  function makeError(name, message, cause) {
    var e = new Error(message);
    e.name = name;
    if (cause !== undefined) e.cause = cause;
    return e;
  }

  // ---- Dependency-Probes ----

  function getSubtle() {
    var c = global.crypto || (typeof crypto !== "undefined" ? crypto : null);
    if (!c || !c.subtle) {
      throw makeError(
        "ApoptoseDependenciesError",
        "WebCrypto (crypto.subtle) ist nicht verfügbar. Modul 07 braucht moderne Browser " +
          "(Chrome ≥ 113, Firefox ≥ 130, Safari ≥ 17). Kein Polyfill.",
      );
    }
    return c.subtle;
  }

  function probeDependencies() {
    var missing = [];
    if (!global.SbkimStorage) missing.push("SbkimStorage (Modul 01)");
    if (!global.SbkimSpore) missing.push("SbkimSpore (Modul 02)");
    if (missing.length > 0) {
      throw makeError(
        "ApoptoseDependenciesError",
        "Fehlende Modul-Abhängigkeiten: " + missing.join(", ") + ". " +
          "Lade 01_storage.js und 02_spore.js vor 07_apoptose.js.",
      );
    }
  }

  function getStorage() { return global.SbkimStorage; }
  function getSpore() { return global.SbkimSpore; }

  // ---- Bau 07.Y: Slot-Helfer ----
  //
  // Modul 07 lebt nach Bau 07.Y in identitäts-spezifischen Stores. Die
  // Closure-Helper bauen den vollen Namen aus Basis + Slot.
  // `ensureSlotStores` legt die FÜNF identitäts-spezifischen Stores
  // defensiv via Bau-01.Y `ensureStore` an (idempotent). Modul 07 ist
  // Schreiber für legacy_inbox + anastomosis_log, Lese-Stores siblings
  // / hetero_inbox / hetero_outbox sind Schreib-Pflicht von Modul 05 /
  // 06 / 08 — aber im Cleanup-Pfad räumt Modul 07 alle fünf.

  function siblingsStoreName(slotKey) {
    return SIBLINGS_STORE_BASE + "_" + slotKey;
  }
  function anastomosisLogStoreName(slotKey) {
    return LOG_STORE_BASE + "_" + slotKey;
  }
  function legacyInboxStoreName(slotKey) {
    return INBOX_STORE_BASE + "_" + slotKey;
  }
  function heteroInboxStoreName(slotKey) {
    return HETERO_INBOX_STORE_BASE + "_" + slotKey;
  }
  function heteroOutboxStoreName(slotKey) {
    return HETERO_OUTBOX_STORE_BASE + "_" + slotKey;
  }

  async function ensureSlotStores(slotKey) {
    var storage = getStorage();
    await storage.ensureStore(siblingsStoreName(slotKey));
    await storage.ensureStore(anastomosisLogStoreName(slotKey));
    await storage.ensureStore(legacyInboxStoreName(slotKey));
    await storage.ensureStore(heteroInboxStoreName(slotKey));
    await storage.ensureStore(heteroOutboxStoreName(slotKey));
  }

  // ---- base64url ohne Padding (RFC 4648 §5, dupliziert aus Modul 02/05) ----

  function base64urlEncode(bytes) {
    var bin = "";
    var view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (var i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
    var b64 = (global.btoa || btoa)(bin);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64urlDecode(str) {
    var pad = str.length % 4 === 0 ? "" : "====".slice(str.length % 4);
    var b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
    var bin = (global.atob || atob)(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function utf8Encode(str) {
    return new TextEncoder().encode(str);
  }

  // Recursive lexicographic key sort. Returns a new object, never mutates.
  function canonicalize(value) {
    if (value === null) return null;
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value === "object") {
      var keys = Object.keys(value).sort();
      var out = {};
      for (var i = 0; i < keys.length; i++) out[keys[i]] = canonicalize(value[keys[i]]);
      return out;
    }
    return value;
  }

  function canonicalJsonBytesWithoutSignature(envelopeLike) {
    var unsigned = {};
    var keys = Object.keys(envelopeLike);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === "signature") continue;
      unsigned[keys[i]] = envelopeLike[keys[i]];
    }
    return utf8Encode(JSON.stringify(canonicalize(unsigned)));
  }

  // ---- Sign / Verify auf Envelope-Ebene ----

  async function signEnvelope(unsigned, privateKey) {
    var bytes = utf8Encode(JSON.stringify(canonicalize(unsigned)));
    var sigBuf = await getSubtle().sign({ name: "Ed25519" }, privateKey, bytes);
    return base64urlEncode(sigBuf);
  }

  async function verifyEnvelope(envelope, publicKeyJwk) {
    if (!envelope || typeof envelope.signature !== "string") return false;
    var subtle = getSubtle();
    var pub;
    try {
      pub = await subtle.importKey("jwk", publicKeyJwk, { name: "Ed25519" }, true, ["verify"]);
    } catch (err) {
      return false;
    }
    var sigBytes;
    try {
      sigBytes = base64urlDecode(envelope.signature);
    } catch (err) {
      return false;
    }
    var bytes = canonicalJsonBytesWithoutSignature(envelope);
    try {
      return await subtle.verify({ name: "Ed25519" }, pub, sigBytes, bytes);
    } catch (err) {
      return false;
    }
  }

  // ---- Helfer ----

  function randomBytesB64(n) {
    var c = global.crypto || (typeof crypto !== "undefined" ? crypto : null);
    if (!c || !c.getRandomValues) {
      throw makeError("ApoptoseDependenciesError", "crypto.getRandomValues fehlt — Modul 07 braucht WebCrypto.");
    }
    var buf = new Uint8Array(n);
    c.getRandomValues(buf);
    return base64urlEncode(buf);
  }

  function majorVersion(v) {
    if (typeof v !== "string") return null;
    var dot = v.indexOf(".");
    return dot === -1 ? v : v.slice(0, dot);
  }

  function nowIso() { return new Date().toISOString(); }
  function nowMs() { return Date.now(); }

  // ---- Modul-Zustand ----

  var ready = false;
  var bridgeRegistered = false;
  // Bau 07.Y: pro Slot ein cached CryptoKey (statt einem globalen).
  var ownPrivateKeyCacheBySlot = new Map();
  var pseudoSiblings = null;       // null oder Array<{nodeId,domain,endpoint,pubKey,since}> — Test-Bridge

  // Self-Apoptose-Token lebt im Closure (nicht in IndexedDB) — er soll
  // weder Browser-Refresh noch Cleanup-Reihenfolge überleben.
  var apoptoseToken = null;        // { token, reason, expiresAt:number }

  // Bau 07.Y: aktiver Slot wird im init() einmal aus
  // `getActiveIdentityKey()` gecached. Operations cachen ihn nochmal
  // lokal (gegen Mid-Operation-Wechsel).
  var activeSlotKey = null;
  // Bau 07.Y: Receiver-Map nodeId → slotKey, im init() einmal aus
  // `listIdentities()` × `getOrCreateIdentity(slot)` aufgebaut. Re-Init
  // via Tab-Reload (Karte 07 § Receiver-Map-Schlank-Konvention).
  var receiverMap = new Map();

  // ---- init() ----

  async function init() {
    probeDependencies();
    getSubtle();
    await getStorage().init();
    await getSpore().init();
    // Bau 07.Y: aktive Identität sicherstellen — sonst kann Modul 07
    // später nicht signieren (Modul 02 ist beim ersten Aufruf lazy).
    await getSpore().getOrCreateIdentity();

    // Bau 07.Y: aktiven Slot cachen + slot-spezifische Stores anlegen.
    var spore = getSpore();
    activeSlotKey = await spore.getActiveIdentityKey();
    await ensureSlotStores(activeSlotKey);

    // Bau 07.Y: Receiver-Map nodeId → slotKey einmal aus
    // listIdentities × getOrCreateIdentity(slot) bauen.
    receiverMap = new Map();
    var slots = await spore.listIdentities();
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      var ident = await spore.getOrCreateIdentity(slot);
      receiverMap.set(ident.nodeId, slot);
    }

    setupServiceWorkerBridge();
    ready = true;
    // Spec: keine TTL-Sweeps in init(). Kein setInterval, kein
    // Selbst-Sweep. Aufrufer muss forgetExpiredSiblings(maxAgeMs)
    // explizit triggern (Variante c).
  }

  async function ensureReady() {
    if (!ready) await init();
  }

  async function loadOwnPrivateKey(slotKey) {
    // Bau 07.Y: pro Slot ein cached CryptoKey.
    var sk = slotKey || activeSlotKey || DEFAULT_IDENTITY_KEY;
    if (ownPrivateKeyCacheBySlot.has(sk)) return ownPrivateKeyCacheBySlot.get(sk);
    var storage = getStorage();
    var stored = await storage.get(KEYS_STORE, sk);
    if (!stored || !stored.privateKey) {
      throw makeError(
        "NoIdentityError",
        "Keine Identität in sbkim_keys[\"" + sk + "\"] — getOrCreateIdentity('" + sk +
          "') wurde nicht ausgeführt.",
      );
    }
    var subtle = getSubtle();
    var priv;
    try {
      priv = await subtle.importKey("jwk", stored.privateKey, { name: "Ed25519" }, true, ["sign"]);
    } catch (err) {
      throw makeError(
        "ApoptoseDependenciesError",
        "Privatschlüssel nicht importierbar (slot=" + sk + "): " +
          (err && err.message ? err.message : err),
        err,
      );
    }
    ownPrivateKeyCacheBySlot.set(sk, priv);
    return priv;
  }

  // ---- Service-Worker-Brücke (Variante A: Page-Hosted via MessageChannel) ----

  function setupServiceWorkerBridge() {
    if (bridgeRegistered) return;
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    try {
      navigator.serviceWorker.addEventListener("message", async function (event) {
        if (!event || !event.data || event.data.type !== "SBKIM_LEGACY_REQUEST") return;
        if (!event.ports || event.ports.length === 0) return;
        var port = event.ports[0];
        var response;
        try {
          response = await receiveLegacy(event.data.request);
        } catch (err) {
          // receiveLegacy wirft per Spec niemals. Verteidigt sicherheitshalber.
          response = { outcome: "rejected", reason: "Interner Fehler: " + (err && err.message ? err.message : err) };
        }
        try { port.postMessage(response); } catch (e2) { /* port already closed */ }
      });
      bridgeRegistered = true;
    } catch (err) {
      bridgeRegistered = false;
    }
  }

  // ---- Geschwister-Quelle (Storage oder Pseudo-Override für Tests) ----

  async function listSiblingsForBroadcast(slotKey) {
    // Bau 07.Y: liest aus sbkim_siblings_<slot>. Pseudo-Siblings sind
    // in-memory (Test-Brücke) und gelten persona-übergreifend — Klaus'
    // Test-Setup nutzt das für Self-Apoptose, ohne pro Persona Pseudo-
    // Siblings setzen zu müssen.
    if (Array.isArray(pseudoSiblings)) {
      return pseudoSiblings.slice();
    }
    var sk = slotKey || activeSlotKey || DEFAULT_IDENTITY_KEY;
    var rows;
    try {
      rows = await getStorage().all(siblingsStoreName(sk));
    } catch (err) {
      // Slot ohne sbkim_siblings_<slot>-Store → leere Liste (fail-soft).
      return [];
    }
    return rows.map(function (r) {
      return {
        nodeId: r.value.nodeId,
        domain: r.value.domain,
        endpoint: r.value.endpoint,
        pubKey: r.value.pubKey,
        since: r.value.since,
      };
    });
  }

  // ---- prepareSelfApoptose() ----

  async function prepareSelfApoptose(reason) {
    await ensureReady();
    if (typeof reason !== "string" || reason.length === 0) {
      throw makeError(
        "ApoptoseDependenciesError",
        "reason fehlt oder ist leer — bitte deutschen Klartext angeben, z.B. \"Domain stillgelegt\".",
      );
    }
    // Identität sicherstellen (wirft NoIdentityError, wenn keine da ist).
    await getSpore().getNodeId();

    var token = randomBytesB64(APOPTOSE_TOKEN_BYTES);
    var expiresAt = nowMs() + APOPTOSE_TOKEN_TTL_MS;
    apoptoseToken = { token: token, reason: reason, expiresAt: expiresAt };

    if (typeof console !== "undefined" && console.warn) {
      console.warn("SELF-APOPTOSE VORBEREITET — irreversibel, Token gültig 60s");
    }

    // Bau 07.Y: globale Self-Apoptose iteriert über alle Slots. Der
    // recipientCount zählt Geschwister über ALLE Slots, weil die
    // Apoptose pro Slot ein Vermächtnis sendet.
    var totalRecipients = 0;
    if (Array.isArray(pseudoSiblings)) {
      // Test-Brücke: Pseudo-Siblings gelten persona-übergreifend.
      totalRecipients = pseudoSiblings.length;
    } else {
      var spore = getSpore();
      var slots = await spore.listIdentities();
      for (var s = 0; s < slots.length; s++) {
        var slotSibs = await listSiblingsForBroadcast(slots[s]);
        totalRecipients += slotSibs.length;
      }
    }
    return {
      confirmationToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
      recipientCount: totalRecipients,
    };
  }

  // ---- confirmSelfApoptose() — irreversibel ----

  async function confirmSelfApoptose(token, reason) {
    await ensureReady();

    if (!apoptoseToken) {
      throw makeError(
        "InvalidApoptoseTokenError",
        "Kein Apoptose-Token vorbereitet. prepareSelfApoptose(reason) zuerst aufrufen.",
      );
    }
    if (typeof token !== "string" || token !== apoptoseToken.token) {
      throw makeError(
        "InvalidApoptoseTokenError",
        "Apoptose-Token stimmt nicht. Bitte den aus prepareSelfApoptose zurückgegebenen confirmationToken nutzen.",
      );
    }
    if (nowMs() > apoptoseToken.expiresAt) {
      apoptoseToken = null;
      throw makeError(
        "InvalidApoptoseTokenError",
        "Apoptose-Token abgelaufen (60s). prepareSelfApoptose erneut aufrufen.",
      );
    }
    if (typeof reason !== "string" || reason !== apoptoseToken.reason) {
      throw makeError(
        "InvalidApoptoseTokenError",
        "reason weicht vom Token-Aufruf ab — confirmSelfApoptose verlangt identisches reason wie prepareSelfApoptose.",
      );
    }

    // Bau 07.Y: Globale Self-Apoptose iteriert über ALLE Slots.
    // Pro Slot wird das Persona-Vermächtnis gesendet (via Hook
    // _sendLegacyForIdentity); danach pro Slot Cleanup; zum Schluss
    // globaler Marker + Cache-Invalidate.
    var spore = getSpore();
    var slots;
    try {
      slots = await spore.listIdentities();
    } catch (err) {
      apoptoseToken = null;
      throw makeError(
        "ApoptoseAlreadyExecutedError",
        "listIdentities-Pfad fehlt — Self-Apoptose wurde wahrscheinlich schon ausgeführt: " +
          (err && err.message ? err.message : err),
        err,
      );
    }
    if (!Array.isArray(slots) || slots.length === 0) {
      apoptoseToken = null;
      throw makeError(
        "ApoptoseAlreadyExecutedError",
        "Keine Identitäten vorhanden — Self-Apoptose wurde wahrscheinlich schon ausgeführt.",
      );
    }

    // Token wird mit Beginn der irreversiblen Operation verbraucht.
    apoptoseToken = null;

    // 1. Pro Slot: Vermächtnis-Versand via _sendLegacyForIdentity. Der
    //    Hook ist intern fail-soft (siehe unten) und liefert pro Slot
    //    eine Liste von recipientsNotified + recipientsFailed. Aggregiert
    //    für das globale Ergebnis.
    var recipientsNotified = [];
    var recipientsFailed = [];
    for (var s = 0; s < slots.length; s++) {
      var slot = slots[s];
      var slotResult;
      try {
        slotResult = await _sendLegacyForIdentity(slot, reason);
      } catch (err) {
        // Sicherheitsnetz — _sendLegacyForIdentity ist intern fail-soft,
        // aber wir blocken Apoptose niemals.
        slotResult = { recipientsNotified: [], recipientsFailed: [], slotError: err && err.message };
        if (typeof console !== "undefined" && console.error) {
          console.error("MODUL 07 APOPTOSE: _sendLegacyForIdentity(" + slot + ") warf (sollte nicht):", err);
        }
      }
      if (Array.isArray(slotResult.recipientsNotified)) {
        for (var n = 0; n < slotResult.recipientsNotified.length; n++) {
          recipientsNotified.push(slotResult.recipientsNotified[n]);
        }
      }
      if (Array.isArray(slotResult.recipientsFailed)) {
        for (var f = 0; f < slotResult.recipientsFailed.length; f++) {
          recipientsFailed.push(slotResult.recipientsFailed[f]);
        }
      }
    }

    // 2. Lokaler Cleanup PRO SLOT, sequenziell. Reihenfolge der Bases
    //    pro Slot: CLEANUP_ORDER_BASES (siblings → log → legacy_inbox →
    //    hetero_inbox → hetero_outbox). Danach sbkim_keys[slot] +
    //    sbkim_spore[slot] (Identität als letzte Bastion, pro Slot).
    //    sbkim_doku_meta bleibt unangetastet (Schreiber 00).
    var storage = getStorage();
    for (var s2 = 0; s2 < slots.length; s2++) {
      var slot2 = slots[s2];
      for (var k = 0; k < CLEANUP_ORDER_BASES.length; k++) {
        var storeName = CLEANUP_ORDER_BASES[k] + "_" + slot2;
        try {
          await storage.clear(storeName);
        } catch (e) {
          // Slot-spezifischer Store kann fehlen (z.B. wenn ein Modul für
          // diesen Slot nie geschrieben hat). Fail-soft — Cleanup
          // läuft weiter.
        }
      }
      // Identität-pro-Slot: Spore + Keys. del ist idempotent (Modul-01-
      // Vertrag).
      try { await storage.del(SPORE_STORE, slot2); } catch (e) {}
      try { await storage.del(KEYS_STORE, slot2); } catch (e) {}
    }

    // 3. Globaler Marker: active-identity. del idempotent.
    try { await storage.del(META_STORE, ACTIVE_IDENTITY_META_KEY); } catch (e) {}

    // 4. Caches im Modul-Closure invalidieren.
    ownPrivateKeyCacheBySlot.clear();
    pseudoSiblings = null;
    activeSlotKey = null;
    receiverMap = new Map();

    // 5. Modul-02-Cache-Invalidate (Pflege-Sitzung 2026-05-15-Hook).
    if (typeof getSpore().resetIdentityCache === "function") {
      getSpore().resetIdentityCache();
    }

    return {
      outcome: "completed",
      recipientsNotified: recipientsNotified,
      recipientsFailed: recipientsFailed,
    };
  }

  // ---- _sendLegacyForIdentity(key, reason?) — Bau 07.Y interner Hook ----
  //
  // Aufrufer: (a) Bau 02.Y `removeIdentity(key, {force:true})` via
  // typeof-check (Modul 02 schluckt Würfe fail-soft); (b) Bau 07.Y
  // `confirmSelfApoptose` iteriert über alle Slots.
  //
  // Pflicht: sendet das Persona-Vermächtnis an die Geschwister DIESER
  // Persona (gelesen aus sbkim_siblings_<key>); signiert mit der
  // Persona-Identität (NICHT der globalen aktiven). KEIN Store-Cleanup
  // — Modul 02 räumt nach Bau 02.Y selbst für die per-Persona-
  // Apoptose; Modul 07's confirmSelfApoptose räumt nach _sendLegacyForIdentity
  // pro Slot.
  //
  // Fail-soft: gibt {recipientsNotified, recipientsFailed} zurück (auch
  // bei vielen Fehlern); wirft nur bei klaren Aufrufer-Fehlern (key
  // fehlt / Identität fehlt) oder echten Storage-Crashes.
  async function _sendLegacyForIdentity(key, reason) {
    if (typeof key !== "string" || key.length === 0) {
      throw makeError(
        "ApoptoseDependenciesError",
        "_sendLegacyForIdentity: key fehlt oder ist leer.",
      );
    }
    await ensureReady();

    var spore = getSpore();
    // Persona-Spore + Persona-Identität laden. fail-soft: wenn der Slot
    // gar nicht existiert (z.B. längst entfernt), gibt's nichts zu
    // verschicken — leere Ergebnis-Listen zurück.
    var ownSpore;
    try {
      ownSpore = await spore.getOwnSpore(key);
    } catch (e) {
      ownSpore = null;
    }
    if (!ownSpore) {
      return { recipientsNotified: [], recipientsFailed: [] };
    }
    var ident;
    try {
      ident = await spore.getOrCreateIdentity(key);
    } catch (e) {
      return { recipientsNotified: [], recipientsFailed: [] };
    }
    var ownNodeId = ident.nodeId;
    var privKey;
    try {
      privKey = await loadOwnPrivateKey(key);
    } catch (e) {
      return { recipientsNotified: [], recipientsFailed: [] };
    }

    // Reason fällt auf einen Default zurück, wenn der Aufrufer keinen
    // liefert (Modul 02 ruft ohne Argument; confirmSelfApoptose reicht
    // das verifizierte reason durch).
    var personalReason = typeof reason === "string" && reason.length > 0
      ? reason
      : "Persona-Apoptose (slot=" + key + ")";

    // Geschwister DIESER Persona aus sbkim_siblings_<key>.
    var siblings = await listSiblingsForBroadcast(key);

    // Bau 07.Y: pro Empfänger eine separat signierte LegacyMessage mit
    // `toNodeId: sibling.nodeId`. So kann der Empfänger via Receiver-
    // Map den richtigen Persona-Slot wählen. Sign + Send pro Sibling
    // parallel; fail-soft pro Empfänger.
    var sends = siblings.map(async function (sib) {
      var unsigned = {
        fromNodeId: ownNodeId,
        nonce: randomBytesB64(NONCE_BYTES),
        protocolVersion: PROTOCOL_VERSION,
        reason: personalReason,
        senderSpore: ownSpore,
        timestamp: nowIso(),
        toNodeId: sib.nodeId,
      };
      var sig = await signEnvelope(unsigned, privKey);
      var legacyMessage = canonicalize(Object.assign({}, unsigned, { signature: sig }));
      return await dispatchLegacyOnce(legacyMessage, sib);
    });
    var results = await Promise.allSettled(sends);

    var recipientsNotified = [];
    var recipientsFailed = [];
    for (var i = 0; i < results.length; i++) {
      var sib = siblings[i];
      var r = results[i];
      if (r.status === "fulfilled" && r.value && r.value.outcome === "accepted") {
        recipientsNotified.push(sib.nodeId);
      } else {
        var failReason;
        if (r.status === "rejected") {
          failReason = (r.reason && r.reason.message) ? r.reason.message : String(r.reason);
        } else if (r.value && typeof r.value.reason === "string") {
          failReason = r.value.reason;
        } else if (r.value && r.value.outcome) {
          failReason = "outcome=" + r.value.outcome;
        } else {
          failReason = "unbekannt";
        }
        recipientsFailed.push({ nodeId: sib.nodeId, reason: failReason });
      }
    }
    return { recipientsNotified: recipientsNotified, recipientsFailed: recipientsFailed };
  }

  // Schickt EINE LegacyMessage an EIN Geschwister, verifiziert die Response,
  // gibt {outcome:"accepted"} oder {outcome:"rejected", reason} zurück.
  // Wirft bei Timeout / Netz-Fehler — wird vom Promise.allSettled gefangen.
  async function dispatchLegacyOnce(legacyMessage, sibling) {
    if (!sibling || typeof sibling.endpoint !== "string") {
      return { outcome: "rejected", reason: "Geschwister ohne endpoint" };
    }
    var url = String(sibling.endpoint).replace(/\/$/, "") + ENDPOINT_LEGACY;
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, QUERY_TIMEOUT_MS);
    var response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacyMessage),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err && err.name === "AbortError") {
        throw makeError("LegacyTimeoutError", "Vermächtnis-POST > " + QUERY_TIMEOUT_MS + " ms abgebrochen: " + url, err);
      }
      throw makeError("LegacyNetworkError", "Netz-Fehler bei " + url + ": " + (err && err.message ? err.message : err), err);
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { outcome: "rejected", reason: "HTTP " + response.status + " " + response.statusText };
    }
    var json;
    try { json = await response.json(); }
    catch (err) {
      return { outcome: "rejected", reason: "Antwort kein gültiges JSON" };
    }

    if (!json || typeof json !== "object" || typeof json.outcome !== "string") {
      return { outcome: "rejected", reason: "Antwort ohne outcome-Feld" };
    }
    // Empfänger-Spore + Response-Signatur prüfen — analog Modul 05's consumeResponse.
    var spore = getSpore();
    var verifyReceiver = await spore.verifyForeignSpore(json.receiverSpore);
    if (!verifyReceiver.valid) {
      return { outcome: "rejected", reason: "receiverSpore ungültig: " + (verifyReceiver.reason || "?") };
    }
    var sigOk = await verifyEnvelope(json, json.receiverSpore.publicKey);
    if (!sigOk) {
      return { outcome: "rejected", reason: "Response-Signatur ungültig" };
    }
    if (json.outcome === "accepted") return { outcome: "accepted" };
    return { outcome: "rejected", reason: typeof json.reason === "string" ? json.reason : "(kein Grund mitgeschickt)" };
  }

  // ---- receiveLegacy() — wirft NIEMALS ----

  async function receiveLegacy(incomingLegacy) {
    try {
      await ensureReady();

      // 1. Form-Check (Pflichtfelder)
      var missing = checkLegacyFields(incomingLegacy);
      if (missing) {
        return await buildLegacyResponse({ outcome: "rejected", reason: "Form ungültig: " + missing }, incomingLegacy);
      }

      // 2. Sender-Spore verifizieren
      var verifySender = await getSpore().verifyForeignSpore(incomingLegacy.senderSpore);
      if (!verifySender.valid) {
        return await buildLegacyResponse(
          { outcome: "rejected", reason: verifySender.reason || "senderSpore ungültig" },
          incomingLegacy,
        );
      }

      // 3. Hauptversion (zusätzlich expliziter Check, vgl. §4)
      if (majorVersion(incomingLegacy.protocolVersion) !== majorVersion(PROTOCOL_VERSION)) {
        return await buildLegacyResponse(
          { outcome: "rejected", reason: "Inkompatible Hauptversion: " + incomingLegacy.protocolVersion },
          incomingLegacy,
        );
      }

      // 4. LegacyMessage-Signatur gegen senderSpore.publicKey
      var sigOk = await verifyEnvelope(incomingLegacy, incomingLegacy.senderSpore.publicKey);
      if (!sigOk) {
        return await buildLegacyResponse(
          { outcome: "rejected", reason: "Signatur ungültig" },
          incomingLegacy,
        );
      }

      // 5. Bau 07.Y: Receiver-Map-Lookup. LegacyMessage MUSS toNodeId
      //    enthalten, damit der Empfänger den Persona-Slot kennt.
      //    Pre-Brief-04-LegacyMessages haben kein toNodeId — Pre-Brief-
      //    04-Rückwärts-Kompat: ohne toNodeId fällt der Empfänger auf
      //    den aktiven Slot zurück (legacy single-identity-Flow).
      var targetSlot;
      if (typeof incomingLegacy.toNodeId === "string" && incomingLegacy.toNodeId.length > 0) {
        var mapped = receiverMap.get(incomingLegacy.toNodeId);
        if (mapped === undefined) {
          return await buildLegacyResponse(
            { outcome: "rejected", reason: "toNodeId stimmt nicht zum Empfänger" },
            incomingLegacy,
          );
        }
        targetSlot = mapped;
      } else {
        targetSlot = activeSlotKey || DEFAULT_IDENTITY_KEY;
      }

      // Bau 07.Y: defensiv ensureStore für den getroffenen Slot.
      await ensureSlotStores(targetSlot);

      // 6. Inbox-Schreib + Sibling-Löschen (slot-spezifisch). Storage-
      //    Fehler werden eingefangen und als „interner Speicherfehler"
      //    gemeldet, NIE geworfen.
      var storage = getStorage();
      try {
        await storage.put(legacyInboxStoreName(targetSlot), incomingLegacy.fromNodeId, {
          fromNodeId: incomingLegacy.fromNodeId,
          reason: incomingLegacy.reason,
          signature: incomingLegacy.signature,
          receivedAt: nowIso(),
        });
        // Idempotent: falls fromNodeId gar kein Geschwister war, ist
        // del im Storage-Wrapper trotzdem ohne Fehler.
        await storage.del(siblingsStoreName(targetSlot), incomingLegacy.fromNodeId);
      } catch (storageErr) {
        if (typeof console !== "undefined" && console.error) {
          console.error("MODUL 07 APOPTOSE: Storage-Fehler beim receiveLegacy-Schreib (slot=" + targetSlot + "):", storageErr);
        }
        return await buildLegacyResponse(
          { outcome: "rejected", reason: "interner Speicherfehler" },
          incomingLegacy,
          targetSlot,
        );
      }

      // 7. Signierte accepted-Response mit der getroffenen Persona.
      return await buildLegacyResponse({ outcome: "accepted" }, incomingLegacy, targetSlot);
    } catch (err) {
      // Spec: receiveLegacy wirft niemals. Wenn doch (z.B. Build-Response
      // scheitert weil eigene Spore fehlt), schicken wir eine unsignierte
      // Notbremse — der Sender wird die unsignierte Variante über
      // verifyEnvelope ablehnen, und das ist richtig: bei totalem
      // Empfänger-Ausfall darf nichts „valide" antworten.
      try {
        return await buildLegacyResponse(
          { outcome: "rejected", reason: "Interner Fehler: " + (err && err.message ? err.message : err) },
          incomingLegacy || {},
        );
      } catch (err2) {
        return {
          fromNodeId: "",
          nonceEcho: (incomingLegacy && typeof incomingLegacy.nonce === "string") ? incomingLegacy.nonce : "",
          outcome: "rejected",
          protocolVersion: PROTOCOL_VERSION,
          reason: "Interner Fehler ohne Signatur: " + (err2 && err2.message ? err2.message : err2),
          timestamp: nowIso(),
          toNodeId: (incomingLegacy && typeof incomingLegacy.fromNodeId === "string") ? incomingLegacy.fromNodeId : "",
        };
      }
    }
  }

  function checkLegacyFields(legacy) {
    if (!legacy || typeof legacy !== "object") return "LegacyMessage ist kein Objekt";
    for (var i = 0; i < LEGACY_REQUIRED_FIELDS.length; i++) {
      var f = LEGACY_REQUIRED_FIELDS[i];
      if (legacy[f] === undefined || legacy[f] === null) return "Pflichtfeld fehlt: " + f;
    }
    if (typeof legacy.senderSpore !== "object") return "senderSpore kein Objekt";
    if (typeof legacy.reason !== "string" || legacy.reason.length === 0) return "reason leer";
    return null;
  }

  async function buildLegacyResponse(extra, incomingLegacy, slotKey) {
    var spore = getSpore();
    // Bau 07.Y: ohne slot-Argument fällt buildLegacyResponse auf den
    // aktiven Slot zurück (Pre-Receiver-Map-Pfad, z.B. malformede
    // LegacyMessages). Mit Argument signiert mit der getroffenen
    // Persona.
    var sk = slotKey || activeSlotKey || DEFAULT_IDENTITY_KEY;
    var ownSpore = await spore.getOwnSpore(sk);
    if (!ownSpore) {
      throw makeError(
        "ApoptoseDependenciesError",
        "Eigene Spore fehlt (slot=" + sk + ") — LegacyResponse kann nicht signiert werden.",
      );
    }
    var privKey = await loadOwnPrivateKey(sk);
    var ident = await spore.getOrCreateIdentity(sk);
    var ownNodeId = ident.nodeId;

    var unsigned = {
      fromNodeId: ownNodeId,
      nonceEcho: (incomingLegacy && typeof incomingLegacy.nonce === "string") ? incomingLegacy.nonce : "",
      outcome: extra.outcome,
      protocolVersion: PROTOCOL_VERSION,
      receiverSpore: ownSpore,
      timestamp: nowIso(),
      toNodeId: (incomingLegacy && typeof incomingLegacy.fromNodeId === "string") ? incomingLegacy.fromNodeId : "",
    };
    if (extra.reason !== undefined) unsigned.reason = extra.reason;

    var sig = await signEnvelope(unsigned, privKey);
    var signed = Object.assign({}, unsigned, { signature: sig });
    return canonicalize(signed);
  }

  // ---- listLegacy() ----

  async function listLegacy(key) {
    // Bau 07.Y: optionaler key-Parameter. Default = aktiver Slot.
    // Persona-übergreifende Sicht: Aufrufer iteriert via
    // SbkimSpore.listIdentities() × listLegacy(slot).
    await ensureReady();
    var sk = (typeof key === "string" && key.length > 0) ? key : activeSlotKey;
    var rows;
    try {
      rows = await getStorage().all(legacyInboxStoreName(sk));
    } catch (e) {
      // Slot ohne legacy-inbox-Store → leere Liste (fail-soft).
      return [];
    }
    return rows.map(function (r) {
      return {
        fromNodeId: r.value.fromNodeId,
        reason: r.value.reason,
        receivedAt: r.value.receivedAt,
      };
    });
  }

  // ---- forgetExpiredSiblings(maxAgeMs) ----
  //
  // TTL-Sweep, explizit ausgelöst. Modul 07 macht NIE einen Sweep im
  // init() oder über setInterval.

  async function forgetExpiredSiblings(maxAgeMs, key) {
    // Bau 07.Y: optionaler key-Parameter. Default = aktiver Slot.
    // Persona-übergreifender Sweep: Aufrufer iteriert via
    // listIdentities() × forgetExpiredSiblings(maxAge, slot).
    if (typeof maxAgeMs !== "number" || !isFinite(maxAgeMs) || maxAgeMs <= 0) {
      throw makeError(
        "InvalidTtlError",
        "forgetExpiredSiblings braucht maxAgeMs > 0 (z.B. SIBLING_MAX_AGE_MS aus §0). Bekommen: " + maxAgeMs,
      );
    }
    await ensureReady();
    var sk = (typeof key === "string" && key.length > 0) ? key : activeSlotKey;
    var storage = getStorage();
    var siblings;
    try {
      siblings = await storage.all(siblingsStoreName(sk));
    } catch (e) {
      // Slot ohne sbkim_siblings-Store → nichts zu sweepen.
      return [];
    }
    if (siblings.length === 0) return [];

    var logRows;
    try {
      logRows = await storage.all(anastomosisLogStoreName(sk));
    } catch (e) {
      logRows = [];
    }
    // lastActivity pro peerId: höchstes ts mit outcome ∈ {"established","re-handshake"}.
    var lastActivityByPeer = Object.create(null);
    for (var i = 0; i < logRows.length; i++) {
      var entry = logRows[i] && logRows[i].value;
      if (!entry || typeof entry.peerId !== "string") continue;
      if (entry.outcome !== "established" && entry.outcome !== "re-handshake") continue;
      var ts = typeof entry.ts === "string" ? entry.ts : null;
      if (!ts) continue;
      if (!lastActivityByPeer[entry.peerId] || ts > lastActivityByPeer[entry.peerId]) {
        lastActivityByPeer[entry.peerId] = ts;
      }
    }

    var now = nowMs();
    var removed = [];
    for (var s = 0; s < siblings.length; s++) {
      var v = siblings[s] && siblings[s].value;
      if (!v || typeof v.nodeId !== "string") continue;
      var lastIso = lastActivityByPeer[v.nodeId] || v.since;
      if (typeof lastIso !== "string") continue;
      var lastMs = Date.parse(lastIso);
      if (!isFinite(lastMs)) continue;
      if (now - lastMs > maxAgeMs) {
        await storage.del(siblingsStoreName(sk), v.nodeId);
        removed.push({ nodeId: v.nodeId, lastSeen: lastIso });
      }
    }
    return removed;
  }

  // ---- Test-Brücken (Unterstrich-Präfix, inoffiziell) ----

  // Baut eine signierte LegacyMessage aus der lokalen Identität — wie
  // confirmSelfApoptose es täte, aber OHNE Versand und OHNE Cleanup.
  // Erlaubt dem Panel, Signatur-Manipulationen + Versions-Mismatch zu
  // testen.
  async function _buildSignedLegacyMessage(reason) {
    await ensureReady();
    if (typeof reason !== "string" || reason.length === 0) {
      throw makeError("ApoptoseDependenciesError", "reason fehlt oder ist leer.");
    }
    // Bau 07.Y: Test-Brücke signiert mit der aktiven Identität.
    var spore = getSpore();
    var opSlot = activeSlotKey || await spore.getActiveIdentityKey();
    var ownSpore = await spore.getOwnSpore(opSlot);
    if (!ownSpore) {
      throw makeError("ApoptoseDependenciesError",
        "Eigene Spore fehlt (slot=" + opSlot + ") — generateOwnSpore(meta) zuerst.");
    }
    var ident = await spore.getOrCreateIdentity(opSlot);
    var ownNodeId = ident.nodeId;
    var privKey = await loadOwnPrivateKey(opSlot);
    var unsigned = {
      fromNodeId: ownNodeId,
      nonce: randomBytesB64(NONCE_BYTES),
      protocolVersion: PROTOCOL_VERSION,
      reason: reason,
      senderSpore: ownSpore,
      timestamp: nowIso(),
    };
    var sig = await signEnvelope(unsigned, privKey);
    return canonicalize(Object.assign({}, unsigned, { signature: sig }));
  }

  function _addPseudoSibling(sib) {
    if (!sib || typeof sib.nodeId !== "string" || typeof sib.endpoint !== "string") {
      throw makeError(
        "ApoptoseDependenciesError",
        "_addPseudoSibling erwartet {nodeId, domain, endpoint, pubKey, since}.",
      );
    }
    if (!Array.isArray(pseudoSiblings)) pseudoSiblings = [];
    pseudoSiblings.push({
      nodeId: sib.nodeId,
      domain: sib.domain || "",
      endpoint: sib.endpoint,
      pubKey: sib.pubKey || null,
      since: sib.since || nowIso(),
    });
  }

  function _clearPseudoSiblings() {
    pseudoSiblings = null;
  }

  // Test-Bridge: verschiebt die Token-Ablaufzeit, damit Panel-Test 7
  // (Token-Ablauf) den 61-Sekunden-Lauf nicht abwarten muss.
  function _advanceTokenClock(ms) {
    if (!apoptoseToken) return false;
    if (typeof ms !== "number" || !isFinite(ms)) {
      throw makeError("ApoptoseDependenciesError", "_advanceTokenClock erwartet eine endliche Zahl.");
    }
    apoptoseToken.expiresAt -= ms;
    return true;
  }

  // ---- public surface ----

  var SbkimApoptose = {
    init: init,
    prepareSelfApoptose: prepareSelfApoptose,
    confirmSelfApoptose: confirmSelfApoptose,
    receiveLegacy: receiveLegacy,
    listLegacy: listLegacy,
    forgetExpiredSiblings: forgetExpiredSiblings,

    // Bau 07.Y: interner Hook, von Modul 02 `removeIdentity(key,
    // {force:true})` via typeof-check gerufen. Wird zusätzlich von
    // confirmSelfApoptose pro Slot gerufen.
    _sendLegacyForIdentity: _sendLegacyForIdentity,

    // Test-Brücken
    _invokeReceiveLegacyDirect: receiveLegacy,
    _buildSignedLegacyMessage: _buildSignedLegacyMessage,
    _addPseudoSibling: _addPseudoSibling,
    _clearPseudoSiblings: _clearPseudoSiblings,
    _advanceTokenClock: _advanceTokenClock,
    _canonicalize: canonicalize,
    _base64urlEncode: base64urlEncode,
    _base64urlDecode: base64urlDecode,
    _signEnvelope: signEnvelope,
    _verifyEnvelope: verifyEnvelope,

    _meta: {
      protocolVersion: PROTOCOL_VERSION,
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      endpointLegacy: ENDPOINT_LEGACY,
      apoptoseTokenTtlMs: APOPTOSE_TOKEN_TTL_MS,
      // Bau 07.Y: Stores leben slot-suffixed. Basis-Namen als Read-Anker.
      inboxStoreBase: INBOX_STORE_BASE,
      siblingsStoreBase: SIBLINGS_STORE_BASE,
      logStoreBase: LOG_STORE_BASE,
      heteroInboxStoreBase: HETERO_INBOX_STORE_BASE,
      heteroOutboxStoreBase: HETERO_OUTBOX_STORE_BASE,
      cleanupOrderBases: CLEANUP_ORDER_BASES.slice(),
      get activeSlotKey() { return activeSlotKey; },
      get receiverMapSize() { return receiverMap ? receiverMap.size : 0; },
      legacyRequiredFields: LEGACY_REQUIRED_FIELDS.slice(),
    },
  };

  global.SbkimApoptose = SbkimApoptose;

  // Self-check: synchronous on script load. Format uniform across SBKIM —
  // see INTERFACES.md §1 Modul 07. Die irreversible Natur erscheint erst
  // beim Aufruf von prepareSelfApoptose als console.warn — nicht hier.
  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 07 APOPTOSE bereit, Funktionen: " +
        "init/prepareSelfApoptose/confirmSelfApoptose/receiveLegacy/listLegacy/forgetExpiredSiblings",
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
