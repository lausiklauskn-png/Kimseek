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
 *     Pflege 2026-08-01 (Klaus' Live-Befund im DuckDuckGo-Browser): jeder
 *     postMessage-Eintrag führt jetzt mit, WER gesendet hat, WOFÜR sich die
 *     Nachricht ausgab, WANN nach dem Laden sie kam und unter welchen
 *     Umständen — und welcher der vier gleich aussehenden „ignored"-Fälle
 *     zutraf (`details.grund`). Das Fenster zeigt das als Klartext-Zeile.
 *     PII-Tabu bleibt hart: nie Werte aus fremden Objekten, nur Feld-NAMEN,
 *     Text-Auszug gekappt und mit maskierten Ziffern, alles RAM-only.
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
 *     enableTestButton?: boolean,   // Default false (Sage-Page-Sichttest-Knopf)
 *     lang?: 'de' | 'en' }          // Default: <html lang> → 'de'. Siehe § SPRACHE.
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
  // Sub (e), Pflege 2026-08-01: die feineren Gründe hinter `decision`. „ignored"
  // allein deckt vier verschiedene Sachlagen ab — in Klaus' Live-Befund war
  // nicht zu erkennen, welche davon zutraf. Whitelist statt Freitext: hier soll
  // nie ein fremder String ins Protokoll wandern.
  var VALID_GRUENDE = {
    "fremder-typ": 1,        // die Nachricht gab sich nicht als SBKIM aus
    "nicht-erlaubt": 1,      // Herkunft steht nicht auf der Allowlist
    "kein-nonce": 1,         // Pflicht-Feld fehlte
    "unbekannte-op": 1,      // op fehlt oder ist nicht in der Whitelist
    "gedrosselt": 1          // Modul 11 hat abgeriegelt
  };

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

  /* ── Die Sprache ────────────────────────────────────────────────────────
   * Verfahren BYTE-GLEICH mit Modul 16, 17 und 23 UI: SCHLUESSELLOS — der
   * deutsche Satz IST der Schluessel, `TEXTE.en` traegt die Uebersetzung,
   * `T()` faellt fail-soft auf Deutsch zurueck. Rangfolge:
   * init({lang}) → <html lang> → de.
   *
   * ⚠ WARUM DIESES MODUL UEBERHAUPT UEBERSETZT WIRD. Das Fremdzugriff-Fenster
   * haengt an der FREMD-Lampe von Modul 17 — und die spricht seit dem
   * 2026-09-14 Englisch. Wer dort klickte, bekam ein vollstaendig deutsches
   * Fenster: englische Leiste, deutsches Fenster dahinter. Genau die HALB
   * UEBERSETZTE TAFEL, die netzweit als die schlimmere Sorte benannt ist.
   * Gemessen am 2026-09-16: 0 von 20 Traegern zeigten dieses Fenster auf
   * Englisch, in allen 20 stand die Leiste darueber auf Englisch.
   *
   * ⚠ OHNE EINSTELLUNG AENDERT SICH NICHTS. Ohne `lang` und ohne
   * `<html lang="en">` gibt T() den deutschen Satz Zeichen fuer Zeichen
   * zurueck — neunzehn Apps tragen dieses Modul byte-1:1, und keine davon
   * darf davon etwas merken.
   *
   * ⚠ WAS BEWUSST DEUTSCH BLEIBT: die Spaltenkoepfe `kind`, `origin`,
   * `endpoint`, `decision` sind FELDNAMEN des Protokolls, keine Saetze — sie
   * stehen in beiden Sprachen gleich da, so wie „nodeId" im Wizard. Auch die
   * WERTE in diesen Spalten (`membrane-postmessage`, `ignored`, `accepted`)
   * sind Protokoll-Bestand und werden nicht uebersetzt: wer einen Befund
   * meldet, soll in beiden Sprachen dasselbe Wort nennen koennen.
   *
   * ⚠ KEIN ZERTIFIKAT_ASPEKTE-EINTRAG, obwohl 15 ein Schutz-Modul ist und die
   * Konvention sonst greift — dieselbe Begruendung wie bei Modul 16 am
   * 2026-09-14: eine Uebersetzung ist Render-Schicht. Sie ruehrt weder die
   * Allowlist noch die Nonce-Pflicht noch den Ringbuffer an. Ein Eintrag
   * „spricht jetzt Englisch" behauptete einen Sicherheits-Fortschritt, den es
   * nicht gibt, und verwaesserte die Liste, die Sicherheits-Updates sichtbar
   * machen soll. Ausgeschrieben in INTERFACES § Modul 15 SPRACHE. */
  var TEXTE = { en: {
      /* Das Fenster selbst */
      "Fremdzugriff-Fenster":
        "Foreign-access window",
      "Schließen":
        "Close",
      "{0} Einträge im Ringbuffer (max {1})":
        "{0} entries in the ring buffer (max {1})",
      "Aufräumen":
        "Clear",
      "🧪 Demo-Eintrag":
        "🧪 Demo entry",
      "Sichttest: synthetischen endpoint-probe-Eintrag einfügen (Sage-Page-Sichttest, kein produktiver Pfad)":
        "Visual check: insert a synthetic endpoint-probe entry (Sage page visual check, not a production path)",
      "Zeit":
        "Time",
      "Tipp: leere Tabelle = Lampe geht aus.":
        "Tip: an empty table means the lamp goes out.",
      "(lokal)":
        "(local)",

      /* Die fuenf Abweis-Gruende (GRUND_TEXT). Sie sind Teilsaetze und werden
       * unten in einen ganzen Satz eingesetzt — deshalb ohne Punkt. */
      "Die Nachricht war nicht für SBKIM bestimmt":
        "The message was not meant for SBKIM",
      "Die Herkunft steht nicht auf der Erlaubnis-Liste":
        "The origin is not on the allowlist",
      "Der Nachricht fehlte die Pflicht-Kennung":
        "The message was missing its required identifier",
      "Die Nachricht wollte etwas, das die Membran nicht anbietet":
        "The message wanted something the membrane does not offer",
      "Es kam zu viel auf einmal von dieser Herkunft":
        "Too much arrived at once from this origin",

      /* Die fuenf Absender (ABSENDER_TEXT) — ebenfalls Teilsaetze. */
      "dieses Fenster selbst":
        "this window itself",
      "ein eingebetteter Rahmen auf dieser Seite":
        "an embedded frame on this page",
      "das Fenster, das diese Seite geöffnet hat":
        "the window that opened this page",
      "ein anderes Fenster":
        "another window",
      "nicht feststellbar":
        "not determinable",

      /* Die Erklaer-Zeile. JEDER EINTRAG IST EIN GANZER SATZ mit Platzhaltern
       * — nicht ein Anfang und ein Ende, die der Code zusammenklebt. Ein Satz,
       * der am Komma auseinandergeschnitten wird, ist keine
       * Uebersetzungs-Einheit: die englische Wortstellung ist eine andere. */
      "{0} (sie gab sich aus als „{1}“).":
        "{0} (it claimed to be “{1}”).",
      "{0}.":
        "{0}.",
      "Sie gab sich aus als „{0}“.":
        "It claimed to be “{0}”.",
      "Abgeschickt hat sie: {0}.":
        "It was sent by: {0}.",
      "Herkunft: {0}.":
        "Origin: {0}.",
      "Herkunft: nicht feststellbar — typisch für Skripte des Browsers selbst und für Erweiterungen.":
        "Origin: not determinable — typical for the browser’s own scripts and for extensions.",
      "Kam {0} s nach dem Laden der Seite, während der Tab vorn war.":
        "Arrived {0} s after the page loaded, while the tab was in the foreground.",
      "Kam {0} s nach dem Laden der Seite, während der Tab im Hintergrund lag.":
        "Arrived {0} s after the page loaded, while the tab was in the background.",
      "Kam {0} s nach dem Laden der Seite.":
        "Arrived {0} s after the page loaded.",
      "Inhalt (gekürzt, Ziffern ersetzt): „{0}“":
        "Content (shortened, digits replaced): “{0}”",
      "Felder der Nachricht: {0}. (Nur die Namen — Inhalte werden nicht protokolliert.)":
        "Fields of the message: {0}. (Names only — contents are not logged.)",
      "Felder der Nachricht: {0} und {1} weitere. (Nur die Namen — Inhalte werden nicht protokolliert.)":
        "Fields of the message: {0} and {1} more. (Names only — contents are not logged.)",
  } };

  /* Die gewaehlte Sprache. null = „nicht gesetzt" → <html lang> entscheidet. */
  var optLang = null;

  function sprache() {
    if (optLang === "de" || optLang === "en") return optLang;
    try {
      var d = global.document;
      var l = String((d && d.documentElement && d.documentElement.lang) || "").slice(0, 2).toLowerCase();
      if (l === "en") return "en";
    } catch (_e) { /* nb */ }
    return "de";
  }

  /* Bei JEDEM Aufruf neu nachsehen, nicht einmal beim Laden merken: wer die
   * Sprache umschaltet und danach das Fenster oeffnet, bekaeme sonst die alte. */
  function T(de) {
    if (sprache() !== "en") return de;
    var w = TEXTE.en;
    return (w && Object.prototype.hasOwnProperty.call(w, de)) ? w[de] : de;
  }

  /* Platzhalter {0}, {1}, … — die Zahl steht im SATZ, nicht daneben. */
  /* Die Zaehl-Zeile stand bis zum 2026-09-16 an DREI Stellen als eigener
   * Zusammenbau (`n + " Einträge im Ringbuffer (max " + bufferMax + ")"`).
   * Ein Satz an drei Orten sind drei Orte, an denen er auseinanderlaufen
   * kann — und beim Uebersetzen waeren es drei Schluessel gewesen, von denen
   * zwei still deutsch geblieben waeren. */
  function zaehlText(n) {
    return Tf("{0} Einträge im Ringbuffer (max {1})", n, bufferMax);
  }

  function Tf(de) {
    var a = arguments;
    return T(de).replace(/\{(\d+)\}/g, function (_, i) {
      var v = a[Number(i) + 1];
      return v === undefined || v === null ? "" : String(v);
    });
  }

  // Bau 04.G-Folge (Strang A2, 2026-07-01): optionale KI-Richter-Konfig für
  // den `op:"query"`-Antwort-Pfad. Default `null` = Richter AUS → der Empfänger
  // ruft wie bisher `SbkimMatch.queryLocal` (roher Vorfilter). Setzt der
  // Betreiber `init({queryJudge:{apiKey,provider?,euOnly?,hybrid?,endpoint?,model?}})`
  // ODER `setQueryJudge(cfg)`, ruft der Empfänger `SbkimMatch.queryLocalJudged`
  // (Vorfilter + Richter, BYOK, fail-soft). RAM-only — kein Persist, kein Log,
  // der Schlüssel steht NIE im Code. Opt-in, weil der antwortende Knoten mit dem
  // Richter seinen eigenen Schlüssel für eingehende Fremd-Anfragen ausgibt.
  var queryJudge = null;

  // Inklusions-Konfig für den `op:"query"`-Antwort-Pfad (2026-08-14, aus
  // BookLedgerPro in den Kanon gehoben).
  //
  // WOHER DAS KOMMT. BookLedgerPro hatte diesen Pfad seit dem 2026-07-11 in
  // seiner EIGENEN Kopie von Modul 15 stehen — mit einer fest eingebauten
  // Buchhaltungs-Synonym-Karte (rechnung↔faktura, beleg↔quittung, ust↔
  // umsatzsteuer). Das war echte, nützliche Funktion an der falschen Stelle:
  // „kopieren, nicht klonen" verbietet, die Kopie zu ändern, und ein späteres
  // byte-1:1-Nachziehen hätte sie lautlos gelöscht. Also wandert die Mechanik
  // hierher — und die FACHWORTE bleiben bei der App, die sie kennt.
  //
  // Default `null` = aus. Dann ruft der Empfänger wie bisher
  // `SbkimMatch.queryLocal(text, k)` — byte-gleiches Verhalten für jeden, der
  // nichts konfiguriert. Setzt der Betreiber
  // `init({queryInclusion:{synonyms?,hybrid?}})` ODER `setQueryInclusion(cfg)`,
  // läuft die Kaskade aus Bau 22f:
  //   A4  Frage über die Synonym-Karte auffächern (expandQuerySimple)
  //       → queryLocalMulti mit RRF-Fusion
  //   A1  Hybrid-queryLocal (BM25 + Vektor)
  //   Boden: der bewährte reine Cosinus-Pfad (Bau 04.C)
  // Jede Stufe fail-soft; die Funktion wirft NICHT (der äußere try/catch im
  // Empfänger schickt sonst die fail-soft-Fehlerantwort statt Treffern).
  //
  // REINE INKLUSION: cross-formulierte Wort-Treffer unter dem Cosinus-Boden
  // werden über BM25 AUFGENOMMEN. Der 0.80-Andock-Riegel (Modul 05
  // `PROVIDER_MIN_MATCH`) bleibt unberührt — hier wird geantwortet, nicht
  // angedockt.
  var queryInclusion = null;

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

  // ---- Sub (e) Herkunfts-Analyse (Pflege 2026-08-01, Klaus' Live-Befund) ----
  //
  // WOZU. Am 2026-08-01 stand im DuckDuckGo-Browser die FREMD-Lampe auf Rot.
  // Klaus klickte sie an und las:
  //
  //     membrane-postmessage   origin: —   decision: ignored
  //
  // Die Membran hatte also etwas gefangen und richtig abgewiesen — aber WER
  // gesendet hat, stand nicht da, und „ignored" deckt vier verschiedene Gründe
  // ab, die alle gleich aussehen. Ein Wächter, dessen Meldung man nicht deuten
  // kann, ist nur halb ein Wächter. Klaus' Wort: „es soll mehr zu lesen sein —
  // wer hat zugegriffen, wann, unter welchen Umständen."
  //
  // WAS AUFGENOMMEN WIRD, UND WARUM GERADE DAS:
  //   grund       welcher der vier ignored-Fälle es war — die häufigste Frage
  //   absender    Fenster, eingebetteter Rahmen, öffnendes Fenster, Worker
  //   typ         wofür sich die Nachricht ausgibt (data.type), gekappt
  //   felder      NUR die NAMEN der obersten Ebene, nie die Werte
  //   text        bei einer reinen Text-Nachricht ein kurzer Auszug
  //   nachLadenMs wie lange nach dem Laden — trennt Erweiterungen (sofort)
  //               von späterem Zutun
  //   sichtbar    war der Tab vorn? Ein Zugriff im Hintergrund ist ein anderer
  //               Befund als einer, während man hinsieht
  //
  // PII-DISZIPLIN, HART. Werte aus fremden Objekten werden NIE protokolliert —
  // nur Feld-NAMEN, und die gekappt, gezählt und auf ein enges Zeichen-Alphabet
  // gefiltert. Der Text-Auszug ist auf MESSAGE_TEXT_MAX Zeichen gekappt, von
  // Steuerzeichen befreit, und JEDE Ziffernfolge wird durch `#` ersetzt: eine
  // Kontonummer, ein Geburtsdatum oder eine Telefonnummer kommt so gar nicht
  // erst ins Protokoll, der wiedererkennbare Wortlaut aber schon. Das Protokoll
  // bleibt RAM-only und verlässt den Browser nicht.
  var MESSAGE_TEXT_MAX = 48;                 // Auszug einer Text-Nachricht
  var MESSAGE_FIELDS_MAX = 8;                // so viele Feld-Namen, dann "…"
  var MESSAGE_FIELD_LEN = 32;                // je Name
  var MESSAGE_TYPE_MAX = 64;                 // data.type

  function kurzText(s, max) {
    if (typeof s !== "string" || s.length === 0) return null;
    var sauber = s
      .replace(/[\u0000-\u001f\u007f]/g, " ")   // Steuerzeichen raus
      .replace(/\d+/g, "#")                     // Ziffernfolgen maskieren (PII)
      .replace(/\s+/g, " ")
      .trim();
    if (!sauber) return null;
    return sauber.length > max ? sauber.slice(0, max) + "…" : sauber;
  }

  // Nur der Name, nie der Wert. Namen mit ungewöhnlichen Zeichen werden nicht
  // durchgereicht, sondern als "?" gezählt — ein Feld-Name ist ein Hinweis,
  // kein Freitext-Kanal ins Protokoll.
  function feldNamen(o) {
    var raus = [], mehr = 0, i, k;
    var keys;
    try { keys = Object.keys(o); } catch (_e) { return null; }
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (raus.length >= MESSAGE_FIELDS_MAX) { mehr++; continue; }
      raus.push(/^[A-Za-z0-9_.$-]{1,32}$/.test(k) ? k : "?");
    }
    if (!raus.length && !mehr) return null;
    return { namen: raus, mehr: mehr };
  }

  // WER hat gesendet — ohne je in ein fremdes Fenster hineinzusehen. Verglichen
  // wird nur mit Referenzen, die wir ohnehin haben; jeder Zugriff ist in
  // try/catch, weil ein Cross-Origin-Fenster beim bloßen Vergleich werfen kann.
  function absenderArt(event) {
    try {
      var q = event && event.source;
      if (!q) return "unbekannt";
      if (q === global) return "eigenes-fenster";
      try { if (global.opener && q === global.opener) return "oeffnendes-fenster"; } catch (_e) { /* nb */ }
      try {
        var f = global.frames;
        if (f && typeof f.length === "number") {
          for (var i = 0; i < f.length && i < 32; i++) {
            try { if (f[i] === q) return "eingebetteter-rahmen"; } catch (_e2) { /* nb */ }
          }
        }
      } catch (_e3) { /* nb */ }
      if (q === event.target) return "eigenes-fenster";
      return "anderes-fenster";
    } catch (_e4) {
      return "unbekannt";
    }
  }

  // Die Umstände. Beide Werte sind fail-soft: fehlt die Uhr oder die
  // Sichtbarkeits-Auskunft, steht das Feld einfach nicht im Eintrag.
  function nachLadenMs() {
    try {
      var p = global.performance;
      if (p && typeof p.now === "function") return Math.round(p.now());
    } catch (_e) { /* nb */ }
    return null;
  }
  function tabSichtbar() {
    try {
      var d = global.document;
      if (d && typeof d.visibilityState === "string") return d.visibilityState === "visible";
    } catch (_e) { /* nb */ }
    return null;
  }

  // Alles zusammen, gedeckelt. Wird an `details` gehängt, nicht an die
  // Kopf-Felder — der Draht-Vertrag des Eintrags (kind/origin/decision) bleibt
  // damit unverändert, und ältere Anzeigen zeigen einfach weiter, was sie
  // kennen.
  function herkunftDetails(event) {
    var d = {};
    try {
      var art = absenderArt(event);
      if (art) d.absender = art;
      var roh = event ? event.data : null;
      if (typeof roh === "string") {
        d.form = "text";
        var t = kurzText(roh, MESSAGE_TEXT_MAX);
        if (t) d.text = t;
      } else if (roh && typeof roh === "object") {
        d.form = Array.isArray(roh) ? "liste" : "objekt";
        var typ = kurzText(roh.type, MESSAGE_TYPE_MAX);
        if (typ) d.typ = typ;
        var f = feldNamen(roh);
        if (f) { d.felder = f.namen; if (f.mehr) d.felderMehr = f.mehr; }
      } else if (roh !== undefined && roh !== null) {
        d.form = typeof roh;
      } else {
        d.form = "leer";
      }
      var ms = nachLadenMs();
      if (ms !== null) d.nachLadenMs = ms;
      var sicht = tabSichtbar();
      if (sicht !== null) d.sichtbar = sicht;
    } catch (_e) { /* nb — ein Protokoll darf nie der Grund für einen Fehler sein */ }
    return d;
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
      // `grund` sagt, WELCHER der gleich aussehenden Fälle es war. Genau das
      // fehlte in Klaus' Befund vom 2026-08-01: „ignored" allein deckt vier
      // verschiedene Sachlagen ab. Whitelist, damit hier nie fremder Text
      // durchrutscht.
      if (typeof extraDetails.grund === "string" && VALID_GRUENDE[extraDetails.grund]) {
        details.grund = extraDetails.grund;
      }
    }
    // Herkunfts-Analyse (Pflege 2026-08-01): wer, wann, unter welchen
    // Umständen. Gedeckelt und ohne Werte aus fremden Objekten.
    var herkunft = herkunftDetails(event);
    for (var hk in herkunft) {
      if (Object.prototype.hasOwnProperty.call(herkunft, hk)) details[hk] = herkunft[hk];
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

  // queryWithInclusion(match, text, k) -> Promise<Array>
  //
  // Die Kaskade A4 → A1 → einfacher Cosinus, jede Stufe fail-soft. Wird NUR
  // aufgerufen, wenn der Betreiber `queryInclusion` gesetzt hat (siehe die
  // Erklärung oben bei der Variable). Wirft NICHT — schlägt eine Stufe fehl,
  // fällt sie auf die nächste durch, und die letzte ist der Pfad, der ohne
  // diese Funktion gelaufen wäre. Schlimmstenfalls also: wie vorher.
  async function queryWithInclusion(match, text, k) {
    var cfg = queryInclusion || {};
    var synonyms = (cfg.synonyms && typeof cfg.synonyms === "object") ? cfg.synonyms : null;
    // `hybrid` ist Teil dieser Betriebsart: BM25 neben dem Vektor ist genau
    // der Weg, auf dem ein anders formulierter Wort-Treffer hereinkommt.
    // Wer ihn nicht will, setzt `hybrid: false` — dann bleibt die
    // Varianten-Auffächerung, aber der Vorfilter bleibt rein semantisch.
    var hybrid = (cfg.hybrid === false) ? false : true;

    // A4 + A1: Varianten auffächern, dann Multi-Suche mit RRF-Fusion.
    if (synonyms &&
        typeof match.queryLocalMulti === "function" &&
        typeof match.expandQuerySimple === "function") {
      try {
        var variants = match.expandQuerySimple(text, { synonyms: synonyms });
        return await match.queryLocalMulti(variants, k, { hybrid: hybrid });
      } catch (e1) {
        warn("A4/A1-Multi-Pfad fehlgeschlagen — Rückfall auf Hybrid-queryLocal.", e1);
      }
    }
    // A1 allein: Hybrid-queryLocal (BM25 + Vektor), ohne Varianten.
    if (hybrid) {
      try {
        return await match.queryLocal(text, k, { hybrid: true });
      } catch (e2) {
        warn("A1-Hybrid-Pfad fehlgeschlagen — Rückfall auf einfachen Cosinus.", e2);
      }
    }
    // Letzter Boden: der bewährte reine Cosinus-Pfad (Bau 04.C).
    return await match.queryLocal(text, k);
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
      var useInclusion = !!queryInclusion &&
        match && typeof match.queryLocal === "function";
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
          var results = useInclusion
            ? await queryWithInclusion(match, payload.text, k)
            : await match.queryLocal(payload.text, k);
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
    recordPostMessageEntry(event, op, nonce, "ignored", { grund: "unbekannte-op" });
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
        recordPostMessageEntry(event, op, nonce, "ignored", { grund: "fremder-typ" });
        return;
      }

      // 3. Allowlist-Check.
      if (allowedOrigins.indexOf(event.origin) < 0) {
        recordPostMessageEntry(event, op, nonce, "rejected-allowlist", { grund: "nicht-erlaubt" });
        return;
      }

      // 4. Nonce-Pflicht.
      if (!nonce) {
        recordPostMessageEntry(event, op, nonce, "ignored", { grund: "kein-nonce" });
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
            recordPostMessageEntry(event, op, nonce, "ignored", { throttled: true, grund: "gedrosselt" });
            return;
          }
        }
      } catch (err) {
        // Modul 11 wirft im Hook — fail-soft, weiter durchreichen.
        warn("SbkimRateLimit.checkOrigin hat geworfen — fail-soft.", err);
      }

      // 7. Op-Validierung (whitelist).
      if (!op || !VALID_OPS[op]) {
        recordPostMessageEntry(event, op, nonce, "ignored", { grund: "unbekannte-op" });
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
    title.textContent = T("Fremdzugriff-Fenster");
    title.style.cssText = "margin:0;font-size:1.1rem;font-weight:600;flex:1;";

    var closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("data-membran-close", "");
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", T("Schließen"));
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
    count.textContent = zaehlText(0);

    var clearBtn = doc.createElement("button");
    clearBtn.type = "button";
    clearBtn.setAttribute("data-membran-clear", "");
    clearBtn.textContent = T("Aufräumen");
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
      testBtn.textContent = T("🧪 Demo-Eintrag");
      testBtn.title = T("Sichttest: synthetischen endpoint-probe-Eintrag einfügen (Sage-Page-Sichttest, kein produktiver Pfad)");
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
      "<th data-membran-th-zeit style=\"text-align:left;padding:0.35rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.18);\"></th>" +
      "<th style=\"text-align:left;padding:0.35rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.18);\">kind</th>" +
      "<th style=\"text-align:left;padding:0.35rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.18);\">origin</th>" +
      "<th style=\"text-align:left;padding:0.35rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.18);\">endpoint</th>" +
      "<th style=\"text-align:left;padding:0.35rem 0.4rem;border-bottom:1px solid rgba(255,255,255,0.18);\">decision</th>" +
      "</tr></thead><tbody data-membran-tbody></tbody>";

    /* Der einzige Spaltenkopf, der ein WORT ist — die vier anderen (kind,
     * origin, endpoint, decision) sind Feldnamen des Protokolls und stehen in
     * beiden Sprachen gleich da. textContent statt innerHTML, wie jede Zelle
     * in diesem Modul: eine Regel, die eine Ausnahme kennt, ist keine. */
    var thZeit = table.querySelector("[data-membran-th-zeit]");
    if (thZeit) thZeit.textContent = T("Zeit");

    var tip = doc.createElement("p");
    tip.style.cssText = "margin:0.9rem 0 0;font-size:0.78rem;color:rgba(245,245,255,0.55);";
    tip.textContent = T("Tipp: leere Tabelle = Lampe geht aus.");

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

  // ---- Sub (e) Klartext zum Eintrag (Pflege 2026-08-01) --------------------
  //
  // Die Tabelle sagt WAS. Diese Zeile sagt WER, WANN und UNTER WELCHEN
  // UMSTÄNDEN — in ganzen Sätzen, weil das Fenster für Klaus gebaut ist und
  // nicht für eine Sitzung. Sie steht als zweite Zeile unter dem Eintrag,
  // damit die Tabelle auf einem Tablet schmal bleibt.
  var GRUND_TEXT = {
    "fremder-typ": "Die Nachricht war nicht für SBKIM bestimmt",
    "nicht-erlaubt": "Die Herkunft steht nicht auf der Erlaubnis-Liste",
    "kein-nonce": "Der Nachricht fehlte die Pflicht-Kennung",
    "unbekannte-op": "Die Nachricht wollte etwas, das die Membran nicht anbietet",
    "gedrosselt": "Es kam zu viel auf einmal von dieser Herkunft"
  };
  var ABSENDER_TEXT = {
    "eigenes-fenster": "dieses Fenster selbst",
    "eingebetteter-rahmen": "ein eingebetteter Rahmen auf dieser Seite",
    "oeffnendes-fenster": "das Fenster, das diese Seite geöffnet hat",
    "anderes-fenster": "ein anderes Fenster",
    "unbekannt": "nicht feststellbar"
  };

  function entryErklaerung(entry) {
    var d = (entry && entry.details) || {};
    var teile = [];

    if (d.grund && GRUND_TEXT[d.grund]) {
      teile.push(d.typ
        ? Tf("{0} (sie gab sich aus als „{1}“).", T(GRUND_TEXT[d.grund]), d.typ)
        : Tf("{0}.", T(GRUND_TEXT[d.grund])));
    } else if (d.typ) {
      teile.push(Tf("Sie gab sich aus als „{0}“.", d.typ));
    }

    if (d.absender) {
      teile.push(Tf("Abgeschickt hat sie: {0}.",
        ABSENDER_TEXT[d.absender] ? T(ABSENDER_TEXT[d.absender]) : d.absender));
    }

    if (entry && entry.origin) {
      teile.push(Tf("Herkunft: {0}.", entry.origin));
    } else if (entry && entry.kind === "membrane-postmessage") {
      // Der Strich in Klaus' Befund. Er ist kein Fehler der Membran, sondern
      // eine echte Auskunft — und die gehört ausgeschrieben, statt dass jeder
      // sie neu erraten muss.
      teile.push(T("Herkunft: nicht feststellbar — typisch für Skripte des Browsers selbst und für Erweiterungen."));
    }

    if (typeof d.nachLadenMs === "number") {
      var s = d.nachLadenMs / 1000;
      var sek = s < 10 ? s.toFixed(1) : String(Math.round(s));
      /* ⚠ DREI GANZE SAETZE, nicht ein Anfang mit drei Enden. Die deutsche
       * Fassung liess sich am Komma zerschneiden; im Englischen steht die
       * Zeitangabe an anderer Stelle im Satz. Ein Satz, der am Komma
       * auseinandergeschnitten wird, ist keine Uebersetzungs-Einheit. */
      teile.push(d.sichtbar === true
        ? Tf("Kam {0} s nach dem Laden der Seite, während der Tab vorn war.", sek)
        : d.sichtbar === false
          ? Tf("Kam {0} s nach dem Laden der Seite, während der Tab im Hintergrund lag.", sek)
          : Tf("Kam {0} s nach dem Laden der Seite.", sek));
    }

    if (d.form === "text" && d.text) {
      teile.push(Tf("Inhalt (gekürzt, Ziffern ersetzt): „{0}“", d.text));
    } else if (Array.isArray(d.felder) && d.felder.length) {
      teile.push(d.felderMehr
        ? Tf("Felder der Nachricht: {0} und {1} weitere. (Nur die Namen — Inhalte werden nicht protokolliert.)",
             d.felder.join(", "), d.felderMehr)
        : Tf("Felder der Nachricht: {0}. (Nur die Namen — Inhalte werden nicht protokolliert.)",
             d.felder.join(", ")));
    }

    return teile.join(" ");
  }

  function renderModalRow(entry) {
    var doc = global.document;
    var tr = doc.createElement("tr");
    var origin = entry.origin === null ? T("(lokal)") : entry.origin;
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

  // Die Erklär-Zeile. Eigene <tr> über die volle Breite, damit sie umbrechen
  // darf statt eine Spalte zu sprengen. textContent, wie jede Zeile hier —
  // in `details` stehen zwar nur gefilterte Werte, aber eine Regel, die eine
  // Ausnahme kennt, ist keine.
  function renderModalNote(entry) {
    var text = entryErklaerung(entry);
    if (!text) return null;
    var doc = global.document;
    var tr = doc.createElement("tr");
    tr.innerHTML = "<td colspan=\"5\" style=\"padding:0 0.4rem 0.55rem;border-bottom:1px solid rgba(255,255,255,0.06);" +
      "font-family:system-ui,sans-serif;font-size:0.78rem;line-height:1.5;color:rgba(245,245,255,0.72);\"></td>";
    tr.children[0].textContent = text;
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
      var note = renderModalNote(snapshot[i]);
      if (note) tbody.appendChild(note);
    }
    countEl.textContent = zaehlText(snapshot.length);
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
    var note = renderModalNote(entry);
    if (note) tbody.appendChild(note);
    countEl.textContent = zaehlText(buffer.length);
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
    /* Sprache. Ein unbekannter Wert laesst optLang auf null, und dann
     * entscheidet <html lang>. Kein Throw — fail-soft wie alles hier. */
    if (opts.lang === "de" || opts.lang === "en") optLang = opts.lang;

    if (opts.enableTestButton === true) {
      testButtonEnabled = true;
    }
    // Optionale KI-Richter-Konfig (Strang A2). null/false löscht sie wieder.
    if (Object.prototype.hasOwnProperty.call(opts, "queryJudge")) {
      queryJudge = (opts.queryJudge && typeof opts.queryJudge === "object") ? opts.queryJudge : null;
    }
    // Optionale Inklusions-Konfig (2026-08-14). null/false löscht sie wieder.
    if (Object.prototype.hasOwnProperty.call(opts, "queryInclusion")) {
      queryInclusion = (opts.queryInclusion && typeof opts.queryInclusion === "object")
        ? opts.queryInclusion : null;
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

  // setQueryInclusion(cfg) — Laufzeit-Setter für die Inklusions-Konfig des
  // op:"query"-Antwort-Pfads. cfg = {synonyms?, hybrid?} (opt-in, RAM-only)
  // oder null/false (löscht → zurück zum rohen Vorfilter). Die Synonym-Karte
  // gehört der App: sie kennt ihre Fachworte, der Kanon kennt sie nicht.
  function setQueryInclusion(cfg) {
    queryInclusion = (cfg && typeof cfg === "object") ? cfg : null;
  }

  var SbkimMembrane = {
    init: init,
    read: readSnapshot,
    setQueryJudge: setQueryJudge,
    setQueryInclusion: setQueryInclusion,
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
      /* Nach aussen sichtbar, damit die Proben MESSEN koennen statt den
       * Quelltext zu lesen — ein Waechter auf eine Zeile misst nicht, ob sie
       * gerufen wird. */
      get lang() { return sprache(); },
      get langKeys() { return Object.keys(TEXTE.en).length; },
      get allowedOrigins() { return allowedOrigins.slice(); },
      // Strang A2: nur ob der Richter-Pfad opt-in konfiguriert ist — NIE der
      // Schlüssel selbst (RAM-only, kein Leak über die Read-Fläche).
      get queryJudgeConfigured() {
        return !!(queryJudge && typeof queryJudge.apiKey === "string" && queryJudge.apiKey.length > 0);
      },
      // Ist der Inklusions-Pfad an? Und mit wie vielen Fachworten? Die Karte
      // selbst wird NICHT herausgegeben — nur ihre Größe, damit eine Probe
      // (und Klaus' Sichttest) sehen kann, ob die App sie gesetzt hat.
      get queryInclusionConfigured() {
        return !!queryInclusion;
      },
      get queryInclusionSynonymCount() {
        var s = queryInclusion && queryInclusion.synonyms;
        return (s && typeof s === "object") ? Object.keys(s).length : 0;
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
      // Sub (e), Pflege 2026-08-01: der Klartext zu einem Eintrag. Offen
      // gelegt, damit eine Anzeige ihn übernehmen kann statt ihn nachzubauen —
      // und damit prüfbar ist, dass er wirklich sagt, wer wann was wollte.
      erklaerung: entryErklaerung,
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
      "MODUL 15 MEMBRAN bereit, Funktionen: init/read/setQueryJudge/setQueryInclusion/fremdzugriff.{list,subscribe,clear,_recordForTest}",
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
