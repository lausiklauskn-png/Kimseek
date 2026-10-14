/*
 * SBKIM — Modul 05b — Nostr-Relais-Client (browser-only)
 *
 * Stufe 2 (2026-06-27, additiv). Konkreter Transport-Client für den
 * Nostr-Pfad von Modul 05 (Anastomose). Implementiert das von Modul 05
 * erwartete, abstrakte Relay-Client-Interface:
 *
 *   publish(eventBody) -> Promise<{ id, gesendetAn, antwort }>
 *       antwort = Promise mit dem Ergebnis je Relais aus `["OK", …]`
 *       (angenommen · abgelehnt samt Grund · unbekannt nach 5 s Frist;
 *       INTERFACES §Modul 05b „Relais-Antwort", 2026-10-14).
 *       eventBody = { kind, created_at, tags, content }  (von Modul 05 gebaut)
 *       Dieses Modul vervollständigt zu einem vollen NIP-01-Event
 *       (id = sha256, pubkey + sig über schnorr), öffnet/nutzt die
 *       WebSocket(s) und sendet `["EVENT", ev]`.
 *   subscribe(filter, onEvent) -> unsubscribeFn
 *       filter = NIP-01-Filter (z.B. {kinds:[1],"#t":[...],"#d":[...]}).
 *       onEvent(ev) wird pro passendem EVENT genau einmal gerufen
 *       (Dedup über ev.id). unsubscribeFn() beendet die Subscription
 *       (CLOSE ans Relais + lokaler Listener-Abbau).
 *
 * ──────────────────────────────────────────────────────────────────────
 * BROWSER-SICHTTEST WARTET AUF KLAUS. Dieses Modul wird in dieser
 * Bau-Sitzung NICHT headless getestet, weil das Relais
 * `wss://relay.family-projekt.de` aus der Sandbox NICHT erreichbar ist
 * (wss blockiert). Bewiesen ist nur die Modul-05-Logik gegen ein
 * In-Memory-Mock-Relais (tests/smoke_bau05_nostr.mjs). Der echte
 * WebSocket+schnorr-Pfad hier ist ungeprüft, bis Klaus ihn im Browser
 * gegen das live laufende Relais bestätigt.
 * ──────────────────────────────────────────────────────────────────────
 *
 * KRYPTO-TRENNUNG (verbindlich): der hier erzeugte secp256k1/schnorr-
 * Schlüssel ist EPHEMER (pro Sitzung neu) und NUR ein Transport-Umschlag.
 * Er beweist NICHTS über die SBKIM-Identität. Die echte Identität ist
 * ausschließlich die Ed25519-Signatur im `content` (Modul 02), die der
 * Empfänger über verifyEnvelope gegen die Spore prüft. Dieses Modul
 * berührt die SBKIM-Identität NICHT.
 *
 * Self-Mount: registriert global.SbkimNostrRelay (Default-Instanz), die
 * Modul 05 automatisch findet (resolveNostrRelayClient). Relais-URL über
 * SbkimNostrRelay.configure({ relays:[...] }) änderbar, Default
 * wss://relay.family-projekt.de.
 *
 * Empfangsmodus gewahrt: dieses Modul baut KEINE Verbindung beim Laden auf.
 * Erst publish()/subscribe() (also eine bewusste Modul-05-Aktion) öffnet
 * die WebSocket — kein Daemon, keine Pulsation, kein Crawl.
 *
 * Lädt die lokal vendorierte noble-secp256k1.js (Schnorr/BIP340) — kein CDN.
 */
import { schnorr, utils } from "./noble-secp256k1.js";

