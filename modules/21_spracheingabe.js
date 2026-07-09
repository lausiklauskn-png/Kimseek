/*
 * SBKIM — Modul 21 — Spracheingabe (Speech input)
 *
 * Eine input-agnostische Sprach-Eingabe-Schicht für das SBKIM-Such-Werkzeug.
 * Sie liefert nur Text — die eigentliche Suche (Modul 03 Embedding + Modul 04
 * queryLocal/hybridMatch) bleibt unberührt. Nachbau des BookLedgerPro-Musters
 * (SIGNAL seq 15, docs/SBKIM-SUCHE-MUSTER.md), als Sage-native Umsetzung nach
 * dem Vertrag — siehe Observatorium-Werkstatt Lehre 1 (Interop ist Vertrag,
 * nicht Kopie).
 *
 * Zwei umschaltbare Engines (kein Bundler, kein Laufzeit-CDN):
 *   - browser : Web Speech API (sofort; Audio geht an den Browser-Hersteller,
 *               keine EU-Residenz-Garantie — offengelegt).
 *   - eu      : Google Cloud Speech-to-Text, EU-Endpunkt (BYOK, Schlüssel
 *               liegt verschlüsselt beim Aufrufer; opt-in, EU-Datenresidenz).
 *
 * EU-Politik (per Knoten konfigurierbar, Klaus' Festlegung 2026-06-21):
 *   - "bindend" : nur die EU-Engine ist erlaubt (z.B. BookLedgerPro).
 *   - "frei"    : beide Engines, EU als WÄHLBARE Option (Default für
 *                 Sage / Mein-Mixarium / Mein-Rezeptbuch).
 *
 * Konsequent fail-soft: fehlendes Mikrofon / kein Schlüssel / Netz weg →
 * klarer deutscher Hinweis, NIE ein Throw. Das Textfeld bleibt immer nutzbar.
 *
 * Public surface (registered on window.SbkimSpeech):
 *   init(config?) -> meta                          (setzt euPolicy)
 *   getLanguages() -> Array<[code, label]>
 *   alternativeCodes(selectedCode) -> Array<code>
 *   availableEngines(euPolicy?) -> Array<"browser"|"eu">
 *   pickEngine(euPolicy?, preferred?) -> engineId | null
 *   isBrowserSupported() -> boolean
 *   makeBrowserRecognizer(opts) -> { supported, start, stop, ... }
 *   startRecording(options?) -> Promise<{ available, stop()|reason }>
 *   recognizeEU(audio, options) -> Promise<{ available, transcript|reason }>
 *   speechErrorHint(err) -> string (deutsch, user-facing)
 *   InvalidEuPolicyError -> ErrorFactory (sync throw bei klarer Aufrufer-Konfig)
 *
 * Self-check: emits a console.info line on script load (synchronous).
 * Spec: docs/components/21_such_werkzeug.md (Folge-Karte).
 */
