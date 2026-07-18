/*
 * SBKIM — Modul 03 — Embedding
 *
 * Text → Float32Array(384) via Xenova/multilingual-e5-small (transformers.js).
 * All vectors are L2-normalized so Modul 04 Match can use the dot product
 * as cosine similarity. The e5 role prefix ("query: " / "passage: ") is
 * applied internally — there is no mode parameter.
 *
 * Public surface (registered on window.SbkimEmbedding):
 *   init() -> Promise<void>                          // loads the model (~30 MB on first run)
 *   isReady() -> boolean
 *   embedQuery(text) -> Promise<Float32Array(384)>
 *   embedPassage(text) -> Promise<Float32Array(384)>
 *   embedQueryBatch(texts) -> Promise<Float32Array[]>
 *   embedPassageBatch(texts) -> Promise<Float32Array[]>
 *   embedContentVector(samples, opts?) -> Promise<{vector,count,source}>  // inhalts-treuer Domänen-Vektor
 *   embedSnippets(text|string[], opts?) -> Promise<[{vec:Float32Array(384), text}]>  // A10 Satz-Schnipsel
 *
 * Self-check: console.info after init() succeeds — not on script load,
 * because the model download is asynchronous. See INTERFACES.md and
 * docs/components/03_embedding.md for the binding spec.
 */