(function (global) {
  "use strict";

  var DEFAULT_RELAYS = ["wss://relay.family-projekt.de"];

  function toHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
    return s;
  }
  function fromHex(h) {
    var a = new Uint8Array(h.length / 2);
    for (var i = 0; i < a.length; i++) a[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return a;
  }

  function getSubtle() {
    var c = global.crypto || (typeof crypto !== "undefined" ? crypto : null);
    if (c && c.subtle) return c.subtle;
    return null;
  }

  // sha256 über WebCrypto; node:crypto-Fallback nur, falls subtle fehlt
  // (dieses Modul ist browser-only, der Fallback ist Gürtel-und-Hosenträger).
  async function sha256Hex(str) {
    var bytes = new TextEncoder().encode(str);
    var subtle = getSubtle();
    if (subtle) {
      var buf = await subtle.digest("SHA-256", bytes);
      return toHex(new Uint8Array(buf));
    }
    // node:crypto-Fallback (nicht der Normalpfad)
    try {
      // eslint-disable-next-line
      var nodeCrypto = (typeof require === "function") ? require("crypto") : null;
      if (nodeCrypto) {
        return nodeCrypto.createHash("sha256").update(Buffer.from(bytes)).digest("hex");
      }
    } catch (e) { /* fall through */ }
    throw new Error("Kein SHA-256 verfügbar (WebCrypto fehlt).");
  }

  function makeClient() {
    // Ephemerer Transport-Schlüssel (pro Instanz/Sitzung neu).
    var priv = utils.randomPrivateKey();
    var pubHex = toHex(schnorr.getPublicKey(priv));

    var relays = DEFAULT_RELAYS.slice();
    var conns = {};            // url -> WebSocket
    var subs = [];             // aktive Subscriptions
    var subCounter = 0;
    // Relais-Antwort (2026-10-14, INTERFACES §Modul 05b „Relais-Antwort"):
    // eventId -> { url -> { ergebnis, grund } }. Frist GEWÄHLT, NICHT GEMESSEN.
    var OK_FRIST_MS = 5000;
    var okFrist = OK_FRIST_MS;
    var offen = {};

    function liveSockets() {
      var out = [];
      for (var url in conns) {
        var ws = conns[url];
        if (ws && ws.readyState === 1 /* OPEN */) out.push(ws);
      }
      return out;
    }

    // Stellt sicher, dass zu jeder konfigurierten Relais-URL eine offene (oder
    // sich öffnende) WebSocket existiert. Re-sendet bei onopen alle aktiven
    // REQs an die neue Verbindung. Liefert ein Promise, das resolvet, sobald
    // mindestens eine Verbindung offen ist (oder alle gescheitert sind).
    function ensureConnections() {
      return new Promise(function (resolve) {
        var pending = 0;
        var resolved = false;
        function maybeResolve() {
          if (resolved) return;
          if (liveSockets().length > 0 || pending === 0) {
            resolved = true;
            resolve(liveSockets());
          }
        }
        relays.forEach(function (url) {
          var existing = conns[url];
          if (existing && (existing.readyState === 0 || existing.readyState === 1)) {
            if (existing.readyState === 1) maybeResolve();
            return;
          }
          pending++;
          var ws;
          try {
            ws = new WebSocket(url);
          } catch (e) {
            pending--;
            maybeResolve();
            return;
          }
          conns[url] = ws;
          var aufgegangen = false;
          ws.onopen = function () {
            aufgegangen = true;
            pending = Math.max(0, pending - 1);
            // Alle aktiven Subscriptions an diese Verbindung (re)senden.
            subs.forEach(function (s) {
              try { ws.send(JSON.stringify(["REQ", s.id, s.filter])); } catch (e2) {}
            });
            maybeResolve();
          };
          ws.onmessage = function (e) {
            var m;
            try { m = JSON.parse(e.data); } catch (e3) { return; }
            if (!Array.isArray(m)) return;
            if (m[0] === "EVENT" && typeof m[1] === "string" && m[2]) {
              dispatchEvent(m[1], m[2]);
            } else if (m[0] === "OK" && typeof m[1] === "string") {
              okEmpfangen(url, m[1], m[2], m[3]);
            }
          };
          ws.onclose = function () {
            /* kein Auto-Reconnect-Daemon — Empfangsmodus. Offene Antworten
               dieses Relais bleiben „unbekannt", nie „angenommen". */
            verbindungZu(url);
            // Nie geöffnet: dieses Relais zählt nicht mehr als „unterwegs".
            // Ohne das wartete publish() für immer, wenn kein Relais aufgeht.
            if (!aufgegangen) { aufgegangen = true; pending = Math.max(0, pending - 1); maybeResolve(); }
          };
          ws.onerror = function () { /* onclose folgt */ };
        });
        if (relays.length === 0) maybeResolve();
        // Sicherheits-Timeout, falls keine Verbindung zustande kommt.
        // Nach Ablauf wird entschieden, auch wenn noch ein Relais „unterwegs" ist.
        setTimeout(function () { pending = 0; maybeResolve(); }, 6000);
      });
    }

    // Eine OK-Zeile zählt nur für ein Ereignis, das an GENAU dieses Relais
    // ging, und nur die erste je Relais. Alles andere wird verworfen.
    function okEmpfangen(url, id, ok, nachricht) {
      var e = offen[id];
      if (!e || !e.relais[url] || e.relais[url].ergebnis !== "unbekannt") return;
      e.relais[url] = ok === true
        ? { ergebnis: "angenommen", grund: "" }
        : { ergebnis: "abgelehnt", grund: String(nachricht == null ? "" : nachricht).slice(0, 200) };
      e.pruefen();
    }

    function verbindungZu(url) {
      for (var id in offen) {
        var e = offen[id];
        if (e.relais[url] && e.relais[url].ergebnis === "unbekannt" && !e.relais[url].grund) {
          e.relais[url].grund = "Verbindung geschlossen, bevor das Relais antwortete";
          e.relais[url].zu = true;
          e.pruefen();
        }
      }
    }

    function liveUrls() {
      var out = [];
      for (var url in conns) {
        var ws = conns[url];
        if (ws && ws.readyState === 1 /* OPEN */) out.push(url);
      }
      return out;
    }

    function dispatchEvent(subId, ev) {
      for (var i = 0; i < subs.length; i++) {
        var s = subs[i];
        if (s.id !== subId) continue;
        if (s.seen.has(ev.id)) continue;
        s.seen.add(ev.id);
        try { s.onEvent(ev); } catch (e) { /* fail-soft */ }
      }
    }

    // Vollständiges NIP-01-Event aus dem Modul-05-Body bauen + signieren.
    async function finalizeEvent(body) {
      var kind = typeof body.kind === "number" ? body.kind : 1;
      var created_at = typeof body.created_at === "number"
        ? body.created_at : Math.floor(Date.now() / 1000);
      var tags = Array.isArray(body.tags) ? body.tags : [];
      var content = typeof body.content === "string" ? body.content : "";
      var id = await sha256Hex(JSON.stringify([0, pubHex, created_at, kind, tags, content]));
      var sig = toHex(await schnorr.sign(fromHex(id), priv));
      return { id: id, pubkey: pubHex, created_at: created_at, kind: kind, tags: tags, content: content, sig: sig };
    }

    async function publish(body) {
      var ev = await finalizeEvent(body);
      await ensureConnections();
      var urls = liveUrls();
      if (urls.length === 0) {
        throw new Error("Kein Nostr-Relais verbunden — Publish nicht möglich.");
      }
      var msg = JSON.stringify(["EVENT", ev]);
      var eintrag = { relais: {} };
      var gesendet = [];
      for (var i = 0; i < urls.length; i++) {
        try {
          conns[urls[i]].send(msg);
          gesendet.push(urls[i]);
          eintrag.relais[urls[i]] = { ergebnis: "unbekannt", grund: "" };
        } catch (e) { /* einzelnes Relais down */ }
      }
      var antwort = new Promise(function (resolve) {
        var fertig = false;
        function abschluss() {
          if (fertig) return;
          fertig = true;
          clearTimeout(uhr);
          if (offen[ev.id] === eintrag) delete offen[ev.id];
          var liste = [], z = { angenommen: 0, abgelehnt: 0, unbekannt: 0 };
          for (var j = 0; j < gesendet.length; j++) {
            var r = eintrag.relais[gesendet[j]];
            var grund = r.grund || (r.ergebnis === "unbekannt" ? "keine Antwort binnen " + okFrist + " ms" : "");
            liste.push({ relay: gesendet[j], ergebnis: r.ergebnis, grund: grund });
            z[r.ergebnis]++;
          }
          resolve({ id: ev.id, relais: liste, angenommen: z.angenommen,
            abgelehnt: z.abgelehnt, unbekannt: z.unbekannt });
        }
        eintrag.pruefen = function () {
          for (var k = 0; k < gesendet.length; k++) {
            var r = eintrag.relais[gesendet[k]];
            if (r.ergebnis === "unbekannt" && !r.zu) return;
          }
          abschluss();
        };
        var uhr = setTimeout(abschluss, okFrist);
        offen[ev.id] = eintrag;
        if (gesendet.length === 0) abschluss();
      });
      return { id: ev.id, gesendetAn: gesendet.slice(), antwort: antwort };
    }

    function subscribe(filter, onEvent) {
      var id = "sbkim-" + (++subCounter) + "-" + Math.random().toString(36).slice(2, 8);
      var sub = { id: id, filter: filter, onEvent: onEvent, seen: new Set() };
      subs.push(sub);
      // Verbindungen sicherstellen + REQ senden (auch an später öffnende via onopen).
      ensureConnections().then(function () {
        liveSockets().forEach(function (ws) {
          try { ws.send(JSON.stringify(["REQ", id, filter])); } catch (e) {}
        });
      });
      return function unsubscribe() {
        var idx = subs.indexOf(sub);
        if (idx !== -1) subs.splice(idx, 1);
        liveSockets().forEach(function (ws) {
          try { ws.send(JSON.stringify(["CLOSE", id])); } catch (e) {}
        });
      };
    }

    // Eigenes Netz (Schritt 1, 2026-10-13, INTERFACES §Modul 05b
    // „Relais-Einstellung"): nur `wss://`-Adressen. Eine ungültige Adresse
    // weist die GANZE Liste ab — nie ein stiller Teil-Wechsel. Verbindungen zu
    // Adressen, die nicht mehr in der Liste stehen, werden geschlossen; sonst
    // ginge publish() weiter auch an das alte Relais (liveSockets zählt jede
    // offene Verbindung). Rückgabe additiv: { ok, relays, reason? }.
    function istRelaisAdresse(url) {
      return typeof url === "string" && url.length <= 200 &&
        /^wss:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[^\s]*)?$/.test(url);
    }

    function configure(opts) {
      var neu = null;
      if (opts && opts.okFristMs !== undefined) {
        var f = opts.okFristMs;
        if (typeof f !== "number" || !isFinite(f) || f < 100 || f > 60000) {
          return { ok: false, relays: relays.slice(), okFristMs: okFrist,
            reason: "Ungültige Antwort-Frist (100–60000 ms): " + String(f).slice(0, 40) };
        }
        okFrist = Math.round(f);
        if (!opts.reset && !Array.isArray(opts.relays)) {
          return { ok: true, relays: relays.slice(), okFristMs: okFrist };
        }
      }
      if (opts && opts.reset === true) {
        neu = DEFAULT_RELAYS.slice();
      } else if (opts && Array.isArray(opts.relays) && opts.relays.length > 0) {
        for (var i = 0; i < opts.relays.length; i++) {
          if (!istRelaisAdresse(opts.relays[i])) {
            return { ok: false, relays: relays.slice(),
              reason: "Ungültige Relais-Adresse (nur wss://…): " + String(opts.relays[i]).slice(0, 80) };
          }
        }
        neu = opts.relays.slice();
      }
      if (!neu) return { ok: false, relays: relays.slice(), reason: "Keine Relais-Liste angegeben." };
      relays = neu;
      for (var url in conns) {
        if (relays.indexOf(url) === -1) {
          try { conns[url].close(); } catch (e) {}
          delete conns[url];
        }
      }
      return { ok: true, relays: relays.slice(), okFristMs: okFrist };
    }

    function close() {
      subs.length = 0;
      for (var url in conns) {
        try { conns[url].close(); } catch (e) {}
      }
      conns = {};
    }

    return {
      publish: publish,
      subscribe: subscribe,
      configure: configure,
      close: close,
      _meta: {
        transportPubKey: pubHex,   // ephemerer Nostr-Transport-Key (NICHT SBKIM-Identität)
        get relays() { return relays.slice(); },
        get defaultRelays() { return DEFAULT_RELAYS.slice(); },
        get liveCount() { return liveSockets().length; },
        get okFristMs() { return okFrist; },
        okFristVorgabe: OK_FRIST_MS,
      },
    };
  }

  // Default-Instanz self-mounten — Modul 05 findet sie via global.SbkimNostrRelay.
  var instance = makeClient();
  instance.makeClient = makeClient;   // Fabrik für Tests/Mehrfach-Instanzen
  global.SbkimNostrRelay = instance;

  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 05b NOSTR-RELAIS bereit (browser-only, Sichttest wartet auf Klaus), " +
        "Funktionen: publish/subscribe/configure/close",
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
