/*
 * SBKIM — Modul 05b — Nostr-Relais-Client (browser-only)
 *
 * Stufe 2 (2026-06-27, additiv). Konkreter Transport-Client für den
 * Nostr-Pfad von Modul 05 (Anastomose). Implementiert das von Modul 05
 * erwartete, abstrakte Relay-Client-Interface:
 *
 *   publish(eventBody) -> Promise<void>
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
          ws.onopen = function () {
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
            }
          };
          ws.onclose = function () { /* kein Auto-Reconnect-Daemon — Empfangsmodus */ };
          ws.onerror = function () { /* onclose folgt */ };
        });
        if (relays.length === 0) maybeResolve();
        // Sicherheits-Timeout, falls keine Verbindung zustande kommt.
        setTimeout(maybeResolve, 6000);
      });
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
      var live = liveSockets();
      if (live.length === 0) {
        throw new Error("Kein Nostr-Relais verbunden — Publish nicht möglich.");
      }
      var msg = JSON.stringify(["EVENT", ev]);
      for (var i = 0; i < live.length; i++) {
        try { live[i].send(msg); } catch (e) { /* einzelnes Relais down */ }
      }
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

    function configure(opts) {
      if (opts && Array.isArray(opts.relays) && opts.relays.length > 0) {
        relays = opts.relays.slice();
      }
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
        get liveCount() { return liveSockets().length; },
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
