/*
 * SBKIM — Modul 15 — Membran
 *
 * Außenhülle zwischen PWA-Zelle und Browser-Umgebung. Bau-Sitzung 15.B
 * (2026-05-25) füllt die Bedien-Pfade Sub (a)+(b); Bau-Sitzung 15
 * (2026-05-24) hatte Sub (e) voll und Sub (a)+(b) als Skelette.
 *
 *   Sub (a) read() — voll: MembraneSnapshot mit Identitäts-/Geschwister-
 *     anonymisiert-/Storage-/Siegel-Block (3-Fall-Logik für Siegel).
 *     Sub-(e)-Hook mit snapshotByteLen-Feld.
 *   Sub (b) postMessage — voll: vier op-Werte (sporeRef/query/hint/
 *     queryResult), Allowlist fail-soft, Nonce-Pflicht + 30 s Replay-
 *     Dedupe, optionaler Rate-Limit-Hook für Modul 11. KEIN handshake.
 *   Sub (e) Fremdzugriff-Detektor + Navleisten-Lampe — Ringbuffer RAM-
 *     only, Listener-Liste, Lampen-Toggle, Modal-Mount, Click-Handler,
 *     BroadcastChannel-Subscription für SW-endpoint-probes.
 *
 * Modul 15 ist NICHT protokoll-aktiv: kein Netz, keine Signatur, kein
 * Embedding, keine Spore-Erzeugung. Sub (b) ist Empfänger-Schicht (keine
 * Sender-API auf der Public-Surface — Sender-Pattern liegt beim Andocker).
 * KEINE benannten Error-Klassen — alle Fehlerpfade fail-soft mit
 * console.warn / console.info.
 *
 * Public surface (registered on window.SbkimMembrane):
 *   init(options?)                                    -> Promise<void>
 *   read()                                            -> Promise<MembraneSnapshot>
 *   fremdzugriff.list()                               -> FremdzugriffEntry[]   (sync, defensive Kopie, älteste zuerst)
 *   fremdzugriff.subscribe(cb)                        -> unsubscribeFn         (sync)
 *   fremdzugriff.clear()                              -> void
 *   fremdzugriff._recordForTest(entry)                -> void                  (Test-Brücke)
 *
 * options-Form (init):
 *   { bufferMax?: number,           // Default MEMBRANE_FREMDZUGRIFF_BUFFER_MAX = 50
 *     lampSelector?: string,        // Default '#lamp-fremd'
 *     mountModal?: boolean,         // Default true
 *     allowedOrigins?: string[],    // Default [] (alle Cross-Origin → rejected-allowlist)
 *     enableTestButton?: boolean }  // Default false (Sage-Page-Sichttest-Knopf)
 *
 * Self-check: emits a console.info line on script load (synchronous,
 * before any call). Siehe INTERFACES.md §1 Modul 15 und
 * docs/components/15_membran.md.
 */
