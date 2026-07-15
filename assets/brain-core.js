/*
 * Kim-Brain — Kern-Logik (Company-Brain-Probeversion)
 *
 * DOM-frei, abhängigkeitsfrei, deterministisch → im Browser (brain.html) UND
 * headless (node --test) identisch nutzbar. Der Beweis läuft über `npm test`.
 *
 * Diese Datei enthält NUR reine Datentransformationen. Alles Umwelt-Abhängige
 * (IndexedDB, crypto.subtle-Hash, Datei-Lesen, PDF/OCR, das echte Embedding aus
 * Modul 03, der KI-Richter aus Modul 04) lebt in brain.html und ruft hier hinein.
 *
 * Öffentliche Fläche (registriert auf window.KimBrainCore):
 *   normalizeWhitespace(s) -> string
 *   makeSnippet(text, maxLen?) -> string
 *   parseEml(raw) -> { subject, from, to, date, body }
 *   emlToText(parsed) -> string
 *   guessType(name, mime?) -> "text" | "pdf" | "email" | "image" | "other"
 *   provisionalCategory(typ) -> string
 *   nameSearch(catalog, query) -> Array<entry>            // die Namenssuche (Baseline)
 *   cosine(a, b) -> number                                // lokaler Cosinus (Fallback/Test)
 *   rankByVector(catalog, queryVec, opts?) -> Array<{entry, score}>   // die Bedeutungssuche
 *   clusterCatalog(catalog, opts?) -> Array<{titel, mitglieder, anzahl, zentrumId}>
 *   topKeywords(texts, n?) -> Array<string>
 *   partitionByHash(existingHashes, incoming) -> { neu, uebersprungen }
 *
 * Datenvertrag (Steckbrief je Datei — siehe Brief):
 *   { id, hash, name, pfad, typ, groesse, datum, textSchnipsel, vektor,
 *     kiKurzfassung, vorschlagKategorie }
 */
