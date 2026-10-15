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
 *     eigene Schublade bleibt), dann Anmelden + „hart neu laden".
 *     Identitäts-Isolierung (2026-07-11): liegt die einzige Identität noch im
 *     geteilten Topf `sbkim`, wird sie ERST in die eigene Schublade migriert
 *     (Modul 01 migrateIdentityFrom), DANN der Topf gelöscht — Kollision
 *     aufgelöst UND Identität behalten. Scheitert die Migration, bleibt der
 *     Topf als Fallback stehen (reiner Schutz vor Identitätsverlust).
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
 *   announce(opts?) -> Promise<{ ok, nodeId?, reason?, bestaetigung? }>
 *       Lauscht (listenNostr) + heftet die lebende Visitenkarte ans Brett.
 *       bestaetigung = { stand: "ja"|"nein"|"unbekannt", relais:[{relay,ergebnis,grund}] }
 *       aus den OK-Antworten der Relais (Modul 05b, 2026-10-14). "nein" ⇒ ok:false.
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
  // Mengenschutz gegen Karten-Flutung (Schutz-Plan Stufe 2b, Vorgriff Modul 11).
  var RDV_CARDS_MAX = 200;              // Obergrenze je discover()-Durchlauf
  var RDV_CARDS_PER_SENDER_MAX = 3;     // je Nostr-pubkey höchstens so viele Identitäten
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

  // ---- Eigenes Netz (Schritt 1, 2026-10-13, INTERFACES §Modul 23 „EIGENES NETZ") ----
  // Ohne Einstellung bleibt ALLES wie vorher: Raum RDV_TAG, Fragen RDV_QUERY_TAG,
  // Klartext-JSON. Mit Netz-Code: Marken und Schlüssel aus dem Code (Vorbild
  // Kim-sync raumOeffnen), Karten/Fragen/Antworten AES-GCM-verschlüsselt.
  // RIEGEL: ein ungültiger Code fällt NIE still ins öffentliche Netz zurück.
  var NETZ_RAUM_SALZ = "sbkim-netz-raum-v1:";
  var NETZ_SCHLUESSEL_SALZ = "sbkim-netz-schluessel-v1";
  var NETZ_RUNDEN = 150000;
  var NETZ_CODE_MIN = 12;
  var NETZ_CODE_ZEICHEN = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var NETZ_SPEICHER_PRAEFIX = "sbkim_netz_";
  var net = { lage: "oeffentlich", rdvTag: null, qryTag: null, key: null, reason: null, pending: null };

  function netRaum() { return net.rdvTag || RDV_TAG; }
  function netFragen() { return net.qryTag || RDV_QUERY_TAG; }

  function netCodeNorm(code) {
    return String(code == null ? "" : code).replace(/[\s-]+/g, "").toUpperCase();
  }
  function netSubtle() {
    var c = global.crypto || (typeof crypto !== "undefined" ? crypto : null);
    return (c && c.subtle) ? c : null;
  }
  function netHex(buf) {
    var u = new Uint8Array(buf), s = "";
    for (var i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, "0");
    return s;
  }
  function netZuB64(u) { var s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function netAusB64(b) { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  function newNetCode() {
    var c = netSubtle();
    var roh = new Uint8Array(20);
    if (c && c.getRandomValues) c.getRandomValues(roh); else throw new Error("Kein Zufall verfügbar (WebCrypto fehlt).");
    var out = "";
    for (var i = 0; i < 20; i++) {
      if (i && i % 4 === 0) out += "-";
      out += NETZ_CODE_ZEICHEN[roh[i] % NETZ_CODE_ZEICHEN.length];
    }
    return out;
  }

  async function netAbleiten(code) {
    var n = netCodeNorm(code);
    if (n.length < NETZ_CODE_MIN || !/^[A-Z0-9]+$/.test(n)) {
      return { ok: false, reason: "Netz-Code ungültig (mindestens " + NETZ_CODE_MIN + " Zeichen, nur Buchstaben und Ziffern)." };
    }
    var c = netSubtle();
    if (!c) return { ok: false, reason: "Kein WebCrypto — Netz-Code kann nicht gelesen werden." };
    var enc = new TextEncoder();
    var h = netHex(await c.subtle.digest("SHA-256", enc.encode(NETZ_RAUM_SALZ + n)));
    var roh = await c.subtle.importKey("raw", enc.encode(n), "PBKDF2", false, ["deriveKey"]);
    var key = await c.subtle.deriveKey(
      { name: "PBKDF2", salt: enc.encode(NETZ_SCHLUESSEL_SALZ), iterations: NETZ_RUNDEN, hash: "SHA-256" },
      roh, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return { ok: true, rdvTag: "sbkim-netz-" + h.slice(0, 32), qryTag: "sbkim-netzq-" + h.slice(32, 64), key: key };
  }

  // Setzt das Netz. null/{} → öffentlich. {code} → eigen. {roomTag} → nur Raum.
  // Ein laufender Antwort-Lauscher hört auf der ALTEN Marke — er wird beendet;
  // die App schaltet das Antwortrecht im neuen Netz wieder ein.
  function setNetwork(opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    if (answerUnsub) { try { answerUnsub(); } catch (_e) {} answerUnsub = null; }
    var code = (typeof opts.code === "string") ? opts.code : null;
    var raum = (typeof opts.roomTag === "string") ? opts.roomTag : null;
    if (code !== null && code.trim() !== "") {
      net = { lage: "wird-abgeleitet", rdvTag: null, qryTag: null, key: null, reason: null, pending: null };
      var mein = net;
      mein.pending = netAbleiten(code).then(function (r) {
        if (net !== mein) return { ok: false, network: net.lage, reason: "Netz wurde inzwischen gewechselt." };
        if (!r.ok) { mein.lage = "ungueltig"; mein.reason = r.reason; return { ok: false, network: "ungueltig", reason: r.reason }; }
        mein.lage = "eigen"; mein.rdvTag = r.rdvTag; mein.qryTag = r.qryTag; mein.key = r.key;
        return { ok: true, network: "eigen" };
      }, function (e) {
        mein.lage = "ungueltig"; mein.reason = "Netz-Code konnte nicht abgeleitet werden: " + (e && e.message ? e.message : e);
        return { ok: false, network: "ungueltig", reason: mein.reason };
      });
      return mein.pending;
    }
    if (raum !== null && raum !== "") {
      if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(raum)) {
        net = { lage: "ungueltig", rdvTag: null, qryTag: null, key: null, pending: null,
          reason: "Raum-Marke ungültig (3–64 Zeichen, a–z, 0–9, Bindestrich)." };
        return Promise.resolve({ ok: false, network: "ungueltig", reason: net.reason });
      }
      net = { lage: "raum", rdvTag: raum, qryTag: raum + "-qry", key: null, reason: null, pending: null };
      return Promise.resolve({ ok: true, network: "raum" });
    }
    net = { lage: "oeffentlich", rdvTag: null, qryTag: null, key: null, reason: null, pending: null };
    return Promise.resolve({ ok: true, network: "oeffentlich" });
  }

  // Vor jeder Netz-Aktion: Ableitung abwarten; ungültig → nichts senden.
  async function netBereit() {
    if (net.pending) { try { await net.pending; } catch (_e) {} }
    if (net.lage === "ungueltig" || net.lage === "wird-abgeleitet") {
      return { ok: false, reason: net.reason || "Netz-Einstellung nicht bereit." };
    }
    return { ok: true };
  }

  // Inhalt hinaus: öffentlich Klartext-JSON (unverändert), eigen AES-GCM-Umschlag.
  async function netPacke(obj, tag) {
    var klar = JSON.stringify(obj);
    if (!net.key) return klar;
    var c = netSubtle();
    var iv = c.getRandomValues(new Uint8Array(12));
    var ct = new Uint8Array(await c.subtle.encrypt(
      { name: "AES-GCM", iv: iv, additionalData: new TextEncoder().encode(tag) },
      net.key, new TextEncoder().encode(klar)));
    return JSON.stringify({ v: 1, iv: netZuB64(iv), ct: netZuB64(ct) });
  }
  // Inhalt herein: ruft handle(obj) — öffentlich synchron wie bisher, eigen nach
  // dem Entschlüsseln. Was nicht passt, wird still verworfen. `warten` sammelt
  // die Versprechen, damit ein Sammelfenster sie vor dem Auswerten abwartet.
  function netEmpfange(ev, tag, handle, warten) {
    if (!ev || typeof ev.content !== "string") return;
    if (!net.key) {
      var o;
      try { o = JSON.parse(ev.content); } catch (_e) { return; }
      handle(o);
      return;
    }
    var key = net.key;
    var p = (async function () {
      var u;
      try { u = JSON.parse(ev.content); } catch (_e) { return; }
      if (!u || u.v !== 1 || typeof u.iv !== "string" || typeof u.ct !== "string") return;
      try {
        var klar = await netSubtle().subtle.decrypt(
          { name: "AES-GCM", iv: netAusB64(u.iv), additionalData: new TextEncoder().encode(tag) },
          key, netAusB64(u.ct));
        handle(JSON.parse(new TextDecoder().decode(klar)));
      } catch (_e) { /* falscher Code / fremder Umschlag → still verwerfen */ }
    })();
    if (warten) warten.push(p);
  }

  // ---- Netz-Einstellung speichern (Entscheidung 2026-10-13, INTERFACES) ----
  function checkNetSetting(s) {
    if (!s || typeof s !== "object") return { ok: false, reason: "Keine Netz-Einstellung." };
    if (typeof s.relay !== "string" || !/^wss:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[^\s]*)?$/.test(s.relay) || s.relay.length > 200) {
      return { ok: false, reason: "Relais-Adresse ungültig (nur wss://…)." };
    }
    var n = netCodeNorm(s.code);
    if (n.length < NETZ_CODE_MIN || !/^[A-Z0-9]+$/.test(n)) {
      return { ok: false, reason: "Netz-Code ungültig (mindestens " + NETZ_CODE_MIN + " Zeichen, nur Buchstaben und Ziffern)." };
    }
    var name = (typeof s.name === "string") ? s.name.trim().slice(0, 60) : "";
    return { ok: true, setting: { v: 1, name: name || "Eigenes Netz", relay: s.relay, code: String(s.code).trim(), auto: s.auto !== false } };
  }
  function netStore(store) {
    if (store && typeof store.getItem === "function") return store;
    try { return global.localStorage || null; } catch (_e) { return null; }
  }
  function netSchluessel() {
    return cfg.dbSuffix ? NETZ_SPEICHER_PRAEFIX + cfg.dbSuffix : null;
  }
  function loadNetwork(store) {
    var st = netStore(store), k = netSchluessel();
    if (!st || !k) return null;
    var roh; try { roh = st.getItem(k); } catch (_e) { return null; }
    if (!roh) return null;
    var s; try { s = JSON.parse(roh); } catch (_e) { return null; }
    var r = checkNetSetting(s);
    return r.ok ? r.setting : null;
  }
  // Wie loadNetwork, sagt aber AUCH, dass etwas Ungültiges gespeichert ist.
  // loadNetwork gibt dann null zurück — und null hieße für einen Aufrufer
  // „öffentlich". Genau das darf eine kaputte Einstellung nie werden (Riegel).
  function readNetwork(store) {
    var st = netStore(store), k = netSchluessel();
    if (!st || !k) return { present: false };
    var roh; try { roh = st.getItem(k); } catch (_e) { return { present: false }; }
    if (!roh) return { present: false };
    var s; try { s = JSON.parse(roh); } catch (_e) {
      return { present: true, ok: false, value: {}, reason: "Gespeicherte Netz-Einstellung ist nicht lesbar." };
    }
    var r = checkNetSetting(s);
    return r.ok ? { present: true, ok: true, setting: r.setting }
                : { present: true, ok: false, value: (s && typeof s === "object") ? s : {}, reason: r.reason };
  }
  function saveNetwork(setting, store) {
    var k = netSchluessel();
    if (!k) return { ok: false, reason: "Ohne dbSuffix wird nicht gespeichert (geteilte Adresse)." };
    var r = checkNetSetting(setting);
    if (!r.ok) return r;
    var st = netStore(store);
    if (!st) return { ok: false, reason: "Kein Speicher verfügbar." };
    try { st.setItem(k, JSON.stringify(r.setting)); } catch (e) { return { ok: false, reason: "Speichern fehlgeschlagen: " + (e && e.message ? e.message : e) }; }
    return { ok: true, setting: r.setting };
  }
  function clearNetwork(store) {
    var st = netStore(store), k = netSchluessel();
    if (st && k) { try { st.removeItem(k); } catch (_e) {} }
    return { ok: true };
  }
  // Wendet eine Einstellung an: 05b-Relais UND Code. null → öffentliches Netz.
  async function applyNetwork(setting) {
    var relay = resolveRelay();
    if (setting == null) {
      var rr = (relay && typeof relay.configure === "function") ? relay.configure({ reset: true }) : null;
      var r0 = await setNetwork(null);
      return { ok: r0.ok, network: r0.network, relays: rr && rr.relays };
    }
    var chk = checkNetSetting(setting);
    if (!chk.ok) {
      // Riegel: nicht still öffentlich weitermachen.
      net = { lage: "ungueltig", rdvTag: null, qryTag: null, key: null, pending: null, reason: chk.reason };
      return { ok: false, network: "ungueltig", reason: chk.reason };
    }
    if (!relay || typeof relay.configure !== "function") {
      net = { lage: "ungueltig", rdvTag: null, qryTag: null, key: null, pending: null,
        reason: "Relais-Client kann die Adresse nicht setzen (Modul 05b fehlt)." };
      return { ok: false, network: "ungueltig", reason: net.reason };
    }
    var rc = relay.configure({ relays: [chk.setting.relay] });
    if (rc && rc.ok === false) {
      net = { lage: "ungueltig", rdvTag: null, qryTag: null, key: null, pending: null, reason: rc.reason };
      return { ok: false, network: "ungueltig", reason: rc.reason };
    }
    var r1 = await setNetwork({ code: chk.setting.code });
    return { ok: r1.ok, network: r1.network, relays: rc && rc.relays, reason: r1.reason };
  }

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
  // Modul 02 als PRÜFER der fremden Karten (Schutz-Plan Stufe 2b). Getrennt vom
  // Resolver oben, weil dort nur `getOwnSpore` verlangt wird: eine App kann ein
  // Spore-Modul ohne `verifyForeignSpore` mitbringen — dann bleibt der Raum
  // funktionsfähig, meldet die Karten aber ehrlich als UNGEPRÜFT
  // (`_meta.cardsVerified === false`), statt sie still durchzuwinken.
  function resolveVerifier() {
    var s = cfg.spore || global.SbkimSpore;
    return (s && typeof s.verifyForeignSpore === "function") ? s : null;
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

  // ---- Raum-Karten nach FRAGE-Passung ranken (A11, REINE ANZEIGE/AUSWAHL) ----
  // Klaus' Befund 2026-07-11: bei vielen Knoten kann der Nutzer nicht wissen,
  // wen er fragen soll. `relatednessForCards` vergleicht die EIGENE Spore mit
  // jeder Karte (Badge) — hier vergleichen wir stattdessen den bereits
  // eingebetteten QUERY-Vektor (die getippte Frage) mit jedem Karten-
  // `domainVector`, damit der Aufrufer den bestpassenden Knoten automatisch
  // anfragen und die Karten nach Passung sortieren kann.
  //
  // Reine Tool-Funktion: DOM-frei, headless testbar, Eingabe NICHT mutiert
  // (neue Liste). Nutzt Modul 04 `relatedness` (zentrierter Cosinus — bessere
  // Trennung; opts.raw → rohes `match`). GATET NICHTS — der 0.80-Andock-Riegel
  // (Modul 05) bleibt unberührt; dies wählt/sortiert nur die Anzeige.
  // Fail-soft: ohne Modul 04 / ohne Query-Vektor / ohne Karten-domainVector →
  // Karten UNVERÄNDERT in Eingabe-Reihenfolge zurück, jede mit queryFit:null
  // (der Aufrufer degradiert dann auf die heutige Recency-Reihenfolge).
  function rankCardsByQuery(cards, queryVec, opts) {
    var list = Array.isArray(cards) ? cards : [];
    var o = opts || {};
    var match = resolveMatch();
    var qv = toVec(queryVec);
    var useRaw = o.raw === true && match && typeof match.match === "function";
    var enriched = list.map(function (c, i) {
      var copy = {};
      for (var k in c) { if (Object.prototype.hasOwnProperty.call(c, k)) copy[k] = c[k]; }
      var fit = null;
      if (match && qv && c && c.spore) {
        var cv = toVec(c.spore.domainVector);
        if (cv) {
          try {
            var s = useRaw ? match.match(qv, cv) : match.relatedness(qv, cv);
            if (typeof s === "number" && isFinite(s)) fit = s;
          } catch (_e) { fit = null; } // fail-soft, Karte bleibt
        }
      }
      copy.queryFit = fit;
      copy._idx = i; // stabiler Tie-Break
      return copy;
    });
    // Ohne brauchbaren Query-Vektor NICHT umsortieren (Eingabe-Reihenfolge).
    if (!qv || !match) {
      return enriched.map(function (c) { delete c._idx; return c; });
    }
    enriched.sort(function (a, b) {
      var fa = (typeof a.queryFit === "number") ? a.queryFit : -Infinity;
      var fb = (typeof b.queryFit === "number") ? b.queryFit : -Infinity;
      if (fb !== fa) return fb - fa;      // beste Passung zuerst
      return a._idx - b._idx;             // sonst Eingabe-Reihenfolge (stabil)
    });
    return enriched.map(function (c) { delete c._idx; return c; });
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

  // ---- dbHasIdentity(dbName) — read-only IndexedDB-Probe (Identitäts-Schutz) ----
  // Prüft OHNE Seiteneffekt, ob eine benannte SBKIM-DB bereits eine Identität
  // trägt (nicht-leerer Store `sbkim_keys`). Rein lesend, fail-soft: ohne
  // IndexedDB / bei jedem Fehler → false. Legt die DB NICHT dauerhaft an — muss
  // sie zum Prüfen geöffnet werden und existierte sie vorher nicht (onupgrade-
  // needed feuert), wird die frisch-leere Phantom-DB gleich wieder gelöscht.
  // Nutzt NUR die Web-IndexedDB-API + die bekannten Store-Namen — Modul 01/02
  // bleiben unangetastet.
  function dbHasIdentity(dbName) {
    return new Promise(function (resolve) {
      var idb = (typeof global.indexedDB !== "undefined" && global.indexedDB) ? global.indexedDB : null;
      if (!idb || typeof idb.open !== "function" || !dbName) return resolve(false);
      var req, created = false;
      try { req = idb.open(dbName); } catch (_e) { return resolve(false); }
      req.onupgradeneeded = function () { created = true; };
      req.onerror = function () { resolve(false); };
      req.onblocked = function () { resolve(false); };
      req.onsuccess = function () {
        var db = req.result;
        function finish(has) {
          try { db.close(); } catch (_e) {}
          if (created) { try { idb.deleteDatabase(dbName); } catch (_e2) {} }
          resolve(has);
        }
        try {
          if (created || !db.objectStoreNames || !db.objectStoreNames.contains("sbkim_keys")) {
            return finish(false);
          }
          var tx = db.transaction("sbkim_keys", "readonly");
          var cnt = tx.objectStore("sbkim_keys").count();
          cnt.onsuccess = function () { finish(typeof cnt.result === "number" && cnt.result > 0); };
          cnt.onerror = function () { finish(false); };
        } catch (_e) { finish(false); }
      };
    });
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
    // Identitäts-Isolierung (2026-07-11, Teil 2): liegt die einzige Identität
    // noch im geteilten Topf `sbkim` und die eigene Schublade ist leer, holen
    // wir sie herüber, BEVOR getOrCreateIdentity unten eine NEUE erzeugt (was
    // die geteilte-Topf-Kollision fortschreiben würde). Modus A = sanft,
    // additiv, nicht-zerstörend (der geteilte Topf bleibt hier stehen; erst
    // repairAndReconnect löscht ihn). Fail-soft; ohne migrateIdentityFrom
    // (älteres Storage-Modul) passiert nichts.
    if (suffix && storage && typeof storage.migrateIdentityFrom === "function") {
      try {
        var sharedHasIdA = await dbHasIdentity(SHARED_DB_NAME);
        var suffixHasIdA = await dbHasIdentity("sbkim_" + suffix);
        if (sharedHasIdA && !suffixHasIdA) {
          await storage.migrateIdentityFrom(SHARED_DB_NAME);
        }
      } catch (_e) { /* fail-soft: dann erzeugt getOrCreateIdentity ggf. neu */ }
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

  // ---- cleanupSharedOrigin(opts?) — Modus-B-Reinigung (NUR eigene Origin) ----
  // opts.deleteSharedDb (Default true): löscht den geteilten Alt-Topf `sbkim`.
  // Identitäts-Schutz (Weg A, 2026-07-11): repairAndReconnect() setzt das auf
  // FALSE, wenn die einzige Identität noch im geteilten Topf steckt — dann
  // bleibt `sbkim` STEHEN (sonst wäre die Identität weg). SW-Abmeldung +
  // Cache-Leerung laufen IMMER (heilen den häufigsten Kollisions-Anteil).
  async function cleanupSharedOrigin(opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    var deleteSharedDb = opts.deleteSharedDb !== false;
    var result = { dbDeleted: false, dbKept: false, swUnregistered: 0, cachesDeleted: 0, notes: [] };
    if (!deleteSharedDb) {
      result.dbKept = true;
      result.notes.push("Geteilte DB 'sbkim' NICHT gelöscht — sie trägt noch die einzige Identität (Schutz vor Identitätsverlust).");
    } else {
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
    }
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

  // ---- Modus B: repairAndReconnect() — nutzer-ausgelöst, identitäts-schonend ----
  async function repairAndReconnect(opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    var suffix = (typeof opts.dbSuffix === "string" && opts.dbSuffix.length > 0) ? opts.dbSuffix : cfg.dbSuffix;
    var storage = resolveStorage();
    // Reihenfolge (Weg A, 2026-07-11): eigene Schublade ZUERST aktivieren, DANN
    // erst reinigen — sonst könnte die spätere init den geteilten Topf gar nicht
    // mehr von der eigenen Schublade unterscheiden.
    if (suffix && storage) {
      try { await storage.init({ dbSuffix: suffix }); } catch (_e) { /* fail-soft */ }
    }
    // Identitäts-Schutz: den geteilten Topf `sbkim` NUR löschen, wenn die eigene
    // Schublade `sbkim_<suffix>` die Identität schon trägt. Steckt die einzige
    // Identität (Alt-Fall / frühe Ordering-Kollision) noch in `sbkim`, würde das
    // Löschen sie vernichten und beim Neu-Anmelden eine NEUE erzeugen — genau das
    // gemeldete Symptom. Im Zweifel (Probe-Fehler) NICHT löschen (fail-safe:
    // Identität behalten geht vor geteilten Topf leeren). Bei newIdentity:true
    // will der Nutzer ausdrücklich frisch anfangen → volle Reinigung.
    // Identitäts-Isolierung (2026-07-11): Alt-Fall (Identität nur im geteilten
    // Topf) wird jetzt AUFGELÖST statt nur geschützt — die Identität wird in
    // die eigene Schublade MIGRIERT, dann der geteilte Topf gefahrlos gelöscht
    // (Kollision weg UND Identität behalten). Nur wenn die Migration fehlschlägt
    // oder kein Migrations-Pfad da ist (älteres Storage-Modul), bleibt der reine
    // Schutz als Fallback (Topf stehen lassen). Bei newIdentity:true will der
    // Nutzer ausdrücklich frisch anfangen → volle Reinigung, keine Migration.
    var protectShared = false, identityNote = null, migrated = false;
    if (opts.newIdentity !== true) {
      try {
        var sharedHasId = await dbHasIdentity(SHARED_DB_NAME);
        var suffixHasId = suffix ? await dbHasIdentity("sbkim_" + suffix) : false;
        if (sharedHasId && !suffixHasId) {
          if (suffix && storage && typeof storage.migrateIdentityFrom === "function") {
            try {
              await storage.migrateIdentityFrom(SHARED_DB_NAME);
              var suffixHasIdAfter = await dbHasIdentity("sbkim_" + suffix);
              if (suffixHasIdAfter) {
                migrated = true;
                identityNote = "Deine Identität lag im geteilten Speicher — sie wurde in deine eigene Schublade übernommen; der geteilte Topf wird jetzt geleert (Kollision aufgelöst, Identität behalten).";
              } else {
                protectShared = true;
                identityNote = "Migration unvollständig — geteilte DB vorsichtshalber NICHT gelöscht (Identität geschützt).";
              }
            } catch (_e2) {
              protectShared = true;
              identityNote = "Migration fehlgeschlagen — geteilte DB vorsichtshalber NICHT gelöscht (Identität geschützt).";
            }
          } else {
            // Kein Migrations-Pfad (älteres Storage-Modul) → reiner Schutz.
            protectShared = true;
            identityNote = "Deine Identität lag noch im geteilten Speicher — sie wurde NICHT gelöscht (kein Identitätsverlust). Nach dem harten Neuladen läuft sie in deiner eigenen Schublade weiter.";
          }
        }
      } catch (_e) { protectShared = true; identityNote = "Speicher-Probe fehlgeschlagen — geteilte DB vorsichtshalber NICHT gelöscht (Identität geschützt)."; }
    }
    var cleaned = await cleanupSharedOrigin({ deleteSharedDb: !protectShared });
    // Nach der Reinigung die eigene Schublade erneut sicherstellen (der geteilte
    // Topf kann jetzt weg sein; die eigene Schublade überlebt in jedem Fall).
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
      protectedIdentity: protectShared, migratedIdentity: migrated, identityNote: identityNote,
      nodeId: res.nodeId, reason: res.reason, reloadHint: RELOAD_HINT, bestaetigung: res.bestaetigung,
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
    if (opts.netCode !== undefined || opts.roomTag !== undefined) {
      setNetwork({ code: opts.netCode, roomTag: opts.roomTag });
    }
  }

  async function init(opts) {
    applyOpts(opts);
    if (net.pending) { try { await net.pending; } catch (_e) {} }
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
  // Relais-Antwort deuten (INTERFACES §Modul 05b „Relais-Antwort", 2026-10-14).
  // "ja" = mindestens ein Relais meldete OK true · "nein" = alle antworteten,
  // alle lehnten ab · "unbekannt" = alles andere (auch ein Client ohne antwort).
  function bestaetigungAus(a) {
    if (!a || !Array.isArray(a.relais)) return { stand: "unbekannt", relais: [] };
    var liste = a.relais.map(function (r) {
      return { relay: String(r && r.relay || ""), ergebnis: String(r && r.ergebnis || "unbekannt"),
        grund: String(r && r.grund || "").slice(0, 200) };
    });
    var ja = liste.some(function (r) { return r.ergebnis === "angenommen"; });
    var alleNein = liste.length > 0 && liste.every(function (r) { return r.ergebnis === "abgelehnt"; });
    return { stand: ja ? "ja" : (alleNein ? "nein" : "unbekannt"), relais: liste };
  }

  async function doAnnounce(own, ohneWarten) {
    var relay = resolveRelay();
    if (!relay) {
      return { ok: false, reason: "Kein Nostr-Relais-Client (Modul 05b) verfügbar." };
    }
    var nb = await netBereit();
    if (!nb.ok) return { ok: false, reason: nb.reason };
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
    var pr;
    try {
      pr = await relay.publish({
        kind: NOSTR_KIND,
        created_at: nowSec(),
        tags: [["t", netRaum()]],
        content: await netPacke(card, netRaum()),
      });
    } catch (e) {
      return { ok: false, reason: "Anmelden fehlgeschlagen: " + (e && e.message ? e.message : e) };
    }
    signalListening(true);
    var antwort = null;
    if (!ohneWarten && pr && pr.antwort && typeof pr.antwort.then === "function") {
      try { antwort = await pr.antwort; } catch (_e) { antwort = null; }
    }
    var best = bestaetigungAus(antwort);
    if (best.stand === "nein") {
      return { ok: false, nodeId: own.id, bestaetigung: best,
        reason: "Kein Relais hat die Anmeldung angenommen: " + best.relais.map(function (r) {
          return r.relay + " — " + (r.grund || "ohne Grund");
        }).join("; ") };
    }
    return { ok: true, nodeId: own.id, bestaetigung: best };
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
      return { ok: rA.ok, created: false, nodeId: rA.nodeId, reason: rA.reason, bestaetigung: rA.bestaetigung };
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
    return { ok: rB.ok, created: true, nodeId: rB.nodeId, reason: rB.reason, bestaetigung: rB.bestaetigung };
  }

  // ---- discover(): lebende Visitenkarten lesen ----
  async function discover(opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    var relay = resolveRelay();
    if (!relay) {
      return { ok: false, cards: [], reason: "Kein Nostr-Relais-Client (Modul 05b) verfügbar." };
    }
    var nbD = await netBereit();
    if (!nbD.ok) return { ok: false, cards: [], reason: nbD.reason };
    var raumTag = netRaum();
    var wartenD = [];
    var listenMs = (typeof opts.listenMs === "number" && isFinite(opts.listenMs) && opts.listenMs > 0)
      ? Math.floor(opts.listenMs) : cfg.listenMs;
    var freshSec = (typeof opts.freshSec === "number" && isFinite(opts.freshSec) && opts.freshSec > 0)
      ? Math.floor(opts.freshSec) : cfg.freshSec;

    var own = await getOwnLiveSpore();
    var ownId = own && own.id;

    var sinceSec = nowSec() - freshSec;
    var byId = {};   // nodeId -> { card, ts }
    var perSender = Object.create(null);  // nostr-pubkey -> Anzahl Identitäten
    var cardCount = 0;                    // Karten gesamt in diesem Durchlauf
    var rejected = 0;                     // wegen Echtheit/Bindung verworfen
    var unsub = null;
    try {
      unsub = relay.subscribe(
        { kinds: [NOSTR_KIND], "#t": [raumTag], since: sinceSec },
        function onEvent(ev) {
          netEmpfange(ev, raumTag, function (card) { karteNehmen(ev, card); }, wartenD);
        },
      );
      function karteNehmen(ev, card) {
          if (!card || card.kind !== RDV_PRESENCE_KIND || !card.nodeId || !card.spore) return;
          // Mengenschutz (Stufe 2b): der Raum darf nicht beliebig groß werden,
          // und ein einzelner Nostr-Absender nicht beliebig viele Identitäten
          // gleichzeitig auslegen. Still verwerfen — der Fluter erfährt nichts.
          var sender = (typeof ev.pubkey === "string" && ev.pubkey) ? ev.pubkey : "?";
          if (!byId[card.nodeId]) {
            if (cardCount >= RDV_CARDS_MAX) return;
            var vonDiesem = perSender[sender] || 0;
            if (vonDiesem >= RDV_CARDS_PER_SENDER_MAX) return;
            perSender[sender] = vonDiesem + 1;
            cardCount++;
          }
          // Die Karte kann keine fremde Spore unter eigenem Namen tragen.
          if (card.spore.id !== card.nodeId) { rejected++; return; }
          var ts = (typeof card.ts === "number" ? card.ts : (typeof ev.created_at === "number" ? ev.created_at : 0));
          if (!byId[card.nodeId] || ts > byId[card.nodeId].ts) byId[card.nodeId] = { card: card, ts: ts };
      }
    } catch (e) {
      return { ok: false, cards: [], reason: "Raum-Lesen fehlgeschlagen: " + (e && e.message ? e.message : e) };
    }

    return await new Promise(function (resolve) {
      setTimeout(async function () {
        if (unsub) { try { unsub(); } catch (e) {} }
        if (wartenD.length) { try { await Promise.all(wartenD); } catch (_e) {} }
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
        // ECHTHEIT (Stufe 2b): Ed25519-Prüfung je Karte über Modul 02. Erst hier,
        // weil verifyForeignSpore async ist und der Empfangs-Callback es nicht
        // abwarten kann. Ungültige Karten fallen raus — niemand kann sich mehr
        // unter fremder Identität ins Brett hängen.
        // ⚠ Modul 02 liefert {valid, reason}, NIE `false` (INTERFACES §2 Modul 02).
        //   Bis 2026-10-14 stand hier `!== false` — damit galt JEDE Spore als echt,
        //   auch eine mit kaputter Signatur (Befund 2026-10-14, N2). Gelesen wird
        //   jetzt `.valid === true`; ein Prüfer mit nacktem Boolean (alte Proben,
        //   Forker) wird weiter verstanden.
        // ⚠ Die Prüfung steht VOR dem Zusammenfassen nach Namen: sonst verdrängt
        //   eine unechte Karte mit neuerer Zeit die echte gleichen Namens und fällt
        //   danach selbst heraus — beide wären weg.
        var verifier = resolveVerifier();
        var cardsVerified = !!verifier;
        if (verifier) {
          var geprueft = [];
          for (var vi = 0; vi < cards.length; vi++) {
            var okSpore = false;
            try {
              var vr = await verifier.verifyForeignSpore(cards[vi].spore);
              okSpore = (vr === true) || !!(vr && typeof vr === "object" && vr.valid === true);
            } catch (e) { okSpore = false; }   // wirft bei ungültiger Spore → unecht
            if (okSpore) geprueft.push(cards[vi]); else rejected++;
          }
          cards = geprueft;
        }
        // Adress-Wand-Härtung (Klaus 2026-07-10): ein Knoten kann durch
        // wiederholtes „Aufräumen & neu anmelden" mehrere Alt-Identitäten
        // hinterlassen — deren Präsenz-Kärtchen leben ~30 min weiter und
        // fluten den Raum („immer mehr Identitäten"). Pro Knoten-NAME nur die
        // NEUESTE Karte zeigen (Liste ist bereits ts-absteigend sortiert). So
        // trifft „❓ Fragen" immer die frischeste, lauschende ID; die toten
        // Alt-Kärtchen verschwinden aus Raum + Karte. Opt-out: collapseByName:false.
        // ⚠ Der Name ist NICHT geprüft (er steht außerhalb der Spore). Eine echt
        //   signierte fremde Identität kann denselben Namen tragen. Die gezeigte
        //   Karte zählt deshalb mit, wie viele andere Kennungen gleichen Namens
        //   ausgeblendet wurden (`gleicherName`) — die Anzeige nennt es.
        if (opts.collapseByName !== false) {
          var seenName = Object.create(null);
          cards = cards.filter(function (c) {
            var key = (c.nodeName || "").toLowerCase();
            if (!key) return true;
            if (seenName[key]) { seenName[key].gleicherName = (seenName[key].gleicherName || 0) + 1; return false; }
            seenName[key] = c; return true;
          });
        }
        // Reine Anzeige-Anreicherung: zentrierter Verwandtschafts-Score je Karte
        // (gatet nichts; Handshake bleibt 0.80-Riegel). Fail-soft ohne Modul 04.
        resolve({
          ok: true,
          cards: relatednessForCards(cards, own),
          cardsVerified: cardsVerified,   // false = Modul 02 fehlt, Karten UNGEPRÜFT
          rejected: rejected,             // ehrlich: wie viele fielen raus
        });
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
  // A12 Briefkasten (Klaus 2026-07-11): Fragen/Antworten sollen eine Zeitver-
  // zögerung überleben (App war zu, als gefragt wurde). Statt nur „ab jetzt"
  // lauscht der Antworter beim Einschalten LOOKBACK zurück und holt liegen-
  // gebliebene Fragen nach; der Frager liest späte Antworten über dasselbe
  // Fenster nach (fetchAnswers). Empfangsmodus-treu: nutzer-ausgelöst beim
  // Öffnen, KEIN Dauer-Ticker. Reale Grenze = Aufbewahrungsdauer des Relais.
  var RDV_ANSWER_LOOKBACK_SEC = 1800; // 30 min zurück (Frage/Antwort nachholen)
  // ---- Antworten an den Antworter binden (Bau 23.R, 2026-10-14) ----
  // Befund docs/sessions/archiv/2026-10-14_angriffsflaeche_mycel.md (N1): die
  // Antwort-Zettel waren unsigniert, `fromNodeId` nur eine Behauptung. Wer den
  // öffentlichen Frage-Tag mithörte, antwortete im Namen des gefragten Knotens,
  // schneller als dieser, und überschrieb in fetchAnswers mit selbst gesetzter Zeit.
  // Jetzt: der Antworter legt seine Spore bei und unterschreibt den Zettel
  // (Modul 02 signDetached). Der Frager prüft Spore, Bindung an fromNodeId,
  // Unterschrift und dass fromNodeId der GEFRAGTE Knoten ist.
  //   bestaetigt   → genommen, schlägt jede unbestätigte Antwort
  //   unbestaetigt → ohne Unterschrift (alte Fassung, oder Modul 02 ohne Sign-Pfad);
  //                  wird nur genommen, wenn keine bestätigte kommt, und trägt
  //                  bestaetigt:false — die Oberfläche sagt es, der KI-Richter bekommt sie nicht
  //   falsch       → Unterschrift/Spore/Bindung passt nicht, oder ein anderer als der
  //                  gefragte Knoten antwortet → verworfen
  var RDV_LABEL_MAX = 200;              // Treffer-Titel hart gekappt (untrusted input)
  var RDV_UNBESTAETIGT_WARTE_MS = 3000; // so lange wartet askNode nach einer unbestätigten
                                        // Antwort noch auf eine bestätigte
  function antwortOhneSig(a) {
    var o = {};
    for (var key in a) { if (Object.prototype.hasOwnProperty.call(a, key) && key !== "sig") o[key] = a[key]; }
    return o;
  }
  async function antwortSignieren(zettel) {
    var s = resolveSpore();
    if (!s || typeof s.signDetached !== "function") return zettel;     // fail-soft: unsigniert
    try {
      var own = await s.getOwnSpore();
      if (!own || own.id !== zettel.fromNodeId) return zettel;
      zettel.spore = own;
      zettel.sig = await s.signDetached(antwortOhneSig(zettel));
    } catch (_e) { delete zettel.spore; delete zettel.sig; }
    return zettel;
  }
  async function antwortPruefen(a, erwartetVon) {
    if (erwartetVon && a.fromNodeId !== erwartetVon) return "falsch";
    if (typeof a.sig !== "string" || !a.spore || typeof a.spore !== "object") {
      return (a.sig === undefined && a.spore === undefined) ? "unbestaetigt" : "falsch";
    }
    var v = resolveVerifier();
    if (!v || typeof v.verifyDetached !== "function") return "unbestaetigt";   // nicht prüfbar
    if (a.spore.id !== a.fromNodeId) return "falsch";
    try {
      var vr = await v.verifyForeignSpore(a.spore);
      if (!(vr === true || (vr && vr.valid === true))) return "falsch";
      return (await v.verifyDetached(antwortOhneSig(a), a.sig, a.spore.publicKey)) ? "bestaetigt" : "falsch";
    } catch (_e) { return "falsch"; }
  }
  function ergebnisseLesen(a) {
    return (Array.isArray(a.results) ? a.results : []).slice(0, RDV_QUERY_K_MAX).map(function (r) {
      var o = { label: String((r && r.label) || "").slice(0, RDV_LABEL_MAX), score: (r && typeof r.score === "number") ? r.score : null };
      if (r && typeof r.anchorId === "string" && r.anchorId) o.anchorId = r.anchorId.slice(0, 120);
      return o;
    });
  }
  var antwortVerworfen = 0;            // _meta: wie viele Antworten die Prüfung nicht bestanden

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
    var nbA = await netBereit();
    if (!nbA.ok) return { ok: false, reason: nbA.reason };
    var fragTagA = netFragen();
    var own = await getOwnLiveSpore();
    if (!own || !own.id) return { ok: false, reason: "Noch keine Identität — zuerst anmelden (announce)." };
    var ownId = own.id;
    // Adress-Wand-Härtung (Klaus 2026-07-10): beim Einschalten des Antwortrechts
    // eine FRISCHE Präsenz-Karte unter GENAU dieser lauschenden ID ans Brett
    // heften. So ist die neueste Karte im Raum immer die, die auch wirklich
    // Fragen beantwortet — der Frager (discover: newest-per-name) trifft sie.
    try { await doAnnounce(own, true); } catch (_e) { /* fail-soft: Lauschen läuft trotzdem */ }
    var kCap = (typeof opts.k === "number" && isFinite(opts.k) && opts.k >= 1)
      ? Math.min(Math.floor(opts.k), RDV_QUERY_K_MAX) : RDV_QUERY_K_MAX;
    // Korpus-leer-Falle absichern: vor dem Lauschen den lokalen Korpus aktiv
    // sicherstellen, damit die erste eingehende Frage nicht ins Leere greift
    // (fail-soft — ohne Provider/Registrier-Pfad passiert nichts, kein Bruch).
    await ensureAnswerCorpus();
    try {
      answerUnsub = relay.subscribe(
        // A12 Briefkasten: LOOKBACK statt nur „ab jetzt" — beim Einschalten des
        // Antwortrechts liegengebliebene Fragen der letzten ~30 min nachholen.
        // qidSeen/rememberQid + Rate-Limit verhindern Doppel-/Flut-Antworten.
        { kinds: [NOSTR_KIND], "#t": [fragTagA], since: nowSec() - RDV_ANSWER_LOOKBACK_SEC },
        function onQuery(ev) {
          netEmpfange(ev, fragTagA, frageNehmen, null);
        },
      );
      function frageNehmen(q) {
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
                tags: [["t", fragTagA]],
                content: await netPacke(await antwortSignieren({
                  kind: RDV_QUERY_RES_KIND, qid: q.qid,
                  toNodeId: q.fromNodeId, fromNodeId: ownId,
                  fromName: cfg.nodeName, results: results, ts: nowSec(),
                }), fragTagA),
              });
              answeredCount++;
            } catch (_e) { /* fail-soft: Antwort verloren, kein Bruch */ }
          })();
      }
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
    var nbQ = await netBereit();
    if (!nbQ.ok) return { ok: false, reason: nbQ.reason };
    var fragTagQ = netFragen();
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
          { kinds: [NOSTR_KIND], "#t": [fragTagQ], since: nowSec() - 5 },
          function onRes(ev) {
            netEmpfange(ev, fragTagQ, antwortNehmen, null);
          },
        );
        // Bau 23.R: nur der GEFRAGTE Knoten, und eine unterschriebene Antwort
        // schlägt jede unbestätigte (siehe antwortPruefen).
        var vorlaeufig = null, graceTimer = null;
        function antwortNehmen(a) {
            if (!a || a.kind !== RDV_QUERY_RES_KIND || a.qid !== qid || a.toNodeId !== ownId) return;
            antwortPruefen(a, toNodeId).then(function (stand) {
              if (done) return;
              if (stand === "falsch") { antwortVerworfen++; return; }
              var res = { ok: true, qid: qid, results: ergebnisseLesen(a), fromNodeId: a.fromNodeId || null,
                          bestaetigt: stand === "bestaetigt", tookMs: Date.now() - started };
              if (stand === "bestaetigt") { if (graceTimer) clearTimeout(graceTimer); finish(res); return; }
              if (!vorlaeufig) {
                vorlaeufig = res;
                graceTimer = setTimeout(function () { finish(vorlaeufig); }, RDV_UNBESTAETIGT_WARTE_MS);
              }
            });
        }
      } catch (e) {
        finish({ ok: false, reason: "Antwort-Lauscher fehlgeschlagen: " + (e && e.message ? e.message : e) });
        return;
      }
      netPacke({
        kind: RDV_QUERY_KIND, qid: qid, toNodeId: toNodeId, fromNodeId: ownId,
        fromName: cfg.nodeName, text: text.trim().slice(0, RDV_QUERY_TEXT_MAX), k: k, ts: nowSec(),
      }, fragTagQ).then(function (inhalt) {
        return relay.publish({
          kind: NOSTR_KIND,
          created_at: nowSec(),
          tags: [["t", fragTagQ]],
          content: inhalt,
        });
      }).catch(function (e) {
        finish({ ok: false, reason: "Frage-Zettel konnte nicht publiziert werden: " + (e && e.message ? e.message : e) });
      });
      timer = setTimeout(function () {
        if (vorlaeufig) { if (graceTimer) clearTimeout(graceTimer); finish(vorlaeufig); return; }
        // A12: qid mitgeben — der Frager merkt die Frage als „offen" und liest
        // die Antwort später über fetchAnswers([qid]) nach (Briefkasten).
        finish({ ok: false, pending: true, qid: qid, reason: "Noch keine Antwort in " + Math.round(timeoutMs / 1000) + " s — Gegenknoten evtl. offline. Die Frage bleibt offen; beim nächsten Öffnen „Antworten abholen“." });
      }, timeoutMs);
    });
  }

  // ---- A12 Briefkasten: späte Antworten NACHLESEN ----
  // askNode gibt nach dem Timeout auf; war der Gegenknoten da noch zu, landet
  // seine Antwort später trotzdem auf dem Relais. fetchAnswers holt sie beim
  // nächsten Öffnen (Nutzer-Aktion) über ein Lookback-Fenster ab — Briefkasten
  // leeren, KEIN Dauer-Ticker. qids = Array offener Frage-IDs (aus askNode).
  // Reale Grenze: Aufbewahrungsdauer des Relais. Fail-soft, DOM-frei.
  async function fetchAnswers(qids, opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    // Bau 23.R: qids = Strings ODER {qid, toNodeId}. Mit toNodeId wird nur die
    // Antwort genau dieses Knotens genommen.
    var want = {};
    (Array.isArray(qids) ? qids : []).forEach(function (id) {
      if (typeof id === "string" && id) want[id] = { von: null };
      else if (id && typeof id === "object" && typeof id.qid === "string" && id.qid) {
        want[id.qid] = { von: (typeof id.toNodeId === "string" && id.toNodeId) ? id.toNodeId : null };
      }
    });
    if (!Object.keys(want).length) return { ok: true, answers: [] };
    var relay = resolveRelay();
    if (!relay) return { ok: false, reason: "Kein Nostr-Relais-Client (Modul 05b) verfügbar.", answers: [] };
    var nbF = await netBereit();
    if (!nbF.ok) return { ok: false, reason: nbF.reason, answers: [] };
    var fragTagF = netFragen();
    var wartenF = [];
    var own = await getOwnLiveSpore();
    if (!own || !own.id) return { ok: false, reason: "Noch keine Identität — zuerst anmelden.", answers: [] };
    var ownId = own.id;
    var lookbackSec = (typeof opts.lookbackSec === "number" && isFinite(opts.lookbackSec) && opts.lookbackSec > 0)
      ? Math.floor(opts.lookbackSec) : RDV_ANSWER_LOOKBACK_SEC;
    var waitMs = (typeof opts.waitMs === "number" && isFinite(opts.waitMs) && opts.waitMs > 0)
      ? Math.floor(opts.waitMs) : cfg.listenMs;
    return await new Promise(function (resolve) {
      var byQid = {}, unsub = null, timer = null, done = false;
      async function finish() {
        if (done) return; done = true;
        if (timer) clearTimeout(timer);
        if (unsub) { try { unsub(); } catch (_e) {} }
        // Bau 23.R: die Prüfung einer Antwort hängt sich erst NACH dem Entschlüsseln an —
        // so lange warten, bis keine neue mehr dazukommt.
        for (var wn = -1; wn !== wartenF.length;) { wn = wartenF.length; try { await Promise.all(wartenF.slice()); } catch (_e) {} }
        var out = Object.keys(byQid).map(function (q) { return byQid[q]; });
        resolve({ ok: true, answers: out });
      }
      try {
        unsub = relay.subscribe(
          { kinds: [NOSTR_KIND], "#t": [fragTagF], since: nowSec() - lookbackSec },
          function onRes(ev) {
            netEmpfange(ev, fragTagF, antwortSammeln, wartenF);
          },
        );
        function antwortSammeln(a) {
            if (!a || a.kind !== RDV_QUERY_RES_KIND) return;      // nur Antwort-Zettel
            if (a.toNodeId !== ownId) return;                     // nur an mich
            if (typeof a.qid !== "string" || !want[a.qid]) return; // nur meine offenen Fragen
            var p = antwortPruefen(a, want[a.qid].von).then(function (stand) {
              if (stand === "falsch") { antwortVerworfen++; return; }
              var best = stand === "bestaetigt";
              var ts = (typeof a.ts === "number") ? a.ts : 0;
              var prev = byQid[a.qid];
              // Bau 23.R: bestätigt schlägt unbestätigt, egal welche Zeit; erst
              // innerhalb derselben Stufe gilt die neueste (newest-per-qid).
              if (prev) {
                if (prev.bestaetigt && !best) return;
                if (prev.bestaetigt === best && typeof prev.ts === "number" && prev.ts >= ts) return;
              }
              byQid[a.qid] = { qid: a.qid, fromNodeId: a.fromNodeId || null, fromName: a.fromName || null,
                               results: ergebnisseLesen(a), ts: ts, bestaetigt: best };
            });
            wartenF.push(p);
        }
      } catch (e) {
        resolve({ ok: false, reason: "Nachlese-Lauscher fehlgeschlagen: " + (e && e.message ? e.message : e), answers: [] });
        return;
      }
      timer = setTimeout(finish, waitMs);
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
    fetchAnswers: fetchAnswers,         // A12 Briefkasten — späte Antworten nachlesen (Lookback)
    relatednessForCards: relatednessForCards, // pure (cards, ownSpore) → angereicherte Liste; reine Anzeige
    rankCardsByQuery: rankCardsByQuery,       // A11 — pure (cards, queryVec) → nach Frage-Passung sortiert; reine Anzeige/Auswahl
    ensureIdentity: ensureIdentity,             // Modus A (sanft, automatisch, idempotent)
    cleanupSharedOrigin: cleanupSharedOrigin,   // Modus-B-Reinigung (nur eigene Origin)
    repairAndReconnect: repairAndReconnect,     // Modus B (zerstörend, nutzer-ausgelöst)
    // Eigenes Netz (Schritt 1, 2026-10-13) — INTERFACES §Modul 23 „EIGENES NETZ"
    setNetwork: setNetwork,
    newNetCode: newNetCode,
    checkNetSetting: checkNetSetting,
    loadNetwork: loadNetwork,
    readNetwork: readNetwork,
    saveNetwork: saveNetwork,
    clearNetwork: clearNetwork,
    applyNetwork: applyNetwork,
    get _meta() {
      return {
        version: VERSION,
        tag: netRaum(),
        network: net.lage,
        encrypted: !!net.key,
        networkReason: net.reason || null,
        presenceKind: RDV_PRESENCE_KIND,
        sharedDbName: SHARED_DB_NAME,
        dbSuffix: cfg.dbSuffix,
        freshSec: cfg.freshSec,
        listenMs: cfg.listenMs,
        nodeName: cfg.nodeName,
        hasRelay: resolveRelay() !== null,
        hasAnastomose: resolveAnastomose() !== null,
        hasSpore: resolveSpore() !== null,
        // Werden fremde Karten kryptografisch geprüft? false = Modul 02 fehlt
        // oder kann kein verifyForeignSpore → Karten sind UNGEPRÜFT. Ehrlich
        // sichtbar statt still durchgewinkt (Schutz-Plan Stufe 2b).
        cardsVerified: resolveVerifier() !== null,
        cardsMax: RDV_CARDS_MAX,
        cardsPerSenderMax: RDV_CARDS_PER_SENDER_MAX,
        hasMatch: resolveMatch() !== null,
        hasStorage: resolveStorage() !== null,
        // Identitäts-Isolierung (2026-07-11): trägt das aktive Storage-Modul
        // den Migrations-Pfad? (älteres Bundle ohne migrateIdentityFrom → false,
        // dann greift der reine Schutz-Fallback in repairAndReconnect).
        hasMigrate: (function () { var s = resolveStorage(); return !!(s && typeof s.migrateIdentityFrom === "function"); })(),
        hasCreateIdentity: typeof cfg.createIdentity === "function",
        answering: answerUnsub !== null,          // Bau 23.B
        answeredCount: answeredCount,             // Bau 23.B
        hasPrepareCorpus: typeof cfg.prepareCorpus === "function", // Bau 23.B-Härtung
        answerCorpusEnsured: answerCorpusEnsured,  // Bau 23.B-Härtung (Korpus gekoppelt?)
        queryTag: netFragen(),                    // Bau 23.B (im eigenen Netz abgeleitet)
        queryKind: RDV_QUERY_KIND,                // Bau 23.B
        queryResKind: RDV_QUERY_RES_KIND,         // Bau 23.B
        queryMaxPerMin: RDV_QUERY_MAX_PER_MIN,    // Bau 23.B
        antwortVerworfen: antwortVerworfen,       // Bau 23.R: Antworten, die die Prüfung nicht bestanden
        antwortSigniert: (function () { var s = resolveSpore(); return !!(s && typeof s.signDetached === "function"); })(), // Bau 23.R
        labelMax: RDV_LABEL_MAX,                  // Bau 23.R
        rankByQueryNote: "rankCardsByQuery(cards, queryVec, {raw?}) rankt Raum-Karten nach Frage-Passung (Modul 04 relatedness, zentriert; raw→match). REINE Anzeige/Auswahl, gatet nichts, 0.80-Riegel unberührt; fail-soft ohne Vektor → Eingabe-Reihenfolge.", // A11
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
