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

  // --- Bau 24.R: REINIGUNG VOR DEM SENDEN (Klaus 2026-10-14) ---
  // Bis hierher ging die ORIGINALDATEI an Mistral/Google: ein Foto samt EXIF
  // (Kamera, Ort), ein PDF samt Text, den man auf der Seite nicht sieht.
  // Jetzt, wie in den Rezeptbüchern und Workflow PDF:
  //   · Foto → JPEG: die Bildpunkte gehen 1:1 hinaus, nur die Metadaten-Abschnitte
  //     (WFP.Reinigung.jpegOhneMeta) und alles hinter dem Bildende werden
  //     abgeschnitten (Klaus: „nur das Bösartige neu, den Rest 1:1"). Andere
  //     Formate (oder ohne Reinigung) → in VOLLER Größe neu gezeichnet (bis
  //     BILD_MAX_KANTE), PNG bleibt verlustfrei PNG. Nicht lesbar: NICHTS geht hinaus.
  //   · PDF  → jede Seite (höchstens PDF_SEITEN_MAX) mit pdf.js GEZEICHNET — mit
  //     300 dpi nach der echten Seitengröße, JPEG 92 % (gemessen 2026-10-14:
  //     kleine, blassgraue Schrift — 1400 px/JPEG 85 % las 9 von 20 Zeilen falsch,
  //     300 dpi 0 von 20; PNG brachte nichts und wog beim Scan das Fünffache),
  //     versteckter Text in der Kopie zugedeckt (WFP.Reinigung, byte-1:1 aus
  //     Workflow PDF), Metadaten heraus. pdf.js und die Reinigung kommen von
  //     /Workflow-PDF/ (gleiche Adresse auf github.io — Klaus: „wie die
  //     Rezeptbücher"). Sind sie nicht ladbar: NICHTS geht hinaus, und das steht da.
  //   · Der erkannte Text geht durch die Prüfliste (window.PrueferMail): eine
  //     Anweisung an eine KI wird gemeldet (kiAnweisung), der Aufrufer hält einmal an.
  // ⚠ Grenzen: Text über einem Foto / über sichtbarer Schrift bleibt · schräger
  //   Text wird nicht beurteilt · nur die ersten 10 PDF-Seiten gehen hinaus (gesagt).
  var BILD_MAX_KANTE = 6000;     // nur gegen Riesenbilder; ein Handyfoto bleibt unverkleinert
  var PDF_SEITEN_MAX = 10;
  var PDF_DPI = 300;
  var PDF_MAX_KANTE = 5000;      // A3 bei 300 dpi = 4961 px; darüber (Plakate) wird gedeckelt
  var JPEG_GUETE = 0.92;
  var PNG_MAX_BYTES = 8 * 1024 * 1024;   // ein größeres PNG geht als JPEG 92 % hinaus
  var PFADE_VORGABE = { pdfjs: "/Workflow-PDF/vendor/pdfjs/", reinigung: "/Workflow-PDF/assets/reinigung.js" };
  var _pfade = { pdfjs: PFADE_VORGABE.pdfjs, reinigung: PFADE_VORGABE.reinigung };
  var TEXT_SPERRT = ["KI-ANWEISUNG", "UNSICHTBARE-ZEICHEN", "VERSTECKTER-TEXT"];

  function nichtGesendet(providerId, grund) {
    return { available: false, provider: providerId, reason: grund + " — es wurde nichts gesendet.", nichtsGesendet: true };
  }
  function skriptLaden(src) {
    return new Promise(function (ok, nein) {
      var d = global.document;
      if (!d || !d.createElement) { nein(new Error("kein Browser")); return; }
      var el = d.createElement("script");
      el.src = src; el.async = false;
      el.onload = function () { ok(); };
      el.onerror = function () { nein(new Error("lädt nicht: " + src)); };
      (d.head || d.documentElement).appendChild(el);
    });
  }
  function absolut(pfad) {
    try { return new URL(pfad, global.location && global.location.href).href; } catch (e) { return pfad; }
  }
  async function reinigungLaden() {
    if (!(global.WFP && global.WFP.Reinigung)) await skriptLaden(absolut(_pfade.reinigung));
    if (!(global.WFP && global.WFP.Reinigung)) throw new Error("Reinigung fehlt");
    return global.WFP.Reinigung;
  }
  async function pdfjsLaden() {
    if (!global.pdfjsLib) {
      var basis = absolut(_pfade.pdfjs);
      await skriptLaden(basis + "pdf.min.js");
      if (!global.pdfjsLib) throw new Error("pdf.js meldet sich nicht");
      global.pdfjsLib.GlobalWorkerOptions.workerSrc = basis + "pdf.worker.min.js";
    }
    return global.pdfjsLib;
  }
  function b64ZuBytes(b64) {
    var bin = global.atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function kannZeichnen() {
    return typeof global.createImageBitmap === "function" && !!(global.document && global.document.createElement) &&
      typeof global.atob === "function" && typeof global.Blob === "function";
  }
  function bytesZuB64(u8) {
    var str = "";
    for (var i = 0; i < u8.length; i += 0x8000) str += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return global.btoa(str);
  }
  // Ende des JPEG: das erste FF D9 nach dem ersten Bilddaten-Abschnitt (FF DA).
  // In den Bilddaten ist jedes FF gestopft (FF 00) oder ein Neustart (FF D0–D7),
  // ein FF D9 dort ist also das Bildende. -1 = nicht gefunden.
  function jpegEnde(u8) {
    var i = 2;
    while (i + 4 <= u8.length && u8[i] === 0xFF && u8[i + 1] !== 0xDA) {
      var m = u8[i + 1];
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      i += 2 + ((u8[i + 2] << 8) | u8[i + 3]);
    }
    for (var k = i; k + 1 < u8.length; k++) if (u8[k] === 0xFF && u8[k + 1] === 0xD9) return k + 2;
    return -1;
  }
  // JPEG 1:1: Metadaten-Abschnitte und Angehängtes weg, Bildpunkte unverändert.
  // → null, wenn das JPEG dafür nicht sauber zu zerlegen ist (dann wird gezeichnet).
  function jpegEinsZuEins(RE, u8) {
    var r = RE.jpegOhneMeta(u8);
    if (!r || !r.geprueft) return null;
    var ende = jpegEnde(r.bytes);
    if (ende < 0) return null;
    var liste = (r.entfernt || []).map(function (e) { return { seite: null, text: e.art + " (" + e.bytes + " Byte)", grund: "meta" }; });
    var bytes = r.bytes;
    if (ende < bytes.length) {
      liste.push({ seite: null, text: "Angehängtes hinter dem Bildende (" + (bytes.length - ende) + " Byte)", grund: "meta" });
      bytes = bytes.subarray(0, ende);
    }
    return { bilder: [bytesZuB64(bytes)], mime: "image/jpeg", liste: liste, seiten: 1, gesamt: 1, einsZuEins: true };
  }
  // Foto reinigen. Wirft, wenn das Bild nicht dekodierbar ist (dann geht nichts hinaus).
  async function bildReinigen(b64, mime) {
    var u8 = b64ZuBytes(b64);
    if (u8.length > 3 && u8[0] === 0xFF && u8[1] === 0xD8) {
      var RE = null;
      try { RE = await reinigungLaden(); } catch (e) { RE = null; }   // ohne Reinigung: neu zeichnen
      var eins = RE ? jpegEinsZuEins(RE, u8) : null;
      if (eins) return eins;
    }
    var bild;
    try { bild = await global.createImageBitmap(new global.Blob([u8], { type: mime || "image/png" })); }
    catch (e) { throw new Error("Das Bild lässt sich hier nicht lesen"); }
    var f = Math.min(1, BILD_MAX_KANTE / Math.max(bild.width, bild.height));
    var c = global.document.createElement("canvas");
    c.width = Math.max(1, Math.round(bild.width * f)); c.height = Math.max(1, Math.round(bild.height * f));
    var x = c.getContext("2d");
    var png = /png$/i.test(mime || "");
    if (!png) { x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); }
    x.drawImage(bild, 0, 0, c.width, c.height);
    if (bild.close) bild.close();
    var url = png ? c.toDataURL("image/png") : "";
    var ausMime = "image/png";
    if (!png || url.length * 0.75 > PNG_MAX_BYTES) { url = c.toDataURL("image/jpeg", JPEG_GUETE); ausMime = "image/jpeg"; }
    c.width = c.height = 0;
    return { bilder: [url.slice(url.indexOf(",") + 1)], mime: ausMime, liste: [], seiten: 1, gesamt: 1, einsZuEins: false };
  }
  // PDF als gereinigte Seitenbilder.
  async function pdfReinigen(b64) {
    var RE = await reinigungLaden();
    var L = await pdfjsLaden();
    // ⚠ isEvalSupported:false — pdf.js 3.x konnte mit einer präparierten Schrift Code ausführen (CVE-2024-4367).
    var pdf = await L.getDocument({ data: b64ZuBytes(b64), isEvalSupported: false }).promise;
    var n = Math.min(pdf.numPages, PDF_SEITEN_MAX), bilder = [], liste = [];
    for (var i = 1; i <= n; i++) {
      var p = await pdf.getPage(i);
      var v1 = p.getViewport({ scale: 1 });
      // 300 dpi nach der echten Seitengröße (1 pt = 1/72 Zoll), Riesenseiten gedeckelt.
      var vp = p.getViewport({ scale: Math.min(PDF_DPI / 72, PDF_MAX_KANTE / Math.max(v1.width, v1.height)) });
      var c = global.document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      var x = c.getContext("2d", { willReadFrequently: true });
      x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
      await p.render({ canvasContext: x, viewport: vp }).promise;
      var img = x.getImageData(0, 0, c.width, c.height);
      var tc = await p.getTextContent(), zu = 0;
      for (var k = 0; k < tc.items.length; k++) {
        var t = tc.items[k];
        if (!t.str || !t.str.trim()) continue;
        var tr = L.Util.transform(vp.transform, t.transform);
        if (Math.abs(Math.atan2(tr[1], tr[0])) > 0.05) continue;   // schräger Text: nicht beurteilt (Grenze)
        var st = { s: t.str, x: tr[4] / vp.scale, y: tr[5] / vp.scale, w: t.width, fh: Math.hypot(tr[2], tr[3]) / vp.scale };
        var g = RE.versteckt(st, img, vp.scale);
        if (g) { liste.push({ seite: i, text: t.str, grund: g }); RE.zudecken(img, st, vp.scale); zu++; }
      }
      if (zu) x.putImageData(img, 0, 0);
      var m = RE.datenAdresseOhneMeta(c.toDataURL("image/jpeg", JPEG_GUETE));
      bilder.push(m.url.slice(m.url.indexOf(",") + 1));
      c.width = c.height = 0;
      try { p.cleanup(); } catch (e) { /* egal */ }
    }
    var gesamt = pdf.numPages;
    try { pdf.destroy(); } catch (e) { /* egal */ }
    return { bilder: bilder, mime: "image/jpeg", liste: liste, seiten: n, gesamt: gesamt };
  }
  // Erkannten Text prüfen. → { geprueft, zeilen:[{zeile,kennung,inhalt}] }
  function textPruefen(text) {
    var L = global.PrueferMail;
    if (!L || typeof L.pruefeMail !== "function") return { geprueft: false, zeilen: [] };
    var r;
    try { r = L.pruefeMail(String(text || "")); }
    catch (e) { return { geprueft: false, zeilen: [] }; }
    var basis = String((r && r.text) || "").split("\n"), out = [];
    ((r && r.stellen) || []).forEach(function (st) {
      if (TEXT_SPERRT.indexOf(st.kennung) === -1) return;
      out.push({ zeile: st.zeile, kennung: st.kennung, inhalt: basis[(st.zeile || 1) - 1] || "" });
    });
    return { geprueft: true, zeilen: out };
  }
  // Nimmt die gemeldeten Zeilen heraus (über ihren INHALT, nicht die Nummer —
  // die Prüfliste zählt über ihren eigenen Text).
  function ohneZeilen(text, zeilen) {
    var weg = (zeilen || []).map(function (z) { return String(z.inhalt || "").trim(); })
      .filter(function (s) { return s.length > 0; });
    if (!weg.length) return String(text || "");
    return String(text || "").split("\n").filter(function (l) {
      return weg.indexOf(l.trim()) === -1;
    }).join("\n");
  }

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
  // Putzt den Markdown-Rausch aus OCR-Text (Mistral OCR liefert Markdown):
  //   - Bild-Platzhalter ![alt](url)  -> weg (verweisen auf nichts Lesbares)
  //   - Link [Text](url)              -> nur der Text bleibt
  //   - Überschriften-Marker ## Titel -> Titel (am Zeilenanfang)
  //   - Mehrfach-Leerraum/Leerzeilen zusammengezogen
  // Der eigentliche Text bleibt vollständig. Fail-soft: Nicht-Strings unberührt.
  // Google/Browser liefern Klartext -> hier praktisch No-Op (kein Markdown).
  function cleanOcrText(text) {
    if (!text || typeof text !== "string") return text || "";
    return text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")          // Bild-Platzhalter raus
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")        // Link -> nur Text
      .replace(/(^|\n)[ \t]{0,3}#{1,6}[ \t]+/g, "$1") // Überschriften-Marker weg
      .replace(/[ \t]{2,}/g, " ")                      // Mehrfach-Space -> 1
      .replace(/\n{3,}/g, "\n\n")                      // >2 Leerzeilen -> 2
      .trim();
  }

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

    // Bau 24.R: erst reinigen, dann senden. Nie das Original.
    if (!kannZeichnen()) {
      return nichtGesendet(providerId, "Hier kann das Bild nicht neu gezeichnet werden (kein Browser)");
    }
    var sauber;
    if (/pdf$/i.test(mime)) {
      try { sauber = await pdfReinigen(b64); }
      catch (e) {
        return nichtGesendet(providerId, /Reinigung fehlt|pdf\.js|lädt nicht/.test(String(e && e.message))
          ? "Ein PDF kann hier nicht gereinigt werden (PDF-Leser von Workflow PDF nicht erreichbar)"
          : "Das PDF lässt sich hier nicht lesen");
      }
    } else {
      try { sauber = await bildReinigen(b64, mime); }
      catch (e) { return nichtGesendet(providerId, (e && e.message) || "Das Bild lässt sich hier nicht lesen"); }
    }
    var versteckt = sauber.liste.filter(function (e) { return e.grund !== "meta"; });
    if (versteckt.length && typeof options.onVersteckt === "function") {
      var weiter = false;
      try { weiter = await options.onVersteckt(versteckt); } catch (e) { weiter = false; }
      if (!weiter) return { available: false, provider: providerId, reason: "Abgebrochen — es wurde nichts gesendet.", nichtsGesendet: true, abgebrochen: true };
    }

    var texte = [], usedModel = null;
    for (var si = 0; si < sauber.bilder.length; si++) {
      var req = provider.build(sauber.bilder[si], sauber.mime || "image/jpeg", options);
      var controller = (typeof AbortController === "function") ? new AbortController() : null;
      var timer = controller
        ? setTimeout(function () { controller.abort(); }, options.timeoutMs || OCR_TIMEOUT_MS)
        : null;
      try {
        if (controller) req.init.signal = controller.signal;
        if (typeof options.onSeite === "function" && sauber.bilder.length > 1) {
          try { options.onSeite(si + 1, sauber.bilder.length); } catch (e) { /* Anzeige */ }
        }
        var res = await global.fetch(req.url, req.init);
        if (timer) clearTimeout(timer);
        if (!res || !res.ok) {
          return { available: false, provider: providerId, reason: "Texterkennung HTTP " + (res ? res.status : "?") + " — bitte tippen." };
        }
        var data = await res.json();
        texte.push(cleanOcrText(provider.extract(data)));
        // Tatsächlich benutzte Modell-Version aus der API-Antwort (Mistral OCR
        // liefert das datierte Modell, z.B. "mistral-ocr-2505") — sichtbar machen,
        // damit klar ist, welche Version lief. Fällt auf die angeforderte Version
        // zurück (mistral-ocr-latest), wenn die Antwort keine nennt.
        if (!usedModel) {
          usedModel = (data && typeof data.model === "string" && data.model)
            ? data.model
            : (providerId === "mistral" ? (options.model || MISTRAL_DEFAULT_MODEL) : null);
        }
      } catch (e) {
        if (timer) clearTimeout(timer);
        return { available: false, provider: providerId, reason: ocrErrorHint(e) };
      }
    }
    var text = texte.filter(function (t) { return t; }).join("\n\n");
    var pr = textPruefen(text);
    return {
      available: true, provider: providerId, text: text, model: usedModel,
      entfernt: sauber.liste, seiten: sauber.seiten, gesamt: sauber.gesamt,
      textGeprueft: pr.geprueft, kiAnweisung: pr.zeilen,
    };
  }

  function init(config) {
    config = config || {};
    if (config.euPolicy !== undefined && config.euPolicy !== null) {
      _euPolicy = normalizeEuPolicy(config.euPolicy);
    }
    if (config.pfade && typeof config.pfade === "object") {
      if (typeof config.pfade.pdfjs === "string" && config.pfade.pdfjs) _pfade.pdfjs = config.pfade.pdfjs;
      if (typeof config.pfade.reinigung === "string" && config.pfade.reinigung) _pfade.reinigung = config.pfade.reinigung;
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
    cleanOcrText: cleanOcrText,
    textPruefen: textPruefen,
    ohneZeilen: ohneZeilen,
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
      // Bau 24.R Reinigung vor dem Senden (Klaus 2026-10-14) Read-Anker.
      bildMaxKante: BILD_MAX_KANTE,
      pdfSeitenMax: PDF_SEITEN_MAX,
      pdfDpi: PDF_DPI,
      pdfMaxKante: PDF_MAX_KANTE,
      jpegGuete: JPEG_GUETE,
      pfadeVorgabe: { pdfjs: PFADE_VORGABE.pdfjs, reinigung: PFADE_VORGABE.reinigung },
      get pfade() { return { pdfjs: _pfade.pdfjs, reinigung: _pfade.reinigung }; },
      textSperrt: TEXT_SPERRT.slice(),
      reinigungNote: "recognize sendet nie das Original: ein JPEG geht mit unveränderten Bildpunkten ohne Metadaten und ohne Angehängtes hinaus, andere Fotos neu gezeichnet in voller Größe, ein PDF als gereinigte Seitenbilder mit 300 dpi über pdf.js + WFP.Reinigung von /Workflow-PDF/ (höchstens 10 Seiten). Geht das nicht, wird nichts gesendet. Versteckter Text → options.onVersteckt(liste) (false = abbrechen). Der erkannte Text geht durch window.PrueferMail → kiAnweisung.",
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