(function (global) {
  "use strict";

  var META = { name: "KimBrainCore", version: "1", embDim: 384 };

  // ---- Text-Helfer ---------------------------------------------------------

  function normalizeWhitespace(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  }

  function makeSnippet(text, maxLen) {
    maxLen = typeof maxLen === "number" && maxLen > 0 ? maxLen : 600;
    var t = normalizeWhitespace(text);
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen).replace(/\s+\S*$/, "") + " …";
  }

  function cap(w) {
    if (!w) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  // ---- E-Mail (.eml) — minimaler Header/Body-Parser ------------------------

  function parseEml(raw) {
    var s = String(raw == null ? "" : raw).replace(/\r\n/g, "\n");
    var sep = s.indexOf("\n\n");
    var headPart = sep >= 0 ? s.slice(0, sep) : s;
    var body = sep >= 0 ? s.slice(sep + 2) : "";
    var headers = {};
    var lines = headPart.split("\n");
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (/^[ \t]/.test(ln) && cur) {
        headers[cur] += " " + ln.trim();
        continue;
      }
      var m = ln.match(/^([A-Za-z\-]+):[ \t]?(.*)$/);
      if (m) {
        cur = m[1].toLowerCase();
        headers[cur] = (headers[cur] ? headers[cur] + " " : "") + m[2];
      }
    }
    return {
      subject: headers.subject || "",
      from: headers.from || "",
      to: headers.to || "",
      date: headers.date || "",
      body: body.trim(),
    };
  }

  function emlToText(parsed) {
    parsed = parsed || {};
    return normalizeWhitespace(
      [
        parsed.subject ? "Betreff: " + parsed.subject : "",
        parsed.from ? "Von: " + parsed.from : "",
        parsed.to ? "An: " + parsed.to : "",
        parsed.date ? "Datum: " + parsed.date : "",
        parsed.body || "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  // ---- Typ-Erkennung -------------------------------------------------------

  var TEXT_EXT = [
    "txt", "text", "md", "markdown", "csv", "tsv", "json", "log", "html",
    "htm", "xml", "yml", "yaml", "rtf", "ics", "vcf", "srt", "tex", "ini", "conf",
  ];
  var IMAGE_EXT = [
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "heic", "avif",
  ];

  function extOf(name) {
    var parts = String(name || "").split(".");
    if (parts.length < 2) return "";
    return parts.pop().toLowerCase();
  }

  function guessType(name, mime) {
    mime = String(mime || "").toLowerCase();
    var ext = extOf(name);
    if (mime.indexOf("image/") === 0 || IMAGE_EXT.indexOf(ext) >= 0) return "image";
    if (mime === "application/pdf" || ext === "pdf") return "pdf";
    if (ext === "eml" || mime === "message/rfc822") return "email";
    if (mime.indexOf("text/") === 0 || TEXT_EXT.indexOf(ext) >= 0) return "text";
    return "other";
  }

  var CATEGORY_BY_TYPE = {
    text: "Texte & Dokumente",
    pdf: "PDFs",
    email: "E-Mails",
    image: "Bilder",
    other: "Sonstiges",
  };

  function provisionalCategory(typ) {
    return CATEGORY_BY_TYPE[typ] || CATEGORY_BY_TYPE.other;
  }

  // ---- Namenssuche (die schwache Baseline für den Aha-Vergleich) -----------

  function nameSearch(catalog, query) {
    var q = normalizeWhitespace(query).toLowerCase();
    if (!q) return [];
    var toks = q.split(" ").filter(Boolean);
    return (catalog || []).filter(function (e) {
      var hay = ((e.name || "") + " " + (e.pfad || "")).toLowerCase();
      return toks.every(function (t) {
        return hay.indexOf(t) >= 0;
      });
    });
  }

  // ---- Bedeutungssuche -----------------------------------------------------

  function cosine(a, b) {
    if (!a || !b) return 0;
    var n = Math.min(a.length, b.length);
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < n; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / Math.sqrt(na * nb);
  }

  // rankByVector — sortiert den Katalog nach Nähe zum Frage-Vektor.
  //   opts.cosine : eigene Ähnlichkeits-Funktion (Default: lokaler Cosinus).
  //   opts.min    : Mindest-Score (Default: keiner).
  //   opts.k      : nur die Top-k behalten.
  function rankByVector(catalog, queryVec, opts) {
    opts = opts || {};
    var fn = typeof opts.cosine === "function" ? opts.cosine : cosine;
    var min = typeof opts.min === "number" ? opts.min : -Infinity;
    var out = [];
    for (var i = 0; i < (catalog || []).length; i++) {
      var e = catalog[i];
      if (!e || !e.vektor) continue;
      var s = fn(queryVec, e.vektor);
      if (typeof s === "number" && isFinite(s) && s >= min) {
        out.push({ entry: e, score: s });
      }
    }
    out.sort(function (a, b) {
      return b.score - a.score;
    });
    if (opts.k && opts.k > 0) out = out.slice(0, opts.k);
    return out;
  }

  // ---- Selbst-Sortierung (Gruppen-Vorschlag) -------------------------------

  var STOPWORDS = {};
  (
    "und oder aber der die das den dem des ein eine einer eines einem den für mit " +
    "von zum zur auf aus bei nach über unter durch gegen ohne sich nicht auch noch " +
    "wie was wer wo wann warum dann denn dass weil sind ist war werden wird kann " +
    "the and for with this that from have has was are you your our their they them " +
    "will not who what when where why how doc docx pdf jpg png datei dokument mail"
  )
    .split(" ")
    .forEach(function (w) {
      STOPWORDS[w] = true;
    });

  function topKeywords(texts, n) {
    n = n || 3;
    var freq = {};
    (texts || []).forEach(function (t) {
      var words = normalizeWhitespace(t)
        .toLowerCase()
        .split(/[^a-z0-9äöüß]+/);
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (w.length < 4) continue;
        if (STOPWORDS[w]) continue;
        freq[w] = (freq[w] || 0) + 1;
      }
    });
    return Object.keys(freq)
      .sort(function (a, b) {
        return freq[b] - freq[a] || a.localeCompare(b);
      })
      .slice(0, n);
  }

  function groupTitle(members) {
    var kw = topKeywords(
      members.map(function (m) {
        return (m.name || "") + " " + (m.kiKurzfassung || m.textSchnipsel || "");
      }),
      3,
    );
    if (kw.length) return kw.map(cap).join(" · ");
    return members.length + " Dateien";
  }

  function meanInto(centroid, vec, count) {
    // Laufender Mittelwert: centroid = centroid*(k-1)/k + vec/k.
    var k = count;
    for (var i = 0; i < centroid.length; i++) {
      centroid[i] = (centroid[i] * (k - 1) + vec[i]) / k;
    }
    return centroid;
  }

  function toArray(vec) {
    if (Array.isArray(vec)) return vec.slice();
    return Array.prototype.slice.call(vec);
  }

  // clusterCatalog — greedy: jede Datei landet in der ähnlichsten Gruppe,
  // deren Zentrum >= threshold liegt, sonst gründet sie eine neue Gruppe.
  // REINER Vorschlag — verändert keine Datei, gatet nichts.
  function clusterCatalog(catalog, opts) {
    opts = opts || {};
    var fn = typeof opts.cosine === "function" ? opts.cosine : cosine;
    var thr = typeof opts.threshold === "number" ? opts.threshold : 0.84;
    var withVec = (catalog || []).filter(function (e) {
      return e && e.vektor;
    });
    var groups = [];
    for (var i = 0; i < withVec.length; i++) {
      var e = withVec[i];
      var best = null, bestS = -Infinity;
      for (var g = 0; g < groups.length; g++) {
        var s = fn(e.vektor, groups[g].zentrum);
        if (s > bestS) {
          bestS = s;
          best = groups[g];
        }
      }
      if (best && bestS >= thr) {
        best.mitglieder.push(e);
        meanInto(best.zentrum, e.vektor, best.mitglieder.length);
      } else {
        groups.push({ zentrum: toArray(e.vektor), mitglieder: [e] });
      }
    }
    var named = groups.map(function (g) {
      return {
        titel: groupTitle(g.mitglieder),
        mitglieder: g.mitglieder.map(function (m) {
          return m.id;
        }),
        anzahl: g.mitglieder.length,
        zentrumId: g.mitglieder[0].id,
      };
    });
    named.sort(function (a, b) {
      return b.anzahl - a.anzahl;
    });
    var ohne = (catalog || []).filter(function (e) {
      return e && !e.vektor;
    });
    if (ohne.length) {
      named.push({
        titel: "Ohne Bedeutungs-Vektor",
        mitglieder: ohne.map(function (m) {
          return m.id;
        }),
        anzahl: ohne.length,
        zentrumId: ohne[0].id,
      });
    }
    return named;
  }

  // ---- Zweiter Lauf: bereits signierte (per Hash) überspringen -------------

  function partitionByHash(existingHashes, incoming) {
    var set =
      existingHashes instanceof Set
        ? existingHashes
        : new Set(existingHashes || []);
    var neu = [], uebersprungen = [];
    var seen = new Set();
    (incoming || []).forEach(function (it) {
      var h = it && (it.hash || it.id);
      if (h == null) {
        neu.push(it);
        return;
      }
      if (set.has(h) || seen.has(h)) {
        uebersprungen.push(it);
      } else {
        seen.add(h);
        neu.push(it);
      }
    });
    return { neu: neu, uebersprungen: uebersprungen };
  }

  // ---- Export --------------------------------------------------------------

  var KimBrainCore = {
    normalizeWhitespace: normalizeWhitespace,
    makeSnippet: makeSnippet,
    parseEml: parseEml,
    emlToText: emlToText,
    guessType: guessType,
    provisionalCategory: provisionalCategory,
    nameSearch: nameSearch,
    cosine: cosine,
    rankByVector: rankByVector,
    clusterCatalog: clusterCatalog,
    topKeywords: topKeywords,
    partitionByHash: partitionByHash,
    _meta: META,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = KimBrainCore;
  }
  global.KimBrainCore = KimBrainCore;

  if (typeof console !== "undefined" && console.info) {
    console.info(
      "KIM-BRAIN CORE bereit: normalizeWhitespace/makeSnippet/parseEml/emlToText/" +
        "guessType/nameSearch/rankByVector/clusterCatalog/partitionByHash",
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
