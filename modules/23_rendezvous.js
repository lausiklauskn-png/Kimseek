/*
 * SBKIM — Modul 23 — Rendezvous (gemeinsamer Raum)
 *
 * Löst die Adress-Wand: die in GitHub committete nodeId ist NICHT die
 * LEBENDE nodeId, die ein Knoten gerade im Browser belauscht (listenNostr).
 * Statt an eine committete ID zu adressieren, treffen sich lebende Knoten
 * in einem GETEILTEN Etikett (Nostr-Tag) auf demselben Relais — wie eine
 * Pinnwand mit einem "gemeinsamen Raum". Ein aktiver Knoten heftet auf
 * bewusste Nutzer-Aktion seine LEBENDE Visitenkarte (echte Spore inkl.
 * lebender nodeId) ans Brett; ein Suchender liest die Karten und handshaket
 * die LEBENDE ID — die der Gegenknoten ja gerade wirklich belauscht.
 *
 * Herkunft: bewiesen am 2026-06-28 (Klaus' Browser-Lauf Tablet↔Handy,
 * "✓ ANDOCK ETABLIERT mit Family Projekt (lebende ID)"). Dieser Code ist
 * die saubere, konfig-getriebene Ausgliederung des family-project-Prototyps
 * (sbkim/sbkim-init.js, Funktionen doAnnounce/announcePresence/discoverRoom/
 * handshakeLiveCard/connectToNet) — KEINE family-Hardcodes mehr. Jeder
 * Knoten injiziert seinen eigenen nodeName + (optional) seinen Relais-Client.
 *
 * VERFASSUNGSTREU (Empfangsmodus mit Antwortrecht, Mycel-Schicht 1):
 * Anmelden UND Suchen sind ausschliesslich NUTZER-AUSGELOeSTE Aktionen
 * (Knöpfe in der App). KEIN getakteter Dauer-Piepser (= Pulsation, fürs
 * Mycel verboten), KEIN Crawl, KEINE Eigenanfrage ins offene Netz beim
 * Laden. Das Anmelden ist eine bewusste Pilz-Schicht-Geste (Schicht 2),
 * der Knoten selbst bleibt Empfangsmodus.
 *
 * Bewusst NUR Tool-Code über die öffentlichen Flächen der geteilten Kern-
 * Module: Modul 05 (handshake/listenNostr) + Modul 05b (publish/subscribe).
 * Die Kern-Module 05/05b bleiben UNANGETASTET (kein Netz-Bruch).
 *
 * DOM-frei: dieses Modul liefert nur Daten/Logik. Die Knöpfe + die Karten-
 * Darstellung sind app-eigen (siehe Karte 23 § UI-Stück) — so bleibt die
 * Modul-Datei byte-1:1 in jeder PWA kopierbar.
 *
 * IDENTITÄTS-HYGIENE (Klaus 2026-07-08, Skill „saubere-netz-anmeldung"):
 * Weil alle Endknoten-PWAs unter EINER Origin liegen und IndexedDB/Service-
 * Worker/Caches an der Origin hängen (nicht am Pfad), teilen sich sonst alle
 * Apps EINE Default-DB `sbkim` → dieselbe nodeId. Darum zwei Modi (NIE mischen):
 *   Modus A — ensureIdentity(): sanft, automatisch (bei init), idempotent,
 *     NICHT zerstörend. Eigene Schublade `sbkim_<suffix>` + EINMAL Identität,
 *     falls keine da. Kein Löschen, KEIN Auto-Anmelden (Empfangsmodus).
 *   Modus B — repairAndReconnect(): zerstörend, NUR hinter Nutzer-Knopf.
 *     Reinigt NUR die eigene Origin (löscht `sbkim`, Service-Worker, Caches —
 *     eigene Schublade bleibt), dann frische Identität + Spore + Anmelden +
 *     „hart neu laden".
 *
 * Public surface (registered on window.SbkimRendezvous):
 *   init(opts?) -> Promise<void>
 *       opts = { nodeName, relayClient, anastomose, spore, storage, dbSuffix,
 *                createIdentity, ensureIdentity, prepareCorpus, freshSec,
 *                listenMs }
 *       Alle optional. relayClient/anastomose/spore/storage sonst aus den
 *       Globals. dbSuffix = eigene Schublade. createIdentity = app-eigener
 *       async-Callback. ensureIdentity:true fährt Modus A einmal (lokal).
 *       prepareCorpus = app-eigener async-Provider → [{label,text,anchorId,
 *       passageVec}]; enableAnswering() koppelt damit den lokalen Such-Korpus
 *       aktiv an Modul 04 (setLocalCorpus), gegen die „Korpus-leer-Falle".
 *       init() ist idempotent + fail-soft, baut NICHTS ins Netz.
 *   configure(opts) -> void           (Teil-Update der Konfig, gleiche Felder)
 *   ensureIdentity(opts?) -> Promise<{ ok, created, nodeId?, reason? }>  (Modus A)
 *   cleanupSharedOrigin() -> Promise<{ dbDeleted, swUnregistered, cachesDeleted, notes }>
 *   repairAndReconnect(opts?) -> Promise<{ ok, cleaned, created, nodeId?, reason?, reloadHint }>  (Modus B)
 *   announce(opts?) -> Promise<{ ok, nodeId?, reason? }>
 *       Lauscht (listenNostr) + heftet die lebende Visitenkarte ans Brett.
 *       Setzt eine vorhandene Identität voraus.
 *   connectAndAnnounce(opts?) -> Promise<{ ok, created, nodeId?, reason? }>
 *       Wie announce, erzeugt aber die Identität, falls noch keine da ist —
 *       über den optionalen opts.createIdentity-Callback (app-eigen, da die
 *       Domänen-Stichworte app-spezifisch sind). Ohne Callback + ohne
 *       Identität: { ok:false, created:false, reason }.
 *   discover(opts?) -> Promise<{ ok, cards, reason? }>
 *       Liest den Raum (Sammelfenster listenMs), dedupt nach nodeId
 *       (frischeste Karte gewinnt), filtert die eigene(n) nodeId(s) raus.
 *       cards = [{ nodeId, nodeName, spore, ts, ageSec, relatedness, isRelated }]
 *       (ts-absteigend). relatedness/isRelated = zentrierter Verwandtschafts-
 *       Score zur eigenen Domäne (REINE ANZEIGE; null ohne Modul 04/Vektor).
 *   relatednessForCards(cards, ownSpore) -> cards'   (pure; reine Anzeige)
 *       Hängt je Karte relatedness (zentrierter Cosinus, Modul 04) + isRelated
 *       an. Gatet NICHTS, mutiert die Eingabe nicht, fail-soft.
 *   handshakeCard(card, opts?) -> Promise<{ outcome, score?, reason?, raw? }>
 *       Handshake an die LEBENDE ID der Karte (Modul 05, transport:"nostr").
 *       Fail-soft normalisiert: outcome ∈ {established, rejected,
 *       rejected-local, timeout, error}.
 *   enableAnswering(opts?) -> { ok, reason? }   (Bau 23.B)
 *       Antwortrecht bewusst AN: lauscht auf Frage-Zettel (Tag "sbkim-qry")
 *       an die eigene lebende nodeId und antwortet mit Top-k der lokalen
 *       Bedeutungs-Suche (Modul 04 queryLocal). Default AUS, Dedupe + Rate-
 *       Limit 6/min. disableAnswering() schaltet ab. Beim Einschalten wird der
 *       lokale Korpus über cfg.prepareCorpus aktiv gekoppelt (Korpus-leer-
 *       Falle abgesichert; fail-soft ohne Provider).
 *   askNode(cardOderNodeId, text, opts?) -> Promise<{ ok, results?, ... }>
 *       (Bau 23.B) Nutzer-ausgelöste Cross-Knoten-Frage; wartet auf den
 *       Antwort-Zettel (Default 15 s). Vertrag: INTERFACES §1 Modul 23.
 *   _meta -> { version, tag, presenceKind, sharedDbName, dbSuffix, freshSec,
 *              listenMs, nodeName, hasRelay, hasAnastomose, hasSpore, hasMatch,
 *              hasStorage, hasCreateIdentity,
 *              answering, answeredCount, hasPrepareCorpus, answerCorpusEnsured,
 *              queryTag, queryKind, queryResKind, queryMaxPerMin }
 *
 * Self-check: emits a console.info line on script load. Siehe
 * docs/components/23_rendezvous.md + INTERFACES.md §1 Modul 23.
 */
