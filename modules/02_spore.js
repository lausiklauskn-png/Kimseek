/*
 * SBKIM — Modul 02 — Spore
 *
 * Multi-Identity Ed25519 owner per PWA (Bau 02.Y, 2026-05-19). Persists
 * an arbitrary number of identity slots via window.SbkimStorage (keys
 * "main" plus free-form Slot-Keys in sbkim_keys), derives each node_id
 * as base64url(sha256(rawPublicKey)) without padding, builds and signs
 * the spore JSON per slot, verifies foreign spores. The active slot is
 * tracked in sbkim_meta["active-identity"] (default "main"). No direct
 * IndexedDB access, no polyfill.
 *
 * Public surface (registered on window.SbkimSpore):
 *   init() -> Promise<void>
 *   getOrCreateIdentity(key?) -> Promise<{ nodeId, publicKeyJwk }>
 *   getNodeId() -> Promise<string>
 *   getPublicKeyJwk() -> Promise<JsonWebKey>
 *   generateOwnSpore(meta, key?) -> Promise<SporeJson>
 *   regenerateOwnSpore(updates, key?) -> Promise<SporeJson>  // gleiche nodeId, neu signiert
 *   getOwnSpore(key?) -> Promise<SporeJson | null>
 *   verifyForeignSpore(spore) -> Promise<{ valid, reason? }>
 *   setActiveIdentity(key) -> Promise<void>
 *   getActiveIdentityKey() -> Promise<string>
 *   listIdentities() -> Promise<string[]>
 *   removeIdentity(key, options?) -> Promise<boolean>
 *   resetIdentityCache() -> void
 *   exportBackup(password) -> Promise<SbkimBackupBlob>
 *   importBackup(blob, password, options?) -> Promise<{ restored, reason? }>
 *
 * Self-check: emits a console.info line on script load (synchronous,
 * before any call). Key generation is lazy and happens on the first
 * getOrCreateIdentity(key) call for the given slot. See INTERFACES.md
 * § 1 Modul 02 + § 9 Identitäts-Map and docs/components/02_spore.md.
 *
 * Bau 02.X Backup-Export (2026-05-16): added the AES-GCM+PBKDF2 backup
 * path (BACKUP_FORMAT_VERSION 1, payload schema 1).
 *
 * Bau 02.Y Multi-Identitäts-API + Backup-Schema-Bump (2026-05-19):
 * additive expansion to multi-slot identities. New API:
 * setActiveIdentity / getActiveIdentityKey / listIdentities /
 * removeIdentity, plus optional key parameter on getOrCreateIdentity /
 * generateOwnSpore / getOwnSpore. Identity-specific stores are created
 * via SbkimStorage.ensureStore (Bau 01.Y) on first write per slot.
 * Backup wrapper is bumped to BACKUP_FORMAT_VERSION 2 with new payload
 * field identities[]; v=1 backups remain importable (Rückwärts-Kompat
 * to Klaus' Mein-Mixarium/Mein-Rezeptbuch backups vom 2026-05-16).
 */