(function (global) {
  "use strict";

  var EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
  var EMBEDDING_DIM = 384;
  var EMBEDDING_MAX_TOKENS = 512;
  var EMBEDDING_QUERY_PREFIX = "query: ";
  var EMBEDDING_PASSAGE_PREFIX = "passage: ";

  // --- A10: „Schnipsel-Mittel" (Spore v0.2, 2026-07-14) ---------------------
  // Spiegelt INTERFACES §0 SPORE_SNIPPET_MAX / SPORE_SNIPPET_GRANULARITY.
  // embedSnippets zerlegt den Domänen-Text SATZ-weise und bettet bis zu
  // SPORE_SNIPPET_MAX Sätze als Passage-Vektoren ein — reine Berechnung, KEIN
  // Spore-Schreibvorgang (Modul 02 assembliert daraus die Spore).
  var SPORE_SNIPPET_MAX = 20;
  var SPORE_SNIPPET_GRANULARITY = "sentence";
  // Anzeige/Debug-Kürzung des Quell-Satzes (KEIN PII — kuratierte Domänen-Sätze).
  var SNIPPET_TEXT_MAX = 160;

  // Pinned CDN version so reproducible across browsers / re-installs.
  // Bump in lockstep with a spec note when the e5-small handling changes.
  var TRANSFORMERS_CDN =
    "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

  // Selbst-gehostetes Modell (offline-first): liegt das Modell unter
  // <origin>/models/<EMBEDDING_MODEL>/…, laden wir es vom eigenen Server statt
  // von HuggingFace. transformers.js schaut per Default ZUERST lokal nach —
  // auf einem SPA-Server (try_files … /index.html) antwortet ein fehlender
  // Pfad aber mit der Startseite (HTTP 200 + <!doctype html>), nicht mit 404.
  // transformers.js liest die HTML-Seite dann als JSON und wirft
  // „Unexpected token '<'“. Deshalb entscheiden wir die Quelle selbst über
  // eine Body-Probe (Status allein genügt nicht) statt der eingebauten
  // Lokal-Erkennung zu vertrauen.
  var LOCAL_MODEL_ROOT = "/models/"; // = transformers.js env.localModelPath
  var LOCAL_MODEL_PROBE = LOCAL_MODEL_ROOT + EMBEDDING_MODEL + "/config.json";
  var modelSource = null; // "local" | "remote" | null (noch nicht bestimmt)

  function makeError(name, message, cause) {
    var e = new Error(message);
    e.name = name;
    if (cause !== undefined) e.cause = cause;
    return e;
  }

  var pipePromise = null;
  var pipe = null;
  var mainPipePromise = null;
  var selfCheckEmitted = false;
  var truncateWarned = false;

  // --- A (Last-Schoner): Web-Worker fürs Embedding (2026-07-12) -------------
  // Das e5-Modell rechnet bei jeder Suche — im Browser lief diese Rechnung
  // bisher im HAUPT-Faden und fror die Anzeige ein (Klaus' Tablet: mehrfach
  // eingefroren/abgestürzt bei wiederholten Cross-Knoten-Suchen). Ein Web-
  // Worker verschiebt die Modell-Rechnung in einen Hintergrund-Faden → die
  // Anzeige bleibt flüssig. STRENG fail-soft: kein Worker verfügbar (Node,
  // alter Browser, CSP verbietet Blob-Worker) → transparenter Rückfall auf
  // den Haupt-Faden = bisheriges Verhalten, byte-gleiche Vektoren.
  //
  // Der Worker wird als INLINE Blob gebaut (kein Extra-File) → offline-first,
  // byte-kopier-tauglich für jede App. Er lädt transformers.js per dynamischem
  // import() im Worker-Kontext genauso wie der Haupt-Faden.
  var USE_WORKER = true;      // via init({worker:false}) abschaltbar
  var worker = null;
  var workerReady = false;
  var workerFailed = false;   // einmal gescheitert → nie wieder versuchen
  var workerTried = false;
  var workerReqId = 0;
  var workerPending = Object.create(null); // id -> {resolve,reject}

  function isReady() {
    return pipe !== null || workerReady;
  }

  function isWorkerActive() {
    return worker !== null && workerReady && !workerFailed;
  }

  function getModelSource() {
    return modelSource; // "local" | "remote" | null (vor dem ersten init)
  }

  function warnTruncateOnce() {
    if (truncateWarned) return;
    truncateWarned = true;
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "MODUL 03 EMBEDDING: Eingabe > " +
        EMBEDDING_MAX_TOKENS +
        " Tokens, abgeschnitten",
      );
    }
  }

  function emitSelfCheckOnce() {
    if (selfCheckEmitted) return;
    selfCheckEmitted = true;
    if (typeof console !== "undefined" && console.info) {
      console.info(
        "MODUL 03 EMBEDDING bereit, Funktionen: " +
        "init/isReady/embedQuery/embedPassage/embedQueryBatch/embedPassageBatch/embedContentVector/embedSnippets, " +
        "Modell: " + EMBEDDING_MODEL + ", Dim: " + EMBEDDING_DIM +
        ", Quelle: " + (modelSource === "local" ? "lokal (eigener Server)" : "HuggingFace"),
      );
    }
  }

  function loadTransformers() {
    // Dynamic import works in classic <script> tags as a function call
    // (Top-level await is not needed because we always call this from
    // an async context).
    return import(TRANSFORMERS_CDN).catch(function (err) {
      throw makeError(
        "ModelLoadError",
        "transformers.js-Bibliothek konnte nicht geladen werden (" +
        TRANSFORMERS_CDN + "). Beim ersten Lauf wird Internet benoetigt.",
        err,
      );
    });
  }

  function emitProgress(data) {
    // Pflege 2026-05-28: meldet den Modell-Download-Fortschritt als
    // window-Event, damit UIs (Sage-Andock-Wizard, Modul-18-Wizard) einen
    // Fortschritts-Stand zeigen können statt „lädt ewig" ohne Rückmeldung.
    // Fail-soft + konsumentenfrei (passt zum Event-Bus von Modul 17) — wer
    // nicht lauscht, merkt nichts. transformers.js progress_callback liefert
    // u.a. {status, file, progress(0-100), loaded, total}.
    try {
      if (global && typeof global.dispatchEvent === "function" &&
          typeof global.CustomEvent === "function") {
        global.dispatchEvent(new global.CustomEvent("sbkim:embedding-progress", {
          detail: data,
        }));
      }
    } catch (_e) { /* nb — Render-Hinweis, nie kritisch */ }
  }

  // Body-Probe: liegt das Modell lokal auf dem eigenen Server? Ein SPA-Server
  // liefert für fehlende Dateien die index.html (200, text/html) aus — daher
  // reicht der HTTP-Status nicht, wir müssen in den Inhalt schauen. Nur wenn
  // wirklich JSON zurückkommt (`{`…), ist das Modell selbst-gehostet.
  // Fail-soft: jeder Fehler (offline, Netz, kein Modell) → "remote".
  async function detectModelSource() {
    try {
      if (!global || typeof global.fetch !== "function") return "remote";
      var res = await global.fetch(LOCAL_MODEL_PROBE, { cache: "no-store" });
      if (!res || !res.ok) return "remote";
      var ct = (res.headers && res.headers.get("content-type")) || "";
      if (ct.indexOf("html") !== -1) return "remote";
      var txt = await res.text();
      return txt.trim().charAt(0) === "{" ? "local" : "remote";
    } catch (_e) {
      return "remote";
    }
  }

  function configureModelSource(env, source) {
    if (!env) return;
    if (source === "local") {
      // Modell liegt im Repo (models/…): nur lokal laden, echtes Offline.
      env.allowLocalModels = true;
      env.localModelPath = LOCAL_MODEL_ROOT;
      env.allowRemoteModels = false;
    } else {
      // Kein lokales Modell: die eingebaute Lokal-Erkennung überspringen
      // (sonst tappt sie in die SPA-index.html-Falle) und direkt von
      // HuggingFace laden.
      env.allowLocalModels = false;
      env.allowRemoteModels = true;
    }
  }

  function noop() { /* void */ }

  // Konfig, die der Worker zum Laden des Modells braucht (strukturell klonbar).
  function makeCfg() {
    return {
      cdn: TRANSFORMERS_CDN,
      model: EMBEDDING_MODEL,
      source: modelSource, // "local" | "remote"
      localRoot: LOCAL_MODEL_ROOT,
    };
  }

  // Der Worker-Quelltext (läuft als Modul-Worker: import() + self verfügbar).
  // Lädt transformers.js genau wie der Haupt-Faden, hält seine eigene pipeline
  // und rechnet die Embeddings dort — der Haupt-Faden bleibt frei.
  function workerSource() {
    return [
      '"use strict";',
      'let pipe=null,T=null;',
      'async function ensure(cfg){',
      '  if(pipe) return;',
      '  T=await import(cfg.cdn);',
      '  const env=T.env;',
      '  if(cfg.source==="local"){env.allowLocalModels=true;env.localModelPath=cfg.localRoot;env.allowRemoteModels=false;}',
      '  else {env.allowLocalModels=false;env.allowRemoteModels=true;}',
      '  pipe=await T.pipeline("feature-extraction",cfg.model,{progress_callback:function(d){self.postMessage({type:"progress",data:d});}});',
      '}',
      'self.onmessage=async function(e){',
      '  const m=e.data; if(!m) return;',
      '  if(m.type==="init"){',
      '    try{ await ensure(m.cfg); self.postMessage({type:"ready",id:m.id}); }',
      '    catch(err){ self.postMessage({type:"error",id:m.id,error:String((err&&err.message)||err)}); }',
      '    return;',
      '  }',
      '  if(m.type==="embed"){',
      '    try{',
      '      await ensure(m.cfg);',
      '      const out=await pipe(m.texts,{pooling:"mean",normalize:true});',
      '      const src=out&&out.data?out.data:out;',
      '      const data=new Float32Array(src);',
      '      self.postMessage({type:"result",id:m.id,data:data,count:m.texts.length},[data.buffer]);',
      '    }catch(err){ self.postMessage({type:"error",id:m.id,error:String((err&&err.message)||err)}); }',
      '  }',
      '};',
    ].join("\n");
  }

  function onWorkerMessage(e) {
    var m = e && e.data;
    if (!m) return;
    if (m.type === "progress") { emitProgress(m.data); return; }
    var slot = workerPending[m.id];
    if (!slot) return;
    delete workerPending[m.id];
    if (m.type === "ready") {
      workerReady = true;
      slot.resolve();
    } else if (m.type === "result") {
      workerReady = true;
      slot.resolve(m.data); // flache Float32Array (count*dim)
    } else if (m.type === "error") {
      slot.reject(makeError("EmbeddingError", "Worker: " + m.error));
    }
  }

  // Worker als gescheitert markieren → alle offenen Anfragen fallen zurück.
  function failWorker(err) {
    workerFailed = true;
    workerReady = false;
    var ids = Object.keys(workerPending);
    for (var i = 0; i < ids.length; i++) {
      var s = workerPending[ids[i]];
      delete workerPending[ids[i]];
      try {
        s.reject(err || makeError("EmbeddingError", "Embedding-Worker gescheitert"));
      } catch (_x) { /* nb */ }
    }
    try { if (worker && worker.terminate) worker.terminate(); } catch (_y) { /* nb */ }
    worker = null;
  }

  // Baut den Worker (einmalig). Gibt true zurück, wenn er nutzbar ist.
  // Fail-soft: fehlt Worker/Blob/URL.createObjectURL (Node, alte Umgebung) →
  // false, der Aufrufer nimmt den Haupt-Faden.
  function ensureWorker() {
    if (!USE_WORKER || workerFailed) return false;
    if (worker) return true;
    if (workerTried) return worker !== null;
    workerTried = true;
    try {
      if (typeof global.Worker !== "function" ||
          typeof global.Blob !== "function" ||
          !global.URL || typeof global.URL.createObjectURL !== "function") {
        workerFailed = true;
        return false;
      }
      var blob = new global.Blob([workerSource()], { type: "application/javascript" });
      var url = global.URL.createObjectURL(blob);
      worker = new global.Worker(url, { type: "module" });
      worker.onmessage = onWorkerMessage;
      worker.onerror = function () { failWorker(makeError("EmbeddingError", "Worker-Fehler")); };
      return true;
    } catch (_e) {
      workerFailed = true;
      worker = null;
      return false;
    }
  }

  function postToWorker(msg) {
    return new Promise(function (resolve, reject) {
      var id = ++workerReqId;
      workerPending[id] = { resolve: resolve, reject: reject };
      msg.id = id;
      msg.cfg = makeCfg();
      try {
        worker.postMessage(msg);
      } catch (e) {
        delete workerPending[id];
        reject(e);
      }
    });
  }

  // Haupt-Faden-Pipeline (Rückfall + ursprünglicher Pfad). Lädt das Modell im
  // Haupt-Faden, wenn kein Worker läuft. Idempotent.
  function loadMainPipe() {
    if (pipe) return Promise.resolve(pipe);
    if (mainPipePromise) return mainPipePromise;
    mainPipePromise = (async function () {
      var transformers = await loadTransformers();
      if (modelSource === null) modelSource = await detectModelSource();
      configureModelSource(transformers.env, modelSource);
      var p = await transformers.pipeline("feature-extraction", EMBEDDING_MODEL, {
        progress_callback: function (data) { emitProgress(data); },
      });
      pipe = p;
      return p;
    })();
    return mainPipePromise;
  }

  function init(opts) {
    if (opts && opts.worker === false) USE_WORKER = false;
    if (pipePromise) return pipePromise.then(noop);
    pipePromise = (async function () {
      modelSource = await detectModelSource();
      // Worker-Pfad zuerst (verschiebt die Rechnung aus dem Anzeige-Faden).
      if (ensureWorker()) {
        try {
          await postToWorker({ type: "init" });
          emitSelfCheckOnce();
          return;
        } catch (e) {
          failWorker(e); // Rückfall auf den Haupt-Faden
        }
      }
      await loadMainPipe();
      emitSelfCheckOnce();
    })().catch(function (err) {
      // Reset so a retry can attempt again.
      pipePromise = null;
      throw makeError(
        "ModelLoadError",
        "Modell '" + EMBEDDING_MODEL + "' konnte nicht geladen werden: " +
        (err && err.message),
        err,
      );
    });
    return pipePromise.then(noop);
  }

  // Zerlegt eine flache Float32Array (count*dim) in einzelne dim-Vektoren.
  function sliceVectors(flat, count) {
    var res = new Array(count);
    for (var i = 0; i < count; i++) {
      var start = i * EMBEDDING_DIM;
      res[i] = new Float32Array(flat.slice(start, start + EMBEDDING_DIM));
    }
    return res;
  }

  // Zentrale Rechen-Stelle: Worker zuerst, sonst Haupt-Faden. Bekommt bereits
  // präfigierte Texte, gibt L2-normalisierte Float32Array(dim)[] zurück.
  async function computeVectors(prefixed) {
    if (isWorkerActive()) {
      try {
        var flat = await postToWorker({ type: "embed", texts: prefixed });
        return sliceVectors(flat, prefixed.length);
      } catch (e) {
        failWorker(e); // ab jetzt Haupt-Faden; dieser Aufruf fällt durch
      }
    }
    await loadMainPipe();
    var out = await pipe(prefixed, { pooling: "mean", normalize: true });
    var res = new Array(prefixed.length);
    for (var j = 0; j < prefixed.length; j++) res[j] = vectorAt(out, j);
    return res;
  }

  function ensureNonEmpty(text, ctx) {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw makeError(
        "EmptyInputError",
        "Leere oder reine Whitespace-Eingabe bei " + ctx + ".",
      );
    }
  }

  function tokenCountOrNull(text) {
    if (!pipe || !pipe.tokenizer) return null;
    try {
      var t = pipe.tokenizer(text);
      if (t && t.input_ids && t.input_ids.dims && t.input_ids.dims.length >= 2) {
        return t.input_ids.dims[1];
      }
    } catch (_e) {
      // Best-effort. If the tokenizer surface changes between
      // transformers.js versions, we silently skip the pre-count.
      return null;
    }
    return null;
  }

  function checkTruncate(prefixedTexts) {
    for (var i = 0; i < prefixedTexts.length; i++) {
      var n = tokenCountOrNull(prefixedTexts[i]);
      if (n !== null && n > EMBEDDING_MAX_TOKENS) {
        warnTruncateOnce();
        return;
      }
    }
  }

  function vectorAt(out, index) {
    // out.data is a Float32Array of length batch * dim; copy out the slice.
    var start = index * EMBEDDING_DIM;
    var end = start + EMBEDDING_DIM;
    return new Float32Array(out.data.slice(start, end));
  }

  async function embedSingle(text, prefix, ctx) {
    ensureNonEmpty(text, ctx);
    await init();
    var prefixed = prefix + text;
    checkTruncate([prefixed]);
    var vecs;
    try {
      vecs = await computeVectors([prefixed]);
    } catch (err) {
      throw makeError(
        "EmbeddingError",
        ctx + " scheiterte: " + (err && err.message),
        err,
      );
    }
    return vecs[0];
  }

  async function embedBatch(texts, prefix, ctx) {
    if (!Array.isArray(texts)) {
      throw makeError(
        "EmbeddingError",
        ctx + " erwartet ein Array, bekam: " + typeof texts,
      );
    }
    if (texts.length === 0) return [];
    for (var i = 0; i < texts.length; i++) {
      ensureNonEmpty(texts[i], ctx + "[" + i + "]");
    }
    await init();
    var prefixed = texts.map(function (t) { return prefix + t; });
    checkTruncate(prefixed);
    var result;
    try {
      result = await computeVectors(prefixed);
    } catch (err) {
      throw makeError(
        "EmbeddingError",
        ctx + " scheiterte: " + (err && err.message),
        err,
      );
    }
    return result;
  }

  // --- Inhalts-treuer Domänen-Vektor (2026-06-28) --------------------------
  // Baut EINEN repräsentativen, L2-normalisierten Passage-Vektor aus vielen
  // echten Inhalts-Schnipseln (Rezepte / Cocktails / Fach-Labels …): jeden
  // Schnipsel einzeln einbetten (gedeckelt), den Schwerpunkt (Mittelwert)
  // bilden, wieder normalisieren. Das ist der „beschreibe den Knoten durch
  // seinen INHALT statt durch seine Hülle"-Pfad (Modul 18 Sub f/g, Brief
  // 2026-06-28).
  //
  // Modul-Grenze: das Verketten/Mitteln von EINGABE-Texten zu einem Zentroid
  // liegt VOR der Ähnlichkeits-Bewertung (Modul 04). Es ist KEINE Cosinus-
  // /Match-Rechnung — die bleibt Modul 04. Hier entsteht nur ein einzelner
  // Bedeutungs-Punkt, exakt das, was embedPassage für einen Text tut.
  var CONTENT_SAMPLE_MAX = 32;

  // --- A3: Contextual Chunking (2026-07-01) --------------------------------
  // Optional wird jedem Schnipsel VOR dem Einbetten ein kurzer, geteilter
  // Kontext-Vorspann vorangestellt (Anthropic „Contextual Retrieval"-Idee,
  // deterministisch/offline/gratis: der Schnipsel trägt dann sein Dokument-/
  // Domänen-Umfeld mit sich). Das verankert jeden Schnipsel-Vektor in der
  // Domäne, bevor gemittelt wird — der Zentroid soll dadurch domänen-treuer
  // und zwischen Domänen besser trennbar werden.
  //
  // STRENG ADDITIV: ohne Kontext (Default) ist das assemblierte Text-Array
  // byte-gleich zum bisherigen Verhalten → identische Vektoren, kein Bruch.
  // Kontext-Quellen (per Schnipsel überschreibt global):
  //   - global:      opts.context (String)
  //   - pro Schnipsel: {label, text, context} → context überschreibt global
  // Der Ausgabe-Vertrag (ein L2-normalisierter 384-Vektor) bleibt gleich;
  // KEIN Spore-Feld, KEIN PROTOCOL_VERSION-/DB_VERSION-Bump — das ist nur die
  // Vor-Einbettungs-Textform. Die Match-Schwelle (Modul 04/05) ist unberührt.
  var CONTENT_CONTEXT_SEP = " — ";

  // Reine, deterministische Text-Assemblierung — VOR jedem Embedding. Als
  // Test-Brücke (_assembleContentTexts) exportiert, damit die Contextual-
  // Chunking-Logik headless (ohne Modell) beweisbar ist.
  function assembleContentTexts(samples, cap, globalContext) {
    var gctx = (typeof globalContext === "string") ? globalContext.trim() : "";
    var texts = [];
    var contextUsed = false;
    for (var i = 0; i < samples.length && texts.length < cap; i++) {
      var s = samples[i];
      var rest = null;
      var perCtx = null;
      if (typeof s === "string") {
        rest = s;
      } else if (s && typeof s === "object") {
        var label = typeof s.label === "string" ? s.label : "";
        var body = typeof s.text === "string" ? s.text : "";
        rest = (label + " " + body).trim();
        if (typeof s.context === "string" && s.context.trim().length > 0) {
          perCtx = s.context.trim();
        }
      }
      if (typeof rest !== "string" || rest.trim().length === 0) continue;
      rest = rest.trim();
      var ctx = perCtx !== null ? perCtx : gctx;
      var finalText;
      if (ctx && ctx.length > 0) {
        finalText = ctx + CONTENT_CONTEXT_SEP + rest;
        contextUsed = true;
      } else {
        finalText = rest;
      }
      texts.push(finalText);
    }
    return { texts: texts, contextUsed: contextUsed };
  }

  async function embedContentVector(samples, opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    if (!Array.isArray(samples)) {
      throw makeError(
        "EmbeddingError",
        "embedContentVector erwartet ein Array, bekam: " + typeof samples,
      );
    }
    var cap = (typeof opts.max === "number" && opts.max > 0)
      ? Math.floor(opts.max)
      : CONTENT_SAMPLE_MAX;

    // Schnipsel → nicht-leere Strings. Objekte {label,text} werden verkettet.
    // Leere Einträge werden fail-soft übersprungen (kein Throw je Eintrag).
    // A3: optionaler Kontext-Vorspann (opts.context / s.context) additiv.
    var assembled = assembleContentTexts(samples, cap, opts.context);
    var texts = assembled.texts;
    if (texts.length === 0) {
      throw makeError(
        "EmptyInputError",
        "embedContentVector: keine nicht-leeren Inhalts-Schnipsel.",
      );
    }

    var vecs = await embedPassageBatch(texts);
    var dim = EMBEDDING_DIM;
    var acc = new Float32Array(dim);
    for (var v = 0; v < vecs.length; v++) {
      var vv = vecs[v];
      for (var d = 0; d < dim; d++) acc[d] += vv[d];
    }
    var norm = 0;
    for (var k = 0; k < dim; k++) norm += acc[k] * acc[k];
    norm = Math.sqrt(norm);
    if (norm === 0) {
      // Entartet (Vektoren heben sich exakt auf) — auf den ersten zurückfallen.
      return { vector: vecs[0], count: texts.length, source: "content", contextUsed: assembled.contextUsed };
    }
    for (var m = 0; m < dim; m++) acc[m] = acc[m] / norm;
    return { vector: acc, count: texts.length, source: "content", contextUsed: assembled.contextUsed };
  }

  // --- A10: Satz-Zerlegung + Schnipsel-Einbettung --------------------------
  // Deterministisch, offline, fail-soft. Zerlegt Domänen-Text in Sätze:
  // erst an Zeilenumbrüchen (Listen/Absätze), dann an Satz-Endzeichen
  // (. ! ? …). Whitespace wird pro Zeile normalisiert. Keine externen
  // Abhängigkeiten. Kein-String / leer / nur-Whitespace → [].
  function splitIntoSentences(text) {
    if (typeof text !== "string") return [];
    if (text.trim().length === 0) return [];
    var lines = text.split(/[\r\n]+/);
    var out = [];
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].replace(/\s+/g, " ").trim();
      if (line.length === 0) continue;
      // Split nach Satz-Endzeichen gefolgt von Leerraum (Lookbehind: Chrome 62+
      // / Node — im gesamten Repo verwendet). Kein Leerraum danach → ganze Zeile
      // bleibt ein Satz (fail-soft, nie leere Fragmente).
      var parts = line.split(/(?<=[.!?…])\s+/);
      for (var pi = 0; pi < parts.length; pi++) {
        var s = parts[pi].trim();
        if (s.length > 0) out.push(s);
      }
    }
    return out;
  }

  // Kürzt einen Quell-Satz für Anzeige/Debug (KEIN PII). Nur die `text`-Anzeige
  // wird gekürzt — der eingebettete Vektor nutzt den vollen Satz.
  function shortenSnippetText(s) {
    s = String(s).trim();
    if (s.length <= SNIPPET_TEXT_MAX) return s;
    return s.slice(0, SNIPPET_TEXT_MAX - 1).trim() + "…";
  }

  // Reine, deterministische Satz-Vorbereitung VOR jedem Embedding. Nimmt einen
  // String ODER ein String-Array (mehrere Domänen-Texte, in Reihenfolge) und
  // liefert bis zu opts.max (Default SPORE_SNIPPET_MAX) Sätze in
  // Satz-Reihenfolge. Als Test-Brücke (_prepareSnippetTexts) exportiert, damit
  // die Zerlegungs-/Deckel-Logik headless (ohne Modell) beweisbar ist.
  function prepareSnippetTexts(input, cap) {
    cap = (typeof cap === "number" && cap > 0) ? Math.floor(cap) : SPORE_SNIPPET_MAX;
    var sources = Array.isArray(input) ? input : [input];
    var sentences = [];
    for (var i = 0; i < sources.length && sentences.length < cap; i++) {
      var parts = splitIntoSentences(sources[i]);
      for (var j = 0; j < parts.length && sentences.length < cap; j++) {
        sentences.push(shortenSnippetText(parts[j]));
      }
    }
    return sentences;
  }

  // A10 „Schnipsel-Mittel": jeder Satz ein L2-normalisierter Passage-Vektor.
  // Rückgabe in Satz-Reihenfolge. Fail-soft: leer → Promise<[]>. Reine
  // Berechnung — schreibt KEINE Spore (Modul 02 nimmt das Ergebnis auf).
  async function embedSnippets(input, opts) {
    opts = (opts && typeof opts === "object") ? opts : {};
    var cap = (typeof opts.max === "number" && opts.max > 0)
      ? Math.floor(opts.max) : SPORE_SNIPPET_MAX;
    var texts = prepareSnippetTexts(input, cap);
    if (texts.length === 0) return [];
    var vecs = await embedPassageBatch(texts);
    var out = [];
    for (var i = 0; i < texts.length; i++) {
      out.push({ vec: vecs[i], text: texts[i] });
    }
    return out;
  }

  function embedQuery(text) {
    return embedSingle(text, EMBEDDING_QUERY_PREFIX, "embedQuery");
  }
  function embedPassage(text) {
    return embedSingle(text, EMBEDDING_PASSAGE_PREFIX, "embedPassage");
  }
  function embedQueryBatch(texts) {
    return embedBatch(texts, EMBEDDING_QUERY_PREFIX, "embedQueryBatch");
  }
  function embedPassageBatch(texts) {
    return embedBatch(texts, EMBEDDING_PASSAGE_PREFIX, "embedPassageBatch");
  }

  var SbkimEmbedding = {
    init: init,
    isReady: isReady,
    getModelSource: getModelSource,
    embedQuery: embedQuery,
    embedPassage: embedPassage,
    embedQueryBatch: embedQueryBatch,
    embedPassageBatch: embedPassageBatch,
    embedContentVector: embedContentVector,
    embedSnippets: embedSnippets,
    // Test-Brücke: Modell-Quellen-Erkennung (Body-Probe) headless prüfbar —
    // unterscheidet echtes JSON (selbst-gehostet) von der SPA-index.html-Falle.
    _detectModelSource: detectModelSource,
    // Test-Brücke (A3): reine, deterministische Text-Assemblierung VOR dem
    // Embedding — beweist die Contextual-Chunking-Logik headless.
    _assembleContentTexts: function (samples, opts) {
      opts = (opts && typeof opts === "object") ? opts : {};
      var cap = (typeof opts.max === "number" && opts.max > 0)
        ? Math.floor(opts.max) : CONTENT_SAMPLE_MAX;
      return assembleContentTexts(
        Array.isArray(samples) ? samples : [], cap, opts.context);
    },
    // Test-Brücke (A10): reine Satz-Zerlegung + Deckel VOR dem Embedding —
    // beweist die Schnipsel-Vorbereitung headless (ohne Modell).
    _splitIntoSentences: splitIntoSentences,
    _prepareSnippetTexts: function (input, opts) {
      opts = (opts && typeof opts === "object") ? opts : {};
      var cap = (typeof opts.max === "number" && opts.max > 0)
        ? Math.floor(opts.max) : SPORE_SNIPPET_MAX;
      return prepareSnippetTexts(input, cap);
    },
    // Test-Brücke (A Last-Schoner): Worker-Zustand headless prüfbar.
    _workerState: function () {
      return {
        useWorker: USE_WORKER,
        hasWorker: worker !== null,
        ready: workerReady,
        failed: workerFailed,
        tried: workerTried,
        active: isWorkerActive(),
      };
    },
    _meta: {
      model: EMBEDDING_MODEL,
      dim: EMBEDDING_DIM,
      maxTokens: EMBEDDING_MAX_TOKENS,
      queryPrefix: EMBEDDING_QUERY_PREFIX,
      passagePrefix: EMBEDDING_PASSAGE_PREFIX,
      transformersCdn: TRANSFORMERS_CDN,
      localModelRoot: LOCAL_MODEL_ROOT,
      localModelProbe: LOCAL_MODEL_PROBE,
      contentSampleMax: CONTENT_SAMPLE_MAX,
      contentContextSep: CONTENT_CONTEXT_SEP,
      sporeSnippetMax: SPORE_SNIPPET_MAX,
      sporeSnippetGranularity: SPORE_SNIPPET_GRANULARITY,
      snippetTextMax: SNIPPET_TEXT_MAX,
      workerMode: true,
    },
  };

  global.SbkimEmbedding = SbkimEmbedding;

  // No self-check on script load — the model is not yet downloaded.
  // The first successful init() emits the console.info line.
})(typeof window !== "undefined" ? window : globalThis);