(function (global) {
  "use strict";

  var VERSION = "0.1";

  // ---- Datenverträge (1:1 aus dem bewiesenen family-Prototyp) ----
  var RDV_TAG = "sbkim-rdv";            // das geteilte Etikett = der gemeinsame Raum
  var RDV_PRESENCE_KIND = "sbkim-presence";
  var RDV_FRESH_SEC_DEFAULT = 1800;     // Karten der letzten 30 min berücksichtigen
  var RDV_LISTEN_MS_DEFAULT = 4000;     // Sammelfenster beim Lesen des Raums
  var RDV_HANDSHAKE_TIMEOUT_MS = 300000; // 5 min (Klaus 2026-07-08; dokumentierter Wert INTERFACES §Modul 05 / PULS Modul-18-Handshake): Empfänger lädt beim ersten Andocken evtl. das ~30-MB-Modell — 12 s waren zu kurz
  var NOSTR_KIND = 1;
  // Der geteilte Alt-Topf (Default-DB des Storage-Moduls). Modus B löscht NUR
  // diese DB — NIE die eigene Schublade `sbkim_<suffix>`.
  var SHARED_DB_NAME = "sbkim";
  var RELOAD_HINT = "Bitte jetzt hart neu laden (Strg+Shift+R bzw. „Cache leeren und " +
    "neu laden“), damit der frische Service-Worker greift.";

  // ---- Konfig-Zustand ----
  var cfg = {
    nodeName: "SBKIM-Knoten",
    relayClient: null,   // null → global.SbkimNostrRelay
    anastomose: null,    // null → global.SbkimAnastomose
    spore: null,         // null → global.SbkimSpore
    match: null,         // null → global.SbkimMatch (optional, nur Anzeige-Score)
    storage: null,       // null → global.SbkimStorage (Identitäts-Hygiene)
    dbSuffix: null,      // eigene Schublade `sbkim_<dbSuffix>`
    createIdentity: null,// app-eigener async-Callback (Spore-Erzeugung)
    prepareCorpus: null, // async → [{label,text,anchorId,passageVec}] (Korpus-Kopplung, Bau 23.B-Härtung)
    freshSec: RDV_FRESH_SEC_DEFAULT,
    listenMs: RDV_LISTEN_MS_DEFAULT,
  };

  // ---- Resolver (Default aus den Globals, Override aus der Konfig) ----
  function resolveRelay() {
    var c = cfg.relayClient;
    if (c && typeof c.publish === "function" && typeof c.subscribe === "function") return c;
    var g = global.SbkimNostrRelay;
    if (g && typeof g.publish === "function" && typeof g.subscribe === "function") return g;
    return null;
  }
  function resolveAnastomose() {
    var a = cfg.anastomose || global.SbkimAnastomose;
    return (a && typeof a.handshake === "function") ? a : null;
  }
  function resolveSpore() {
    var s = cfg.spore || global.SbkimSpore;
    return (s && typeof s.getOwnSpore === "function") ? s : null;
  }
  // Modul 04 (Match) ist eine OPTIONALE Anzeige-Abhängigkeit — nur für den
  // zentrierten Verwandtschafts-Score der Raum-Karten. Fehlt es, bleibt der
  // Raum voll funktionsfähig (Karten ohne Verwandtschafts-Badge).
  function resolveMatch() {
    var m = cfg.match || global.SbkimMatch;
    return (m && typeof m.relatedness === "function") ? m : null;
  }
  // Modul 01 (Storage) — nur für die Identitäts-Hygiene (eigene Schublade).
  function resolveStorage() {
    var s = cfg.storage || global.SbkimStorage;
    return (s && typeof s.init === "function") ? s : null;
  }

  function nowSec() { return Math.floor(Date.now() / 1000); }

  // Domänen-Vektor (number[] aus der Spore, oder Float32Array) → Float32Array.
  // null bei fehlender/ungültiger Eingabe (relatedness() validiert den Rest).
  function toVec(arr) {
    if (arr instanceof Float32Array) return arr;
    if (Array.isArray(arr)) { try { return new Float32Array(arr); } catch (_e) { return null; } }
    return null;
  }

  // ---- Verwandtschafts-Anreicherung der Raum-Karten (REINE ANZEIGE) ----
  // Folge zu Bau 04.E / „Wählen"-UI (2026-06-28): hängt je Karte einen
  // ZENTRIERTEN Verwandtschafts-Score (Modul 04 relatedness(), whitened-light)
  // an — ausschliesslich für die Anzeige im Rendezvous-Raum (z.B. Badge
  // „🧬 verwandt 0.72" vs nur „verbunden"). Der 0.80-Andock-Riegel (Modul 05
  // handshake / PROVIDER_MIN_MATCH) bleibt UNBERÜHRT — dieser Score gatet
  // NICHTS, er sortiert/filtert nur die Darstellung. Pure Funktion (DOM-frei,
  // headless testbar): nimmt die Karten + die eigene Spore, gibt eine NEUE Liste
  // zurück (Eingabe NICHT mutiert). Fail-soft: ohne Modul 04 / ohne eigenen
  // domainVector / ohne Karten-domainVector → relatedness null, isRelated false;
  // relatedness() wirft bei falscher Eingabe (InvalidVectorError/ShapeMismatch)
  // → pro Karte abgefangen, nie Bruch der ganzen Liste.
  function relatednessForCards(cards, ownSpore) {
    var list = Array.isArray(cards) ? cards : [];
    var match = resolveMatch();
    var ownVec = (ownSpore && typeof ownSpore === "object") ? toVec(ownSpore.domainVector) : null;
    return list.map(function (c) {
      var copy = {};
      for (var k in c) { if (Object.prototype.hasOwnProperty.call(c, k)) copy[k] = c[k]; }
      var rel = null, isRel = false;
      if (match && ownVec && c && c.spore) {
        var cv = toVec(c.spore.domainVector);
        if (cv) {
          try {
            var s = match.relatedness(ownVec, cv);
            if (typeof s === "number" && isFinite(s)) {
              rel = s;
              isRel = (typeof match.isRelated === "function") ? match.isRelated(s) : (s >= 0.30);
            }
          } catch (_e) { rel = null; isRel = false; } // fail-soft, Karte bleibt
        }
      }
      copy.relatedness = rel;
      copy.isRelated = isRel;
      return copy;
    });
  }

  // VERKEHR-Lampe (Modul 17 / Status-Widget) ehrlich setzen: aktiv, solange
  // wir lauschen. Fail-soft — Render-Schicht ist optionaler Konsument.
  function signalListening(active) {
    try {
      if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
        global.dispatchEvent(new global.CustomEvent("sbkim:nostr-listening", {
          detail: { active: active !== false },
        }));
      }
    } catch (_e) { /* fail-soft */ }
  }

  async function getOwnLiveSpore() {
    var spore = resolveSpore();
    if (!spore) return null;
    try {
      return await spore.getOwnSpore();
    } catch (_e) {
      return null;
    }
  }

  // ==== IDENTITÄTS-HYGIENE (Skill „saubere-netz-anmeldung") ====

  // ---- Modus A: ensureIdentity() — sanft, automatisch, idempotent ----
  async function ensureIdentity(opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    var suffix = (typeof opts.dbSuffix === "string" && opts.dbSuffix.length > 0) ? opts.dbSuffix : cfg.dbSuffix;
    var storage = resolveStorage();
    if (suffix && storage) {
      try { await storage.init({ dbSuffix: suffix }); } catch (_e) { /* fail-soft */ }
    }
    var spore = resolveSpore();
    if (!spore || typeof spore.getOrCreateIdentity !== "function") {
      return { ok: false, created: false, reason: "Modul 02 (Spore) nicht geladen." };
    }
    var existed = false;
    if (typeof spore.getNodeId === "function") {
      try { existed = !!(await spore.getNodeId()); } catch (_e) { existed = false; }
    }
    var id;
    try {
      id = await spore.getOrCreateIdentity();
    } catch (e) {
      return { ok: false, created: false, reason: "getOrCreateIdentity fehlgeschlagen: " + (e && e.message ? e.message : e) };
    }
    return { ok: true, created: !existed, nodeId: (id && id.nodeId) ? id.nodeId : undefined };
  }

  // ---- cleanupSharedOrigin() — Modus-B-Reinigung (NUR eigene Origin) ----
  async function cleanupSharedOrigin() {
    var result = { dbDeleted: false, swUnregistered: 0, cachesDeleted: 0, notes: [] };
    try {
      var idb = (typeof global.indexedDB !== "undefined" && global.indexedDB) ? global.indexedDB : null;
      if (idb && typeof idb.deleteDatabase === "function") {
        await new Promise(function (resolve) {
          var settled = false;
          function done() { if (!settled) { settled = true; resolve(); } }
          var req;
          try { req = idb.deleteDatabase(SHARED_DB_NAME); } catch (_e) { return done(); }
          req.onsuccess = function () { result.dbDeleted = true; done(); };
          req.onerror = function () { result.notes.push("DB-Löschen fehlgeschlagen (fail-soft)."); done(); };
          req.onblocked = function () { result.notes.push("DB blockiert (offene Verbindung) — nach hartem Neuladen erneut."); done(); };
        });
      } else { result.notes.push("Kein IndexedDB verfügbar."); }
    } catch (_e) { result.notes.push("DB-Löschen übersprungen (fail-soft)."); }
    try {
      var nav = global.navigator;
      if (nav && nav.serviceWorker && typeof nav.serviceWorker.getRegistrations === "function") {
        var regs = await nav.serviceWorker.getRegistrations();
        for (var i = 0; i < (regs ? regs.length : 0); i++) {
          try { if (await regs[i].unregister()) result.swUnregistered++; } catch (_e) { /* fail-soft */ }
        }
      }
    } catch (_e) { result.notes.push("Service-Worker-Abmeldung übersprungen (fail-soft)."); }
    try {
      var cs = global.caches;
      if (cs && typeof cs.keys === "function") {
        var keys = await cs.keys();
        for (var j = 0; j < (keys ? keys.length : 0); j++) {
          try { if (await cs.delete(keys[j])) result.cachesDeleted++; } catch (_e) { /* fail-soft */ }
        }
      }
    } catch (_e) { result.notes.push("Cache-Leerung übersprungen (fail-soft)."); }
    return result;
  }

  // ---- Modus B: repairAndReconnect() — zerstörend, nutzer-ausgelöst ----
  async function repairAndReconnect(opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    var cleaned = await cleanupSharedOrigin();
    var suffix = (typeof opts.dbSuffix === "string" && opts.dbSuffix.length > 0) ? opts.dbSuffix : cfg.dbSuffix;
    var storage = resolveStorage();
    if (suffix && storage) {
      try { await storage.init({ dbSuffix: suffix }); } catch (_e) { /* fail-soft */ }
    }
    if (opts.newIdentity === true) {
      var sp = resolveSpore();
      if (sp && typeof sp.getActiveIdentityKey === "function" && typeof sp.removeIdentity === "function") {
        try {
          var activeKey = await sp.getActiveIdentityKey();
          await sp.removeIdentity(activeKey);
        } catch (_e) { /* fail-soft: dann bleibt die bestehende Identität */ }
      }
    }
    var res = await connectAndAnnounce({ createIdentity: opts.createIdentity || cfg.createIdentity || undefined });
    return {
      ok: res.ok, cleaned: cleaned, created: res.created,
      nodeId: res.nodeId, reason: res.reason, reloadHint: RELOAD_HINT,
    };
  }

  // ---- init / configure ----
  function applyOpts(opts) {
    if (!opts || typeof opts !== "object") return;
    if (typeof opts.nodeName === "string" && opts.nodeName.length > 0) cfg.nodeName = opts.nodeName;
    if (opts.relayClient !== undefined) cfg.relayClient = opts.relayClient;
    if (opts.anastomose !== undefined) cfg.anastomose = opts.anastomose;
    if (opts.spore !== undefined) cfg.spore = opts.spore;
    if (opts.match !== undefined) cfg.match = opts.match;
    if (opts.storage !== undefined) cfg.storage = opts.storage;
    if (typeof opts.dbSuffix === "string" && opts.dbSuffix.length > 0) cfg.dbSuffix = opts.dbSuffix;
    if (typeof opts.createIdentity === "function") cfg.createIdentity = opts.createIdentity;
    if (opts.prepareCorpus !== undefined) {
      cfg.prepareCorpus = (typeof opts.prepareCorpus === "function") ? opts.prepareCorpus : null;
      answerCorpusEnsured = false; // neuer Provider → beim nächsten Antwort-AN neu koppeln
    }
    if (typeof opts.freshSec === "number" && isFinite(opts.freshSec) && opts.freshSec > 0) {
      cfg.freshSec = Math.floor(opts.freshSec);
    }
    if (typeof opts.listenMs === "number" && isFinite(opts.listenMs) && opts.listenMs > 0) {
      cfg.listenMs = Math.floor(opts.listenMs);
    }
  }

  async function init(opts) {
    applyOpts(opts);
    // init() baut KEINE Verbindung auf (Empfangsmodus). Modus A (sanft, lokal,
    // idempotent) nur wenn ausdrücklich verlangt — das ist KEINE Netz-Aktion.
    if (opts && opts.ensureIdentity) {
      try { await ensureIdentity(); } catch (_e) { /* fail-soft */ }
    }
    return Promise.resolve();
  }

  function configure(opts) { applyOpts(opts); }

  // ---- Kern: lauschen + lebende Visitenkarte ans Brett heften ----
  // Geteilt von announce() und connectAndAnnounce().
  async function doAnnounce(own) {
    var relay = resolveRelay();
    if (!relay) {
      return { ok: false, reason: "Kein Nostr-Relais-Client (Modul 05b) verfügbar." };
    }
    // Erst lauschen, damit der Knoten erreichbar ist, wenn jemand andockt.
    var ana = resolveAnastomose();
    if (ana && typeof ana.listenNostr === "function") {
      try { await ana.listenNostr(); } catch (_e) { /* fail-soft: weiter, Karte hängt trotzdem */ }
    }
    var card = {
      kind: RDV_PRESENCE_KIND,
      nodeId: own.id,
      nodeName: cfg.nodeName,
      spore: own,
      ts: nowSec(),
    };
    try {
      await relay.publish({
        kind: NOSTR_KIND,
        created_at: nowSec(),
        tags: [["t", RDV_TAG]],
        content: JSON.stringify(card),
      });
    } catch (e) {
      return { ok: false, reason: "Anmelden fehlgeschlagen: " + (e && e.message ? e.message : e) };
    }
    signalListening(true);
    return { ok: true, nodeId: own.id };
  }

  // ---- announce(): nur (neu) anmelden — setzt Identität voraus ----
  async function announce() {
    var relay = resolveRelay();
    if (!relay) {
      return { ok: false, reason: "Kein Nostr-Relais-Client (Modul 05b) verfügbar." };
    }
    var own = await getOwnLiveSpore();
    if (!own || !own.id) {
      return { ok: false, reason: "Noch keine Identität — connectAndAnnounce() nutzen oder zuerst eine Spore erzeugen." };
    }
    return await doAnnounce(own);
  }

  // ---- connectAndAnnounce(): Identität erzeugen (falls keine) + anmelden ----
  // opts.createIdentity: optional async () -> spore. App-eigen (Domänen-
  // Stichworte sind app-spezifisch). Ohne Callback + ohne Identität → ok:false.
  async function connectAndAnnounce(opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    var relay = resolveRelay();
    if (!relay) {
      return { ok: false, created: false, reason: "Kein Nostr-Relais-Client (Modul 05b) verfügbar." };
    }
    var own = await getOwnLiveSpore();
    if (own && own.id) {
      var rA = await doAnnounce(own);
      return { ok: rA.ok, created: false, nodeId: rA.nodeId, reason: rA.reason };
    }
    // Keine Identität — über den app-eigenen Callback erzeugen (opts oder cfg).
    var makeId = (typeof opts.createIdentity === "function") ? opts.createIdentity : cfg.createIdentity;
    if (typeof makeId !== "function") {
      return {
        ok: false, created: false,
        reason: "Keine Identität und kein createIdentity-Callback übergeben " +
          "(app-eigen, da Domänen-Stichworte app-spezifisch sind).",
      };
    }
    try {
      await makeId();
    } catch (e) {
      return { ok: false, created: false, reason: "Identitäts-Erzeugung fehlgeschlagen: " + (e && e.message ? e.message : e) };
    }
    var fresh = await getOwnLiveSpore();
    if (!fresh || !fresh.id) {
      return { ok: false, created: false, reason: "Identität nach createIdentity nicht lesbar." };
    }
    var rB = await doAnnounce(fresh);
    return { ok: rB.ok, created: true, nodeId: rB.nodeId, reason: rB.reason };
  }

  // ---- discover(): lebende Visitenkarten lesen ----
  async function discover(opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    var relay = resolveRelay();
    if (!relay) {
      return { ok: false, cards: [], reason: "Kein Nostr-Relais-Client (Modul 05b) verfügbar." };
    }
    var listenMs = (typeof opts.listenMs === "number" && isFinite(opts.listenMs) && opts.listenMs > 0)
      ? Math.floor(opts.listenMs) : cfg.listenMs;
    var freshSec = (typeof opts.freshSec === "number" && isFinite(opts.freshSec) && opts.freshSec > 0)
      ? Math.floor(opts.freshSec) : cfg.freshSec;

    var own = await getOwnLiveSpore();
    var ownId = own && own.id;

    var sinceSec = nowSec() - freshSec;
    var byId = {};   // nodeId -> { card, ts }
    var unsub = null;
    try {
      unsub = relay.subscribe(
        { kinds: [NOSTR_KIND], "#t": [RDV_TAG], since: sinceSec },
        function onEvent(ev) {
          if (!ev || typeof ev.content !== "string") return;
          var card;
          try { card = JSON.parse(ev.content); } catch (e) { return; }
          if (!card || card.kind !== RDV_PRESENCE_KIND || !card.nodeId || !card.spore) return;
          var ts = (typeof card.ts === "number" ? card.ts : (typeof ev.created_at === "number" ? ev.created_at : 0));
          if (!byId[card.nodeId] || ts > byId[card.nodeId].ts) byId[card.nodeId] = { card: card, ts: ts };
        },
      );
    } catch (e) {
      return { ok: false, cards: [], reason: "Raum-Lesen fehlgeschlagen: " + (e && e.message ? e.message : e) };
    }

    return await new Promise(function (resolve) {
      setTimeout(function () {
        if (unsub) { try { unsub(); } catch (e) {} }
        var now = nowSec();
        var cards = Object.keys(byId)
          .filter(function (id) { return id !== ownId; })
          .map(function (id) {
            var entry = byId[id];
            var c = entry.card;
            return {
              nodeId: id,
              nodeName: (typeof c.nodeName === "string" && c.nodeName.length > 0) ? c.nodeName : "Knoten",
              spore: c.spore,
              ts: entry.ts,
              ageSec: Math.max(0, now - (entry.ts || now)),
            };
          })
          .sort(function (a, b) { return b.ts - a.ts; });
        // Reine Anzeige-Anreicherung: zentrierter Verwandtschafts-Score je Karte
        // (gatet nichts; Handshake bleibt 0.80-Riegel). Fail-soft ohne Modul 04.
        resolve({ ok: true, cards: relatednessForCards(cards, own) });
      }, listenMs);
    });
  }

  // ---- handshakeCard(): Handshake an die LEBENDE ID der Karte ----
  async function handshakeCard(card, opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    if (!card || !card.spore || !card.spore.id) {
      return { outcome: "error", reason: "Karte ohne gültige Spore." };
    }
    var ana = resolveAnastomose();
    if (!ana) {
      return { outcome: "error", reason: "Modul 05 (Anastomose) nicht geladen." };
    }
    var timeoutMs = (typeof opts.timeoutMs === "number" && isFinite(opts.timeoutMs) && opts.timeoutMs > 0)
      ? Math.floor(opts.timeoutMs) : RDV_HANDSHAKE_TIMEOUT_MS;
    var r;
    try {
      r = await ana.handshake(card.spore, null, { transport: "nostr", timeoutMs: timeoutMs });
    } catch (e) {
      var nm = e && e.name ? e.name : "";
      if (nm === "HandshakeTimeoutError") {
        return { outcome: "timeout", reason: "Keine Antwort in " + Math.round(timeoutMs / 1000) + " s — Gegenknoten offline/nicht wach (Visitenkarte veraltet)." };
      }
      return { outcome: "error", reason: (nm ? "(" + nm + ") " : "") + (e && e.message ? e.message : String(e)) };
    }
    var oc = (r && typeof r.outcome === "string") ? r.outcome : "rejected";
    return {
      outcome: oc,
      score: (r && typeof r.score === "number") ? r.score : undefined,
      reason: (r && r.reason) ? r.reason : undefined,
      raw: r,
    };
  }

  // ==== Bau 23.B — Cross-Knoten-Frage (bidirektionale Bedeutungs-Suche) ====
  // Vertrag: INTERFACES.md §1 Modul 23 § Bau 23.B. Knoten fragt Knoten
  // server-los über das Relais; der Gegenknoten antwortet mit den Top-k
  // seiner LOKALEN Bedeutungs-Suche (Modul 04 queryLocal, app-registrierter
  // Korpus-Provider). FRAGEN ist nutzer-ausgelöst; ANTWORTEN ist das
  // Antwortrecht des Empfangsmodus und wird per enableAnswering()
  // AUSDRÜCKLICH eingeschaltet (Default AUS, nicht persistiert).
  // v1 ehrlich offen: Zettel-Umschläge UNSIGNIERT — Identitäts-Wahrheit
  // bleibt beim signierten Handshake + 0.80-Riegel; Antworten sind ADVISORY.
  var RDV_QUERY_TAG = "sbkim-qry";
  var RDV_QUERY_KIND = "sbkim-query";
  var RDV_QUERY_RES_KIND = "sbkim-query-res";
  var RDV_QUERY_MAX_PER_MIN = 6;     // Antwort-Rate-Limit (Vorgriff Modul 11)
  var RDV_QUERY_TEXT_MAX = 300;      // Frage-Text hart gekappt (untrusted input)
  var RDV_QUERY_K_MAX = 5;           // maximal 5 Treffer je Antwort
  var RDV_ASK_TIMEOUT_MS = 60000; // 15 s war zu knapp: der Antworter lädt beim ersten Mal sein ~30-MB-Modell

  var answerUnsub = null;            // aktiver Antwort-Lauscher (null = AUS)
  var answeredCount = 0;
  var seenQids = [];                 // Dedupe-Fenster (Cap 200)
  var answerTimestamps = [];         // für das Rate-Limit (ms-Zeitstempel)
  var answerCorpusEnsured = false;   // Korpus-Kopplung schon erzwungen? (Bau 23.B-Härtung)

  function resolveQueryMatch() {
    var m = cfg.match || global.SbkimMatch;
    return (m && typeof m.queryLocal === "function") ? m : null;
  }

  // ---- Korpus-Kopplung härten (Bau 23.B-Härtung, 2026-07-10) ----
  // Die Korpus-leer-Falle: enableAnswering() ruft beim Fragen queryLocal —
  // ECHTE Treffer gibt es aber nur, wenn Modul 04 vorher einen lokalen Korpus
  // registriert bekam (setLocalCorpus). Bisher tat das AUSSCHLIESSLICH das
  // Such-Widget (Modul 22) LAZY bei der ERSTEN Widget-Suche. Antwort-Pfad (23)
  // und Korpus-Aufbau (22) waren also nicht gekoppelt → wer „Antworten" AN-
  // schaltet, aber nie selbst suchte, antwortete mit LEERER Liste trotz
  // vorhandener Daten (live zugeschlagen, PULS.md 2026-07-02). Beim bewussten
  // Einschalten des Antwortrechts stellen wir den Korpus jetzt AKTIV sicher —
  // unabhängig davon, ob je eine Widget-Suche lief.
  //
  // Verfassungstreu + fail-soft: rein lokal (kein Netz), nutzt NUR die
  // öffentliche Fläche von Modul 04 (setLocalCorpus). Ohne cfg.prepareCorpus
  // (App koppelt den Korpus anders, z.B. selbst übers Widget) ODER ohne
  // setLocalCorpus-Fähigkeit ODER bei einem Fehler im Provider → wir tun
  // NICHTS bzw. lassen den Korpus wie er ist; queryLocal liefert dann ehrlich
  // leer, es bricht NICHTS. Idempotent: nur einmal je Provider.
  async function ensureAnswerCorpus() {
    if (answerCorpusEnsured) return;
    if (typeof cfg.prepareCorpus !== "function") return; // App koppelt anders → nicht erzwingen
    var m = cfg.match || global.SbkimMatch;
    if (!m || typeof m.setLocalCorpus !== "function") return; // kein Registrier-Pfad → fail-soft
    try {
      var corpus = await cfg.prepareCorpus();
      if (Array.isArray(corpus)) {
        m.setLocalCorpus(corpus);
        answerCorpusEnsured = true;
      }
    } catch (_e) { /* fail-soft: Korpus bleibt unverändert, queryLocal ggf. ehrlich leer */ }
  }
  function qidSeen(qid) { return seenQids.indexOf(qid) !== -1; }
  function rememberQid(qid) {
    seenQids.push(qid);
    if (seenQids.length > 200) seenQids.splice(0, seenQids.length - 200);
  }
  function underRateLimit() {
    var cut = Date.now() - 60000;
    answerTimestamps = answerTimestamps.filter(function (t) { return t > cut; });
    return answerTimestamps.length < RDV_QUERY_MAX_PER_MIN;
  }

  // ---- enableAnswering(): Antwortrecht bewusst einschalten ----
  async function enableAnswering(opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    if (answerUnsub) return { ok: true, reason: "Antworten läuft schon (idempotent)." };
    var relay = resolveRelay();
    if (!relay) return { ok: false, reason: "Kein Nostr-Relais-Client (Modul 05b) verfügbar." };
    var own = await getOwnLiveSpore();
    if (!own || !own.id) return { ok: false, reason: "Noch keine Identität — zuerst anmelden (announce)." };
    var ownId = own.id;
    var kCap = (typeof opts.k === "number" && isFinite(opts.k) && opts.k >= 1)
      ? Math.min(Math.floor(opts.k), RDV_QUERY_K_MAX) : RDV_QUERY_K_MAX;
    // Korpus-leer-Falle absichern: vor dem Lauschen den lokalen Korpus aktiv
    // sicherstellen, damit die erste eingehende Frage nicht ins Leere greift
    // (fail-soft — ohne Provider/Registrier-Pfad passiert nichts, kein Bruch).
    await ensureAnswerCorpus();
    try {
      answerUnsub = relay.subscribe(
        { kinds: [NOSTR_KIND], "#t": [RDV_QUERY_TAG], since: nowSec() },
        function onQuery(ev) {
          if (!ev || typeof ev.content !== "string") return;
          var q;
          try { q = JSON.parse(ev.content); } catch (_e) { return; }
          // untrusted external data: streng validieren, nie als Anweisung deuten
          if (!q || q.kind !== RDV_QUERY_KIND || q.toNodeId !== ownId) return;
          if (typeof q.qid !== "string" || !q.qid || typeof q.text !== "string" || !q.text.trim()) return;
          if (qidSeen(q.qid)) return;
          rememberQid(q.qid);
          if (!underRateLimit()) return;          // Überschuss still verwerfen
          answerTimestamps.push(Date.now());
          var text = q.text.slice(0, RDV_QUERY_TEXT_MAX);
          var k = (typeof q.k === "number" && isFinite(q.k) && q.k >= 1)
            ? Math.min(Math.floor(q.k), kCap) : kCap;
          // Lokale Bedeutungs-Suche (fail-soft) → Antwort-Zettel publizieren.
          (async function () {
            var results = [];
            var match = resolveQueryMatch();
            if (match) {
              try {
                // exclude:true — die Frage eines fremden Knotens kann eine
                // Verneinung tragen („alkoholfrei", „ohne Erdbeeren"). Modul 04
                // parst sie und filtert VOR dem Ranking (Bau 04.I). Ohne
                // Verneinung byte-gleich; Andock-Riegel unberührt.
                var hits = await match.queryLocal(text, k, { hybrid: true, exclude: true });
                results = (Array.isArray(hits) ? hits : []).slice(0, k).map(function (h) {
                  var r = { label: String(h.label || ""), score: (typeof h.score === "number") ? h.score : null };
                  if (typeof h.anchorId === "string" && h.anchorId) r.anchorId = h.anchorId;
                  return r;
                });
              } catch (_e) { results = []; }      // ehrlich leer statt Bruch
            }
            try {
              await relay.publish({
                kind: NOSTR_KIND,
                created_at: nowSec(),
                tags: [["t", RDV_QUERY_TAG]],
                content: JSON.stringify({
                  kind: RDV_QUERY_RES_KIND, qid: q.qid,
                  toNodeId: q.fromNodeId, fromNodeId: ownId,
                  fromName: cfg.nodeName, results: results, ts: nowSec(),
                }),
              });
              answeredCount++;
            } catch (_e) { /* fail-soft: Antwort verloren, kein Bruch */ }
          })();
        },
      );
    } catch (e) {
      answerUnsub = null;
      return { ok: false, reason: "Antwort-Lauscher fehlgeschlagen: " + (e && e.message ? e.message : e) };
    }
    // Vorwärmen (Bau 23.B-Härtung II, 2026-07-10): der Antworter lädt sein
    // ~30-MB-Modell + baut seinen Korpus SONST erst bei der ersten eingehenden
    // Frage — das kann 30 s–2 min dauern und läuft in den Frage-Timeout. Deshalb
    // beim Einschalten des Antwortrechts JETZT im Hintergrund eine Aufwärm-Suche
    // absetzen: das lädt Modell + Korpus vor, sodass die erste echte Frage
    // sofort beantwortet wird. Fire-and-forget, fail-soft (kein Netz, rein lokal).
    (function warmUpAnswerer() {
      var m = resolveQueryMatch();
      if (!m) return;
      try { Promise.resolve(m.queryLocal("aufwärmen", 1)).catch(function () {}); }
      catch (_e) { /* fail-soft */ }
    })();
    signalListening(true);
    return { ok: true };
  }

  function disableAnswering() {
    if (answerUnsub) { try { answerUnsub(); } catch (_e) {} }
    answerUnsub = null;
  }

  // ---- askNode(): einem lebenden Knoten eine Suchfrage stellen ----
  async function askNode(target, text, opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    var toNodeId = null;
    if (target && typeof target === "object") {
      toNodeId = target.nodeId || (target.spore && target.spore.id) || null;
    } else if (typeof target === "string") { toNodeId = target; }
    if (!toNodeId) return { ok: false, reason: "Kein Ziel-Knoten (Karte oder nodeId) angegeben." };
    if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "Leere Frage." };
    var relay = resolveRelay();
    if (!relay) return { ok: false, reason: "Kein Nostr-Relais-Client (Modul 05b) verfügbar." };
    var own = await getOwnLiveSpore();
    if (!own || !own.id) return { ok: false, reason: "Noch keine Identität — zuerst anmelden (announce)." };
    var ownId = own.id;
    var k = (typeof opts.k === "number" && isFinite(opts.k) && opts.k >= 1)
      ? Math.min(Math.floor(opts.k), RDV_QUERY_K_MAX) : RDV_QUERY_K_MAX;
    var timeoutMs = (typeof opts.timeoutMs === "number" && isFinite(opts.timeoutMs) && opts.timeoutMs > 0)
      ? Math.floor(opts.timeoutMs) : RDV_ASK_TIMEOUT_MS;
    var qid = "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var started = Date.now();

    return await new Promise(function (resolve) {
      var done = false, unsub = null, timer = null;
      function finish(res) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (unsub) { try { unsub(); } catch (_e) {} }
        resolve(res);
      }
      // Erst auf die Antwort lauschen, dann fragen (kein Fenster verpassen).
      try {
        unsub = relay.subscribe(
          { kinds: [NOSTR_KIND], "#t": [RDV_QUERY_TAG], since: nowSec() - 5 },
          function onRes(ev) {
            if (!ev || typeof ev.content !== "string") return;
            var a;
            try { a = JSON.parse(ev.content); } catch (_e) { return; }
            if (!a || a.kind !== RDV_QUERY_RES_KIND || a.qid !== qid || a.toNodeId !== ownId) return;
            var results = (Array.isArray(a.results) ? a.results : []).slice(0, RDV_QUERY_K_MAX)
              .map(function (r) {
                var o = { label: String((r && r.label) || ""), score: (r && typeof r.score === "number") ? r.score : null };
                if (r && typeof r.anchorId === "string" && r.anchorId) o.anchorId = r.anchorId;
                return o;
              });
            finish({ ok: true, results: results, fromNodeId: a.fromNodeId || null, tookMs: Date.now() - started });
          },
        );
      } catch (e) {
        finish({ ok: false, reason: "Antwort-Lauscher fehlgeschlagen: " + (e && e.message ? e.message : e) });
        return;
      }
      Promise.resolve(relay.publish({
        kind: NOSTR_KIND,
        created_at: nowSec(),
        tags: [["t", RDV_QUERY_TAG]],
        content: JSON.stringify({
          kind: RDV_QUERY_KIND, qid: qid, toNodeId: toNodeId, fromNodeId: ownId,
          fromName: cfg.nodeName, text: text.trim().slice(0, RDV_QUERY_TEXT_MAX), k: k, ts: nowSec(),
        }),
      })).catch(function (e) {
        finish({ ok: false, reason: "Frage-Zettel konnte nicht publiziert werden: " + (e && e.message ? e.message : e) });
      });
      timer = setTimeout(function () {
        finish({ ok: false, reason: "Keine Antwort in " + Math.round(timeoutMs / 1000) + " s — Gegenknoten offline oder Antworten dort nicht eingeschaltet." });
      }, timeoutMs);
    });
  }

  // ---- Public surface ----
  var api = {
    init: init,
    configure: configure,
    announce: announce,
    connectAndAnnounce: connectAndAnnounce,
    discover: discover,
    handshakeCard: handshakeCard,
    enableAnswering: enableAnswering,   // Bau 23.B — Antwortrecht bewusst AN (Default AUS)
    disableAnswering: disableAnswering, // Bau 23.B
    askNode: askNode,                   // Bau 23.B — nutzer-ausgelöste Cross-Knoten-Frage
    relatednessForCards: relatednessForCards, // pure (cards, ownSpore) → angereicherte Liste; reine Anzeige
    ensureIdentity: ensureIdentity,             // Modus A (sanft, automatisch, idempotent)
    cleanupSharedOrigin: cleanupSharedOrigin,   // Modus-B-Reinigung (nur eigene Origin)
    repairAndReconnect: repairAndReconnect,     // Modus B (zerstörend, nutzer-ausgelöst)
    get _meta() {
      return {
        version: VERSION,
        tag: RDV_TAG,
        presenceKind: RDV_PRESENCE_KIND,
        sharedDbName: SHARED_DB_NAME,
        dbSuffix: cfg.dbSuffix,
        freshSec: cfg.freshSec,
        listenMs: cfg.listenMs,
        nodeName: cfg.nodeName,
        hasRelay: resolveRelay() !== null,
        hasAnastomose: resolveAnastomose() !== null,
        hasSpore: resolveSpore() !== null,
        hasMatch: resolveMatch() !== null,
        hasStorage: resolveStorage() !== null,
        hasCreateIdentity: typeof cfg.createIdentity === "function",
        answering: answerUnsub !== null,          // Bau 23.B
        answeredCount: answeredCount,             // Bau 23.B
        hasPrepareCorpus: typeof cfg.prepareCorpus === "function", // Bau 23.B-Härtung
        answerCorpusEnsured: answerCorpusEnsured,  // Bau 23.B-Härtung (Korpus gekoppelt?)
        queryTag: RDV_QUERY_TAG,                  // Bau 23.B
        queryKind: RDV_QUERY_KIND,                // Bau 23.B
        queryResKind: RDV_QUERY_RES_KIND,         // Bau 23.B
        queryMaxPerMin: RDV_QUERY_MAX_PER_MIN,    // Bau 23.B
      };
    },
  };

  global.SbkimRendezvous = api;

  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 23 RENDEZVOUS bereit (gemeinsamer Raum, Empfangsmodus/nutzer-ausgelöst), " +
        "Funktionen: init/configure/announce/connectAndAnnounce/discover/handshakeCard/" +
        "enableAnswering/disableAnswering/askNode/relatednessForCards/" +
        "ensureIdentity/cleanupSharedOrigin/repairAndReconnect",
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
