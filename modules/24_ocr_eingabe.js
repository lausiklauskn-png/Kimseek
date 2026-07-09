/*
 * SBKIM — Modul 24 — OCR-/Bild-Eingabe (image / handwriting → text)
 *
 * Eine input-agnostische Bild-Eingabe-Schicht für das SBKIM-Such-Werkzeug —
 * Geschwister von Modul 21 (Spracheingabe). Sie liefert nur Text; die eigentliche
 * Suche (Modul 03 Embedding + Modul 04 queryLocal/hybridMatch) bleibt unberührt.
 * Muster 1:1 wie Modul 21: input-agnostisch, fail-soft, Anbieter-steckbar, BYOK,
 * EU-Politik per Knoten.
 *
 * Drei umschaltbare Anbieter (kein Bundler, kein Laufzeit-CDN):
 *   - mistral : Mistral OCR (mistral-ocr-latest), EU (Frankreich), BYOK. FAVORIT.
 *   - google  : Google Cloud Vision, EU-Endpunkt (eu-vision.googleapis.com), BYOK.
 *   - browser : Shape Detection API (TextDetector), experimentell, keine EU-Garantie.
 *
 * EU-Politik (per Knoten konfigurierbar, wie Modul 21):
 *   - "bindend" : nur EU-Anbieter erlaubt (mistral/google) — z.B. BookLedgerPro.
 *   - "frei"    : alle Anbieter, EU als WÄHLBARE Option (Default für Sage /
 *                 Mein-Mixarium / Mein-Rezeptbuch).
 *
 * Konsequent fail-soft: kein Schlüssel / kein Bild / Netz weg / HTTP-Fehler →
 * klarer deutscher Hinweis ({ available:false, reason }), NIE ein Throw (außer
 * InvalidEuPolicyError bei klarer Aufrufer-Konfig). Das Textfeld bleibt nutzbar.
 * Kosten unkritisch (~2–4 $/1000 Seiten). Kein Schlüssel im Code.
 *
 * Public surface (registered on window.SbkimOcr):
 *   init(config?) -> meta                              (setzt euPolicy)
 *   getProviders() -> Array<{id,label,region,needsKey}>
 *   availableProviders(euPolicy?) -> Array<id>
 *   pickProvider(euPolicy?, preferred?) -> id | null
 *   isFileSupported(mimeType) -> boolean
 *   isBrowserOcrSupported() -> boolean
 *   recognize(image, options?) -> Promise<{ available, text|reason, provider }>
 *   recognizeBrowser(image, options?) -> Promise<{ available, text|reason }>
 *   ocrErrorHint(err) -> string (deutsch, user-facing)
 *   InvalidEuPolicyError -> ErrorFactory (sync throw bei klarer Aufrufer-Konfig)
 *
 * Self-check: emits a console.info line on script load (synchronous).
 * Spec: docs/components/24_ocr_eingabe.md.
 */