(function (global) {
  "use strict";

  // ---- Konstanten ----
  // Querschnitts-Konstante MEMBRANE_FREMDZUGRIFF_BUFFER_MAX steht in
  // §0 INTERFACES.md. Modul-lokale Konstanten gespiegelt aus Karte 15.

  var MEMBRANE_FREMDZUGRIFF_BUFFER_MAX = 50;
  var AGENT_HINT_MAX_LEN = 64;
  var MEMBRANE_MESSAGE_TYPE = "sbkim/membrane/v1";
  var BROADCAST_CHANNEL_NAME = "sbkim-membrane";
  var SW_PROBE_MESSAGE_TYPE = "SBKIM_MEMBRANE_PROBE";
  var LAMP_PULSE_MS = 600;

  // Sub (b) modul-lokale Konstanten (Karte 15 § Sub (b), Spec-Sitzung 15.B).
  var PROTOCOL_VERSION = "0.1";              // §0 INTERFACES, Sub (a) Pflicht-Feld
  var REPLAY_DEDUPE_TTL_MS = 30000;          // Nonce + pendingQueries TTL
  var RECENT_SPORE_REFS_MAX = 16;            // FIFO-Eviction (Karte 15 § Op-Tabelle sporeRef)
  var EMBEDDING_DIM = 384;                   // hint-Payload Vektor-Länge
  var VALID_OPS = { "sporeRef": 1, "query": 1, "hint": 1, "queryResult": 1 };

  var VALID_KINDS = { "membrane-read": 1, "membrane-postmessage": 1, "endpoint-probe": 1 };
  var VALID_DECISIONS = { "accepted": 1, "ignored": 1, "rejected-allowlist": 1 };

  // ---- Modul-Zustand (Closure) ----

  var ready = false;
  var bufferMax = MEMBRANE_FREMDZUGRIFF_BUFFER_MAX;
  var buffer = [];
  var listeners = [];
  var allowedOrigins = [];
  var lampSelector = "#lamp-fremd";
  var lampElement = null;
  var modalMounted = false;
  var modalRoot = null;
  var modalOpen = false;
  var modalUnsubscribe = null;
  var modalKeydownHandler = null;
  var postMessageListener = null;
  var broadcastChannel = null;
  // Sub (b) RAM-only Caches (Karte 15 § Sub (b) Persistenz-Entscheidung).
  // seenNonces: nonce → receivedAt (ms). FIFO-Eviction nach REPLAY_DEDUPE_TTL_MS.
  var seenNonces = new Map();
  // recentSporeRefs: origin → {nodeId, sporeUrl, domain, receivedAt}. FIFO max 16.
  var recentSporeRefs = new Map();
  // pendingQueries: nonce → {origin, sentAt, resolve}. TTL REPLAY_DEDUPE_TTL_MS.
  var pendingQueries = new Map();
  // Frequenz-Drossel für Modul-14-fehlt-Hinweis (einmal pro Sitzung).
  var diffusionMissingNotified = false;
  // Sage-Page-Sichttest-Anker (Pflege 2026-05-24, „Fremd-Lampe-Test-Knopf"):
  // wenn `init({enableTestButton:true})` gesetzt ist, ergänzt das Modal
  // im Summary-Bereich einen kleinen „🧪 Demo-Eintrag"-Knopf. Endknoten-
  // PWAs setzen die Flag NICHT; nur Sage-Page setzt sie. Der Knopf ist
  // ausschließlich Sichttest-Werkzeug für Klaus und ruft `_recordForTest`
  // mit einem synthetischen `kind:"endpoint-probe"`-Eintrag auf — keine
  // produktive Pfad-Erweiterung.
  var testButtonEnabled = false;

  // Bau 04.G-Folge (Strang A2, 2026-07-01): optionale KI-Richter-Konfig für
  // den `op:"query"`-Antwort-Pfad. Default `null` = Richter AUS → der Empfänger
  // ruft wie bisher `SbkimMatch.queryLocal` (roher Vorfilter). Setzt der
  // Betreiber `init({queryJudge:{apiKey,provider?,euOnly?,hybrid?,endpoint?,model?}})`
  // ODER `setQueryJudge(cfg)`, ruft der Empfänger `SbkimMatch.queryLocalJudged`
  // (Vorfilter + Richter, BYOK, fail-soft). RAM-only — kein Persist, kein Log,
  // der Schlüssel steht NIE im Code. Opt-in, weil der antwortende Knoten mit dem
  // Richter seinen eigenen Schlüssel für eingehende Fremd-Anfragen ausgibt.
  var queryJudge = null;

  // ---- Hilfsfunktionen ----

  function nowIso() { return new Date().toISOString(); }

  // Bau 17: Custom-Event-Dispatcher für die Render-Schicht (Modul 17).
  // Karte 17 § Event-Bus-Schema legt zwei Modul-15-Events fest:
  //   - sbkim:postmessage (Sub (b), pro op-Dispatch nach Allowlist/Schema/
  //                         Replay-Dedupe, decision final)
  //   - sbkim:fremd-alert (Sub (e), pro Ringbuffer-Neueintrag)
  // PII-Disziplin: KEIN origin / payload / agentHint / endpoint im Event-
  // Detail; nur Counts + Status-Flags. Konsument liest die vollen
  // Einträge via fremdzugriff.list() / subscribe(cb).
  function dispatchPostmessageEvent(op, decision) {
    try {
      if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
        global.dispatchEvent(new global.CustomEvent("sbkim:postmessage", {
          detail: {
            op:        op,
            direction: "incoming",
            decision:  decision,
          },
          bubbles:    false,
          cancelable: false,
        }));
      }
    } catch (_e) { /* fail-soft — Render-Schicht ist optional. */ }
  }

  function dispatchFremdAlertEvent(kind, decision, bufferSize) {
    try {
      if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
        global.dispatchEvent(new global.CustomEvent("sbkim:fremd-alert", {
          detail: {
            kind:       kind,
            decision:   decision,
            bufferSize: bufferSize,
          },
          bubbles:    false,
          cancelable: false,
        }));
      }
    } catch (_e) { /* fail-soft */ }
  }

  function warn(message, cause) {
    if (typeof console !== "undefined" && console.warn) {
      if (cause !== undefined) console.warn("[SbkimMembrane] " + message, cause);
      else console.warn("[SbkimMembrane] " + message);
    }
  }

  function info(message) {
    if (typeof console !== "undefined" && console.info) {
      console.info("[SbkimMembrane] " + message);
    }
  }

  // Sub (b) Hilfen: Replay-Dedupe + FIFO-Eviction.
  function pruneSeenNonces(nowMs) {
    if (seenNonces.size === 0) return;
    var cutoff = nowMs - REPLAY_DEDUPE_TTL_MS;
    // Map iteriert in Insertion-Order — älteste zuerst, FIFO sauber.
    var stale = [];
    seenNonces.forEach(function (receivedAt, nonce) {
      if (receivedAt < cutoff) stale.push(nonce);
    });
    for (var i = 0; i < stale.length; i++) seenNonces.delete(stale[i]);
  }

  function prunePendingQueries(nowMs) {
    if (pendingQueries.size === 0) return;
    var cutoff = nowMs - REPLAY_DEDUPE_TTL_MS;
    var stale = [];
    pendingQueries.forEach(function (entry, nonce) {
      if (entry.sentAt < cutoff) stale.push(nonce);
    });
    for (var i = 0; i < stale.length; i++) pendingQueries.delete(stale[i]);
  }

  function isHttpOrigin(s) {
    if (typeof s !== "string" || s.length === 0) return false;
    return s.indexOf("http://") === 0 || s.indexOf("https://") === 0;
  }

  function safeUserAgentHint() {
    try {
      var nav = global.navigator;
      if (!nav || typeof nav.userAgent !== "string") return null;
      return nav.userAgent.slice(0, AGENT_HINT_MAX_LEN);
    } catch (_e) {
      return null;
    }
  }

  function isValidEntry(entry) {
    if (!entry || typeof entry !== "object") return false;
    if (typeof entry.kind !== "string" || !VALID_KINDS[entry.kind]) return false;
    if (typeof entry.decision !== "string" || !VALID_DECISIONS[entry.decision]) return false;
    return true;
  }

  function normalizeEntry(raw) {
    // Defensive Kopie + Defaults für optionale Felder.
    var entry = {
      at: typeof raw.at === "string" ? raw.at : nowIso(),
      kind: raw.kind,
      origin: typeof raw.origin === "string" ? raw.origin : null,
      agentHint: typeof raw.agentHint === "string" ? raw.agentHint.slice(0, AGENT_HINT_MAX_LEN) : null,
      endpoint: typeof raw.endpoint === "string" ? raw.endpoint : null,
      decision: raw.decision,
      details: raw.details && typeof raw.details === "object" ? raw.details : {},
    };
    return entry;
  }

  // ---- Lampen-Steuerung ----

  function resolveLampElement() {
    if (!lampSelector || typeof lampSelector !== "string") return null;
    try {
      var doc = global.document;
      if (!doc || typeof doc.querySelector !== "function") return null;
      return doc.querySelector(lampSelector);
    } catch (err) {
      warn("lampSelector ist kein gültiger CSS-Selektor: " + lampSelector, err);
      return null;
    }
  }

  function updateLampAlertState() {
    if (!lampElement) return;
    try {
      if (buffer.length > 0) {
        if (!lampElement.classList.contains("fremd-alert")) {
          lampElement.classList.add("fremd-alert");
        }
      } else {
        lampElement.classList.remove("fremd-alert");
      }
    } catch (err) {
      warn("Lampen-Toggle fehlgeschlagen", err);
    }
  }

  function pulseLamp() {
    if (!lampElement) return;
    try {
      lampElement.classList.remove("fremd-pulse");
      // Force reflow, damit die Animation neu startet (analog
      // index.html .traffic-pulse-Pattern).
      void lampElement.offsetWidth;
      lampElement.classList.add("fremd-pulse");
      // Klasse nach Pulse-Dauer wieder abnehmen, damit jeder neue
      // Eintrag erneut pulst.
      setTimeout(function () {
        if (lampElement) {
          try { lampElement.classList.remove("fremd-pulse"); } catch (_e) { /* nb */ }
        }
      }, LAMP_PULSE_MS);
    } catch (err) {
      warn("Lampen-Puls fehlgeschlagen", err);
    }
  }

  // ---- Ringbuffer ----

  function recordEntry(rawEntry) {
    if (!isValidEntry(rawEntry)) {
      warn("Ignoriere ungültigen Eintrag (kind/decision fehlt oder unbekannt).", rawEntry);
      return;
    }
    var entry = normalizeEntry(rawEntry);
    buffer.push(entry);
    if (buffer.length > bufferMax) {
      buffer.splice(0, buffer.length - bufferMax);
    }
    updateLampAlertState();
    pulseLamp();
    notifyListeners(entry);
    notifyModal(entry);
    // Bau 17: Custom-Event NACH Buffer-Push + Listener-Aufruf
    // (Karte 17 § Event-Bus-Schema). Spiegelt den subscribe(cb)-Hook
    // auf das DOM-Event-System, damit Modul 17 (Render-Schicht)
    // unabhängig von der Listener-API mitkriegt.
    dispatchFremdAlertEvent(entry.kind, entry.decision, buffer.length);
  }

  function notifyListeners(entry) {
    // Defensive Kopie der Listener-Liste, damit Listener-Abmeldung
    // während des Loops keine Schäden anrichtet.
    var snapshot = listeners.slice();
    for (var i = 0; i < snapshot.length; i++) {
      var cb = snapshot[i];
      try {
        cb(entry);
      } catch (err) {
        warn("subscribe-Listener hat geworfen — Throw still verworfen.", err);
      }
    }
  }

  // ---- Öffentliche fremdzugriff-API ----

  function listFremdzugriff() {
    // Defensive Kopie. Modul 15 schützt seinen internen Zustand;
    // Mutation am Rückgabe-Array berührt buffer nicht.
    var copy = new Array(buffer.length);
    for (var i = 0; i < buffer.length; i++) {
      copy[i] = buffer[i];
    }
    return copy;
  }

  function subscribeFremdzugriff(cb) {
    if (typeof cb !== "function") {
      warn("subscribe(cb): cb ist keine Funktion — no-op.");
      return function noopUnsubscribe() { /* no-op */ };
    }
    listeners.push(cb);
    var removed = false;
    return function unsubscribe() {
      if (removed) return;
      removed = true;
      var idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  function clearFremdzugriff() {
    if (buffer.length === 0) {
      // Lampe trotzdem konsistent halten (falls aus irgendeinem Grund
      // die Klasse hängen geblieben ist).
      updateLampAlertState();
      return;
    }
    buffer.length = 0;
    updateLampAlertState();
    notifyModal(null);
  }

  function recordForTest(entry) {
    recordEntry(entry);
  }

  // ---- Sub (b) postMessage-Listener (Spec-Sitzung 15.B vom 2026-05-25) ----
  //
  // Empfänger-Kette (Reihenfolge verbindlich):
  //   1. event.origin === own → still verworfen (kein Sub-(e)-Eintrag)
  //   2. data.type !== "sbkim/membrane/v1" → decision:"ignored"
  //   3. event.origin nicht in allowedOrigins → decision:"rejected-allowlist"
  //   4. nonce fehlt → decision:"ignored"
  //   5. Replay (nonce <30 s gesehen) → still verworfen, KEIN Sub-(e)-Eintrag
  //   6. SbkimRateLimit?.checkOrigin → "throttled" → ignored + throttled-Marker
  //   7. op-Dispatch — bedient pro Op-Tabelle (Karte 15 § Sub (b)).

  function recordPostMessageEntry(event, op, nonce, decision, extraDetails) {
    var details = { op: op, nonce: nonce };
    if (extraDetails && typeof extraDetails === "object") {
      // Defensive Kopie der Extra-Felder (KEIN voller Payload — PII-Tabu).
      if (extraDetails.throttled === true) details.throttled = true;
    }
    recordEntry({
      kind: "membrane-postmessage",
      origin: typeof event.origin === "string" ? event.origin : null,
      agentHint: safeUserAgentHint(),
      endpoint: null,
      decision: decision,
      details: details,
    });
    // Bau 17: sbkim:postmessage-Event nur bei SBKIM-Op (sporeRef/query/
    // hint/queryResult). Type-Mismatch-Pfad und unbekannte ops geben
    // keinen Event ab — sie sind keine SBKIM-Membran-Postmessages im
    // engeren Sinn (Karte 17 § Event-Bus-Schema, detail.op-Whitelist).
    // Replay-Dedupe-Pfade rufen `recordPostMessageEntry` ohnehin nicht
    // (still verworfen vor dem Eintrag — Sub (b) Empfänger-Kette Punkt 5).
    if (typeof op === "string" && VALID_OPS[op]) {
      dispatchPostmessageEvent(op, decision);
    }
  }

  function isValidSporeRefPayload(p) {
    return p && typeof p === "object" &&
           typeof p.nodeId === "string" && p.nodeId.length > 0 &&
           typeof p.sporeUrl === "string" && p.sporeUrl.length > 0 &&
           typeof p.domain === "string" && p.domain.length > 0;
  }

  function isValidHintPayload(p) {
    if (!p || typeof p !== "object") return false;
    if (!Array.isArray(p.vector) || p.vector.length !== EMBEDDING_DIM) return false;
    if (typeof p.label !== "string" || p.label.length === 0) return false;
    if (typeof p.ttlMs !== "number" || !(p.ttlMs > 0)) return false;
    return true;
  }

  function isValidQueryPayload(p) {
    if (!p || typeof p !== "object") return false;
    if (typeof p.text !== "string" || p.text.length === 0) return false;
    // k ist optional (Default 5) — wenn vorhanden, muss er Number sein.
    if (p.k !== undefined && (typeof p.k !== "number" || !(p.k > 0))) return false;
    return true;
  }

  function cacheSporeRef(origin, payload) {
    // FIFO-Eviction: Map iteriert in Insertion-Order. Bei Re-Insertion
    // (gleicher Origin) erst löschen, damit der neue Eintrag ans Ende kommt.
    if (recentSporeRefs.has(origin)) recentSporeRefs.delete(origin);
    recentSporeRefs.set(origin, {
      nodeId: payload.nodeId,
      sporeUrl: payload.sporeUrl,
      domain: payload.domain,
      receivedAt: nowIso(),
    });
    while (recentSporeRefs.size > RECENT_SPORE_REFS_MAX) {
      var firstKey = recentSporeRefs.keys().next().value;
      recentSporeRefs.delete(firstKey);
    }
  }

  function sendQueryResultReply(event, inReplyToNonce, results, errorReason) {
    // event.source kann Window oder MessagePort sein. Wir machen das fail-soft —
    // wenn kein source vorhanden ist, wird einfach nichts gesendet (Sub-(e)-
    // Eintrag wurde trotzdem geschrieben).
    try {
      if (!event.source || typeof event.source.postMessage !== "function") return;
      var replyNonce;
      try { replyNonce = global.crypto.randomUUID(); }
      catch (_e) { replyNonce = "reply-" + Date.now() + "-" + Math.random().toString(36).slice(2); }
      var replyFromOrigin = "";
      try { replyFromOrigin = global.location.origin; } catch (_e) { /* nb */ }
      var replyPayload = { results: results, error: errorReason };
      event.source.postMessage({
        type: MEMBRANE_MESSAGE_TYPE,
        op: "queryResult",
        fromOrigin: replyFromOrigin,
        nonce: replyNonce,
        inReplyTo: inReplyToNonce,
        payload: replyPayload,
      }, event.origin);
    } catch (err) {
      warn("queryResult-Antwort konnte nicht gesendet werden — fail-soft.", err);
    }
  }

  async function dispatchOp(event, op, nonce, payload) {
    if (op === "sporeRef") {
      if (!isValidSporeRefPayload(payload)) {
        recordPostMessageEntry(event, op, nonce, "ignored");
        return;
      }
      cacheSporeRef(event.origin, payload);
      recordPostMessageEntry(event, op, nonce, "accepted");
      return;
    }

    if (op === "hint") {
      if (!isValidHintPayload(payload)) {
        recordPostMessageEntry(event, op, nonce, "ignored");
        return;
      }
      var diffusion = global.SbkimDiffusion;
      if (diffusion && typeof diffusion.recordLead === "function") {
        try {
          diffusion.recordLead({
            vector: payload.vector,
            label: payload.label,
            ttlMs: payload.ttlMs,
            sourceOrigin: event.origin,
          });
          recordPostMessageEntry(event, op, nonce, "accepted");
        } catch (err) {
          warn("SbkimDiffusion.recordLead hat geworfen — fail-soft.", err);
          recordPostMessageEntry(event, op, nonce, "ignored");
        }
      } else {
        // Modul 14 fehlt — frequenz-gedrosselter Hinweis (einmal pro Sitzung).
        if (!diffusionMissingNotified) {
          diffusionMissingNotified = true;
          info("Modul 14 (Diffusion) fehlt — hint-Pfad still verworfen. Modul 14 wird im Backlog gebaut (Karte 14).");
        }
        recordPostMessageEntry(event, op, nonce, "ignored");
      }
      return;
    }

    if (op === "query") {
      if (!isValidQueryPayload(payload)) {
        recordPostMessageEntry(event, op, nonce, "ignored");
        return;
      }
      var k = (typeof payload.k === "number" && payload.k > 0) ? payload.k : 5;
      var match = global.SbkimMatch;
      // Richter-Pfad (Strang A2) nur, wenn der Betreiber ihn opt-in konfiguriert
      // hat UND queryLocalJudged vorhanden ist. Sonst der bisherige rohe
      // Vorfilter-Pfad (byte-gleiches Verhalten wie vor dieser Änderung).
      var useJudge = queryJudge &&
        typeof queryJudge.apiKey === "string" && queryJudge.apiKey.length > 0 &&
        match && typeof match.queryLocalJudged === "function";
      if (useJudge) {
        try {
          // queryLocalJudged ist selbst fail-soft: kein/fehlerhafter Richter →
          // roher Vorfilter in `.candidates`. Wir senden die Kandidaten-Liste.
          var judgedRes = await match.queryLocalJudged(payload.text, k, queryJudge);
          var jCandidates = (judgedRes && Array.isArray(judgedRes.candidates)) ? judgedRes.candidates : [];
          sendQueryResultReply(event, nonce, jCandidates, null);
          recordPostMessageEntry(event, op, nonce, "accepted");
        } catch (err) {
          warn("SbkimMatch.queryLocalJudged hat geworfen — fail-soft mit Fehler-Antwort.", err);
          sendQueryResultReply(event, nonce, [], "module-04c-query-failed");
          recordPostMessageEntry(event, op, nonce, "ignored");
        }
        return;
      }
      if (match && typeof match.queryLocal === "function") {
        try {
          var results = await match.queryLocal(payload.text, k);
          sendQueryResultReply(event, nonce, Array.isArray(results) ? results : [], null);
          recordPostMessageEntry(event, op, nonce, "accepted");
        } catch (err) {
          warn("SbkimMatch.queryLocal hat geworfen — fail-soft mit Fehler-Antwort.", err);
          sendQueryResultReply(event, nonce, [], "module-04c-query-failed");
          recordPostMessageEntry(event, op, nonce, "ignored");
        }
      } else {
        // Modul 04.C noch nicht da — Antwort mit fail-soft-Marker.
        sendQueryResultReply(event, nonce, [], "module-04c-not-available");
        recordPostMessageEntry(event, op, nonce, "ignored");
      }
      return;
    }

    if (op === "queryResult") {
      var inReplyTo = (payload && typeof payload === "object" && typeof payload.inReplyTo === "string")
        ? payload.inReplyTo
        : null;
      // Spec-Konvention: inReplyTo liegt auf Envelope-Ebene, NICHT im Payload.
      // Wir lesen ihn primär aus dem Event (siehe handlePostMessage); dieser
      // Pfad ist Fallback für Sender, die ihn versehentlich in payload legen.
      if (!inReplyTo) {
        recordPostMessageEntry(event, op, nonce, "ignored");
        return;
      }
      var pending = pendingQueries.get(inReplyTo);
      if (!pending) {
        recordPostMessageEntry(event, op, nonce, "ignored");
        return;
      }
      pendingQueries.delete(inReplyTo);
      try { pending.resolve(payload); } catch (err) { warn("pendingQueries-Resolver hat geworfen.", err); }
      recordPostMessageEntry(event, op, nonce, "accepted");
      return;
    }

    // Unbekannte op (insbesondere "handshake" — explizites Tabu).
    recordPostMessageEntry(event, op, nonce, "ignored");
  }

  function handlePostMessage(event) {
    try {
      // 1. Same-Origin → still verworfen (keine Sub-(e)-Buffer-Verschmutzung).
      var sameOrigin = false;
      try {
        sameOrigin = event.origin === global.location.origin;
      } catch (_e) { /* nb */ }
      if (sameOrigin) return;

      var data = event.data;
      var op = (data && typeof data.op === "string") ? data.op : null;
      var nonce = (data && typeof data.nonce === "string") ? data.nonce : null;
      var type = (data && typeof data.type === "string") ? data.type : null;
      var inReplyToEnvelope = (data && typeof data.inReplyTo === "string") ? data.inReplyTo : null;
      var payload = (data && typeof data.payload === "object" && data.payload !== null) ? data.payload : null;

      // 2. Type-Check.
      if (type !== MEMBRANE_MESSAGE_TYPE) {
        recordPostMessageEntry(event, op, nonce, "ignored");
        return;
      }

      // 3. Allowlist-Check.
      if (allowedOrigins.indexOf(event.origin) < 0) {
        recordPostMessageEntry(event, op, nonce, "rejected-allowlist");
        return;
      }

      // 4. Nonce-Pflicht.
      if (!nonce) {
        recordPostMessageEntry(event, op, nonce, "ignored");
        return;
      }

      // 5. Replay-Dedupe.
      var now = Date.now();
      pruneSeenNonces(now);
      if (seenNonces.has(nonce)) {
        // Still verworfen — KEIN Sub-(e)-Eintrag, KEINE Antwort.
        return;
      }
      seenNonces.set(nonce, now);
      prunePendingQueries(now);

      // 6. Rate-Limit-Hook (optional, Modul 11 — fail-soft).
      try {
        var rateLimit = global.SbkimRateLimit;
        if (rateLimit && typeof rateLimit.checkOrigin === "function") {
          var verdict = rateLimit.checkOrigin(event.origin);
          if (verdict === "throttled") {
            recordPostMessageEntry(event, op, nonce, "ignored", { throttled: true });
            return;
          }
        }
      } catch (err) {
        // Modul 11 wirft im Hook — fail-soft, weiter durchreichen.
        warn("SbkimRateLimit.checkOrigin hat geworfen — fail-soft.", err);
      }

      // 7. Op-Validierung (whitelist).
      if (!op || !VALID_OPS[op]) {
        recordPostMessageEntry(event, op, nonce, "ignored");
        return;
      }

      // Für queryResult: inReplyTo aus Envelope-Ebene durchreichen, falls
      // payload selbst die Info nicht trägt. Sender-Konvention: inReplyTo
      // ist Envelope-Feld. Wir reichen es in dispatchOp via payload-Wrapper
      // — bewusst nicht in den Payload geschoben, sondern als zweiter Pfad.
      if (op === "queryResult") {
        // Wir bauen eine Payload-Kopie mit inReplyTo-Anker, damit dispatchOp
        // ihn lesen kann. Originale payload bleibt unangetastet.
        var augmented = (payload && typeof payload === "object") ? payload : {};
        if (!augmented.inReplyTo && inReplyToEnvelope) augmented.inReplyTo = inReplyToEnvelope;
        // dispatchOp ist async — wir reichen das Promise nicht hoch, weil
        // der Browser-Event-Loop das ohnehin nicht erwartet (fire-and-forget).
        dispatchOp(event, op, nonce, augmented);
        return;
      }

      dispatchOp(event, op, nonce, payload);
    } catch (err) {
      warn("postMessage-Handler hat geworfen — fail-soft.", err);
    }
  }

  // ---- BroadcastChannel-Subscription für SW-endpoint-probes ----

  function subscribeBroadcastChannel() {
    if (broadcastChannel) return; // idempotent
    if (typeof global.BroadcastChannel !== "function") {
      // Kein Throw — manche Browser (alte Safari-Versionen) haben kein
      // BroadcastChannel; Sub (e) bleibt dann ohne SW-Probe-Pfad
      // (postMessage + read() funktionieren weiterhin).
      return;
    }
    try {
      broadcastChannel = new global.BroadcastChannel(BROADCAST_CHANNEL_NAME);
      broadcastChannel.addEventListener("message", function (event) {
        try {
          var data = event && event.data;
          if (!data || data.type !== SW_PROBE_MESSAGE_TYPE) return;
          var probeEntry = data.entry;
          if (!probeEntry || typeof probeEntry !== "object") return;
          // SW hat den Eintrag bereits als endpoint-probe geformt; wir
          // erzwingen den kind-Wert defensiv.
          probeEntry.kind = "endpoint-probe";
          recordEntry(probeEntry);
        } catch (err) {
          warn("BroadcastChannel-Message-Handler hat geworfen — fail-soft.", err);
        }
      });
    } catch (err) {
      warn("BroadcastChannel-Subscription fehlgeschlagen — endpoint-probe-Pfad inaktiv.", err);
      broadcastChannel = null;
    }
  }

  // ---- Modal-Mount + Click-Handler ----
  //
  // Eigenständiges Modal in document.body (kein Modul-00-Reuse —
  // Karte 15 § Fremdzugriff-Fenster Wahl-Begründung).

  function mountFremdzugriffModal() {
    if (modalMounted) return;
    var doc = global.document;
    if (!doc || !doc.body) return;

    var root = doc.createElement("div");
    root.id = "sbkim-membran-modal";
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:99999",
      "display:none",
      "align-items:center",
      "justify-content:center",
      "font-family:system-ui,sans-serif",
    ].join(";");

    var backdrop = doc.createElement("div");
    backdrop.setAttribute("data-membran-backdrop", "");
    backdrop.style.cssText = [
      "position:absolute",
      "inset:0",
      "background:rgba(0,0,0,0.62)",
    ].join(";");

    var panel = doc.createElement("div");
    panel.style.cssText = [
      "position:relative",
      "background:#10102A",
      "color:#F5F5FF",
      "border:1px solid rgba(255,255,255,0.18)",
      "border-radius:16px",
      "padding:1.2rem 1.4rem",
      "max-width:min(720px, 92vw)",
      "max-height:80vh",
      "overflow:auto",
      "box-shadow:0 24px 64px rgba(0,0,0,0.6)",
    ].join(";");

    var header = doc.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:0.8rem;margin-bottom:0.8rem;";

    var title = doc.createElement("h2");
    title.textContent = "Fremdzugriff-Fenster";
    title.style.cssText = "margin:0;font-size:1.1rem;font-weight:600;flex:1;";

    var closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("data-membran-close", "");
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", "Schließen");
    closeBtn.style.cssText = [
      "background:transparent",
      "color:#F5F5FF",
      "border:1px solid rgba(255,255,255,0.18)",
      "border-radius:8px",
      "padding:0.25rem 0.6rem",
      "cursor:pointer",
      "font-size:1rem",
    ].join(";");

    header.appendChild(title);
    header.appendChild(closeBtn);

    var summary = doc.createElement("div");
    summary.setAttribute("data-membran-summary", "");
    summary.style.cssText = "display:flex;align-items:center;gap:0.8rem;margin-bottom:0.8rem;font-size:0.86rem;color:rgba(245,245,255,0.78);";

    var count = doc.createElement("span");
    count.setAttribute("data-membran-count", "");
    count.textContent = "0 Einträge im Ringbuffer (max " + bufferMax + ")";

    var clearBtn = doc.createElement("button");
    clearBtn.type = "button";
    clearBtn.setAttribute("data-membran-clear", "");
    clearBtn.textContent = "Aufräumen";
    clearBtn.style.cssText = [
      "background:rgba(220,38,38,0.18)",
      "color:#F5F5FF",
      "border:1px solid rgba(220,38,38,0.45)",
      "border-radius:8px",
      "padding:0.3rem 0.7rem",
      "cursor:pointer",
      "font-size:0.86rem",
    ].join(";");

    summary.appendChild(count);
    summary.appendChild(clearBtn);

    // Sage-Page-Sichttest-Knopf (nur wenn init({enableTestButton:true})).
    // Endknoten-PWAs setzen die Flag NICHT — der Knopf ist dort unsichtbar.
    if (testButtonEnabled) {
      var testBtn = doc.createElement("button");
      testBtn.type = "button";
      testBtn.setAttribute("data-membran-test", "");
      testBtn.textContent = "🧪 Demo-Eintrag";
      testBtn.title = "Sichttest: synthetischen endpoint-probe-Eintrag einfügen (Sage-Page-Sichttest, kein produktiver Pfad)";
      testBtn.style.cssText = [
        "background:rgba(110,168,254,0.18)",
        "color:#F5F5FF",
        "border:1px solid rgba(110,168,254,0.45)",
        "border-radius:8px",
        "padding:0.3rem 0.7rem",
        "cursor:pointer",
        "font-size:0.86rem",
      ].join(";");
      testBtn.addEventListener("click", function () {
        try {
          recordForTest({
            kind: "endpoint-probe",
            origin: "https://gemini.google.com",
            agentHint: "Sichttest/1.0 (Demo-Knopf in Sage-Page-Modal)",
            endpoint: "/sbkim/spore.json",
            decision: "accepted",
            details: { method: "GET", secFetchSite: "cross-site" },
          });
        } catch (err) {
          warn("Demo-Eintrag-Knopf fehlgeschlagen", err);
        }
      });
      summary.appendChild(testBtn);
    }

    var table = doc.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:0.8rem;font-family:'Geist Mono',ui-monospace,monospace;";
    table.innerHTML =
      "<thead><tr>" +
      "<th style=\"text-align:left;padding:0.35rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.18);\">Zeit</th>" +
      "<th style=\"text-align:left;padding:0.35rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.18);\">kind</th>" +
      "<th style=\"text-align:left;padding:0.35rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.18);\">origin</th>" +
      "<th style=\"text-align:left;padding:0.35rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.18);\">endpoint</th>" +
      "<th style=\"text-align:left;padding:0.35rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.18);\">decision</th>" +
      "</tr></thead><tbody data-membran-tbody></tbody>";

    var tip = doc.createElement("p");
    tip.style.cssText = "margin:0.9rem 0 0;font-size:0.78rem;color:rgba(245,245,255,0.55);";
    tip.textContent = "Tipp: leere Tabelle = Lampe geht aus.";

    panel.appendChild(header);
    panel.appendChild(summary);
    panel.appendChild(table);
    panel.appendChild(tip);

    root.appendChild(backdrop);
    root.appendChild(panel);
    doc.body.appendChild(root);

    backdrop.addEventListener("click", closeFremdzugriffModal);
    closeBtn.addEventListener("click", closeFremdzugriffModal);
    clearBtn.addEventListener("click", function () {
      clearFremdzugriff();
    });

    modalRoot = root;
    modalMounted = true;
  }

  function renderModalRow(entry) {
    var doc = global.document;
    var tr = doc.createElement("tr");
    var origin = entry.origin === null ? "(lokal)" : entry.origin;
    var endpoint = entry.endpoint === null ? "—" : entry.endpoint;
    tr.innerHTML =
      "<td style=\"padding:0.3rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.06);\"></td>" +
      "<td style=\"padding:0.3rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.06);\"></td>" +
      "<td style=\"padding:0.3rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.06);\"></td>" +
      "<td style=\"padding:0.3rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.06);\"></td>" +
      "<td style=\"padding:0.3rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.06);\"></td>";
    // textContent statt innerHTML, damit fremde Strings nie als HTML
    // interpretiert werden (origin/endpoint/agentHint kommen aus
    // postMessage und SW-Probe — Vorsicht vor XSS).
    tr.children[0].textContent = entry.at;
    tr.children[1].textContent = entry.kind;
    tr.children[2].textContent = origin;
    tr.children[3].textContent = endpoint;
    tr.children[4].textContent = entry.decision;
    return tr;
  }

  function renderModalContents() {
    if (!modalRoot) return;
    var tbody = modalRoot.querySelector("[data-membran-tbody]");
    var countEl = modalRoot.querySelector("[data-membran-count]");
    if (!tbody || !countEl) return;
    tbody.textContent = "";
    var snapshot = listFremdzugriff();
    for (var i = 0; i < snapshot.length; i++) {
      tbody.appendChild(renderModalRow(snapshot[i]));
    }
    countEl.textContent = snapshot.length + " Einträge im Ringbuffer (max " + bufferMax + ")";
    // Auto-Scroll nach unten — chronologische Lesart (Karte 15
    // § Fremdzugriff-Fenster Bau-Hinweis).
    if (modalRoot.scrollTop !== undefined) {
      modalRoot.scrollTop = modalRoot.scrollHeight;
    }
  }

  function notifyModal(entry) {
    if (!modalOpen || !modalRoot) return;
    if (entry === null) {
      // clear()-Signal — Tabelle leeren, Lampe schon aus.
      renderModalContents();
      return;
    }
    var tbody = modalRoot.querySelector("[data-membran-tbody]");
    var countEl = modalRoot.querySelector("[data-membran-count]");
    if (!tbody || !countEl) return;
    tbody.appendChild(renderModalRow(entry));
    countEl.textContent = buffer.length + " Einträge im Ringbuffer (max " + bufferMax + ")";
  }

  function openFremdzugriffModal() {
    if (!modalMounted) mountFremdzugriffModal();
    if (!modalRoot) return;
    modalRoot.style.display = "flex";
    modalRoot.setAttribute("aria-hidden", "false");
    modalOpen = true;
    renderModalContents();
    // Live-Updates via subscribe — wir benutzen denselben Listener-Pfad,
    // damit der Modal-Re-Render exakt mit dem Buffer mitläuft.
    if (!modalUnsubscribe) {
      modalUnsubscribe = subscribeFremdzugriff(function (_entry) {
        // Re-Render: ein einzelner Eintrag ist schon via notifyModal
        // gerendert. subscribe-Listener nutzen wir hier NICHT für UI-
        // Updates, weil notifyModal das bereits effizient erledigt.
        // Trotzdem registrieren wir den Listener, um Listener-Pfad
        // einheitlich zu prüfen.
      });
    }
    if (!modalKeydownHandler) {
      modalKeydownHandler = function (event) {
        if (event && event.key === "Escape" && modalOpen) {
          closeFremdzugriffModal();
        }
      };
      try { global.document.addEventListener("keydown", modalKeydownHandler); }
      catch (_e) { /* nb */ }
    }
  }

  function closeFremdzugriffModal() {
    if (!modalOpen) return;
    if (modalRoot) {
      modalRoot.style.display = "none";
      modalRoot.setAttribute("aria-hidden", "true");
    }
    modalOpen = false;
    if (modalUnsubscribe) {
      try { modalUnsubscribe(); } catch (_e) { /* nb */ }
      modalUnsubscribe = null;
    }
    if (modalKeydownHandler) {
      try { global.document.removeEventListener("keydown", modalKeydownHandler); }
      catch (_e) { /* nb */ }
      modalKeydownHandler = null;
    }
  }

  // ---- Sub (a) read() — Skelett ----
  //
  // Karte 15 § Sub (a) Anker-Form: protocolVersion, nodeId, domain,
  // sporeUrl, siblings[], storage{quotaWarningLevel, storagePersisted}.
  // Finale Feld-Liste ist Spec-Sitzung 15.B vorbehalten — Bau-Sitzung 15
  // baut nur das Skelett, fail-soft pro Quelle.

  async function readSnapshot() {
    // Identitäts-Block (Spore). protocolVersion ist IMMER §0-Wert "0.1"
    // (Spec 15.B: aktiver Stand, nicht aus Spore lesen).
    var snapshot = {
      protocolVersion: PROTOCOL_VERSION,
      nodeId: null,
      domain: null,
      sporeUrl: null,
      domainKeywords: [],
      stammCategories: [],
      guestCategories: [],
      siblings: [],
      storage: {
        quotaWarningLevel: "none",
        storagePersisted: null,
      },
      siegel: null,
    };

    // Spore: nodeId + domain + sporeUrl + Listen-Felder (fail-soft pro Feld).
    try {
      var spore = global.SbkimSpore;
      if (spore) {
        try {
          if (typeof spore.getNodeId === "function") {
            var nodeId = await spore.getNodeId();
            if (typeof nodeId === "string") snapshot.nodeId = nodeId;
          }
        } catch (_e) { /* nb */ }
        try {
          if (typeof spore.getOwnSpore === "function") {
            var own = await spore.getOwnSpore();
            if (own && typeof own === "object") {
              if (typeof own.domain === "string") snapshot.domain = own.domain;
              if (typeof own.endpoint === "string") {
                var ep = own.endpoint.replace(/\/+$/, "");
                snapshot.sporeUrl = ep + "/sbkim/spore.json";
              }
              if (Array.isArray(own.domainKeywords)) {
                snapshot.domainKeywords = own.domainKeywords.filter(function (s) { return typeof s === "string"; });
              }
              if (Array.isArray(own.stammCategories)) {
                snapshot.stammCategories = own.stammCategories.filter(function (s) { return typeof s === "string"; });
              }
              if (Array.isArray(own.guestCategories)) {
                snapshot.guestCategories = own.guestCategories.filter(function (s) { return typeof s === "string"; });
              }
            }
          }
        } catch (_e) { /* nb */ }
      }
    } catch (_e) { /* nb */ }

    // Anastomose: siblings ANONYMISIERT (nodeIdHash via base64url-sha256).
    // KEIN score, KEIN lastSeen (Empfehlungs-Pfad-Tabu, Spec 15.B).
    try {
      var anast = global.SbkimAnastomose;
      if (anast && typeof anast.listSiblings === "function") {
        var rows = await anast.listSiblings();
        if (Array.isArray(rows)) {
          var anonymized = [];
          for (var i = 0; i < rows.length; i++) {
            var sib = rows[i];
            if (!sib || typeof sib.nodeId !== "string") continue;
            try {
              var hash = await hashNodeIdToBase64url(sib.nodeId);
              anonymized.push({
                nodeIdHash: hash,
                since: typeof sib.since === "string" ? sib.since : null,
                status: typeof sib.status === "string" ? sib.status : null,
              });
            } catch (_e) { /* nb — Hash schlug fehl, Eintrag überspringen */ }
          }
          snapshot.siblings = anonymized;
        }
      }
    } catch (_e) { /* nb */ }

    // Storage._meta.storagePersisted: Modul-01-Getter, fail-soft.
    try {
      var storage = global.SbkimStorage;
      if (storage && storage._meta && Object.prototype.hasOwnProperty.call(storage._meta, "storagePersisted")) {
        var persisted = storage._meta.storagePersisted;
        if (typeof persisted === "boolean" || persisted === null) {
          snapshot.storage.storagePersisted = persisted;
        }
      }
    } catch (_e) { /* nb */ }

    // Quota: navigator.storage.estimate() → grob in "none"/"ratio"/"bytes"/"both".
    // Quota blockt read() NICHT (Empfangsmodus-Prinzip, Spec 15.B).
    try {
      var nav = global.navigator;
      if (nav && nav.storage && typeof nav.storage.estimate === "function") {
        var est = await nav.storage.estimate();
        snapshot.storage.quotaWarningLevel = computeQuotaWarningLevel(est);
      }
    } catch (_e) { /* nb */ }

    // Siegel-Block (Modul 16 SbkimSiegel — drei Pflicht-Fälle):
    //   - Modul 16 fehlt/nicht ready → null
    //   - Modul 16 vorhanden + isCertified()===false → voll mit isCertified:false
    //   - Modul 16 vorhanden + isCertified()===true → voll mit isCertified:true
    // getExplanation() liefert bereits defensive Kopie — kein zweiter Klon nötig.
    try {
      var siegel = global.SbkimSiegel;
      if (siegel && typeof siegel === "object" &&
          siegel._meta && siegel._meta.ready === true &&
          typeof siegel.isCertified === "function" &&
          typeof siegel.getExplanation === "function") {
        var explanation = siegel.getExplanation();
        snapshot.siegel = {
          isCertified: siegel.isCertified() === true,
          repoUrl: (explanation && typeof explanation.repoUrl === "string") ? explanation.repoUrl : null,
          certifiedModules: (explanation && Array.isArray(explanation.modules)) ? explanation.modules : [],
        };
      }
    } catch (_e) { /* nb — fail-soft, siegel bleibt null */ }

    // Sub-(e)-Hook: jeder read() schreibt einen Eintrag (Karte 15
    // § Architektur-Trennung Detektions-Schicht Pfad 1). snapshotByteLen
    // macht Daten-Volumen-Beobachtung möglich (Spec 15.B Sub (a)).
    var snapshotByteLen = 0;
    try { snapshotByteLen = JSON.stringify(snapshot).length; }
    catch (_e) { /* nb */ }
    recordEntry({
      kind: "membrane-read",
      origin: null,
      agentHint: safeUserAgentHint(),
      endpoint: null,
      decision: "accepted",
      details: { fieldsRequested: null, snapshotByteLen: snapshotByteLen },
    });

    return snapshot;
  }

  // Quota-Schwellen-Mapping analog Modul 00 § getStatusSnapshot.
  // Doppelschwelle: ratio > 80 % ODER freeBytes < 50 MiB.
  function computeQuotaWarningLevel(est) {
    if (!est || typeof est !== "object") return "none";
    var usage = typeof est.usage === "number" ? est.usage : 0;
    var quota = typeof est.quota === "number" ? est.quota : 0;
    if (quota <= 0) return "none";
    var ratioOver = (usage / quota) > 0.8;
    var bytesLow = (quota - usage) < (50 * 1024 * 1024);
    if (ratioOver && bytesLow) return "both";
    if (ratioOver) return "ratio";
    if (bytesLow) return "bytes";
    return "none";
  }

  // base64url-sha256 (Modul-02-Pattern); Web-Crypto fail-soft.
  async function hashNodeIdToBase64url(nodeId) {
    if (!global.crypto || !global.crypto.subtle || typeof TextEncoder !== "function") {
      throw new Error("WebCrypto nicht verfügbar");
    }
    var bytes = new TextEncoder().encode(nodeId);
    var hashBuf = await global.crypto.subtle.digest("SHA-256", bytes);
    var arr = new Uint8Array(hashBuf);
    var bin = "";
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    var b64 = global.btoa(bin);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // ---- init() ----

  async function init(options) {
    // Optionen
    var opts = (options && typeof options === "object") ? options : {};
    if (typeof opts.bufferMax === "number" && opts.bufferMax > 0) {
      bufferMax = opts.bufferMax;
      // Falls bestehender Buffer größer als neue Grenze — verdrängen.
      if (buffer.length > bufferMax) {
        buffer.splice(0, buffer.length - bufferMax);
      }
    }
    if (typeof opts.lampSelector === "string" && opts.lampSelector.length > 0) {
      lampSelector = opts.lampSelector;
    }
    if (Array.isArray(opts.allowedOrigins)) {
      // Sub (b) Validierungs-Strenge (Karte 15 § Konfigurations-Pfad, Spec
      // 15.B): fail-soft. Pro entferntem Eintrag eine `console.warn`-Zeile,
      // KEIN sync Throw — sonst bräche ein falsch konfigurierter Andocker
      // die ganze Init-Kette.
      var filtered = [];
      for (var ai = 0; ai < opts.allowedOrigins.length; ai++) {
        var entry = opts.allowedOrigins[ai];
        if (isHttpOrigin(entry)) {
          filtered.push(entry);
        } else {
          warn("Allowlist-Eintrag verworfen (Format ungültig): " + JSON.stringify(entry));
        }
      }
      allowedOrigins = filtered;
    }
    if (opts.enableTestButton === true) {
      testButtonEnabled = true;
    }
    // Optionale KI-Richter-Konfig (Strang A2). null/false löscht sie wieder.
    if (Object.prototype.hasOwnProperty.call(opts, "queryJudge")) {
      queryJudge = (opts.queryJudge && typeof opts.queryJudge === "object") ? opts.queryJudge : null;
    }
    var mountModal = opts.mountModal !== false; // default true

    if (ready) {
      // Idempotenz: lampSelector neu auflösen falls Page-DOM inzwischen
      // vorhanden ist. Listener werden NICHT doppelt registriert.
      var maybeLamp = resolveLampElement();
      if (maybeLamp) {
        lampElement = maybeLamp;
        updateLampAlertState();
      }
      return;
    }

    // Lampen-Element auflösen (kein Throw bei Miss — re-try beim DOMContentLoaded).
    lampElement = resolveLampElement();
    if (!lampElement) {
      var doc = global.document;
      if (doc && typeof doc.addEventListener === "function" && doc.readyState === "loading") {
        doc.addEventListener("DOMContentLoaded", function () {
          lampElement = resolveLampElement();
          updateLampAlertState();
          if (mountModal && !modalMounted) mountFremdzugriffModal();
          attachLampClickHandler();
        }, { once: true });
      } else {
        warn("lampSelector matcht aktuell kein Element: " + lampSelector + " (Lampen-Toggle übersprungen).");
      }
    } else {
      updateLampAlertState();
    }

    // Modal-Mount + Click-Handler (default true).
    if (mountModal) {
      try { mountFremdzugriffModal(); } catch (err) { warn("Modal-Mount fehlgeschlagen", err); }
    }
    attachLampClickHandler();

    // postMessage-Listener (Sub (b) Skelett).
    try {
      postMessageListener = handlePostMessage;
      global.addEventListener("message", postMessageListener);
    } catch (err) {
      warn("postMessage-Listener-Registrierung fehlgeschlagen", err);
    }

    // BroadcastChannel für SW-endpoint-probes (Sub (e) Pfad 3).
    subscribeBroadcastChannel();

    ready = true;
  }

  function attachLampClickHandler() {
    if (!lampElement) return;
    if (lampElement.__sbkimMembranClickAttached) return;
    try {
      lampElement.addEventListener("click", function () {
        if (modalOpen) closeFremdzugriffModal();
        else openFremdzugriffModal();
      });
      lampElement.style.cursor = "pointer";
      lampElement.__sbkimMembranClickAttached = true;
    } catch (err) {
      warn("Lampen-Click-Handler konnte nicht registriert werden.", err);
    }
  }

  // ---- public surface ----

  // setQueryJudge(cfg) — Laufzeit-Setter für die KI-Richter-Konfig des
  // op:"query"-Antwort-Pfads (Strang A2). cfg = Objekt (opt-in, RAM-only) oder
  // null/false (löscht → zurück zum rohen Vorfilter). Kein Persist, kein Log.
  function setQueryJudge(cfg) {
    queryJudge = (cfg && typeof cfg === "object") ? cfg : null;
  }

  var SbkimMembrane = {
    init: init,
    read: readSnapshot,
    setQueryJudge: setQueryJudge,
    fremdzugriff: {
      list: listFremdzugriff,
      subscribe: subscribeFremdzugriff,
      clear: clearFremdzugriff,
      _recordForTest: recordForTest,
    },
    _meta: {
      bufferMax: MEMBRANE_FREMDZUGRIFF_BUFFER_MAX,
      agentHintMaxLen: AGENT_HINT_MAX_LEN,
      messageType: MEMBRANE_MESSAGE_TYPE,
      broadcastChannelName: BROADCAST_CHANNEL_NAME,
      swProbeMessageType: SW_PROBE_MESSAGE_TYPE,
      protocolVersion: PROTOCOL_VERSION,
      replayDedupeTtlMs: REPLAY_DEDUPE_TTL_MS,
      recentSporeRefsMax: RECENT_SPORE_REFS_MAX,
      embeddingDim: EMBEDDING_DIM,
      get bufferLength() { return buffer.length; },
      get listenerCount() { return listeners.length; },
      get modalMounted() { return modalMounted; },
      get modalOpen() { return modalOpen; },
      get ready() { return ready; },
      get allowedOrigins() { return allowedOrigins.slice(); },
      // Strang A2: nur ob der Richter-Pfad opt-in konfiguriert ist — NIE der
      // Schlüssel selbst (RAM-only, kein Leak über die Read-Fläche).
      get queryJudgeConfigured() {
        return !!(queryJudge && typeof queryJudge.apiKey === "string" && queryJudge.apiKey.length > 0);
      },
      // Sub (b) Read-Anker — Größen-Getter, keine direkten Map-Referenzen
      // (Snapshot-Pattern; interne Maps bleiben modul-lokal).
      get recentSporeRefsCount() { return recentSporeRefs.size; },
      get pendingQueriesCount() { return pendingQueries.size; },
      get seenNoncesCount() { return seenNonces.size; },
      get siegelAvailable() {
        try {
          var s = global.SbkimSiegel;
          return !!(s && typeof s === "object" && s._meta && s._meta.ready === true);
        } catch (_e) { return false; }
      },
      // Test-Brücke für queryResult-Match-Pfad. Sub (b) ist Empfänger-
      // Schicht — eine echte Sender-API liegt beim Andocker (Karte 15
      // § Sender-Mechanismus). Für Sichttest registrieren wir einen
      // Pending-Eintrag und liefern das Promise zurück, das bei einer
      // passenden queryResult-Message resolved.
      _registerPendingQueryForTest: function (nonce, origin) {
        var resolveFn = null;
        var p = new Promise(function (resolve) { resolveFn = resolve; });
        pendingQueries.set(nonce, {
          origin: typeof origin === "string" ? origin : null,
          sentAt: Date.now(),
          resolve: resolveFn,
        });
        return p;
      },
      // Snapshot der RAM-Caches (defensive Kopie für Tests).
      get recentSporeRefsSnapshot() {
        var out = {};
        recentSporeRefs.forEach(function (entry, origin) {
          out[origin] = {
            nodeId: entry.nodeId,
            sporeUrl: entry.sporeUrl,
            domain: entry.domain,
            receivedAt: entry.receivedAt,
          };
        });
        return out;
      },
    },
  };

  global.SbkimMembrane = SbkimMembrane;

  // Self-check (synchron, beim Skript-Laden — vor jedem Aufruf).
  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 15 MEMBRAN bereit, Funktionen: init/read/setQueryJudge/fremdzugriff.{list,subscribe,clear,_recordForTest}",
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