(function (global) {
  "use strict";

  // Spore v0.2 (Spec-Sitzung 2026-07-14): Bump 0.1 → 0.2 (MINOR, gleiche
  // Hauptversion "0"). A10 fügt optional `snippetVectors` hinzu; A6 schließt
  // den echten domainVector verbindlich. Sanfter Übergang: verifyForeignSpore
  // vergleicht nur die Hauptversion → 0.1- und 0.2-Sporen bleiben gegenseitig
  // handshake-kompatibel. Spiegelt INTERFACES §0 PROTOCOL_VERSION.
  var PROTOCOL_VERSION = "0.2";
  var EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
  // A10 „Schnipsel-Mittel" (Spore v0.2). Spiegelt INTERFACES §0 SPORE_SNIPPET_MAX.
  // Obergrenze für snippetVectors[]; Modul 02 kürzt hart darauf (kein Throw).
  var SPORE_SNIPPET_MAX = 20;
  var SPORE_SNIPPET_VEC_DIM = 384;
  var DEFAULT_IDENTITY_KEY = "main";
  var KEYS_STORE = "sbkim_keys";
  var SPORE_STORE = "sbkim_spore";
  var META_STORE = "sbkim_meta";
  var ACTIVE_IDENTITY_META_KEY = "active-identity";
  var VALID_NODE_TYPES = ["provider", "seeker", "hybrid"];
  var REQUIRED_SPORE_FIELDS = [
    "createdAt",
    "domain",
    "embeddingModel",
    "endpoint",
    "id",
    "nodeType",
    "protocolVersion",
    "publicKey",
    "signature",
  ];

  // Bau 02.Y: identitäts-spezifische Store-Basen. Pro Persona ein Store
  // pro Basis; Modul 02 ruft ensureStore("<base>_<key>") für alle fünf,
  // BEVOR er den ersten Schreibvorgang in einen davon macht.
  // Spec-Quelle INTERFACES.md § 9.2 (Brief 04 + Bau 02.Y).
  var IDENTITY_STORE_BASES = [
    "sbkim_siblings",
    "sbkim_anastomosis_log",
    "sbkim_legacy_inbox",
    "sbkim_hetero_inbox",
    "sbkim_hetero_outbox",
  ];

  // §0-Konstanten, hier gespiegelt (Sage-Protokol hat noch kein
  // konfig-Modul-System — INTERFACES.md §0 trägt den „sobald
  // angelegt"-Hinweis; Bau 02.Y bumpt BACKUP_FORMAT_VERSION 1 → 2).
  var BACKUP_FORMAT_VERSION = 2;
  // Bau 02.Y: Lesen ist asymmetrisch zum Schreiben — alte v=1-Backups
  // (Bau 02.X, Klaus' Backup vom 2026-05-16) bleiben importierbar.
  var BACKUP_FORMAT_VERSION_READ_OK = [1, 2];
  var BACKUP_KDF_ITERATIONS = 600000;
  var BACKUP_PASSWORD_MIN_LEN = 8;

  // Modul-lokale Backup-Konstanten (Karte 02 § Konfigurationswerte).
  // Bau 02.Y bumpt das Klartext-Payload-Schema von 1 auf 2 (neues
  // Pflicht-Feld payload.identities[]).
  var BACKUP_PAYLOAD_SCHEMA_VERSION = 2;
  var BACKUP_KDF_SALT_BYTES = 16;
  var BACKUP_CIPHER_IV_BYTES = 12;

  function makeError(name, message, cause) {
    var e = new Error(message);
    e.name = name;
    if (cause !== undefined) e.cause = cause;
    return e;
  }

  // Fünf Error-Klassen für den Backup-Pfad (Bau 02.X) + zwei für die
  // Multi-Identitäts-API (Bau 02.Y). Auf window.SbkimSpore.<Error>
  // exportiert; intern bevorzugt makeError("Name", ...).
  function InvalidBackupPasswordError(message) { return makeError("InvalidBackupPasswordError", message); }
  function BackupDecryptError(message, cause) { return makeError("BackupDecryptError", message, cause); }
  function BackupVersionMismatchError(message) { return makeError("BackupVersionMismatchError", message); }
  function BackupSchemaError(message) { return makeError("BackupSchemaError", message); }
  function BackupOverwriteError(message) { return makeError("BackupOverwriteError", message); }
  function UnknownIdentityError(message) { return makeError("UnknownIdentityError", message); }
  function RemoveActiveIdentityError(message) { return makeError("RemoveActiveIdentityError", message); }

  function getSubtle() {
    var c = global.crypto || (typeof crypto !== "undefined" ? crypto : null);
    if (!c || !c.subtle) {
      throw makeError(
        "CryptoUnavailableError",
        "WebCrypto (crypto.subtle) ist nicht verfügbar. Modul 02 braucht moderne Browser " +
          "(Chrome ≥ 113, Firefox ≥ 130, Safari ≥ 17). Kein Polyfill.",
      );
    }
    return c.subtle;
  }

  function getStorage() {
    if (!global.SbkimStorage) {
      throw makeError(
        "StorageUnavailableError",
        "window.SbkimStorage nicht geladen. Modul 02 persistiert ausschließlich über Modul 01 — " +
          "lade src/modules/01_storage.js vor 02_spore.js.",
      );
    }
    return global.SbkimStorage;
  }

  // base64url ohne Padding (RFC 4648 §5).
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

  // Backup-Pfad: leitet den AES-GCM-Key aus dem Passwort ab. KDF-Pfad
  // verbindlich aus Karte 02 § Datenformat „Backup-Format" — PBKDF2-
  // SHA-256 mit BACKUP_KDF_ITERATIONS Runden gegen einen 16-Byte-Salt.
  async function derivePbkdf2AesGcmKey(password, salt, iterations) {
    var subtle = getSubtle();
    var material = utf8Encode(password);
    var baseKey = await subtle.importKey(
      "raw",
      material,
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    return await subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  // Recursive lexicographic key sort. Returns a new object so the
  // caller's input is never mutated.
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

  function canonicalJsonBytes(obj) {
    return utf8Encode(JSON.stringify(canonicalize(obj)));
  }

  // node_id = base64url(sha256(rawPublicKey)) without padding.
  async function deriveNodeIdFromPublicKey(publicKey) {
    var subtle = getSubtle();
    var raw = await subtle.exportKey("raw", publicKey);
    var hash = await subtle.digest("SHA-256", raw);
    return base64urlEncode(hash);
  }

  async function deriveNodeIdFromJwk(publicJwk) {
    var subtle = getSubtle();
    var pub = await subtle.importKey(
      "jwk",
      publicJwk,
      { name: "Ed25519" },
      true,
      ["verify"],
    );
    return await deriveNodeIdFromPublicKey(pub);
  }

  // ---- module state (lazy) ----

  var ready = false;
  // Bau 02.Y: Map key → IdentitySnapshot. Vor Brief 04 ein Singleton;
  // additive Erweiterung — resetIdentityCache() leert die ganze Map.
  // Snapshot-Form: { nodeId, publicKeyJwk, privateKey, publicKey }.
  var identityCache = new Map();
  // Bau 02.Y: Lese-Cache für den active-identity-Marker. Sync-Read-Anker
  // für getActiveIdentityKey nach dem ersten Storage-Lookup; null = noch
  // nicht gelesen. setActiveIdentity / removeIdentity / resetIdentityCache
  // invalidieren bzw. setzen ihn.
  var activeIdentityKeyCache = null;
  // Bau 17: sbkim:alive-Custom-Event wird nach erfolgreichem
  // getOrCreateIdentity() einmal pro Sitzung gefeuert (Karte 17 §
  // Event-Bus-Schema). Flag-Schutz, damit jeder weitere
  // getOrCreateIdentity-Aufruf (z.B. für Sekundär-Persona) den Event
  // NICHT erneut dispatcht — Modul 17 LEBT-Slot reagiert auf den ersten.
  var aliveDispatched = false;

  function dispatchAliveOnce(nodeId) {
    if (aliveDispatched) return;
    aliveDispatched = true;
    try {
      if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
        global.dispatchEvent(new global.CustomEvent("sbkim:alive", {
          detail: {
            since:  new Date().toISOString(),
            nodeId: nodeId,
          },
          bubbles:    false,
          cancelable: false,
        }));
      }
    } catch (_e) {
      // fail-soft — Render-Schicht (Modul 17) ist optional.
    }
  }

  async function init() {
    // Probe WebCrypto and storage but do not generate keys.
    getSubtle();
    var storage = getStorage();
    await storage.init();
    ready = true;
  }

  async function ensureReady() {
    if (!ready) await init();
  }

  // Bau 02.Y: ruft SbkimStorage.ensureStore für alle fünf identitäts-
  // spezifischen Store-Basen mit dem Slot-Suffix. Aufrufer (Modul 02 in
  // getOrCreateIdentity / importBackup) ruft das BEVOR der erste
  // Schreibvorgang in einen davon stattfindet. Idempotent dank
  // ensureStore's Idempotenz-Garantie (Bau 01.Y).
  async function ensureIdentityStores(key) {
    var storage = getStorage();
    if (typeof storage.ensureStore !== "function") {
      // Modul 01 vor Bau 01.Y geladen — Multi-Identitäts-Pfad braucht
      // den ensureStore-Helper. Sprechende Fehler-Message.
      throw makeError(
        "StorageUnavailableError",
        "SbkimStorage.ensureStore fehlt — Bau 01.Y nicht eingespielt. " +
          "Multi-Identitäts-Pfad in Modul 02 (Bau 02.Y) braucht die achte öffentliche " +
          "Modul-01-Funktion.",
      );
    }
    // Bewusst seriell: jede ensureStore-Iteration bumpt db.version um 1,
    // schließt die aktuelle Verbindung und öffnet eine neue. Parallel-
    // Aufrufe würden alle gegen dieselbe alte db.version racen und sich
    // gegenseitig blockieren (mehrfache Versions-Bumps auf die gleiche
    // Ziel-Version). Bau 01.Y dokumentiert die lineare Choreografie.
    for (var i = 0; i < IDENTITY_STORE_BASES.length; i++) {
      await storage.ensureStore(IDENTITY_STORE_BASES[i] + "_" + key);
    }
  }

  // Bau 02.Y: sbkim_meta wird in Modul 01 nicht als Pflicht-Store
  // deklariert — der active-identity-Marker entsteht erst mit Brief 04 /
  // Bau 02.Y. Modul 02 legt den Store via ensureStore (Bau 01.Y, Option A
  // aus INTERFACES.md § 9.5) dynamisch an, bevor er ihn liest/schreibt.
  // Idempotent. KEIN Modul-01-Eingriff nötig.
  var metaStoreEnsured = false;
  async function ensureMetaStore() {
    if (metaStoreEnsured) return;
    var storage = getStorage();
    if (typeof storage.ensureStore !== "function") {
      throw makeError(
        "StorageUnavailableError",
        "SbkimStorage.ensureStore fehlt — Bau 01.Y nicht eingespielt. " +
          "Multi-Identitäts-Marker (sbkim_meta) braucht die achte öffentliche Modul-01-Funktion.",
      );
    }
    await storage.ensureStore(META_STORE);
    metaStoreEnsured = true;
  }

  async function loadIdentity(key) {
    var slotKey = key || DEFAULT_IDENTITY_KEY;
    if (identityCache.has(slotKey)) {
      var cached = identityCache.get(slotKey);
      // Pflege 17 Heartbeat 2026-05-26: jeder Pfad, der eine geladene
      // Identität liefert, soll `sbkim:alive` dispatchen. Bisher war
      // das nur in getOrCreateIdentity — Aufrufer wie generateOwnSpore
      // mit existing-Identity oder getNodeId/getPublicKeyJwk lösten das
      // nicht aus. Klaus' Sichttest 2026-05-26: LEBT bleibt grau wenn
      // die Identität schon im Storage liegt. Once-Flag im
      // dispatchAliveOnce schützt vor Doppel-Feuer.
      dispatchAliveOnce(cached.nodeId);
      return cached;
    }
    await ensureReady();
    var storage = getStorage();
    var subtle = getSubtle();
    var stored = await storage.get(KEYS_STORE, slotKey);
    if (!stored) return null;

    var privateKey = await subtle.importKey(
      "jwk",
      stored.privateKey,
      { name: "Ed25519" },
      true,
      ["sign"],
    );
    var publicKey = await subtle.importKey(
      "jwk",
      stored.publicKey,
      { name: "Ed25519" },
      true,
      ["verify"],
    );
    var nodeId = await deriveNodeIdFromPublicKey(publicKey);
    var snapshot = {
      nodeId: nodeId,
      publicKeyJwk: stored.publicKey,
      privateKey: privateKey,
      publicKey: publicKey,
    };
    identityCache.set(slotKey, snapshot);
    dispatchAliveOnce(nodeId);
    return snapshot;
  }

  async function getOrCreateIdentity(key) {
    var slotKey = key || DEFAULT_IDENTITY_KEY;
    var existing = await loadIdentity(slotKey);
    if (existing) {
      dispatchAliveOnce(existing.nodeId);
      return { nodeId: existing.nodeId, publicKeyJwk: existing.publicKeyJwk };
    }

    var subtle = getSubtle();
    var keyPair;
    try {
      keyPair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    } catch (err) {
      throw makeError(
        "CryptoUnavailableError",
        "Ed25519-Schlüsselerzeugung fehlgeschlagen: " + (err && err.message ? err.message : err) +
          ". Modul 02 braucht moderne WebCrypto-Unterstützung. Kein Polyfill.",
        err,
      );
    }

    var privateKeyJwk = await subtle.exportKey("jwk", keyPair.privateKey);
    var publicKeyJwk = await subtle.exportKey("jwk", keyPair.publicKey);
    var nodeId = await deriveNodeIdFromPublicKey(keyPair.publicKey);

    var storage = getStorage();

    // Bau 02.Y: identitäts-spezifische Stores ZUERST anlegen, BEVOR
    // sbkim_keys[slotKey] geschrieben wird. Bei EnsureStoreError-Reject
    // (z.B. Multi-Tab-onblocked-Befund, Sichttest 2026-05-19) bleibt
    // KEIN verwaister sbkim_keys-Eintrag zurück — kein Rollback nötig.
    // ensureStore ist idempotent (Bau 01.Y); ein nachfolgender retry
    // mit demselben slotKey überspringt existierende Stores.
    await ensureIdentityStores(slotKey);

    await storage.put(KEYS_STORE, slotKey, {
      keyId: slotKey,
      privateKey: privateKeyJwk,
      publicKey: publicKeyJwk,
    });

    identityCache.set(slotKey, {
      nodeId: nodeId,
      publicKeyJwk: publicKeyJwk,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
    });
    dispatchAliveOnce(nodeId);
    return { nodeId: nodeId, publicKeyJwk: publicKeyJwk };
  }

  async function getActiveIdentityKey() {
    if (typeof activeIdentityKeyCache === "string") return activeIdentityKeyCache;
    await ensureReady();
    await ensureMetaStore();
    var storage = getStorage();
    var stored = await storage.get(META_STORE, ACTIVE_IDENTITY_META_KEY);
    if (typeof stored === "string" && stored.length > 0) {
      activeIdentityKeyCache = stored;
      return stored;
    }
    // Default-Slot — Rückwärts-Kompat zum Singleton-Vertrag aus
    // Spec-Sitzung 02 (2026-05-14). Cache schreiben, damit der nächste
    // Aufruf nicht erneut den Storage liest.
    activeIdentityKeyCache = DEFAULT_IDENTITY_KEY;
    return DEFAULT_IDENTITY_KEY;
  }

  async function setActiveIdentity(key) {
    if (typeof key !== "string") {
      throw makeError(
        "TypeError",
        "setActiveIdentity erwartet einen String-Schlüssel; bekommen: " + typeof key + ".",
      );
    }
    await ensureReady();
    var storage = getStorage();
    var stored = await storage.get(KEYS_STORE, key);
    if (!stored) {
      throw UnknownIdentityError(
        "setActiveIdentity('" + key + "'): kein Eintrag in sbkim_keys. " +
          "Erst getOrCreateIdentity('" + key + "') aufrufen.",
      );
    }
    var current = await getActiveIdentityKey();
    if (current === key) {
      // Idempotent — kein Storage-Schreibvorgang, aber Cache-Pflege
      // (resetIdentityCache invalidiert Map, damit nachfolgende
      // getNodeId-Aufrufe sauber auf dem neuen Slot stehen — auch wenn
      // Slot bereits aktiv war, schadet das nicht).
      return;
    }
    await ensureMetaStore();
    await storage.put(META_STORE, ACTIVE_IDENTITY_META_KEY, key);
    activeIdentityKeyCache = key;
    resetIdentityCache();
  }

  async function listIdentities() {
    await ensureReady();
    var storage = getStorage();
    var rows = await storage.all(KEYS_STORE);
    if (!Array.isArray(rows)) return [];
    var keys = rows.map(function (r) { return r.key; }).filter(function (k) {
      return typeof k === "string" && k.length > 0;
    });
    // Lexikographisch sortieren — Spec-Pflicht aus INTERFACES.md § 1
    // Modul 02 listIdentities-Block. Array.prototype.sort() ist der
    // JS-Default für Strings (Codeunit-Vergleich).
    keys.sort();
    return keys;
  }

  async function removeIdentity(key, options) {
    if (typeof key !== "string" || key.length === 0) {
      throw makeError(
        "TypeError",
        "removeIdentity erwartet einen nicht-leeren String-Schlüssel; bekommen: " + typeof key + ".",
      );
    }
    var opts = options || {};
    var force = opts.force === true;

    await ensureReady();
    var storage = getStorage();
    var stored = await storage.get(KEYS_STORE, key);
    if (!stored) {
      // Idempotent — wie forgetSibling. Kein Throw.
      return false;
    }

    var activeKey = await getActiveIdentityKey();
    if (key === activeKey && !force) {
      throw RemoveActiveIdentityError(
        "removeIdentity('" + key + "') ohne {force:true} verweigert: '" + key +
          "' ist die aktive Identität. " +
          "Aufrufer muss erst setActiveIdentity(<anderer Slot>) rufen oder force:true setzen — " +
          "force triggert per-Persona-Apoptose mit Vermächtnis-Versand (Modul 07).",
      );
    }

    if (key === activeKey && force) {
      // Bau 02.Y: Vermächtnis-Versand pro Persona. Modul 07 bekommt
      // _sendLegacyForIdentity erst in Bau 07.Y implementiert; bis
      // dahin fail-soft (typeof-check, console.warn, kein Throw).
      // Heilige Tafel aus dem Brief: 07.Y und 02.Y können in beliebiger
      // Reihenfolge gemerged werden.
      if (
        global.SbkimApoptose &&
        typeof global.SbkimApoptose._sendLegacyForIdentity === "function"
      ) {
        try {
          await global.SbkimApoptose._sendLegacyForIdentity(key);
        } catch (err) {
          // Fail-soft: Vermächtnis-Versand-Fehler hält die per-Persona-
          // Apoptose nicht auf. Modul 07 ist Aufrufer-Pflicht-Trennung
          // (Bau 07.Y wird die genauen Fehler-Pfade spec'en).
          if (typeof console !== "undefined" && console.warn) {
            console.warn(
              "SbkimApoptose._sendLegacyForIdentity('" + key + "') warf: " +
                (err && err.message ? err.message : err) +
                " — Persona-Apoptose läuft trotzdem weiter.",
            );
          }
        }
      } else {
        if (typeof console !== "undefined" && console.warn) {
          console.warn(
            "SbkimApoptose._sendLegacyForIdentity nicht verfügbar (Bau 07.Y noch nicht eingespielt) — " +
              "Persona-Apoptose für '" + key + "' läuft ohne Vermächtnis-Versand. Aufrufer-" +
              "Konvention für die Übergangszeit (siehe Bau 02.Y Brief).",
          );
        }
      }
    }

    // Lösch-Pfad in INTERFACES § 1 Modul 02-konformer Reihenfolge:
    // sbkim_keys → sbkim_spore → fünf identitäts-spezifische Stores.
    // Die clear-Aufrufe sind fail-soft (try/catch um UnknownStoreError),
    // weil ein Slot nicht alle Stores haben muss — z.B. wenn die Persona
    // nie ein Heterokaryose-Pull oder Anastomose-Handshake bekommen hat.
    // KEIN dropStore-Pfad (Modul 01 bietet keinen, Karte 02 § Risiken
    // benennt das); die Stores bleiben als leere Stores in IndexedDB.
    await storage.del(KEYS_STORE, key);
    try { await storage.del(SPORE_STORE, key); }
    catch (e) { /* fail-soft */ }

    for (var i = 0; i < IDENTITY_STORE_BASES.length; i++) {
      var storeName = IDENTITY_STORE_BASES[i] + "_" + key;
      try {
        await storage.clear(storeName);
      } catch (err) {
        // UnknownStoreError ist erwartet, wenn der Slot diese Store-Basis
        // nie genutzt hat (siehe Brief: removeIdentity-Block fail-soft).
        if (err && err.name === "UnknownStoreError") continue;
        // Andere Fehler werden hochgereicht — das ist ein echtes
        // Storage-Problem.
        throw err;
      }
    }

    // Cache-Map: den Eintrag für key löschen (sauberer als die ganze
    // Map zu invalidieren, weil andere Slots im Cache bleiben sollen).
    identityCache.delete(key);

    if (key === activeKey) {
      // Neue aktive Identität wählen — "main" hat Vorrang, sonst
      // erster Slot aus listIdentities() (lexikographisch), sonst
      // Marker löschen.
      await ensureMetaStore();
      var mainStored = await storage.get(KEYS_STORE, DEFAULT_IDENTITY_KEY);
      if (mainStored) {
        await storage.put(META_STORE, ACTIVE_IDENTITY_META_KEY, DEFAULT_IDENTITY_KEY);
        activeIdentityKeyCache = DEFAULT_IDENTITY_KEY;
      } else {
        var remaining = await listIdentities();
        if (remaining.length > 0) {
          await storage.put(META_STORE, ACTIVE_IDENTITY_META_KEY, remaining[0]);
          activeIdentityKeyCache = remaining[0];
        } else {
          try { await storage.del(META_STORE, ACTIVE_IDENTITY_META_KEY); }
          catch (e) { /* fail-soft */ }
          activeIdentityKeyCache = null;
        }
      }
    }

    resetIdentityCache();
    return true;
  }

  async function getNodeId() {
    var activeKey = await getActiveIdentityKey();
    var id = await loadIdentity(activeKey);
    if (!id) {
      throw makeError(
        "NoIdentityError",
        "Es existiert noch keine Identität für Slot '" + activeKey + "'. " +
          "Erst getOrCreateIdentity('" + activeKey + "') aufrufen.",
      );
    }
    return id.nodeId;
  }

  async function getPublicKeyJwk() {
    var activeKey = await getActiveIdentityKey();
    var id = await loadIdentity(activeKey);
    if (!id) {
      throw makeError(
        "NoIdentityError",
        "Es existiert noch keine Identität für Slot '" + activeKey + "'. " +
          "Erst getOrCreateIdentity('" + activeKey + "') aufrufen.",
      );
    }
    return id.publicKeyJwk;
  }

  function validateSporeMeta(meta) {
    var missing = [];
    if (!meta || typeof meta !== "object") {
      throw makeError("InvalidSporeMetaError", "meta-Objekt fehlt oder ist kein Objekt.");
    }
    if (typeof meta.domain !== "string" || meta.domain.length === 0) missing.push("domain");
    if (typeof meta.endpoint !== "string" || meta.endpoint.length === 0) missing.push("endpoint");
    if (typeof meta.nodeType !== "string") missing.push("nodeType");
    if (missing.length > 0) {
      throw makeError(
        "InvalidSporeMetaError",
        "Pflichtfelder fehlen oder leer: " + missing.join(", ") + ".",
      );
    }
    if (VALID_NODE_TYPES.indexOf(meta.nodeType) === -1) {
      throw makeError(
        "InvalidSporeMetaError",
        "nodeType '" + meta.nodeType + "' ungültig. Erlaubt: " + VALID_NODE_TYPES.join(", ") + ".",
      );
    }
  }

  // --- A10: snippetVectors bereinigen (Spore v0.2) -------------------------
  // Nimmt meta.snippetVectors (Array<{vec:number[384]|Float32Array, text?}>)
  // und liefert kanonisch signierbare Einträge {vec:number[384], text?}.
  // HARTE Kürzung auf SPORE_SNIPPET_MAX (überzählige VOR dem Signieren
  // verworfen, KEIN Throw). Defensiver Schema-Check: vec-Länge ≠ 384 →
  // InvalidSporeMetaError. Reihenfolge bleibt erhalten. `text` optional
  // (kurzer Domänen-Satz für Anzeige, KEIN PII).
  function sanitizeSnippetVectors(list) {
    var out = [];
    for (var i = 0; i < list.length && out.length < SPORE_SNIPPET_MAX; i++) {
      var e = list[i];
      if (!e || typeof e !== "object") {
        throw makeError("InvalidSporeMetaError", "snippetVectors[" + i + "] ist kein Objekt.");
      }
      var v = e.vec;
      var arr = null;
      if (Array.isArray(v)) {
        arr = v;
      } else if (v && typeof v.length === "number" && typeof v !== "string") {
        arr = Array.prototype.slice.call(v); // Float32Array o.ä. → Array
      }
      if (!arr || arr.length !== SPORE_SNIPPET_VEC_DIM) {
        throw makeError(
          "InvalidSporeMetaError",
          "snippetVectors[" + i + "].vec muss Länge " + SPORE_SNIPPET_VEC_DIM + " haben.",
        );
      }
      var num = [];
      for (var d = 0; d < arr.length; d++) num.push(Number(arr[d]));
      var entry = { vec: num };
      if (typeof e.text === "string" && e.text.length > 0) entry.text = e.text;
      out.push(entry);
    }
    return out;
  }

  async function generateOwnSpore(meta, key) {
    validateSporeMeta(meta);
    var slotKey = key || await getActiveIdentityKey();
    var identity = await loadIdentity(slotKey);
    if (!identity) {
      await getOrCreateIdentity(slotKey);
      identity = await loadIdentity(slotKey);
    }
    // Bau 02.Y: identitäts-spezifische Stores sicherstellen — der
    // typische Fall ist „Slot kam frisch aus getOrCreateIdentity, alles
    // angelegt", aber ein Slot aus importBackup kann aus einer
    // Backup-Migration stammen, wo der getOrCreateIdentity-Pfad nicht
    // gerufen wurde. ensureIdentityStores ist idempotent.
    await ensureIdentityStores(slotKey);

    var unsigned = {
      createdAt: new Date().toISOString(),
      domain: meta.domain,
      embeddingModel: typeof meta.embeddingModel === "string" ? meta.embeddingModel : EMBEDDING_MODEL,
      endpoint: meta.endpoint,
      id: identity.nodeId,
      nodeType: meta.nodeType,
      protocolVersion: typeof meta.protocolVersion === "string" ? meta.protocolVersion : PROTOCOL_VERSION,
      publicKey: identity.publicKeyJwk,
    };
    if (typeof meta.nodeName === "string") unsigned.nodeName = meta.nodeName;
    if (typeof meta.domainDescription === "string") unsigned.domainDescription = meta.domainDescription;
    if (Array.isArray(meta.domainKeywords)) unsigned.domainKeywords = meta.domainKeywords.slice();
    if (Array.isArray(meta.domainVector)) unsigned.domainVector = meta.domainVector.slice();
    // M04-Erweiterung (Brief 03) + inhalts-treuer Vektor (2026-06-28): die
    // beiden Vektor-Felder + Provenienz-Marker in die Allow-List aufnehmen,
    // sonst würden sie still ignoriert (wie stammCategories vor 2026-05-15).
    // embeddingSource = "content" | "description" (wie der domainVector
    // entstand); embeddingVersion = Re-Embedding-Zähler (Drift-Erkennung).
    if (Array.isArray(meta.embeddingCapabilities)) unsigned.embeddingCapabilities = meta.embeddingCapabilities.slice();
    if (Array.isArray(meta.embeddingNeeds)) unsigned.embeddingNeeds = meta.embeddingNeeds.slice();
    // A10 (Spore v0.2): optionale Schnipsel-Vektoren additiv aufnehmen. Harte
    // Kürzung + Längen-Check in sanitizeSnippetVectors; leer → Feld weglassen
    // (0.1-kompatible Sporen bleiben byte-identisch, kein leeres Array).
    if (Array.isArray(meta.snippetVectors)) {
      var sv = sanitizeSnippetVectors(meta.snippetVectors);
      if (sv.length > 0) unsigned.snippetVectors = sv;
    }
    if (typeof meta.embeddingSource === "string") unsigned.embeddingSource = meta.embeddingSource;
    if (typeof meta.embeddingVersion === "number" && isFinite(meta.embeddingVersion)) {
      unsigned.embeddingVersion = meta.embeddingVersion;
    }
    if (Array.isArray(meta.stammCategories)) unsigned.stammCategories = meta.stammCategories.slice();
    if (Array.isArray(meta.guestCategories)) unsigned.guestCategories = meta.guestCategories.slice();
    if (meta.endpointPaths && typeof meta.endpointPaths === "object") {
      unsigned.endpointPaths = meta.endpointPaths;
    }

    var subtle = getSubtle();
    var bytes = canonicalJsonBytes(unsigned);
    var sigBuf = await subtle.sign({ name: "Ed25519" }, identity.privateKey, bytes);
    var signature = base64urlEncode(sigBuf);

    var spore = canonicalize(unsigned);
    spore.signature = signature;
    spore = canonicalize(spore);

    var storage = getStorage();
    await storage.put(SPORE_STORE, slotKey, {
      nodeId: identity.nodeId,
      sporeJson: spore,
      signature: signature,
    });
    return spore;
  }

  async function getOwnSpore(key) {
    await ensureReady();
    var slotKey = key || await getActiveIdentityKey();
    var storage = getStorage();
    var stored = await storage.get(SPORE_STORE, slotKey);
    if (!stored) return null;
    return stored.sporeJson || null;
  }

  // --- Sporen-Regeneration (Modul 18 Sub f, Brief 2026-06-28) ---------------
  // Erzeugt die Spore mit der BESTEHENDEN Identität (gleiche nodeId) neu —
  // kein neuer Schlüssel. `updates` überschreibt einzelne Felder; alle nicht
  // genannten Felder werden aus der vorhandenen Spore übernommen (sonst gingen
  // z.B. embeddingNeeds beim Neu-Signieren verloren). Typischer Einsatz: der
  // Endknoten hat seinen domainVector inhalts-treu neu gerechnet (Modul 03
  // embedContentVector) und reicht ihn als updates.domainVector +
  // embeddingSource:"content" herein.
  //
  // embeddingVersion-Logik: ändert sich der domainVector (updates.domainVector
  // ist ein Array), wird die Version hochgezählt (Drift-Marker); sonst bleibt
  // sie erhalten. Ein explizites updates.embeddingVersion gewinnt immer.
  async function regenerateOwnSpore(updates, key) {
    updates = (updates && typeof updates === "object") ? updates : {};
    var slotKey = key || await getActiveIdentityKey();
    var existing = await getOwnSpore(slotKey);
    var base = existing || {};

    function pickStr(u, b) { return typeof u === "string" ? u : b; }
    function pickArr(u, b) {
      if (Array.isArray(u)) return u;
      if (Array.isArray(b)) return b;
      return undefined;
    }

    var meta = {
      domain: pickStr(updates.domain, base.domain),
      nodeType: pickStr(updates.nodeType, base.nodeType),
      endpoint: pickStr(updates.endpoint, base.endpoint),
      embeddingModel: pickStr(updates.embeddingModel, base.embeddingModel),
      protocolVersion: typeof base.protocolVersion === "string" ? base.protocolVersion : PROTOCOL_VERSION,
      nodeName: pickStr(updates.nodeName, base.nodeName),
      domainDescription: pickStr(updates.domainDescription, base.domainDescription),
      domainKeywords: pickArr(updates.domainKeywords, base.domainKeywords),
      stammCategories: pickArr(updates.stammCategories, base.stammCategories),
      guestCategories: pickArr(updates.guestCategories, base.guestCategories),
      embeddingCapabilities: pickArr(updates.embeddingCapabilities, base.embeddingCapabilities),
      embeddingNeeds: pickArr(updates.embeddingNeeds, base.embeddingNeeds),
    };
    if (updates.endpointPaths && typeof updates.endpointPaths === "object") {
      meta.endpointPaths = updates.endpointPaths;
    } else if (base.endpointPaths && typeof base.endpointPaths === "object") {
      meta.endpointPaths = base.endpointPaths;
    }

    var vectorChanged = Array.isArray(updates.domainVector);
    var newVector = vectorChanged ? updates.domainVector : base.domainVector;
    if (Array.isArray(newVector)) meta.domainVector = newVector;

    // A10 (Spore v0.2): snippetVectors beim Neu-Signieren erhalten (updates
    // gewinnt, sonst aus der bestehenden Spore übernehmen — sonst gingen die
    // Schnipsel bei jedem regenerate verloren). generateOwnSpore bereinigt sie.
    var newSnippets = pickArr(updates.snippetVectors, base.snippetVectors);
    if (Array.isArray(newSnippets)) meta.snippetVectors = newSnippets;

    var src = pickStr(updates.embeddingSource, base.embeddingSource);
    if (typeof src === "string") meta.embeddingSource = src;

    var prevVer = (typeof base.embeddingVersion === "number") ? base.embeddingVersion : 0;
    if (typeof updates.embeddingVersion === "number") {
      meta.embeddingVersion = updates.embeddingVersion;
    } else if (vectorChanged) {
      meta.embeddingVersion = prevVer + 1;
    } else if (typeof base.embeddingVersion === "number") {
      meta.embeddingVersion = base.embeddingVersion;
    }

    return generateOwnSpore(meta, slotKey);
  }

  function checkRequiredFields(spore) {
    for (var i = 0; i < REQUIRED_SPORE_FIELDS.length; i++) {
      var f = REQUIRED_SPORE_FIELDS[i];
      if (spore[f] === undefined || spore[f] === null) return f;
    }
    return null;
  }

  function majorVersion(v) {
    if (typeof v !== "string") return null;
    var dot = v.indexOf(".");
    return dot === -1 ? v : v.slice(0, dot);
  }

  async function verifyForeignSpore(spore) {
    try {
      if (!spore || typeof spore !== "object") {
        return { valid: false, reason: "Spore ist kein Objekt." };
      }
      var missing = checkRequiredFields(spore);
      if (missing) return { valid: false, reason: "Pflichtfeld fehlt: " + missing };

      var ourMajor = majorVersion(PROTOCOL_VERSION);
      var theirMajor = majorVersion(spore.protocolVersion);
      if (ourMajor !== theirMajor) {
        return {
          valid: false,
          reason: "Inkompatible Hauptversion: " + spore.protocolVersion + " (wir: " + PROTOCOL_VERSION + ")",
        };
      }

      if (VALID_NODE_TYPES.indexOf(spore.nodeType) === -1) {
        return { valid: false, reason: "nodeType ungültig: " + spore.nodeType };
      }

      var derivedId;
      try {
        derivedId = await deriveNodeIdFromJwk(spore.publicKey);
      } catch (err) {
        return { valid: false, reason: "publicKey nicht importierbar: " + (err && err.message ? err.message : err) };
      }
      if (derivedId !== spore.id) {
        return { valid: false, reason: "nodeId stimmt nicht zum Public Key" };
      }

      var subtle = getSubtle();
      var pub = await subtle.importKey("jwk", spore.publicKey, { name: "Ed25519" }, true, ["verify"]);

      var unsigned = {};
      var keys = Object.keys(spore);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i] === "signature") continue;
        unsigned[keys[i]] = spore[keys[i]];
      }
      var bytes = canonicalJsonBytes(unsigned);

      var sigBytes;
      try {
        sigBytes = base64urlDecode(spore.signature);
      } catch (err) {
        return { valid: false, reason: "Signatur nicht dekodierbar (kein base64url)" };
      }

      var ok = await subtle.verify({ name: "Ed25519" }, pub, sigBytes, bytes);
      if (!ok) return { valid: false, reason: "Signatur ungültig" };
      return { valid: true };
    } catch (err) {
      return { valid: false, reason: "Verifikationsfehler: " + (err && err.message ? err.message : err) };
    }
  }

  // Sync, idempotent. Leert In-Memory-identityCache + activeIdentityKey-
  // Cache, ohne den Storage anzufassen. Pflicht-Aufruf für externe
  // Cleanup-Pfade, die sbkim_keys/sbkim_spore/sbkim_meta selbst leeren
  // (z.B. Modul 07 confirmSelfApoptose). Bau 02.Y erweitert um den
  // active-identity-Lese-Cache.
  function resetIdentityCache() {
    identityCache.clear();
    activeIdentityKeyCache = null;
    // metaStoreEnsured wird NICHT zurückgesetzt — der ensureStore-Status
    // ist ein DB-Schema-Fakt (Store existiert), nicht ein Cache-Wert.
  }

  // ---- Backup-Pfad (Bau 02.X, 2026-05-16 / Bau 02.Y, 2026-05-19) ----
  //
  // exportBackup: schreibt IMMER version: 2 (Bau 02.Y), payload-schema-
  // version: 2 mit Pflicht-Feld identities[]. Top-Level-Felder
  // nodeId/keys/spore/siblings bleiben mit aktivem Slot befüllt
  // (konservative Down-Grade-Kompat).

  async function buildIdentityEntry(slotKey) {
    var storage = getStorage();
    var identity = await loadIdentity(slotKey);
    if (!identity) {
      throw makeError(
        "NoIdentityError",
        "Slot '" + slotKey + "' aus sbkim_keys liefert keine ladbare Identität. " +
          "Inkonsistenter Storage-Zustand.",
      );
    }
    var keysWrap = await storage.get(KEYS_STORE, slotKey);
    if (!keysWrap) {
      throw makeError(
        "NoIdentityError",
        "sbkim_keys['" + slotKey + "'] fehlt — Slot zwischen listIdentities und get verschwunden?",
      );
    }
    var sporeWrap = await storage.get(SPORE_STORE, slotKey);

    var siblingValues = [];
    var siblingsStore = "sbkim_siblings_" + slotKey;
    try {
      var rows = await storage.all(siblingsStore);
      if (Array.isArray(rows)) {
        siblingValues = rows.map(function (r) { return r.value; });
      }
    } catch (e) {
      // Fail-soft (Karte 02 § Storage „Backup-Inhalt"). Häufigster Fall:
      // UnknownStoreError, wenn der Slot nie Geschwister bekommen hat
      // (Stores sind nur via ensureStore in getOrCreateIdentity entstanden,
      // beim Modul-02-Singleton-Pfad gab es nicht-suffixed sbkim_siblings).
      siblingValues = [];
    }

    return {
      key: slotKey,
      nodeId: identity.nodeId,
      keys: {
        keyId: slotKey,
        privateKey: keysWrap.privateKey,
        publicKey: keysWrap.publicKey,
      },
      spore: sporeWrap && sporeWrap.sporeJson ? sporeWrap.sporeJson : null,
      siblings: siblingValues,
    };
  }

  async function exportBackup(password) {
    if (typeof password !== "string" || password.length < BACKUP_PASSWORD_MIN_LEN) {
      throw makeError(
        "InvalidBackupPasswordError",
        "Passwort muss mindestens " + BACKUP_PASSWORD_MIN_LEN + " Zeichen lang sein.",
      );
    }

    // Sicherstellen, dass mindestens eine Identität existiert.
    // getOrCreateIdentity legt fehlende Default-Identität an.
    await getOrCreateIdentity(DEFAULT_IDENTITY_KEY);

    var slotKeys = await listIdentities();
    if (slotKeys.length === 0) {
      // Sollte nach getOrCreateIdentity(DEFAULT_IDENTITY_KEY) nicht
      // passieren; defensiv.
      throw makeError(
        "NoIdentityError",
        "Keine Identitäten in sbkim_keys — exportBackup nicht möglich.",
      );
    }

    var activeKey = await getActiveIdentityKey();
    var identities = [];
    var activeEntry = null;
    for (var i = 0; i < slotKeys.length; i++) {
      var entry = await buildIdentityEntry(slotKeys[i]);
      identities.push(entry);
      if (entry.key === activeKey) activeEntry = entry;
    }
    // Fallback: wenn der active-identity-Marker auf einen Slot zeigt,
    // den listIdentities nicht enthält (sollte nicht passieren, weil
    // setActiveIdentity validiert), nehmen wir den ersten Slot.
    if (!activeEntry) activeEntry = identities[0];

    // B1b (Klaus-Entscheid 2026-07-17, „Weg A"): Export VERLANGT die Spore.
    // importBackup wirft je Identität, wenn identities[i].spore fehlt — ein
    // Backup ohne Spore ließe sich anlegen, aber NIE zurückspielen (stiller
    // Fehlschlag). Statt ein unbrauchbares Backup zu erzeugen, hier ein KLARER
    // Fehler VOR der Verschlüsselung — symmetrisch zu importBackup. Real nur
    // bei einer frisch erzeugten Identität, die noch nie eine Spore signiert
    // hat (nie angedockt); Behebung: zuerst Spore erzeugen, dann Backup.
    for (var se = 0; se < identities.length; se++) {
      if (!identities[se].spore || typeof identities[se].spore !== "object") {
        throw makeError(
          "SporeMissingError",
          "Identität '" + identities[se].key + "' hat noch keine Spore — ein Backup ohne " +
            "Spore ließe sich nicht wiederherstellen. Bitte zuerst eine Spore erzeugen " +
            "(Andock-Wizard), dann das Backup anlegen.",
        );
      }
    }

    var payload = {
      "active-identity": activeEntry.key,
      createdAt: new Date().toISOString(),
      identities: identities,
      // Konservative Down-Grade-Kompat: alte Bau-02.X-Code-Pfade lesen
      // diese Top-Level-Felder direkt (kein identities[]-Verständnis).
      // Karte 02 § Datenformat „Backup-Format" dokumentiert beide
      // Pfade. KEINE Pflicht aus Brief 04 — bewusste Wahl Bau 02.Y.
      keys: activeEntry.keys,
      nodeId: activeEntry.nodeId,
      siblings: activeEntry.siblings,
      spore: activeEntry.spore,
    };

    var subtle = getSubtle();
    var plaintext = canonicalJsonBytes(payload);
    var salt = global.crypto.getRandomValues(new Uint8Array(BACKUP_KDF_SALT_BYTES));
    var iv = global.crypto.getRandomValues(new Uint8Array(BACKUP_CIPHER_IV_BYTES));
    var aesKey = await derivePbkdf2AesGcmKey(password, salt, BACKUP_KDF_ITERATIONS);
    var cipherBuf = await subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, plaintext);

    return {
      version: BACKUP_FORMAT_VERSION,
      kdf: {
        algorithm: "PBKDF2",
        hash: "SHA-256",
        iterations: BACKUP_KDF_ITERATIONS,
        salt: base64urlEncode(salt),
      },
      cipher: {
        algorithm: "AES-GCM-256",
        iv: base64urlEncode(iv),
      },
      ciphertext: base64urlEncode(new Uint8Array(cipherBuf)),
      "payload-schema-version": BACKUP_PAYLOAD_SCHEMA_VERSION,
    };
  }

  // importBackup: liest beide Wrapper-Versionen (1 und 2). v=1 wird
  // intern in eine identities[]-Liste mit einem main-Eintrag migriert.
  // BackupOverwriteError pro Slot (Bau 02.Y), nicht mehr global.
  async function importBackup(blob, password, options) {
    var opts = options || {};
    var force = opts.force === true;

    if (typeof password !== "string" || password.length < BACKUP_PASSWORD_MIN_LEN) {
      throw makeError(
        "InvalidBackupPasswordError",
        "Passwort muss mindestens " + BACKUP_PASSWORD_MIN_LEN + " Zeichen lang sein.",
      );
    }
    if (!blob || typeof blob !== "object") {
      throw makeError("BackupSchemaError", "Backup-Blob fehlt oder ist kein Objekt.");
    }
    if (BACKUP_FORMAT_VERSION_READ_OK.indexOf(blob.version) === -1) {
      throw makeError(
        "BackupVersionMismatchError",
        "Backup-Hauptversion " + blob.version + " unbekannt (Modul 02 versteht " +
          BACKUP_FORMAT_VERSION_READ_OK.join("/") + ").",
      );
    }
    if (!blob.kdf || !blob.cipher || typeof blob.ciphertext !== "string") {
      throw makeError(
        "BackupSchemaError",
        "Backup-Pflichtfeld fehlt im Wrapper: kdf / cipher / ciphertext.",
      );
    }

    await ensureReady();
    var storage = getStorage();

    var iterations = blob.kdf.iterations;
    if (typeof iterations !== "number" || !(iterations > 0)) {
      throw makeError("BackupSchemaError", "Backup-kdf.iterations ungültig.");
    }

    var payload;
    try {
      var salt = base64urlDecode(blob.kdf.salt);
      var iv = base64urlDecode(blob.cipher.iv);
      var ct = base64urlDecode(blob.ciphertext);
      var aesKey = await derivePbkdf2AesGcmKey(password, salt, iterations);
      var subtle = getSubtle();
      var plainBuf = await subtle.decrypt({ name: "AES-GCM", iv: iv }, aesKey, ct);
      var plainText = new TextDecoder().decode(plainBuf);
      payload = JSON.parse(plainText);
    } catch (e) {
      // Sammel-Klasse — kein Oracle.
      throw makeError(
        "BackupDecryptError",
        "Falsches Passwort oder korruptes Backup.",
        e,
      );
    }

    var payloadSchemaVersion = blob["payload-schema-version"];
    if (typeof payloadSchemaVersion === "number" && payloadSchemaVersion > BACKUP_PAYLOAD_SCHEMA_VERSION) {
      throw makeError(
        "BackupSchemaError",
        "Payload-Schema-Version " + payloadSchemaVersion + " ist neuer als Modul 02 kennt (" +
          BACKUP_PAYLOAD_SCHEMA_VERSION + ").",
      );
    }
    if (!payload || typeof payload !== "object") {
      throw makeError("BackupSchemaError", "Backup-Klartext-Payload ist kein Objekt.");
    }

    // Migrations-Pfad: v=1-Backups (Bau 02.X) tragen kein identities[];
    // sie haben Top-Level-nodeId/keys/spore/siblings für den main-Slot.
    var identitiesList;
    if (blob.version === 1) {
      if (typeof payload.nodeId !== "string" || payload.nodeId.length === 0) {
        throw makeError("BackupSchemaError", "Payload-Pflichtfeld fehlt: nodeId (v=1).");
      }
      if (!payload.keys || typeof payload.keys !== "object") {
        throw makeError("BackupSchemaError", "Payload-Pflichtfeld fehlt: keys (v=1).");
      }
      identitiesList = [{
        key: DEFAULT_IDENTITY_KEY,
        nodeId: payload.nodeId,
        keys: payload.keys,
        spore: payload.spore,
        siblings: Array.isArray(payload.siblings) ? payload.siblings : [],
      }];
    } else {
      // v=2-Pfad — payload.identities[] ist Pflicht.
      if (!Array.isArray(payload.identities) || payload.identities.length === 0) {
        throw makeError(
          "BackupSchemaError",
          "leere identities[]-Liste nach Decrypt — Multi-Identitäts-Backup muss mindestens " +
            "einen Slot enthalten.",
        );
      }
      identitiesList = payload.identities;
    }

    // Pro-Slot-Schema-Check vor irgendeinem Schreibvorgang.
    for (var iE = 0; iE < identitiesList.length; iE++) {
      var entry = identitiesList[iE];
      if (!entry || typeof entry !== "object") {
        throw makeError("BackupSchemaError", "identities[" + iE + "] ist kein Objekt.");
      }
      if (typeof entry.key !== "string" || entry.key.length === 0) {
        throw makeError("BackupSchemaError", "identities[" + iE + "].key fehlt oder leer.");
      }
      if (typeof entry.nodeId !== "string" || entry.nodeId.length === 0) {
        throw makeError("BackupSchemaError", "identities[" + iE + "].nodeId fehlt.");
      }
      if (!entry.keys || typeof entry.keys !== "object") {
        throw makeError("BackupSchemaError", "identities[" + iE + "].keys fehlt.");
      }
      if (!entry.keys.privateKey || typeof entry.keys.privateKey !== "object") {
        throw makeError("BackupSchemaError", "identities[" + iE + "].keys.privateKey fehlt.");
      }
      if (!entry.keys.publicKey || typeof entry.keys.publicKey !== "object") {
        throw makeError("BackupSchemaError", "identities[" + iE + "].keys.publicKey fehlt.");
      }
      if (!entry.spore || typeof entry.spore !== "object") {
        throw makeError("BackupSchemaError", "identities[" + iE + "].spore fehlt.");
      }
    }

    // Pro-Slot BackupOverwriteError-Check (Bau 02.Y) — Sammel-Error
    // mit Hinweis auf alle kollidierenden Slot-Keys. Kein
    // Storage-Schreibvorgang bis der ganze Container überschreibbar
    // ist.
    if (!force) {
      var collisions = [];
      for (var iC = 0; iC < identitiesList.length; iC++) {
        var slot = identitiesList[iC].key;
        var existing = await storage.get(KEYS_STORE, slot);
        if (existing) collisions.push(slot);
      }
      if (collisions.length > 0) {
        throw makeError(
          "BackupOverwriteError",
          "Bestehende Identitäten in sbkim_keys für Slot(s): " + collisions.join(", ") +
            ". {force:true} setzen, um sie bewusst zu ersetzen — die alten nodeIds werden damit " +
            "verworfen, Geschwister behandeln den/die Knoten danach als unbekannt.",
        );
      }
    }

    // Schreib-Pfad pro Slot — ensureStore + put.
    for (var iW = 0; iW < identitiesList.length; iW++) {
      var entryW = identitiesList[iW];
      await ensureIdentityStores(entryW.key);
      await storage.put(KEYS_STORE, entryW.key, {
        keyId: entryW.key,
        privateKey: entryW.keys.privateKey,
        publicKey: entryW.keys.publicKey,
      });
      await storage.put(SPORE_STORE, entryW.key, {
        nodeId: entryW.nodeId,
        sporeJson: entryW.spore,
        signature: entryW.spore.signature,
      });
      var siblingArr = Array.isArray(entryW.siblings) ? entryW.siblings : [];
      var siblingStore = "sbkim_siblings_" + entryW.key;
      for (var iS = 0; iS < siblingArr.length; iS++) {
        var s = siblingArr[iS];
        if (!s || typeof s !== "object" || typeof s.nodeId !== "string" || s.nodeId.length === 0) continue;
        await storage.put(siblingStore, s.nodeId, s);
      }
    }

    // Active-identity-Marker setzen. v=2-Backups tragen evtl. ein
    // optionales Top-Level-Feld "active-identity"; sonst "main"
    // (Default), falls "main" im Container ist, sonst der erste Slot.
    var requestedActive = typeof payload["active-identity"] === "string" ? payload["active-identity"] : null;
    var newActive = null;
    if (requestedActive) {
      for (var iA = 0; iA < identitiesList.length; iA++) {
        if (identitiesList[iA].key === requestedActive) {
          newActive = requestedActive;
          break;
        }
      }
    }
    if (!newActive) {
      for (var iD = 0; iD < identitiesList.length; iD++) {
        if (identitiesList[iD].key === DEFAULT_IDENTITY_KEY) {
          newActive = DEFAULT_IDENTITY_KEY;
          break;
        }
      }
    }
    if (!newActive) newActive = identitiesList[0].key;
    await ensureMetaStore();
    await storage.put(META_STORE, ACTIVE_IDENTITY_META_KEY, newActive);

    resetIdentityCache();
    return { restored: true };
  }

  var SbkimSpore = {
    init: init,
    getOrCreateIdentity: getOrCreateIdentity,
    getNodeId: getNodeId,
    getPublicKeyJwk: getPublicKeyJwk,
    generateOwnSpore: generateOwnSpore,
    regenerateOwnSpore: regenerateOwnSpore,
    getOwnSpore: getOwnSpore,
    verifyForeignSpore: verifyForeignSpore,
    setActiveIdentity: setActiveIdentity,
    getActiveIdentityKey: getActiveIdentityKey,
    listIdentities: listIdentities,
    removeIdentity: removeIdentity,
    resetIdentityCache: resetIdentityCache,
    exportBackup: exportBackup,
    importBackup: importBackup,
    InvalidBackupPasswordError: InvalidBackupPasswordError,
    BackupDecryptError: BackupDecryptError,
    BackupVersionMismatchError: BackupVersionMismatchError,
    BackupSchemaError: BackupSchemaError,
    BackupOverwriteError: BackupOverwriteError,
    UnknownIdentityError: UnknownIdentityError,
    RemoveActiveIdentityError: RemoveActiveIdentityError,
    _meta: {
      // Pflege 17 Self-Heartbeat 2026-05-26: `ready`-Getter exponiert
      // den internen Closure-Flag — Modul 17 prüft das beim Self-
      // Heartbeat-Fallback (Karte 17 § Anti-Greenwashing-Klausel).
      get ready() { return ready; },
      protocolVersion: PROTOCOL_VERSION,
      sporeSnippetMax: SPORE_SNIPPET_MAX,
      sporeSnippetVecDim: SPORE_SNIPPET_VEC_DIM,
      defaultIdentityKey: DEFAULT_IDENTITY_KEY,
      keysStore: KEYS_STORE,
      sporeStore: SPORE_STORE,
      metaStore: META_STORE,
      activeIdentityMetaKey: ACTIVE_IDENTITY_META_KEY,
      identityStoreBases: IDENTITY_STORE_BASES.slice(),
      requiredSporeFields: REQUIRED_SPORE_FIELDS.slice(),
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      backupFormatVersionReadOk: BACKUP_FORMAT_VERSION_READ_OK.slice(),
      backupKdfIterations: BACKUP_KDF_ITERATIONS,
      backupPasswordMinLen: BACKUP_PASSWORD_MIN_LEN,
      backupPayloadSchemaVersion: BACKUP_PAYLOAD_SCHEMA_VERSION,
    },
  };

  global.SbkimSpore = SbkimSpore;

  // Self-check: emitted on script load (synchronous, no async load step).
  // Format is uniform across all SBKIM modules — see INTERFACES.md.
  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 02 SPORE bereit, Funktionen: " +
        "init/getOrCreateIdentity/getNodeId/getPublicKeyJwk/generateOwnSpore/regenerateOwnSpore/getOwnSpore/" +
        "verifyForeignSpore/setActiveIdentity/getActiveIdentityKey/listIdentities/" +
        "removeIdentity/resetIdentityCache/exportBackup/importBackup",
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