(function (global) {
  "use strict";

  // --- Konstanten ---
  // Array-getrieben, vom Knoten erweiterbar (BLP-Muster SPEECH_LANGS).
  var SPEECH_LANGS = [
    ["de-DE", "Deutsch"],
    ["en-US", "English"],
    ["ru-RU", "Русский"],
  ];
  var EU_POLICIES = ["bindend", "frei"];
  var EU_POLICY_DEFAULT = "frei"; // freie Knoten: EU wählbar, nicht erzwungen.
  var ENGINES = {
    browser: { id: "browser", label: "Browser (Web Speech)", region: "browser" },
    eu: { id: "eu", label: "EU Cloud Speech-to-Text", region: "eu" },
  };
  // EU-Regional-Endpunkt (BLP nutzt eu-speech.googleapis.com).
  var EU_SPEECH_URL = "https://eu-speech.googleapis.com/v1/speech:recognize";
  var EU_DEFAULT_ENCODING = "WEBM_OPUS";
  var EU_DEFAULT_SAMPLE_RATE = 48000;
  var EU_TIMEOUT_MS = 20000;

  // Laufzeit-Konfig (über init gesetzt).
  var _euPolicy = EU_POLICY_DEFAULT;

  function makeError(name, message, cause) {
    var e = new Error(message);
    e.name = name;
    if (cause !== undefined) e.cause = cause;
    return e;
  }
  // Sync throw nur bei klarem Aufrufer-Konfig-Fehler (ungültige euPolicy).
  function InvalidEuPolicyError(message) {
    return makeError("InvalidEuPolicyError", message);
  }

  // null/undefined → aktuelle Laufzeit-Politik (fail-soft). Ein gesetzter,
  // aber unbekannter Wert ist ein Aufrufer-Bug → sync throw.
  function normalizeEuPolicy(p) {
    if (p === undefined || p === null) return _euPolicy;
    if (EU_POLICIES.indexOf(p) === -1) {
      throw InvalidEuPolicyError(
        "euPolicy muss 'bindend' oder 'frei' sein, war: " + JSON.stringify(p),
      );
    }
    return p;
  }

  function getLanguages() {
    return SPEECH_LANGS.map(function (pair) { return pair.slice(); });
  }

  // Alle Sprach-Codes außer dem gewählten — für alternativeLanguageCodes
  // (EU-Engine, Sprach-Misch-Toleranz).
  function alternativeCodes(selectedCode) {
    return SPEECH_LANGS.map(function (pair) { return pair[0]; })
      .filter(function (code) { return code !== selectedCode; });
  }

  // "bindend" → nur EU (Browser-Engine ohne EU-Residenz-Garantie).
  // "frei"    → beide, Nutzer wählt.
  function availableEngines(euPolicy) {
    var p = normalizeEuPolicy(euPolicy);
    return p === "bindend" ? ["eu"] : ["browser", "eu"];
  }

  function pickEngine(euPolicy, preferred) {
    var allowed = availableEngines(euPolicy);
    if (preferred && allowed.indexOf(preferred) !== -1) return preferred;
    return allowed.length ? allowed[0] : null;
  }

  function isBrowserSupported() {
    return typeof global.SpeechRecognition === "function" ||
      typeof global.webkitSpeechRecognition === "function";
  }

  // Bekannte Fehler-Formen → ruhiger deutscher Hinweis. Wirft nie.
  function speechErrorHint(err) {
    var name = err && (err.name || err.error) ? (err.name || err.error) : "";
    var msg = err && err.message ? String(err.message)
      : (typeof err === "string" ? err : "");
    if (name === "not-allowed" || name === "NotAllowedError" ||
        /denied|permission/i.test(msg)) {
      return "Mikrofon-Zugriff nicht erlaubt — du kannst stattdessen tippen.";
    }
    if (name === "no-speech") {
      return "Nichts erkannt — bitte nochmal sprechen oder tippen.";
    }
    if (name === "audio-capture" || name === "NotFoundError") {
      return "Kein Mikrofon gefunden — du kannst stattdessen tippen.";
    }
    if (name === "AbortError") {
      return "Spracheingabe abgebrochen.";
    }
    if (name === "network" || /network|fetch|ENOTFOUND|failed/i.test(msg)) {
      return "Netz nicht erreichbar — Spracheingabe gerade nicht möglich, bitte tippen.";
    }
    return "Spracheingabe gerade nicht möglich — du kannst tippen.";
  }

  // Browser Web Speech API. Bei fehlendem Support fail-soft: ein Stub mit
  // supported:false, dessen start() nur den onError-Hinweis liefert.
  function makeBrowserRecognizer(opts) {
    opts = opts || {};
    var lang = opts.lang || SPEECH_LANGS[0][0];
    if (!isBrowserSupported()) {
      return {
        supported: false,
        reason: "Browser-Spracherkennung nicht verfügbar — bitte tippen.",
        start: function () {
          if (opts.onError) opts.onError("Browser-Spracherkennung nicht verfügbar — bitte tippen.");
        },
        stop: function () {},
      };
    }
    var Ctor = global.SpeechRecognition || global.webkitSpeechRecognition;
    var rec = new Ctor();
    rec.lang = lang;
    rec.continuous = !!opts.continuous;
    rec.interimResults = !!opts.interimResults;
    rec.maxAlternatives = 1;
    rec.onresult = function (ev) {
      try {
        var last = ev.results[ev.results.length - 1];
        var transcript = last[0].transcript;
        if (opts.onResult) opts.onResult(transcript);
      } catch (e) {
        if (opts.onError) opts.onError(speechErrorHint(e));
      }
    };
    rec.onerror = function (ev) { if (opts.onError) opts.onError(speechErrorHint(ev)); };
    rec.onend = function () { if (opts.onEnd) opts.onEnd(); };
    return {
      supported: true,
      recognition: rec,
      start: function () {
        try { rec.start(); }
        catch (e) { if (opts.onError) opts.onError(speechErrorHint(e)); }
      },
      stop: function () { try { rec.stop(); } catch (e) { /* idempotent */ } },
    };
  }

  // Akzeptiert base64-String direkt oder { content }.
  function toBase64Audio(audio) {
    if (typeof audio === "string") return audio;
    if (audio && typeof audio.content === "string") return audio.content;
    return null;
  }

  // EU Cloud Speech-to-Text (BYOK). Fail-soft: { available:false, reason }
  // statt Throw bei fehlendem Schlüssel / Audio / Netz / HTTP-Fehler.
  async function recognizeEU(audio, options) {
    options = options || {};
    var apiKey = options.apiKey;
    if (!apiKey || typeof apiKey !== "string") {
      return { available: false, reason: "Kein EU-Schlüssel hinterlegt — EU-Spracheingabe deaktiviert." };
    }
    var content = toBase64Audio(audio);
    if (!content) {
      return { available: false, reason: "Keine Audio-Daten (base64) übergeben." };
    }
    var languageCode = options.languageCode || SPEECH_LANGS[0][0];
    var altCodes = options.alternativeLanguageCodes || alternativeCodes(languageCode);
    var body = {
      config: {
        encoding: options.encoding || EU_DEFAULT_ENCODING,
        sampleRateHertz: options.sampleRateHertz || EU_DEFAULT_SAMPLE_RATE,
        languageCode: languageCode,
        alternativeLanguageCodes: altCodes,
        enableAutomaticPunctuation: options.enableAutomaticPunctuation !== false,
      },
      audio: { content: content },
    };
    var controller = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, options.timeoutMs || EU_TIMEOUT_MS)
      : null;
    try {
      var res = await global.fetch(EU_SPEECH_URL + "?key=" + encodeURIComponent(apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) {
        return { available: false, reason: "EU-Spracherkennung HTTP " + (res ? res.status : "?") + " — bitte tippen." };
      }
      var data = await res.json();
      var transcript = "";
      if (data && Array.isArray(data.results)) {
        transcript = data.results.map(function (r) {
          return (r && r.alternatives && r.alternatives[0] && r.alternatives[0].transcript) || "";
        }).join(" ").trim();
      }
      return { available: true, transcript: transcript };
    } catch (e) {
      if (timer) clearTimeout(timer);
      return { available: false, reason: speechErrorHint(e) };
    }
  }

  // Browser-only: Mikrofon-Audio für die EU-Engine aufnehmen. Fail-soft,
  // wenn kein Mikrofon / MediaRecorder vorhanden ist.
  async function startRecording(options) {
    options = options || {};
    var nav = global.navigator;
    if (!nav || !nav.mediaDevices ||
        typeof nav.mediaDevices.getUserMedia !== "function" ||
        typeof global.MediaRecorder === "undefined") {
      return { available: false, reason: "Aufnahme nicht verfügbar (kein Mikrofon-Zugriff) — bitte tippen." };
    }
    try {
      var stream = await nav.mediaDevices.getUserMedia({ audio: true });
      var chunks = [];
      var mr = new global.MediaRecorder(stream, options.recorderOptions || {});
      mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      mr.start();
      return {
        available: true,
        stop: function () {
          return new Promise(function (resolve) {
            mr.onstop = function () {
              try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* ignore */ }
              var blob = new global.Blob(chunks, { type: mr.mimeType || "audio/webm" });
              var reader = new global.FileReader();
              reader.onloadend = function () {
                var dataUrl = String(reader.result || "");
                var base64 = dataUrl.indexOf(",") !== -1 ? dataUrl.split(",")[1] : dataUrl;
                resolve({ available: true, content: base64, mimeType: blob.type });
              };
              reader.onerror = function () { resolve({ available: false, reason: "Audio konnte nicht gelesen werden." }); };
              reader.readAsDataURL(blob);
            };
            mr.stop();
          });
        },
      };
    } catch (e) {
      return { available: false, reason: speechErrorHint(e) };
    }
  }

  function init(config) {
    config = config || {};
    if (config.euPolicy !== undefined && config.euPolicy !== null) {
      _euPolicy = normalizeEuPolicy(config.euPolicy);
    }
    return SbkimSpeech._meta;
  }

  var SbkimSpeech = {
    init: init,
    getLanguages: getLanguages,
    alternativeCodes: alternativeCodes,
    availableEngines: availableEngines,
    pickEngine: pickEngine,
    isBrowserSupported: isBrowserSupported,
    makeBrowserRecognizer: makeBrowserRecognizer,
    startRecording: startRecording,
    recognizeEU: recognizeEU,
    speechErrorHint: speechErrorHint,
    InvalidEuPolicyError: InvalidEuPolicyError,
    _meta: {
      languages: SPEECH_LANGS.map(function (pair) { return pair.slice(); }),
      euPolicies: EU_POLICIES.slice(),
      get euPolicy() { return _euPolicy; },
      euPolicyDefault: EU_POLICY_DEFAULT,
      engines: Object.keys(ENGINES).map(function (id) {
        return { id: id, label: ENGINES[id].label, region: ENGINES[id].region };
      }),
      euSpeechUrl: EU_SPEECH_URL,
      euDefaultEncoding: EU_DEFAULT_ENCODING,
      euDefaultSampleRate: EU_DEFAULT_SAMPLE_RATE,
    },
  };

  global.SbkimSpeech = SbkimSpeech;

  // Self-check: emitted on script load (synchronous, no async load step).
  // Uniform format across all SBKIM modules — see INTERFACES.md.
  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 21 SPRACHEINGABE bereit, Funktionen: getLanguages/availableEngines/pickEngine/" +
        "makeBrowserRecognizer/startRecording/recognizeEU, EU-Politik-Default: " +
        EU_POLICY_DEFAULT + ", Sprachen: " + SPEECH_LANGS.length,
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