(function (global) {
  "use strict";

  // --- Konstanten ---
  var EU_POLICIES = ["bindend", "frei"];
  var EU_POLICY_DEFAULT = "frei";
  var FAVORITE_PROVIDER = "mistral"; // Klaus' Favorit (Brief 2026-07-01).

  var MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";
  var MISTRAL_DEFAULT_MODEL = "mistral-ocr-latest";
  var GOOGLE_EU_VISION_URL = "https://eu-vision.googleapis.com/v1/images:annotate";
  var OCR_TIMEOUT_MS = 30000;

  // Vom Anbieter unterstützte Bild-/Dokument-Typen (Mistral kann auch PDF).
  var SUPPORTED_MIME = [
    "image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "application/pdf",
  ];

  // Laufzeit-Konfig (über init gesetzt).
  var _euPolicy = EU_POLICY_DEFAULT;

  function makeError(name, message, cause) {
    var e = new Error(message);
    e.name = name;
    if (cause !== undefined) e.cause = cause;
    return e;
  }
  function InvalidEuPolicyError(message) {
    return makeError("InvalidEuPolicyError", message);
  }

  function normalizeEuPolicy(p) {
    if (p === undefined || p === null) return _euPolicy;
    if (EU_POLICIES.indexOf(p) === -1) {
      throw InvalidEuPolicyError(
        "euPolicy muss 'bindend' oder 'frei' sein, war: " + JSON.stringify(p),
      );
    }
    return p;
  }

  // --- Anbieter-Abstraktion (analog Modul 04 HYBRID_PROVIDERS) ---
  var PROVIDERS = {
    mistral: {
      id: "mistral", label: "Mistral OCR (EU)", region: "eu", needsKey: true,
      build: function (b64, mime, opts) {
        return {
          url: MISTRAL_OCR_URL,
          init: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + opts.apiKey,
            },
            body: JSON.stringify({
              model: opts.model || MISTRAL_DEFAULT_MODEL,
              document: {
                type: "image_url",
                image_url: "data:" + (mime || "image/png") + ";base64," + b64,
              },
            }),
          },
        };
      },
      extract: function (data) {
        // Mistral OCR liefert { pages: [{ markdown | text }] }.
        if (data && Array.isArray(data.pages)) {
          return data.pages.map(function (p) {
            return (p && (p.markdown || p.text)) || "";
          }).join("\n\n").trim();
        }
        if (data && typeof data.text === "string") return data.text.trim();
        return "";
      },
    },
    google: {
      id: "google", label: "Google Vision (EU-Endpunkt)", region: "eu", needsKey: true,
      build: function (b64, mime, opts) {
        return {
          url: GOOGLE_EU_VISION_URL + "?key=" + encodeURIComponent(opts.apiKey),
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: [{
                image: { content: b64 },
                features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
              }],
            }),
          },
        };
      },
      extract: function (data) {
        if (data && Array.isArray(data.responses) && data.responses[0]) {
          var r0 = data.responses[0];
          if (r0.fullTextAnnotation && typeof r0.fullTextAnnotation.text === "string") {
            return r0.fullTextAnnotation.text.trim();
          }
          if (Array.isArray(r0.textAnnotations) && r0.textAnnotations[0]) {
            return String(r0.textAnnotations[0].description || "").trim();
          }
        }
        return "";
      },
    },
    browser: {
      id: "browser", label: "Browser (Shape Detection, experimentell)", region: "browser", needsKey: false,
    },
  };

  function getProviders() {
    return Object.keys(PROVIDERS).map(function (id) {
      var p = PROVIDERS[id];
      return { id: p.id, label: p.label, region: p.region, needsKey: !!p.needsKey };
    });
  }

  // "bindend" → nur EU-Anbieter (browser ohne EU-Residenz raus).
  // "frei"    → alle Anbieter.
  function availableProviders(euPolicy) {
    var p = normalizeEuPolicy(euPolicy);
    return Object.keys(PROVIDERS).filter(function (id) {
      return p === "bindend" ? PROVIDERS[id].region === "eu" : true;
    });
  }

  // Favorit zuerst (mistral), sonst erster erlaubter. preferred gewinnt, wenn erlaubt.
  function pickProvider(euPolicy, preferred) {
    var allowed = availableProviders(euPolicy);
    if (preferred && allowed.indexOf(preferred) !== -1) return preferred;
    if (allowed.indexOf(FAVORITE_PROVIDER) !== -1) return FAVORITE_PROVIDER;
    return allowed.length ? allowed[0] : null;
  }

  function isFileSupported(mimeType) {
    if (typeof mimeType !== "string") return false;
    return SUPPORTED_MIME.indexOf(mimeType.toLowerCase()) !== -1;
  }

  function isBrowserOcrSupported() {
    return typeof global.TextDetector === "function";
  }

  // Akzeptiert base64-String, data-URL oder { content, mimeType }.
  function toBase64Image(image) {
    if (typeof image === "string") {
      var comma = image.indexOf(",");
      if (image.indexOf("data:") === 0 && comma !== -1) return image.slice(comma + 1);
      return image;
    }
    if (image && typeof image.content === "string") {
      var c = image.content;
      var cm = c.indexOf(",");
      if (c.indexOf("data:") === 0 && cm !== -1) return c.slice(cm + 1);
      return c;
    }
    return null;
  }

  function mimeOf(image, options) {
    if (options && typeof options.mimeType === "string") return options.mimeType;
    if (image && typeof image.mimeType === "string") return image.mimeType;
    if (typeof image === "string" && image.indexOf("data:") === 0) {
      var m = image.slice(5).split(";")[0];
      if (m) return m;
    }
    return "image/png";
  }

  // Bekannte Fehler-Formen → ruhiger deutscher Hinweis. Wirft nie.
  function ocrErrorHint(err) {
    var name = err && err.name ? String(err.name) : "";
    var msg = err && err.message ? String(err.message)
      : (typeof err === "string" ? err : "");
    if (name === "AbortError") {
      return "Texterkennung hat zu lange gedauert — bitte nochmal oder tippen.";
    }
    if (/network|fetch|ENOTFOUND|failed to fetch/i.test(msg) || name === "TypeError") {
      return "Netz nicht erreichbar — Texterkennung gerade nicht möglich, bitte tippen.";
    }
    if (/401|403|unauthor|forbidden|api key|invalid.*key/i.test(msg)) {
      return "Schlüssel fehlt oder ist ungültig — bitte prüfen oder tippen.";
    }
    if (/429|rate/i.test(msg)) {
      return "Zu viele Anfragen — kurz warten und nochmal, oder tippen.";
    }
    return "Texterkennung gerade nicht möglich — du kannst tippen.";
  }

  // Browser-only: Shape Detection API (experimentell). Fail-soft, wenn nicht
  // verfügbar. Erwartet ein detektierbares Objekt (Blob/ImageBitmap/…) in
  // options.source ODER image (wenn kein String).
  async function recognizeBrowser(image, options) {
    options = options || {};
    if (!isBrowserOcrSupported()) {
      return { available: false, reason: "Browser-Texterkennung nicht verfügbar — bitte tippen." };
    }
    var source = options.source || (typeof image !== "string" && image && image.content === undefined ? image : null);
    if (!source) {
      return { available: false, reason: "Kein Bild-Objekt für die Browser-Erkennung übergeben (options.source)." };
    }
    try {
      var detector = new global.TextDetector();
      var blocks = await detector.detect(source);
      var text = Array.isArray(blocks)
        ? blocks.map(function (b) { return (b && b.rawValue) || ""; }).join("\n").trim()
        : "";
      return { available: true, text: text };
    } catch (e) {
      return { available: false, reason: ocrErrorHint(e) };
    }
  }

  // Kern: OCR über den gewählten (oder Politik-Default-) Anbieter. Fail-soft.
  async function recognize(image, options) {
    options = options || {};
    var euPolicy = normalizeEuPolicy(options.euPolicy); // sync throw nur bei Unfug
    var allowed = availableProviders(euPolicy);
    var providerId = options.provider || pickProvider(euPolicy, options.provider);
    if (!providerId || allowed.indexOf(providerId) === -1) {
      return {
        available: false, provider: providerId || null,
        reason: providerId
          ? ("Anbieter '" + providerId + "' bei EU-Politik '" + euPolicy + "' nicht erlaubt — bitte tippen.")
          : "Kein OCR-Anbieter verfügbar — bitte tippen.",
      };
    }
    var provider = PROVIDERS[providerId];

    if (providerId === "browser") {
      var br = await recognizeBrowser(image, options);
      br.provider = "browser";
      return br;
    }

    if (provider.needsKey && (!options.apiKey || typeof options.apiKey !== "string")) {
      return { available: false, provider: providerId, reason: "Kein Schlüssel hinterlegt — Texterkennung (" + provider.label + ") deaktiviert." };
    }
    var b64 = toBase64Image(image);
    if (!b64) {
      return { available: false, provider: providerId, reason: "Keine Bild-Daten (base64) übergeben." };
    }
    var mime = mimeOf(image, options);
    if (options.enforceMime === true && !isFileSupported(mime)) {
      return { available: false, provider: providerId, reason: "Dateityp '" + mime + "' wird nicht unterstützt." };
    }

    var req = provider.build(b64, mime, options);
    var controller = (typeof AbortController === "function") ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, options.timeoutMs || OCR_TIMEOUT_MS)
      : null;
    try {
      if (controller) req.init.signal = controller.signal;
      var res = await global.fetch(req.url, req.init);
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) {
        return { available: false, provider: providerId, reason: "Texterkennung HTTP " + (res ? res.status : "?") + " — bitte tippen." };
      }
      var data = await res.json();
      var text = provider.extract(data);
      // Tatsächlich benutzte Modell-Version aus der API-Antwort (Mistral OCR
      // liefert das datierte Modell, z.B. "mistral-ocr-2505") — sichtbar machen,
      // damit klar ist, welche Version lief. Fällt auf die angeforderte Version
      // zurück (mistral-ocr-latest), wenn die Antwort keine nennt.
      var usedModel = (data && typeof data.model === "string" && data.model)
        ? data.model
        : (providerId === "mistral" ? (options.model || MISTRAL_DEFAULT_MODEL) : null);
      return { available: true, provider: providerId, text: text, model: usedModel };
    } catch (e) {
      if (timer) clearTimeout(timer);
      return { available: false, provider: providerId, reason: ocrErrorHint(e) };
    }
  }

  function init(config) {
    config = config || {};
    if (config.euPolicy !== undefined && config.euPolicy !== null) {
      _euPolicy = normalizeEuPolicy(config.euPolicy);
    }
    return SbkimOcr._meta;
  }

  var SbkimOcr = {
    init: init,
    getProviders: getProviders,
    availableProviders: availableProviders,
    pickProvider: pickProvider,
    isFileSupported: isFileSupported,
    isBrowserOcrSupported: isBrowserOcrSupported,
    recognize: recognize,
    recognizeBrowser: recognizeBrowser,
    ocrErrorHint: ocrErrorHint,
    InvalidEuPolicyError: InvalidEuPolicyError,
    _meta: {
      providers: getProviders(),
      favoriteProvider: FAVORITE_PROVIDER,
      euPolicies: EU_POLICIES.slice(),
      get euPolicy() { return _euPolicy; },
      euPolicyDefault: EU_POLICY_DEFAULT,
      supportedMime: SUPPORTED_MIME.slice(),
      mistralOcrUrl: MISTRAL_OCR_URL,
      mistralDefaultModel: MISTRAL_DEFAULT_MODEL,
      googleEuVisionUrl: GOOGLE_EU_VISION_URL,
      ocrTimeoutMs: OCR_TIMEOUT_MS,
    },
  };

  global.SbkimOcr = SbkimOcr;

  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 24 OCR-EINGABE bereit, Funktionen: getProviders/availableProviders/pickProvider/" +
        "isFileSupported/recognize/recognizeBrowser/ocrErrorHint, Favorit: " + FAVORITE_PROVIDER +
        ", EU-Politik-Default: " + EU_POLICY_DEFAULT + ", Anbieter: " + Object.keys(PROVIDERS).length,
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
