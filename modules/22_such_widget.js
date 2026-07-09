/*
 * SBKIM — Modul 22 — Such-Widget (Floating Search-Tool)
 *
 * Schritt 2 des SBKIM-Such-Werkzeugs (nach Modul 21 Spracheingabe). Ein
 * SEPARATES, frei bewegliches Floating-Such-Tool, self-mountend in <body>.
 * Klein im Ruhezustand (Blase mit 🔍), wächst NUR bei Interaktion zu einem
 * Eingabe-Panel mit eigenem Textfeld. Leicht transparent. Komponiert vorhandene
 * Module — baut keine eigene Such-Logik:
 *
 *   1. SPRACHE   — Modul 21 SbkimSpeech (Sprach-Knopf → Text ins Feld).
 *   2. VORFILTER — Modul 04 queryLocalMulti (Hybrid BM25+Vektor · A1 Bau 04.F,
 *                  Query-Expansion/Multi-Query · A4 Bau 04.H) + Modul 03
 *                  Embedding (lokal, server-los). Additiv, fail-soft.
 *   3. RICHTER   — Modul 04 hybridMatch (opt-in, BYOK).
 *   4. FAIL-SOFT — kein Schlüssel/Richter → Vorfilter gilt. Nie Eintritts-Barriere.
 *
 * EU-Politik einheitlich für Sprach-Engine UND Richter (Klaus 2026-06-21):
 *   - "frei"    (Default) — beide Sprach-Engines, Richter euOnly wählbar.
 *   - "bindend" — nur EU-Sprach-Engine, Richter euOnly:true erzwungen.
 *
 * Drag-/Self-Mount-/X-/Persistenz-Mechanik aus Modul 17 wiederverwendet
 * (Pointer-Events, 5 px Threshold, MutationObserver-Mount-Fallback,
 * localStorage-UX-Preferences). Modul 17 selbst bleibt unangetastet.
 *
 * UX-Lehre „Eingabe-Erhalt" (BLP/Modul 21): das Textfeld wird EINMAL angelegt
 * und NIE mit value:'' neu gebaut; erkannter Sprach-Text wird angehängt.
 *
 * Increment 1 (diese Sitzung): Widget-Shell + komponierte Suche.
 * Increment 2 (Folge-Sitzung): PWA-/Suchfeld-Kopplung über Modul 15 Membran —
 * Host lesen + aus dem Suchfeld interagieren. Host-Inhalt = untrusted external
 * data. In Increment 1 ist _meta.coupled === false, keine Kopplungs-API.
 *
 * Public surface (registered on window.SbkimSearchWidget):
 *   init(options?)   -> Promise<void>   (idempotent)
 *   show() / hide() / isVisible()
 *   expand() / collapse() / isExpanded()
 *   getPosition()    -> PositionSnapshot
 *   setCorpus(corpus)-> void
 *   search(text)     -> Promise<SearchResult>
 *   _meta            -> Read-Only-Anker
 *
 * Strikte Tabus: keine eigene Identität/Krypto/Signatur, kein IndexedDB,
 * kein Crawler/Pulsation/Eigenanfrage ins Netz, kein Umbau fremder Module,
 * kein PROTOCOL_VERSION-Bump. Fail-soft überall; einziger Sync-Throw:
 * ungültige euPolicy in init().
 *
 * Self-check: emits a console.info line on script load (synchronous).
 * Spec: docs/components/22_such_widget.md · INTERFACES.md § 1 Modul 22.
 */
(function (global) {
  "use strict";

  // ---- Konstanten ----

  var WIDGET_ID = "sbkim-search-widget";
  var STYLE_ID = "sbkim-search-widget-style";

  var LS_KEY_VISIBLE = "sbkim_search_widget_visible";
  var LS_KEY_POSITION = "sbkim_search_widget_position";
  var LS_KEY_STATE = "sbkim_search_widget_state"; // "collapsed" | "expanded"
  var LS_KEY_ENGINE = "sbkim_search_widget_engine"; // gewählte Web-Suchmaschine
  var LS_KEY_SIZE = "sbkim_search_widget_size"; // {w,h} ziehbare Panel-Größe
  var LS_KEY_MERK = "sbkim_search_widget_merkliste"; // Merkliste (Text+Link, gruppiert)
  var LS_KEY_LAST = "sbkim_search_widget_lastsearch"; // letzte Suche (Frage+Treffer), Reload-Schutz
  var LS_KEY_VIEW = "sbkim_search_widget_view"; // Anzeige-Sicht {mode,relatedOnly,kiRelated} (verbunden/verwandt)

  // Frei wählbare Web-Suchmaschinen für den Internet-Neuer-Tab-Weg (Klaus
  // 2026-06-21: DuckDuckGo ODER eine andere). Query wird angehängt (URL-encoded).
  var WEB_ENGINES = [
    { id: "duckduckgo", label: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
    { id: "startpage",  label: "Startpage",  url: "https://www.startpage.com/sp/search?query=" },
    { id: "ecosia",     label: "Ecosia",     url: "https://www.ecosia.org/search?q=" },
    { id: "brave",      label: "Brave",      url: "https://search.brave.com/search?q=" },
    { id: "google",     label: "Google",     url: "https://www.google.com/search?q=" },
    { id: "bing",       label: "Bing",       url: "https://www.bing.com/search?q=" },
    { id: "searxng",    label: "SearXNG",    url: "https://searx.be/search?q=" },
  ];
  // Öffentliche Standard-SearXNG-Instanz für den Neuer-Tab-Weg; durch eine
  // im SearXNG-Feld gesetzte eigene Instanz überschrieben (siehe webSearchUrl).
  var SEARXNG_PUBLIC_DEFAULT = "https://searx.be";

  var DRAG_THRESHOLD_PX = 5;
  // Ziehbare Panel-Größe (Klaus' Befund 2026-06-22: unteres Lesefeld zu eng).
  // panelWidth = Gesamt-Panel-Breite, resultsHeight = Höhe des Treffer-Lesefelds.
  // Ein Resize-Griff unten rechts zieht beide; Größe persistiert in localStorage.
  var MIN_PANEL_WIDTH = 240;
  var MAX_PANEL_WIDTH = 760;
  var MIN_RESULTS_HEIGHT = 120;
  var RESIZE_MAX_VH = 0.72;   // Lesefeld-Höhe max. Anteil der Viewport-Höhe
  var DEFAULT_CORNER = "bottom-right";
  var DEFAULT_OFFSET = { x: 16, y: 16 };
  // Andock-Punkt für das X: oben rechts „in der Navleiste" (Klaus 2026-06-21).
  var NAV_DOCK_CORNER = "top-right";
  var NAV_DOCK_OFFSET = { x: 12, y: 10 };
  // Unter Modul 17 (9990) und Modals (9999), damit beide Floating-Tools
  // koexistieren.
  var DEFAULT_Z_INDEX = 9985;
  var DEFAULT_K = 5;
  var MOUNT_OBSERVER_TIMEOUT_MS = 10000;

  var EU_POLICIES = ["frei", "bindend"];
  var EU_POLICY_DEFAULT = "frei";
  var DEFAULT_PROVIDER = "mistral";

  var ALLOWED_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];

  // ---- Modul-Zustand (Closure) ----

  var ready = false;
  var widgetRoot = null;
  var styleElement = null;
  var bubbleEl = null;
  var panelEl = null;
  var inputEl = null;          // EINMAL angelegt, nie mit value:'' neu gebaut
  var resultsEl = null;
  var hintEl = null;
  var voiceBtnEl = null;
  var ocrBtnEl = null;         // 📷 Foto/Handschrift → Suchtext (Modul 24)
  var ocrKey = "";             // EU-OCR-Schlüssel, RAM-only (nur diese Sitzung)
  var searchBtnEl = null;
  var euChipEl = null;
  var areaRowEl = null;        // Bereichs-Checkboxen (App/Knoten/Internet)
  var viewRowEl = null;            // Anzeige-Sicht-Zeile: verbunden ↔ verwandt + nur-verwandte
  var viewModeCheckboxEl = null;   // „🧬 verwandt (genau)" — schaltet die Sicht
  var viewRelatedOnlyCheckboxEl = null; // „nur verwandte" — blendet Fremde aus
  var viewKiCheckboxEl = null;     // „· KI" — verwandt-Maß vom KI-Richter (opt-in)
  var richterToggleEl = null;  // KI-Richter an/aus
  var richterRowEl = null;            // Zeile: Richter-Anbieter + Schlüssel + Modell
  var richterProviderSelectEl = null; // KI-Richter-Anbieter-Auswahl (Sortierung)
  var richterKeyEl = null;            // API-Schlüssel-Feld (RAM-only, nicht persistiert)
  var richterModelEl = null;          // optionales Modell-Feld (leer = Standard/auto)
  var searxngFieldEl = null;   // SearXNG-URL-Feld (für Web-Treffer im Widget)
  var engineSelectEl = null;   // Web-Suchmaschine-Auswahl (Neuer-Tab-Weg)
  var aiSelectEl = null;       // KI-Anbieter-Auswahl (KI-Such-Brücke Stufe A)
  var aiContextEl = null;      // „Schärfen"-Feld (optionaler Kontext vor dem Prompt)
  var aiContextRowEl = null;   // Zeile um das Schärfen-Feld (+ 🎤 Sprach-Knopf)
  var aiPromptBtnEl = null;    // „Prompt → KI"-Knopf (kopiert + öffnet Anbieter)
  var aiPasteEl = null;        // Einfüge-Feld für die KI-Antwort (JSON)
  var aiSortBtnEl = null;      // „Antwort sortieren"-Knopf
  var aiAutoBtnEl = null;      // „⚡ Automatisch"-Knopf (B2-Probe, Claude)
  var aiProgressEl = null;     // Fortschrittsbalken während des Web-Such-Aufrufs
  var internetCheckboxEl = null; // Referenz auf die Internet-Bereichs-Checkbox
  var vaultSectionEl = null;   // Tresor-Bedien-Sektion (🔐)
  var vaultSectionOpen = false;// Tresor-Sektion ein-/ausgeklappt
  var fullscreenBtnEl = null;  // ⛶ Vollbild-Umschalter
  var fullscreenFlag = false;  // Vollbild-Modus (NICHT persistiert — Pille bleibt Standard)
  var merkBtnEl = null;        // 📌 Merkliste-Knopf
  var merkOverlayEl = null;    // Merkliste-Overlay (gruppiert nach Suchfrage)
  var detailOverlayEl = null;  // Tool-eigene Detail-Karte (Overlay über einem Treffer)
  var merkOverlayOpen = false;
  var detailOverlayOpen = false;
  var detailItem = null;       // aktuell in der Detail-Karte gezeigter Treffer
  var reloadBtnEl = null;      // 🔄 App-aktualisieren-Knopf (Hard-Reload, opt-in)
  var optShowReload = false;   // nur wenn init({reloadButton:true}) — z.B. such-tool/
  var reloadInFlight = false;

  // Position + Sichtbarkeit (localStorage-persistiert).
  var currentCorner = DEFAULT_CORNER;
  var currentOffsetX = DEFAULT_OFFSET.x;
  var currentOffsetY = DEFAULT_OFFSET.y;
  var currentFreeX = null;
  var currentFreeY = null;
  var visibleFlag = true;
  var expandedFlag = false;

  // Eingabe-Zustand (RAM-only, UX-Erhalt). NICHT persistiert.
  var queryValue = "";

  // Options aus init().
  var optEuPolicy = EU_POLICY_DEFAULT;
  var optApiKey = null;
  var optProvider = DEFAULT_PROVIDER;
  var optRichterModel = "";    // optionales KI-Richter-Modell (leer = Standard/auto)
  var optEuOnly = false;       // nur bei euPolicy:"frei" relevant
  var optQueryLabel = null;
  var optK = DEFAULT_K;

  // ---- A4 (Bau 04.H) Query-Expansion / Multi-Query — kleine, app-eigene
  //      Synonym-Karte. Schema { term(lowercase): [alt, ...] } für Modul 04
  //      expandQuerySimple (ein Token → eine Alternative). Bidirektional
  //      eingetragen, damit beide Frage-Richtungen denselben Treffer finden
  //      (Frage „torte" findet Doku „kuchen" UND umgekehrt). Rein additiv:
  //      ohne Treffer in der Karte bleibt es bei [query] (kein Regress).
  //      Eine App darf ihre eigene Karte via init({synonyms}) setzen — sie
  //      kennt ihre Domäne besser als diese generische Grundausstattung.
  var DEFAULT_SYNONYMS = {
    // Getränke / Rezept-Domäne (Endknoten Mixarium / Rezeptbuch)
    "torte": ["kuchen"], "kuchen": ["torte"],
    "cocktail": ["drink"], "drink": ["cocktail", "getränk"], "getränk": ["drink", "getraenk"],
    "limo": ["limonade"], "limonade": ["limo"],
    "smoothie": ["shake"], "shake": ["smoothie"],
    "alkoholfrei": ["mocktail"], "mocktail": ["alkoholfrei"],
    "plätzchen": ["keks"], "keks": ["plätzchen", "plaetzchen"],
    // Allgemeine Umschreibungen (netzweit nützlich, harmlos)
    "kfz": ["auto"], "auto": ["kfz", "wagen"], "wagen": ["auto"],
    "notebook": ["laptop"], "laptop": ["notebook"],
    "handy": ["smartphone"], "smartphone": ["handy"],
    "arznei": ["medikament"], "medikament": ["arznei", "arzneimittel"],
    "foto": ["bild"], "bild": ["foto"],
  };
  // Aktive Synonym-Karte (via init({synonyms}) überschreibbar) + A4-Schalter.
  var optSynonyms = DEFAULT_SYNONYMS;
  var optQueryExpand = true;   // A4 an (Default); init({queryExpand:false}) schaltet ab
  // Treffer-Anzeige (Klaus 2026-06-21): viel sammeln + ranken, 10 zeigen, der
  // Rest hinter einem ▾-Pfeil, je Klick 10 mehr.
  var RESULT_PAGE_SIZE = 10;
  var MAX_RANK = 100;          // so viele Kandidaten werden semantisch gerankt
  var resultsVisibleCount = RESULT_PAGE_SIZE;
  var lastRenderRes = null;    // letztes Ergebnis, fürs Nachladen ohne neue Suche

  // ---- Anzeige-Sicht: „verbunden" (grob) ↔ „verwandt" (genau) ----
  // (Brief „Wählen"-UI, 2026-06-28). REINE ANZEIGE-SCHICHT — gatet NICHTS. Der
  // Andock-Handshake (Modul 05, PROVIDER_MIN_MATCH 0.80) bleibt unberührt. Der
  // Umschalter sortiert/filtert NUR die schon gefundene Trefferliste:
  //   "verbunden" (Default) — alle Treffer in ihrer rohen Cosinus-Reihenfolge
  //                           (PROVIDER_MIN_MATCH-Boden), das gewohnte Verhalten.
  //   "verwandt"            — nach dem ZENTRIERTEN Cosinus (Modul 04 relatedness())
  //                           absteigend; echte Themen-Verwandte oben, fremde
  //                           Domänen unten (mit „nur verwandte" ganz ausgeblendet).
  var viewMode = "verbunden";       // "verbunden" | "verwandt"
  var viewRelatedOnly = false;      // im "verwandt"-Modus: fremde (nicht isRelated) ausblenden
  // „· KI" (Kalibrier-Abschluss 2026-06-28): das „verwandt"-Maß wahlweise vom
  // KI-Richter (Modul 04 hybridMatch) liefern lassen statt vom zentrierten Cosinus.
  // OPT-IN, BYOK, fail-soft: ohne Schlüssel / ohne Urteil → gratis Cosinus-Rangfolge.
  // REINE ANZEIGE — gatet nichts (Andock-Riegel 0.80 unberührt). Der bestehende
  // „KI-Richter"-Schalter (ganze Liste re-ranken) bleibt davon unberührt daneben.
  var viewKiRelated = false;        // „· KI": verwandt-Ranking per KI-Richter (opt-in)
  // Letztes KI-Verwandtschafts-Urteil, an die Suchfrage gebunden (RAM-only, kein PII,
  // nicht persistiert). { query, byKey:{ "anchorId|label": {score,passt,begruendung} },
  // available, running }. Wird bei jeder neuen Suche zurückgesetzt.
  var kiRelatedState = { query: null, byKey: {}, available: false, running: false };
  var lastQueryVec = null;          // Query-Embedding der letzten Suche (RAM-only, für relatedness)
  var optAllowDrag = true;
  var optRememberHidden = true;
  var optZIndex = DEFAULT_Z_INDEX;

  // Korpus (lokal gehalten; an SbkimMatch durchgereicht).
  var localCorpus = null;
  // Lazy-Korpus-Vorbereitung (z.B. Embedding via Modul 03 beim ersten Gebrauch).
  // corpusPreparer: async () => Array<corpusEntry mit passageVec>. Wird EINMAL
  // ausgeführt (beim ersten expand() oder bei der ersten Suche), danach gecacht.
  // So bleibt die Host-Seite leicht beim Start (kein Modell-Download im Boot).
  var corpusPreparer = null;
  var corpusReady = false;
  var corpusPrepPromise = null;

  // ---- Mehrfach-Suche (Bau 22 Mehrfach 2026-06-21, Klaus' Vision) ----
  // Drei getrennt wählbare Such-Bereiche, mehrere zugleich ankreuzbar. Alle drei
  // münden in dieselbe Sortiermaschine (Modul 03 Embedding + Modul 04 Matcher) —
  // dasselbe Zwei-Stufen-Muster wie BLP (Eingang teils KI → in-App-Matcher).
  //   app      — lokaler Korpus / Host-Inhalt (gratis, server-los).
  //   knoten   — verbundene Mycel-Knoten (deren Sporen, lokal bekannt; KEINE
  //              Netz-Anfrage → Empfangsmodus gewahrt).
  //   internet — Web-Treffer. PILZ-Schicht (Werkzeug, kein Mycel-Knoten): bewusst
  //              nutzer-ausgelöste Eigen-Anfrage ins Netz, daher KEIN Widerspruch
  //              zum Empfangsmodus (CLAUDE.md § Vier-Schichten-Lesart Schicht 2).
  var areas = {
    app:      { enabled: true,  label: "App" },
    knoten:   { enabled: true,  label: "Knoten" },
    internet: { enabled: false, label: "Netz" },
  };
  // KI-Richter an/aus. DEFAULT AUS (gratis: reine semantische Cosinus-Suche „über
  // die Bedeutung"). AN nur sinnvoll mit BYOK-Schlüssel — dann urteilt die KI
  // zusätzlich. So kostet niemand ungewollt Geld (Klaus 2026-06-21).
  var richterOn = false;
  // SearXNG-Instanz-URL (optional). Gesetzt → Web-Treffer werden geholt + im
  // Widget semantisch sortiert (Re-Ranker). Leer → Internet-Bereich = „↗ Im Netz
  // suchen"-Karte (neuer Tab, kein Fetch). Öffentliche Instanzen blocken JSON/CORS
  // meist → praktisch die eigene SearXNG-Instanz (Pilz-Server).
  var searxngUrl = "";
  var optWebEngine = "duckduckgo";  // gewählte Web-Suchmaschine (Neuer-Tab-Weg)
  var optAiProvider = "chatgpt";    // gewählter KI-Anbieter (KI-Such-Brücke)
  var pastedAiText = "";            // zuletzt eingefügte KI-Antwort (RAM-only, nie persistiert)
  // Knoten-Korpus (verbundene Knoten) — analog localCorpus, eigene Lazy-Prep.
  var nodeCorpus = null;
  var nodeCorpusPreparer = null;
  var nodeCorpusReady = false;
  var nodeCorpusPrepPromise = null;
  // Live-Cross-Knoten-Frage (Bau Query-über-Relais 2026-06-28): optional via
  // options.queryNode injizierte Funktion (nodeId, text) -> Array<{label,score,
  // anchorId}>. Auf der Sage-Seite verdrahtet mit SbkimAnastomose.queryNostr
  // (Modul 05 + Relais). Im Standalone-Such-Tool ohne Modul 05 = null → der
  // Knoten-Bereich bleibt rein lokal (fail-soft, kein Bruch).
  var queryNodeFn = null;
  var LIVE_NODE_MAX = 2;          // top-N Nachbarn pro Suche live fragen (Deckel)
  var SEARXNG_MAX_RESULTS = 50;   // wie viele Roh-Treffer wir holen + sortieren

  // Drag + Mount.
  var dragState = null;
  // Resize (ziehbare Panel-Größe). panelWidth/resultsHeight === null → CSS-Default.
  var resizeHandleEl = null;
  var resizeState = null;
  var panelWidth = null;      // px, null = CSS-Default min(320px, 88vw)
  var resultsHeight = null;   // px, null = CSS-Default max-height 40vh
  var mountObserver = null;
  var mountObserverTimeoutId = null;

  // Diagnose-Anker für _meta.
  var lastSearchMode = null;
  var searchCount = 0;
  var activeRecognizer = null;

  // ---- Hilfsfunktionen ----

  function warn(message, cause) {
    if (typeof console !== "undefined" && console.warn) {
      if (cause !== undefined) console.warn("[SbkimSearchWidget] " + message, cause);
      else console.warn("[SbkimSearchWidget] " + message);
    }
  }

  function makeError(name, message) {
    var e = new Error(message);
    e.name = name;
    return e;
  }

  // Sync-Throw nur bei klarem Aufrufer-Konfig-Fehler (ungültige euPolicy).
  function normalizeEuPolicy(p) {
    if (p === undefined || p === null) return optEuPolicy;
    if (EU_POLICIES.indexOf(p) === -1) {
      throw makeError(
        "InvalidEuPolicyError",
        "euPolicy muss 'frei' oder 'bindend' sein, war: " + JSON.stringify(p),
      );
    }
    return p;
  }

  function safeGetLocalStorage() {
    try { return global.localStorage || null; }
    catch (_e) { return null; }
  }

  function lsGet(key) {
    var ls = safeGetLocalStorage();
    if (!ls) return null;
    try { return ls.getItem(key); } catch (_e) { return null; }
  }

  function lsSet(key, value) {
    var ls = safeGetLocalStorage();
    if (!ls) return;
    try { ls.setItem(key, value); } catch (_e) { /* fail-soft (Quota/Inkognito) */ }
  }

  function lsRemove(key) {
    var ls = safeGetLocalStorage();
    if (!ls) return;
    try { ls.removeItem(key); } catch (_e) { /* fail-soft */ }
  }

  function loadVisibleFromLs() {
    // Das Widget startet IMMER sichtbar — es darf nie unauffindbar verschwinden
    // (Klaus 2026-06-21: X = komplett weg, kam auch nach Hard-Reload nicht
    // wieder). Das X parkt jetzt nur noch oben (dockToTop), versteckt nicht
    // mehr. Ein evtl. alter „versteckt"-Zustand wird einmalig geheilt.
    visibleFlag = true;
    if (optRememberHidden && lsGet(LS_KEY_VISIBLE) === "false") {
      lsSet(LS_KEY_VISIBLE, "true");
    }
  }

  function persistVisible() {
    if (!optRememberHidden) return;
    lsSet(LS_KEY_VISIBLE, visibleFlag ? "true" : "false");
  }

  function loadStateFromLs() {
    expandedFlag = (lsGet(LS_KEY_STATE) === "expanded");
  }

  function persistState() {
    lsSet(LS_KEY_STATE, expandedFlag ? "expanded" : "collapsed");
  }

  function loadPositionFromLs() {
    var raw = lsGet(LS_KEY_POSITION);
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      if (typeof parsed.x === "number" && typeof parsed.y === "number" &&
          isFinite(parsed.x) && isFinite(parsed.y)) {
        currentFreeX = parsed.x;
        currentFreeY = parsed.y;
        currentCorner = null;
      } else if (typeof parsed.corner === "string" &&
                 ALLOWED_CORNERS.indexOf(parsed.corner) >= 0) {
        currentCorner = parsed.corner;
        if (typeof parsed.offsetX === "number") currentOffsetX = parsed.offsetX;
        if (typeof parsed.offsetY === "number") currentOffsetY = parsed.offsetY;
      }
    } catch (_e) { /* fail-soft — Defaults bleiben */ }
  }

  function buildPositionSnapshot() {
    return {
      corner: currentCorner,
      offsetX: currentOffsetX,
      offsetY: currentOffsetY,
      x: currentFreeX,
      y: currentFreeY,
    };
  }

  function persistPosition() {
    try { lsSet(LS_KEY_POSITION, JSON.stringify(buildPositionSnapshot())); }
    catch (_e) { /* fail-soft */ }
  }

  function applyPositionToRoot() {
    if (!widgetRoot) return;
    widgetRoot.style.top = "";
    widgetRoot.style.bottom = "";
    widgetRoot.style.left = "";
    widgetRoot.style.right = "";
    if (currentFreeX !== null && currentFreeY !== null) {
      widgetRoot.style.left = currentFreeX + "px";
      widgetRoot.style.top = currentFreeY + "px";
      return;
    }
    var corner = currentCorner || DEFAULT_CORNER;
    var ox = currentOffsetX;
    var oy = currentOffsetY;
    if (corner === "top-left")          { widgetRoot.style.top = oy + "px"; widgetRoot.style.left = ox + "px"; }
    else if (corner === "top-right")    { widgetRoot.style.top = oy + "px"; widgetRoot.style.right = ox + "px"; }
    else if (corner === "bottom-left")  { widgetRoot.style.bottom = oy + "px"; widgetRoot.style.left = ox + "px"; }
    else                                { widgetRoot.style.bottom = oy + "px"; widgetRoot.style.right = ox + "px"; }
  }

  // ---- Ziehbare Panel-Größe (localStorage-persistiert) ----

  function clampPanelWidth(w) {
    var vw = global.innerWidth || 1024;
    var max = Math.min(MAX_PANEL_WIDTH, vw - 16);
    if (max < MIN_PANEL_WIDTH) max = MIN_PANEL_WIDTH;
    if (w < MIN_PANEL_WIDTH) w = MIN_PANEL_WIDTH;
    if (w > max) w = max;
    return Math.round(w);
  }

  function clampResultsHeight(h) {
    var vh = global.innerHeight || 768;
    var max = Math.max(MIN_RESULTS_HEIGHT, Math.round(vh * RESIZE_MAX_VH));
    if (h < MIN_RESULTS_HEIGHT) h = MIN_RESULTS_HEIGHT;
    if (h > max) h = max;
    return Math.round(h);
  }

  function loadSizeFromLs() {
    var raw = lsGet(LS_KEY_SIZE);
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      if (typeof parsed.w === "number" && isFinite(parsed.w)) panelWidth = clampPanelWidth(parsed.w);
      if (typeof parsed.h === "number" && isFinite(parsed.h)) resultsHeight = clampResultsHeight(parsed.h);
    } catch (_e) { /* fail-soft — CSS-Default bleibt */ }
  }

  function persistSize() {
    if (panelWidth === null && resultsHeight === null) { lsRemove(LS_KEY_SIZE); return; }
    try { lsSet(LS_KEY_SIZE, JSON.stringify({ w: panelWidth, h: resultsHeight })); }
    catch (_e) { /* fail-soft */ }
  }

  function applySizeToPanel() {
    if (panelEl && panelWidth !== null) panelEl.style.width = panelWidth + "px";
    if (resultsEl && resultsHeight !== null) resultsEl.style.maxHeight = resultsHeight + "px";
  }

  // Beim Wechsel klein↔groß den Mittelpunkt halten und in den sichtbaren Bereich
  // klemmen — sonst schnappt die Blase beim Minimieren in die Ecke / aus dem Bild
  // (Klaus' Befund 2026-06-21: Such-Tool rutschte beim Minimieren nach rechts raus).
  function keepCenterAcrossResize(before) {
    if (!widgetRoot || !before) return;
    var vw = global.innerWidth || 1024;
    var vh = global.innerHeight || 768;
    var cx = before.left + before.width / 2;
    var cy = before.top + before.height / 2;
    var rect = widgetRoot.getBoundingClientRect(); // neue Größe nach Zustands-Wechsel
    var x = cx - rect.width / 2;
    var y = cy - rect.height / 2;
    var maxX = vw - rect.width - 8;
    var maxY = vh - rect.height - 8;
    if (x > maxX) x = maxX;
    if (x < 8) x = 8;
    if (y > maxY) y = maxY;
    if (y < 8) y = 8;
    currentFreeX = x;
    currentFreeY = y;
    currentCorner = null;
    applyPositionToRoot();
  }

  // Splitscreen-Fix (Klaus' Befund 2026-06-22): im geteilten Bildschirm rutscht
  // die Pille aus dem Sichtfeld. Bei jeder Viewport-Änderung (resize /
  // orientationchange) die GEZOGENE (freie) Position ins sichtbare Feld
  // zurück-klemmen. Ecken-verankerte Widgets bleiben durch CSS am Rand und
  // brauchen keine Korrektur. Mindestens VIEWPORT_VISIBLE_MARGIN px bleiben am
  // Rand sichtbar (mirror der Drag-Clamp-Reserve von 24 px).
  var VIEWPORT_VISIBLE_MARGIN = 24;
  var viewportListenerAttached = false;

  function clampPositionIntoView() {
    if (!widgetRoot) return;
    if (currentFreeX === null || currentFreeY === null) return; // nur freie Position
    var vw = global.innerWidth || 1024;
    var vh = global.innerHeight || 768;
    var rect = widgetRoot.getBoundingClientRect();
    var w = rect.width || 44;
    var x = currentFreeX;
    var y = currentFreeY;
    var minX = -w + VIEWPORT_VISIBLE_MARGIN;
    var maxX = vw - VIEWPORT_VISIBLE_MARGIN;
    var minY = 0;
    var maxY = vh - VIEWPORT_VISIBLE_MARGIN;
    if (x > maxX) x = maxX;
    if (x < minX) x = minX;
    if (y > maxY) y = maxY;
    if (y < minY) y = minY;
    if (x !== currentFreeX || y !== currentFreeY) {
      currentFreeX = x;
      currentFreeY = y;
      applyPositionToRoot();
      persistPosition();
    }
  }

  function onViewportChange() { clampPositionIntoView(); }

  function attachViewportListener() {
    if (viewportListenerAttached) return;
    if (!global || typeof global.addEventListener !== "function") return;
    try {
      global.addEventListener("resize", onViewportChange);
      global.addEventListener("orientationchange", onViewportChange);
      viewportListenerAttached = true;
    } catch (_e) { /* fail-soft — ohne Listener bleibt nur die statische Position */ }
  }

  // ---- CSS-Injektion ----

  function buildCss() {
    return [
      "/* SBKIM Modul 22 Such-Widget — leicht transparent, klein→groß. */",
      "#" + WIDGET_ID + " {",
      "  position: fixed;",
      "  z-index: " + optZIndex + ";",
      "  font-family: 'Geist', system-ui, sans-serif;",
      "  color: #F5F5FF;",
      "  user-select: none;",
      "  -webkit-user-select: none;",
      "  touch-action: none;",
      "}",
      "#" + WIDGET_ID + ".sbkim-sw-hidden { display: none; }",
      "#" + WIDGET_ID + ".sbkim-sw-dragging .sbkim-sw-bubble,",
      "#" + WIDGET_ID + ".sbkim-sw-dragging .sbkim-sw-panel {",
      "  cursor: grabbing;",
      "  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);",
      "}",
      // Ruhezustand: Blase (collapsed). Leicht transparent.
      "#" + WIDGET_ID + " .sbkim-sw-bubble {",
      "  width: 44px;",
      "  height: 44px;",
      "  border-radius: 50%;",
      "  background: rgba(16, 16, 42, 0.90);",
      "  border: 1px solid rgba(255, 255, 255, 0.18);",
      "  backdrop-filter: blur(6px);",
      "  -webkit-backdrop-filter: blur(6px);",
      "  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  font-size: 1.2rem;",
      "  cursor: pointer;",
      "  color: #F5F5FF;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-bubble:hover { background: rgba(24, 24, 58, 0.94); }",
      // Interaktions-Zustand: Panel (expanded). Leicht transparent.
      "#" + WIDGET_ID + " .sbkim-sw-panel {",
      "  position: relative;",
      "  width: min(320px, 88vw);",
      "  background: rgba(16, 16, 42, 0.92);",
      "  border: 1px solid rgba(255, 255, 255, 0.18);",
      "  border-radius: 14px;",
      "  backdrop-filter: blur(8px);",
      "  -webkit-backdrop-filter: blur(8px);",
      "  box-shadow: 0 6px 28px rgba(0, 0, 0, 0.42);",
      "  padding: 0.55rem 0.65rem 0.7rem;",
      "}",
      // Zustand-Umschaltung via data-state.
      "#" + WIDGET_ID + "[data-state=\"collapsed\"] .sbkim-sw-panel { display: none; }",
      "#" + WIDGET_ID + "[data-state=\"expanded\"] .sbkim-sw-bubble { display: none; }",
      // Vollbild-Modus (⛶, Klaus 2026-06-22): zweite Anzeige derselben Treffer —
      // das Panel füllt den ganzen Viewport (kein Kern-Umbau, gleicher Inhalt).
      // !important schlägt die Inline-Position/-Größe (left/top/width).
      "#" + WIDGET_ID + ".sbkim-sw-fullscreen {",
      "  left: 0 !important;",
      "  top: 0 !important;",
      "  right: 0 !important;",
      "  bottom: 0 !important;",
      "  width: 100% !important;",
      "  height: 100% !important;",
      "  z-index: 9996;",
      "}",
      "#" + WIDGET_ID + ".sbkim-sw-fullscreen .sbkim-sw-bubble { display: none; }",
      "#" + WIDGET_ID + ".sbkim-sw-fullscreen .sbkim-sw-panel {",
      "  display: block;",
      "  width: 100% !important;",
      "  height: 100%;",
      "  max-width: none;",
      "  border-radius: 0;",
      "  box-sizing: border-box;",
      "  display: flex;",
      "  flex-direction: column;",
      "  overflow: auto;",
      "}",
      "#" + WIDGET_ID + ".sbkim-sw-fullscreen .sbkim-sw-results {",
      "  max-height: none !important;",
      "  flex: 1 1 auto;",
      "}",
      "#" + WIDGET_ID + ".sbkim-sw-fullscreen .sbkim-sw-resize { display: none; }",
      // Resize-Griff unten rechts (ziehbar — Breite + Lesefeld-Höhe).
      "#" + WIDGET_ID + " .sbkim-sw-resize {",
      "  position: absolute;",
      "  right: 2px;",
      "  bottom: 2px;",
      "  width: 18px;",
      "  height: 18px;",
      "  cursor: nwse-resize;",
      "  touch-action: none;",
      "  opacity: 0.55;",
      "  background: linear-gradient(135deg, transparent 0 44%, rgba(245,245,255,0.5) 44% 52%, transparent 52% 66%, rgba(245,245,255,0.5) 66% 74%, transparent 74%);",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-resize:hover { opacity: 1; }",
      "#" + WIDGET_ID + ".sbkim-sw-resizing { user-select: none; -webkit-user-select: none; }",
      "#" + WIDGET_ID + ".sbkim-sw-resizing .sbkim-sw-panel { box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5); }",
      // Kopfzeile: Drag-Griff + Knöpfe.
      "#" + WIDGET_ID + " .sbkim-sw-head {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 0.4rem;",
      "  margin-bottom: 0.45rem;",
      "  cursor: grab;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-title {",
      "  flex: 1;",
      "  font-size: 0.72rem;",
      "  letter-spacing: 0.04em;",
      "  text-transform: uppercase;",
      "  color: rgba(245, 245, 255, 0.6);",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-btn {",
      "  width: 20px;",
      "  height: 20px;",
      "  border-radius: 50%;",
      "  background: rgba(255, 255, 255, 0.08);",
      "  color: #F5F5FF;",
      "  border: 1px solid rgba(255, 255, 255, 0.18);",
      "  cursor: pointer;",
      "  font-size: 0.7rem;",
      "  line-height: 1;",
      "  padding: 0;",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  opacity: 0.7;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-btn:hover { opacity: 1; background: rgba(255, 255, 255, 0.16); }",
      // Bereichs-Auswahl + Optionen-Zeile (Checkbox-Pillen).
      "#" + WIDGET_ID + " .sbkim-sw-areas, #" + WIDGET_ID + " .sbkim-sw-optrow, #" + WIDGET_ID + " .sbkim-sw-viewrow {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 0.35rem;",
      "  flex-wrap: wrap;",
      "  margin-top: 0.4rem;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-viewrow .sbkim-sw-check.on { border-color: rgba(196, 181, 253, 0.6); color: rgba(196, 181, 253, 0.95); }",
      "#" + WIDGET_ID + " .sbkim-sw-check {",
      "  display: inline-flex;",
      "  align-items: center;",
      "  gap: 0.25rem;",
      "  font-size: 0.66rem;",
      "  color: rgba(245, 245, 255, 0.7);",
      "  cursor: pointer;",
      "  border: 1px solid rgba(255, 255, 255, 0.14);",
      "  border-radius: 999px;",
      "  padding: 0.1rem 0.45rem;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-check input { margin: 0; cursor: pointer; accent-color: #6EE7D3; }",
      "#" + WIDGET_ID + " .sbkim-sw-searxng {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  margin-top: 0.4rem;",
      "  background: rgba(0, 0, 0, 0.24);",
      "  border: 1px solid rgba(255, 255, 255, 0.14);",
      "  border-radius: 8px;",
      "  color: #F5F5FF;",
      "  font-size: 0.72rem;",
      "  padding: 0.3rem 0.45rem;",
      "  outline: none;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-richterrow {",
      "  display: flex;",
      "  gap: 0.3rem;",
      "  margin-top: 0.4rem;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-richterprov, #" + WIDGET_ID + " .sbkim-sw-richterkey, #" + WIDGET_ID + " .sbkim-sw-richtermodel {",
      "  box-sizing: border-box;",
      "  min-width: 0;",
      "  background: rgba(0, 0, 0, 0.24);",
      "  border: 1px solid rgba(167, 139, 250, 0.35);",
      "  border-radius: 8px;",
      "  color: #F5F5FF;",
      "  font-size: 0.72rem;",
      "  padding: 0.3rem 0.45rem;",
      "  outline: none;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-richterprov { flex: 0 0 auto; }",
      "#" + WIDGET_ID + " .sbkim-sw-richterkey { flex: 1 1 auto; }",
      "#" + WIDGET_ID + " .sbkim-sw-richtermodel { flex: 1 1 auto; }",
      "#" + WIDGET_ID + " .sbkim-sw-richterprov option { color: #1A1A1A; }",
      "#" + WIDGET_ID + " .sbkim-sw-engine {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  margin-top: 0.35rem;",
      "  background: rgba(0, 0, 0, 0.24);",
      "  border: 1px solid rgba(255, 255, 255, 0.14);",
      "  border-radius: 8px;",
      "  color: #F5F5FF;",
      "  font-size: 0.72rem;",
      "  padding: 0.3rem 0.45rem;",
      "  outline: none;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-engine option { color: #1A1A1A; }",
      "#" + WIDGET_ID + " .sbkim-sw-ai {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  margin-top: 0.35rem;",
      "  background: rgba(0, 0, 0, 0.24);",
      "  border: 1px solid rgba(167, 139, 250, 0.35);",
      "  border-radius: 8px;",
      "  color: #F5F5FF;",
      "  font-size: 0.72rem;",
      "  padding: 0.3rem 0.45rem;",
      "  outline: none;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-ai option { color: #1A1A1A; }",
      "#" + WIDGET_ID + " .sbkim-sw-aicontext {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  margin-top: 0.35rem;",
      "  background: rgba(0, 0, 0, 0.24);",
      "  border: 1px dashed rgba(167, 139, 250, 0.45);",
      "  border-radius: 8px;",
      "  color: #F5F5FF;",
      "  font-size: 0.7rem;",
      "  padding: 0.32rem 0.45rem;",
      "  outline: none;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-aibtn {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  margin-top: 0.35rem;",
      "  background: rgba(167, 139, 250, 0.18);",
      "  border: 1px solid rgba(167, 139, 250, 0.4);",
      "  border-radius: 8px;",
      "  color: #EDE9FE;",
      "  font-size: 0.72rem;",
      "  padding: 0.34rem 0.45rem;",
      "  cursor: pointer;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-aibtn:hover { background: rgba(167, 139, 250, 0.28); }",
      "#" + WIDGET_ID + " .sbkim-sw-aiauto { background: rgba(110, 231, 211, 0.16); border-color: rgba(110, 231, 211, 0.42); color: #CFFcF4; }",
      "#" + WIDGET_ID + " .sbkim-sw-aiauto:hover { background: rgba(110, 231, 211, 0.26); }",
      "#" + WIDGET_ID + " .sbkim-sw-progress {",
      "  position: relative;",
      "  height: 6px;",
      "  margin-top: 0.4rem;",
      "  border-radius: 4px;",
      "  background: rgba(255, 255, 255, 0.08);",
      "  overflow: hidden;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-progress .bar {",
      "  position: absolute;",
      "  top: 0;",
      "  height: 100%;",
      "  width: 38%;",
      "  left: -38%;",
      "  border-radius: 4px;",
      "  background: linear-gradient(90deg, rgba(167,139,250,0), rgba(167,139,250,0.95) 45%, rgba(110,231,211,0.95) 75%, rgba(110,231,211,0));",
      "  box-shadow: 0 0 10px rgba(167,139,250,0.55);",
      "  animation: sbkimSweep 1.3s ease-in-out infinite;",
      "}",
      "@keyframes sbkimSweep { 0% { left: -38%; } 100% { left: 100%; } }",
      "#" + WIDGET_ID + " .sbkim-sw-progress.done .bar {",
      "  width: 100%;",
      "  left: 0;",
      "  animation: none;",
      "  background: linear-gradient(90deg, rgba(110,231,211,0.95), rgba(167,139,250,0.95));",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-aipaste {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  margin-top: 0.35rem;",
      "  background: rgba(0, 0, 0, 0.28);",
      "  border: 1px solid rgba(255, 255, 255, 0.14);",
      "  border-radius: 8px;",
      "  color: #F5F5FF;",
      "  font-size: 0.7rem;",
      "  padding: 0.35rem 0.45rem;",
      "  resize: vertical;",
      "  outline: none;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-result .sbkim-sw-badge {",
      "  display: inline-block;",
      "  font-size: 0.58rem;",
      "  text-transform: uppercase;",
      "  letter-spacing: 0.04em;",
      "  color: #0B0B1A;",
      "  background: rgba(110, 231, 211, 0.85);",
      "  border-radius: 4px;",
      "  padding: 0 0.3rem;",
      "  margin-right: 0.3rem;",
      "  vertical-align: middle;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-result .sbkim-sw-badge.knoten { background: rgba(244, 180, 53, 0.85); }",
      "#" + WIDGET_ID + " .sbkim-sw-result .sbkim-sw-badge.internet { background: rgba(167, 139, 250, 0.9); color: #0B0B1A; }",
      "#" + WIDGET_ID + " a.sbkim-sw-result-link { color: #8EE7FF; text-decoration: none; }",
      "#" + WIDGET_ID + " a.sbkim-sw-result-link:hover { text-decoration: underline; }",
      // Eingabe-Zeile.
      "#" + WIDGET_ID + " .sbkim-sw-inrow {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 0.35rem;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-input {",
      "  flex: 1;",
      "  min-width: 0;",
      "  background: rgba(0, 0, 0, 0.28);",
      "  border: 1px solid rgba(255, 255, 255, 0.18);",
      "  border-radius: 8px;",
      "  color: #F5F5FF;",
      "  font-size: 0.86rem;",
      "  padding: 0.4rem 0.5rem;",
      "  outline: none;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-input::placeholder { color: rgba(245, 245, 255, 0.4); }",
      "#" + WIDGET_ID + " .sbkim-sw-iconbtn {",
      "  flex-shrink: 0;",
      "  width: 32px;",
      "  height: 32px;",
      "  border-radius: 8px;",
      "  background: rgba(255, 255, 255, 0.08);",
      "  color: #F5F5FF;",
      "  border: 1px solid rgba(255, 255, 255, 0.18);",
      "  cursor: pointer;",
      "  font-size: 0.95rem;",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-iconbtn:hover { background: rgba(255, 255, 255, 0.16); }",
      // EU-Politik-Chip.
      "#" + WIDGET_ID + " .sbkim-sw-euchip {",
      "  display: inline-block;",
      "  margin-top: 0.4rem;",
      "  font-size: 0.64rem;",
      "  letter-spacing: 0.03em;",
      "  color: rgba(245, 245, 255, 0.55);",
      "  cursor: pointer;",
      "  border: 1px solid rgba(255, 255, 255, 0.14);",
      "  border-radius: 999px;",
      "  padding: 0.12rem 0.5rem;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-euchip:hover { color: #F5F5FF; }",
      // Hinweis-Zeile (fail-soft Hinweise).
      "#" + WIDGET_ID + " .sbkim-sw-hint {",
      "  margin-top: 0.4rem;",
      "  font-size: 0.7rem;",
      "  color: #F4B435;",
      "  min-height: 0.9rem;",
      "}",
      // Treffer-Liste.
      "#" + WIDGET_ID + " .sbkim-sw-results {",
      "  margin-top: 0.5rem;",
      "  max-height: 40vh;",
      "  overflow: auto;",
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 0.3rem;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-result {",
      "  background: rgba(255, 255, 255, 0.05);",
      "  border: 1px solid rgba(255, 255, 255, 0.1);",
      "  border-radius: 8px;",
      "  padding: 0.35rem 0.5rem;",
      "  font-size: 0.8rem;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-result .sbkim-sw-score {",
      "  color: rgba(110, 231, 211, 0.85);",
      "  font-family: 'Geist Mono', ui-monospace, monospace;",
      "  font-size: 0.68rem;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-result .sbkim-sw-relscore {",
      "  color: rgba(245, 245, 255, 0.45);",
      "  font-family: 'Geist Mono', ui-monospace, monospace;",
      "  font-size: 0.68rem;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-result .sbkim-sw-relscore.is-related {",
      "  color: rgba(196, 181, 253, 0.95);",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-result .sbkim-sw-reason {",
      "  color: rgba(245, 245, 255, 0.6);",
      "  font-size: 0.7rem;",
      "  margin-top: 0.15rem;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-result .sbkim-sw-snippet {",
      "  color: rgba(245, 245, 255, 0.72);",
      "  font-size: 0.7rem;",
      "  line-height: 1.3;",
      "  margin-top: 0.12rem;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-more {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  margin-top: 0.4rem;",
      "  background: rgba(255, 255, 255, 0.06);",
      "  border: 1px solid rgba(255, 255, 255, 0.16);",
      "  border-radius: 8px;",
      "  color: rgba(245, 245, 255, 0.85);",
      "  font-size: 0.72rem;",
      "  padding: 0.32rem 0.45rem;",
      "  cursor: pointer;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-more:hover { background: rgba(255, 255, 255, 0.12); }",
      // KI-Zusammenfassung („warum diese Reihenfolge") oben über den Treffern.
      "#" + WIDGET_ID + " .sbkim-sw-summary {",
      "  margin-bottom: 0.5rem;",
      "  padding: 0.45rem 0.55rem;",
      "  background: rgba(167, 139, 250, 0.12);",
      "  border: 1px solid rgba(167, 139, 250, 0.4);",
      "  border-left: 3px solid rgba(167, 139, 250, 0.85);",
      "  border-radius: 8px;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-summary-head { display: flex; align-items: center; gap: 0.4rem; margin-bottom: 0.25rem; }",
      "#" + WIDGET_ID + " .sbkim-sw-summary-head span { flex: 1; font-size: 0.64rem; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(237, 233, 254, 0.85); }",
      "#" + WIDGET_ID + " .sbkim-sw-saybtn {",
      "  flex-shrink: 0;",
      "  background: rgba(167, 139, 250, 0.22);",
      "  border: 1px solid rgba(167, 139, 250, 0.45);",
      "  border-radius: 999px;",
      "  color: #EDE9FE;",
      "  font-size: 0.66rem;",
      "  padding: 0.12rem 0.5rem;",
      "  cursor: pointer;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-saybtn:hover { background: rgba(167, 139, 250, 0.32); }",
      "#" + WIDGET_ID + " .sbkim-sw-summary-text { font-size: 0.78rem; line-height: 1.4; color: rgba(245, 245, 255, 0.9); }",
      "#" + WIDGET_ID + " .sbkim-sw-copyall {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  margin-bottom: 0.4rem;",
      "  background: rgba(110, 231, 211, 0.14);",
      "  border: 1px solid rgba(110, 231, 211, 0.4);",
      "  border-radius: 8px;",
      "  color: #CFFcF4;",
      "  font-size: 0.72rem;",
      "  padding: 0.32rem 0.45rem;",
      "  cursor: pointer;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-copyall:hover { background: rgba(110, 231, 211, 0.22); }",
      "#" + WIDGET_ID + " .sbkim-sw-vault {",
      "  margin-top: 0.4rem;",
      "  padding: 0.45rem 0.5rem;",
      "  background: rgba(255, 255, 255, 0.05);",
      "  border: 1px solid rgba(167, 139, 250, 0.3);",
      "  border-radius: 10px;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-vnote { color: rgba(245, 245, 255, 0.72); font-size: 0.68rem; line-height: 1.3; margin: 0.15rem 0; }",
      "#" + WIDGET_ID + " .sbkim-sw-vinput {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  margin-top: 0.3rem;",
      "  background: rgba(0, 0, 0, 0.28);",
      "  border: 1px solid rgba(255, 255, 255, 0.16);",
      "  border-radius: 8px;",
      "  color: #F5F5FF;",
      "  font-size: 0.72rem;",
      "  padding: 0.32rem 0.45rem;",
      "  outline: none;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-vbtn {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  margin-top: 0.32rem;",
      "  background: rgba(167, 139, 250, 0.18);",
      "  border: 1px solid rgba(167, 139, 250, 0.4);",
      "  border-radius: 8px;",
      "  color: #EDE9FE;",
      "  font-size: 0.72rem;",
      "  padding: 0.34rem 0.45rem;",
      "  cursor: pointer;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-vbtn:hover { background: rgba(167, 139, 250, 0.28); }",
      "#" + WIDGET_ID + " .sbkim-sw-vdelete { background: rgba(255, 120, 120, 0.12); border-color: rgba(255, 120, 120, 0.35); color: rgba(255, 200, 200, 0.9); }",
      "#" + WIDGET_ID + " .sbkim-sw-vshares {",
      "  width: 100%;",
      "  box-sizing: border-box;",
      "  margin-top: 0.3rem;",
      "  background: rgba(0, 0, 0, 0.32);",
      "  border: 1px solid rgba(255, 255, 255, 0.16);",
      "  border-radius: 8px;",
      "  color: #F5F5FF;",
      "  font-size: 0.62rem;",
      "  font-family: 'Geist Mono', ui-monospace, monospace;",
      "  padding: 0.35rem 0.45rem;",
      "  resize: vertical;",
      "}",
      // Schärfen-Zeile: Feld + 🎤 nebeneinander.
      "#" + WIDGET_ID + " .sbkim-sw-ctxrow { margin-top: 0.35rem; }",
      "#" + WIDGET_ID + " .sbkim-sw-ctxrow .sbkim-sw-aicontext { flex: 1; min-width: 0; width: auto; margin-top: 0; }",
      // Merken-Haken pro Treffer (kleiner als die Bereichs-Pillen).
      "#" + WIDGET_ID + " .sbkim-sw-resultline { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }",
      "#" + WIDGET_ID + " .sbkim-sw-merkbox { border: none; padding: 0 0.1rem 0 0; }",
      "#" + WIDGET_ID + " .sbkim-sw-merkbox span { font-size: 0.7rem; }",
      "#" + WIDGET_ID + " .sbkim-sw-result-title { cursor: pointer; }",
      "#" + WIDGET_ID + " .sbkim-sw-result-title:hover { text-decoration: underline; }",
      // 📌-Kopf-Knopf hebt sich ab, wenn etwas gemerkt ist.
      "#" + WIDGET_ID + " .sbkim-sw-merkbtn.sbkim-sw-has-merk { background: rgba(244, 180, 53, 0.28); border-color: rgba(244, 180, 53, 0.6); opacity: 1; }",
      // Overlays (Detail-Karte + Merkliste) — über dem Panel, in Tool-Farben.
      "#" + WIDGET_ID + " .sbkim-sw-overlay {",
      "  position: absolute;",
      "  inset: 0;",
      "  z-index: 6;",
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 0.45rem;",
      "  padding: 0.6rem 0.65rem 0.7rem;",
      "  background: rgba(12, 12, 30, 0.97);",
      "  backdrop-filter: blur(8px);",
      "  -webkit-backdrop-filter: blur(8px);",
      "  border-radius: 14px;",
      "  overflow: auto;",
      "}",
      "#" + WIDGET_ID + " .sbkim-sw-overlay-head { display: flex; align-items: center; gap: 0.45rem; }",
      "#" + WIDGET_ID + " .sbkim-sw-overlay-title { flex: 1; font-size: 0.8rem; letter-spacing: 0.03em; color: #F5F5FF; }",
      "#" + WIDGET_ID + " .sbkim-sw-back { width: 24px; height: 24px; font-size: 0.95rem; opacity: 0.9; }",
      "#" + WIDGET_ID + " .sbkim-sw-detail-titel { font-size: 0.86rem; color: #F5F5FF; }",
      "#" + WIDGET_ID + " .sbkim-sw-detail-desc { font-size: 0.76rem; line-height: 1.35; color: rgba(245, 245, 255, 0.82); }",
      "#" + WIDGET_ID + " .sbkim-sw-detail-url { font-size: 0.68rem; color: #8EE7FF; word-break: break-all; }",
      "#" + WIDGET_ID + " .sbkim-sw-detail-open { background: rgba(110, 231, 211, 0.16); border-color: rgba(110, 231, 211, 0.42); color: #CFFcF4; }",
      "#" + WIDGET_ID + " .sbkim-sw-merk-empty { font-size: 0.74rem; color: rgba(245, 245, 255, 0.65); line-height: 1.35; }",
      "#" + WIDGET_ID + " .sbkim-sw-merk-group { border-top: 1px solid rgba(255,255,255,0.12); padding-top: 0.4rem; }",
      "#" + WIDGET_ID + " .sbkim-sw-merk-group-title { font-size: 0.78rem; font-weight: 600; color: #F4B435; margin-bottom: 0.3rem; }",
      "#" + WIDGET_ID + " .sbkim-sw-merk-item { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0.35rem 0.5rem; margin-bottom: 0.3rem; font-size: 0.8rem; }",
      "#" + WIDGET_ID + " .sbkim-sw-merk-actions { display: flex; gap: 0.35rem; margin-top: 0.25rem; }",
      "#" + WIDGET_ID + " .sbkim-sw-merk-actions .sbkim-sw-more { width: auto; margin-top: 0; flex: 1; }",
      "#" + WIDGET_ID + " .sbkim-sw-merk-remove { background: rgba(255, 120, 120, 0.12); border-color: rgba(255, 120, 120, 0.35); color: rgba(255, 200, 200, 0.9); }",
    ].join("\n");
  }

  function injectStyle(doc) {
    if (styleElement && styleElement.parentNode) return;
    if (!doc || !doc.head) return;
    var existing = doc.getElementById(STYLE_ID);
    if (existing) { styleElement = existing; return; }
    styleElement = doc.createElement("style");
    styleElement.id = STYLE_ID;
    styleElement.textContent = buildCss();
    doc.head.appendChild(styleElement);
  }

  // ---- DOM-Bau ----

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function makeBtn(doc, cls, label, ariaLabel) {
    var b = doc.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.setAttribute("aria-label", ariaLabel || label);
    return b;
  }

  // Checkbox + Label als eine kleine Pille. onChange(checked) bei Klick.
  function makeCheckbox(doc, id, labelText, checked, onChange) {
    var wrap = doc.createElement("label");
    wrap.className = "sbkim-sw-check";
    wrap.setAttribute("for", id);
    var input = doc.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = !!checked;
    input.addEventListener("change", function () { onChange(!!input.checked); });
    // Klick auf das Label (nicht die Box) togglet ebenfalls; stopPropagation,
    // damit der Drag-Mechanismus nicht anspringt.
    wrap.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    var span = doc.createElement("span");
    span.textContent = labelText;
    wrap.appendChild(input);
    wrap.appendChild(span);
    wrap._input = input;
    return wrap;
  }

  // „nur verwandte" ist nur im verwandt-Modus sinnvoll → sonst ausblenden. Hält
  // die Checkbox-Häkchen mit dem State synchron (z.B. nach setViewMode/Restore).
  function updateViewRowState() {
    if (viewModeCheckboxEl && viewModeCheckboxEl._input) viewModeCheckboxEl._input.checked = (viewMode === "verwandt");
    if (viewRelatedOnlyCheckboxEl) {
      if (viewRelatedOnlyCheckboxEl._input) viewRelatedOnlyCheckboxEl._input.checked = !!viewRelatedOnly;
      viewRelatedOnlyCheckboxEl.style.display = (viewMode === "verwandt") ? "" : "none";
    }
    if (viewKiCheckboxEl) {
      if (viewKiCheckboxEl._input) viewKiCheckboxEl._input.checked = !!viewKiRelated;
      viewKiCheckboxEl.style.display = (viewMode === "verwandt") ? "" : "none";
    }
  }

  function updateSearxngFieldVisibility() {
    var show = areas.internet.enabled ? "block" : "none";
    if (searxngFieldEl) searxngFieldEl.style.display = show;
    if (engineSelectEl) engineSelectEl.style.display = show;
    if (aiSelectEl) aiSelectEl.style.display = show;
    if (aiContextRowEl) aiContextRowEl.style.display = show ? "flex" : "none";
    if (aiPromptBtnEl) aiPromptBtnEl.style.display = show;
    if (aiAutoBtnEl) aiAutoBtnEl.style.display = show;
    if (aiPasteEl) aiPasteEl.style.display = show;
    if (aiSortBtnEl) aiSortBtnEl.style.display = show;
  }

  function buildWidget(doc) {
    var root = doc.createElement("div");
    root.id = WIDGET_ID;
    root.className = "sbkim-search-widget";
    root.setAttribute("role", "search");
    root.setAttribute("aria-label", "SBKIM Such-Widget");
    root.setAttribute("data-state", expandedFlag ? "expanded" : "collapsed");

    // --- Ruhezustand: Blase ---
    bubbleEl = doc.createElement("div");
    bubbleEl.className = "sbkim-sw-bubble";
    bubbleEl.setAttribute("role", "button");
    bubbleEl.setAttribute("tabindex", "0");
    bubbleEl.setAttribute("aria-label", "SBKIM-Suche öffnen");
    bubbleEl.textContent = "🔍";
    bubbleEl.addEventListener("click", function () {
      if (dragState && dragState.moved) return; // Drag, kein Tap
      expand();
    });
    root.appendChild(bubbleEl);

    // --- Interaktions-Zustand: Panel ---
    panelEl = doc.createElement("div");
    panelEl.className = "sbkim-sw-panel";

    // Kopfzeile (Drag-Griff + Minimieren + X).
    var head = doc.createElement("div");
    head.className = "sbkim-sw-head";
    var title = doc.createElement("span");
    title.className = "sbkim-sw-title";
    title.textContent = "SBKIM-Suche";
    head.appendChild(title);
    if (optShowReload) {
      reloadBtnEl = makeBtn(doc, "sbkim-sw-btn sbkim-sw-reloadbtn", "🔄", "App aktualisieren — Cache leeren und neu laden (holt die neueste Version)");
      reloadBtnEl.addEventListener("click", function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        hardReload();
      });
      head.appendChild(reloadBtnEl);
    }
    merkBtnEl = makeBtn(doc, "sbkim-sw-btn sbkim-sw-merkbtn", "📌", "Merkliste — Gemerktes, gruppiert nach Suchfrage");
    merkBtnEl.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      if (merkOverlayOpen) closeOverlays();
      else openMerkliste();
    });
    head.appendChild(merkBtnEl);
    var vaultBtn = makeBtn(doc, "sbkim-sw-btn sbkim-sw-vaultbtn", "🔐", "Schlüssel-Tresor (KI-Schlüssel sicher speichern)");
    vaultBtn.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      vaultSectionOpen = !vaultSectionOpen;
      renderVaultSection();
    });
    head.appendChild(vaultBtn);
    fullscreenBtnEl = makeBtn(doc, "sbkim-sw-btn sbkim-sw-fs", "⛶", "Vollbild — Suchraum groß (verkleinern: nochmal tippen)");
    fullscreenBtnEl.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      toggleFullscreen();
    });
    head.appendChild(fullscreenBtnEl);
    var minBtn = makeBtn(doc, "sbkim-sw-btn sbkim-sw-min", "–", "Minimieren — zurück zur Such-Blase");
    minBtn.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      collapse();
    });
    head.appendChild(minBtn);
    var closeBtn = makeBtn(doc, "sbkim-sw-btn sbkim-sw-close", "✕", "Oben als Lupe parken (verschwindet nicht — antippen holt es zurück)");
    closeBtn.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      dockToTop();
    });
    head.appendChild(closeBtn);
    panelEl.appendChild(head);

    // Eingabe-Zeile: Textfeld + Sprach-Knopf + Such-Knopf.
    var inrow = doc.createElement("div");
    inrow.className = "sbkim-sw-inrow";
    inputEl = doc.createElement("input");
    inputEl.type = "text";
    inputEl.className = "sbkim-sw-input";
    inputEl.setAttribute("placeholder", "Suchen oder sprechen …");
    inputEl.setAttribute("aria-label", "Such-Eingabe");
    // UX-Erhalt: Wert lebt zusätzlich in queryValue; Feld wird nie neu gebaut.
    inputEl.value = queryValue;
    inputEl.addEventListener("input", function () { queryValue = inputEl.value; persistQuery(); });
    inputEl.addEventListener("keydown", function (ev) {
      if (ev && ev.key === "Enter") { ev.preventDefault(); runAndRender(); }
    });
    inrow.appendChild(inputEl);

    voiceBtnEl = makeBtn(doc, "sbkim-sw-iconbtn sbkim-sw-voice", "🎤", "Spracheingabe (Modul 21)");
    voiceBtnEl.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      onVoiceClick();
    });
    inrow.appendChild(voiceBtnEl);

    // 📷 OCR-Knopf (Strang B2): Foto/Handschrift → Suchtext via Modul 24.
    ocrBtnEl = makeBtn(doc, "sbkim-sw-iconbtn sbkim-sw-ocr", "📷", "Foto/Handschrift → Suchtext (Mistral OCR, EU)");
    ocrBtnEl.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      onOcrClick();
    });
    inrow.appendChild(ocrBtnEl);

    searchBtnEl = makeBtn(doc, "sbkim-sw-iconbtn sbkim-sw-search", "🔍", "Suchen");
    searchBtnEl.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      runAndRender();
    });
    inrow.appendChild(searchBtnEl);
    panelEl.appendChild(inrow);

    // Bereichs-Auswahl (Mehrfach ankreuzbar): App · Knoten · Internet.
    areaRowEl = doc.createElement("div");
    areaRowEl.className = "sbkim-sw-areas";
    var areaIds = ["app", "knoten", "internet"];
    for (var ai = 0; ai < areaIds.length; ai++) {
      (function (id) {
        var box = makeCheckbox(doc, "sbkim-sw-area-" + id, areas[id].label, areas[id].enabled,
          function (checked) {
            areas[id].enabled = checked;
            updateSearxngFieldVisibility();
          });
        if (id === "internet") internetCheckboxEl = box;
        areaRowEl.appendChild(box);
      })(areaIds[ai]);
    }
    panelEl.appendChild(areaRowEl);

    // Anzeige-Sicht-Zeile (Brief „Wählen"-UI): „verbunden" (grob, alle erreichbaren)
    // ↔ „verwandt" (genau, nach zentriertem Cosinus sortiert). REINE ANZEIGE — der
    // Andock-Handshake (0.80) bleibt unberührt.
    viewRowEl = doc.createElement("div");
    viewRowEl.className = "sbkim-sw-viewrow";
    viewModeCheckboxEl = makeCheckbox(doc, "sbkim-sw-view-verwandt", "🧬 verwandt (genau)",
      viewMode === "verwandt", function (checked) {
        viewMode = checked ? "verwandt" : "verbunden";
        persistViewPref();
        updateViewRowState();
        if (lastRenderRes) renderResults(lastRenderRes);
      });
    viewModeCheckboxEl.setAttribute("title",
      "Aus: verbunden (grob) — alle erreichbaren Treffer. An: verwandt (genau) — eine Rangfolge nach Themen-Bezug (gratis zentrierter Cosinus). Mit „· KI“ urteilt der KI-Richter über die Bedeutung.");
    viewRowEl.appendChild(viewModeCheckboxEl);

    viewRelatedOnlyCheckboxEl = makeCheckbox(doc, "sbkim-sw-view-onlyrelated", "nur verwandte",
      viewRelatedOnly, function (checked) {
        viewRelatedOnly = checked;
        persistViewPref();
        if (lastRenderRes) renderResults(lastRenderRes);
      });
    viewRelatedOnlyCheckboxEl.setAttribute("title",
      "Nur im verwandt-Modus: blendet fremde Domänen (nicht wirklich verwandt) ganz aus.");

    // „· KI" — verwandt-Maß vom KI-Richter beurteilen lassen (opt-in, BYOK).
    // Nutzt das vorhandene Richter-Anbieter-Dropdown + Schlüsselfeld (unten).
    // Ohne Schlüssel → fail-soft auf den gratis Cosinus. REINE ANZEIGE.
    viewKiCheckboxEl = makeCheckbox(doc, "sbkim-sw-view-ki", "· KI",
      viewKiRelated, function (checked) {
        viewKiRelated = checked;
        persistViewPref();
        if (checked && !optApiKey) {
          setHint("„· KI“ braucht einen Schlüssel — Tresor (🔐) entsperren oder unten eintragen. Bis dahin: gratis Cosinus.");
        }
        if (lastRenderRes) renderResults(lastRenderRes);
      });
    viewKiCheckboxEl.setAttribute("title",
      "Nur im verwandt-Modus: das echte Verwandtschafts-Maß vom KI-Richter (über die Bedeutung) beurteilen lassen. Braucht einen Schlüssel; ohne Schlüssel bleibt der gratis zentrierte Cosinus.");
    viewRowEl.appendChild(viewRelatedOnlyCheckboxEl);
    viewRowEl.appendChild(viewKiCheckboxEl);
    panelEl.appendChild(viewRowEl);
    updateViewRowState();

    // Optionen-Zeile: KI-Richter-Schalter + EU-Politik-Chip.
    var optRow = doc.createElement("div");
    optRow.className = "sbkim-sw-optrow";
    richterToggleEl = makeCheckbox(doc, "sbkim-sw-richter", "KI-Richter", richterOn,
      function (checked) { richterOn = checked; });
    richterToggleEl.setAttribute("title", "KI-Richter an: urteilt zusätzlich (braucht Schlüssel, kostet). Aus: gratis, rein semantisch.");
    optRow.appendChild(richterToggleEl);

    euChipEl = doc.createElement("button");
    euChipEl.type = "button";
    euChipEl.className = "sbkim-sw-euchip";
    euChipEl.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      setEuPolicy(optEuPolicy === "frei" ? "bindend" : "frei");
    });
    optRow.appendChild(euChipEl);
    panelEl.appendChild(optRow);

    // KI-Richter-Anbieter (gratis: Gemini/OpenRouter) + Schlüssel + optionales
    // Modell. Greift, wenn KI-Richter an ist. Schlüssel bleibt NUR im Speicher
    // (nicht persistiert) — wie die Pinnwand (BYOK, kein Key im Code/Storage).
    richterRowEl = doc.createElement("div");
    richterRowEl.className = "sbkim-sw-richterrow";

    richterProviderSelectEl = doc.createElement("select");
    richterProviderSelectEl.className = "sbkim-sw-richterprov";
    richterProviderSelectEl.setAttribute("aria-label", "KI-Richter-Anbieter (Antwort-Sortierung)");
    rebuildRichterProviderOptions();
    richterProviderSelectEl.addEventListener("change", function () {
      optProvider = richterProviderSelectEl.value;
      updateRichterModelPlaceholder();
    });
    richterProviderSelectEl.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    richterRowEl.appendChild(richterProviderSelectEl);

    richterKeyEl = doc.createElement("input");
    richterKeyEl.type = "password";
    richterKeyEl.className = "sbkim-sw-richterkey";
    richterKeyEl.setAttribute("placeholder", "API-Schlüssel (bleibt nur auf diesem Gerät)");
    richterKeyEl.setAttribute("aria-label", "API-Schlüssel für den KI-Richter");
    richterKeyEl.setAttribute("autocomplete", "off");
    richterKeyEl.addEventListener("input", function () { optApiKey = richterKeyEl.value.trim() || null; });
    richterKeyEl.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    richterRowEl.appendChild(richterKeyEl);

    richterModelEl = doc.createElement("input");
    richterModelEl.type = "text";
    richterModelEl.className = "sbkim-sw-richtermodel";
    richterModelEl.setAttribute("aria-label", "KI-Richter-Modell (optional)");
    richterModelEl.addEventListener("input", function () { optRichterModel = richterModelEl.value.trim(); });
    richterModelEl.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    richterRowEl.appendChild(richterModelEl);
    updateRichterModelPlaceholder();

    panelEl.appendChild(richterRowEl);

    // SearXNG-URL-Feld (nur sichtbar, wenn Internet-Bereich aktiv). Leer →
    // Internet = neuer Tab; gesetzt → semantischer Web-Re-Ranker.
    searxngFieldEl = doc.createElement("input");
    searxngFieldEl.type = "text";
    searxngFieldEl.className = "sbkim-sw-searxng";
    searxngFieldEl.setAttribute("placeholder", "SearXNG-URL (optional, für Web-Treffer im Widget)");
    searxngFieldEl.setAttribute("aria-label", "SearXNG-Instanz-URL für die Internet-Suche");
    searxngFieldEl.value = searxngUrl;
    searxngFieldEl.addEventListener("input", function () { searxngUrl = searxngFieldEl.value.trim(); });
    panelEl.appendChild(searxngFieldEl);

    // Web-Suchmaschine frei wählbar (Neuer-Tab-Weg). Nur sichtbar, wenn Internet
    // aktiv ist (gemeinsam mit dem SearXNG-Feld).
    engineSelectEl = doc.createElement("select");
    engineSelectEl.className = "sbkim-sw-engine";
    engineSelectEl.setAttribute("aria-label", "Web-Suchmaschine für den Internet-Bereich");
    for (var ei = 0; ei < WEB_ENGINES.length; ei++) {
      var opt = doc.createElement("option");
      opt.value = WEB_ENGINES[ei].id;
      opt.textContent = "Suchmaschine: " + WEB_ENGINES[ei].label;
      if (WEB_ENGINES[ei].id === optWebEngine) opt.selected = true;
      engineSelectEl.appendChild(opt);
    }
    engineSelectEl.addEventListener("change", function () {
      optWebEngine = engineSelectEl.value;
      persistEngine();
    });
    engineSelectEl.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    panelEl.appendChild(engineSelectEl);

    // ---- KI-Such-Brücke Stufe A: Anbieter-Wahl + Prompt-Knopf + Einfüge-Feld ----
    aiSelectEl = doc.createElement("select");
    aiSelectEl.className = "sbkim-sw-ai";
    aiSelectEl.setAttribute("aria-label", "KI-Anbieter für die Internet-Suche");
    rebuildAiProviderOptions();
    aiSelectEl.addEventListener("change", function () { optAiProvider = aiSelectEl.value; });
    aiSelectEl.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    panelEl.appendChild(aiSelectEl);

    // Schärfen-Feld: aktiv zum Präzisieren auffordern (Klaus 2026-06-21 —
    // wenige Worte tragen die Absicht oft nicht; vgl. NoBite-Befund). Mit eigenem
    // 🎤 Sprach-Knopf (Klaus 2026-06-23): das Schärfen lässt sich auch einsprechen.
    var ctxRow = doc.createElement("div");
    ctxRow.className = "sbkim-sw-inrow sbkim-sw-ctxrow";
    aiContextEl = doc.createElement("input");
    aiContextEl.type = "text";
    aiContextEl.className = "sbkim-sw-aicontext";
    aiContextEl.setAttribute("placeholder", "Schärfen (optional): Zweck? · Region/Land? · Art/Form? · Marke/Budget?");
    aiContextEl.setAttribute("aria-label", "Suche schärfen — optionaler Kontext");
    aiContextEl.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    ctxRow.appendChild(aiContextEl);
    var ctxVoiceBtn = makeBtn(doc, "sbkim-sw-iconbtn sbkim-sw-ctxvoice", "🎤", "Schärfen einsprechen (Spracheingabe)");
    ctxVoiceBtn.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      onVoiceClick(aiContextEl);
    });
    ctxRow.appendChild(ctxVoiceBtn);
    aiContextRowEl = ctxRow;
    panelEl.appendChild(ctxRow);

    aiPromptBtnEl = makeBtn(doc, "sbkim-sw-aibtn", "🤖 Prompt → KI (öffnen + kopieren)", "Prompt bauen, kopieren und die KI öffnen (eigene App läuft parallel)");
    aiPromptBtnEl.addEventListener("click", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      handleAiPromptClick();
    });
    panelEl.appendChild(aiPromptBtnEl);

    // B2-Probe: automatischer Aufruf (nur Claude, braucht Schlüssel im Tresor).
    aiAutoBtnEl = makeBtn(doc, "sbkim-sw-aibtn sbkim-sw-aiauto", "⚡ Automatisch (Claude, Tresor)", "Direkt aufrufen — braucht entsperrten Tresor / Schlüssel; nur Claude (Probe)");
    aiAutoBtnEl.addEventListener("click", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      handleAutoClick();
    });
    panelEl.appendChild(aiAutoBtnEl);

    // Fortschrittsbalken (über dem Einfüge-Feld) — läuft während Claude im Netz
    // sucht, füllt sich, wenn die Antwort da ist (Klaus 2026-06-21).
    aiProgressEl = doc.createElement("div");
    aiProgressEl.className = "sbkim-sw-progress";
    aiProgressEl.style.display = "none";
    var progBar = doc.createElement("div");
    progBar.className = "bar";
    aiProgressEl.appendChild(progBar);
    panelEl.appendChild(aiProgressEl);

    aiPasteEl = doc.createElement("textarea");
    aiPasteEl.className = "sbkim-sw-aipaste";
    aiPasteEl.setAttribute("rows", "3");
    aiPasteEl.setAttribute("placeholder", "KI-Antwort (JSON) hier einfügen …");
    aiPasteEl.setAttribute("aria-label", "KI-Antwort einfügen");
    aiPasteEl.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    panelEl.appendChild(aiPasteEl);

    aiSortBtnEl = makeBtn(doc, "sbkim-sw-aibtn", "↓ Antwort sortieren", "KI-Antwort übernehmen und semantisch sortieren");
    aiSortBtnEl.addEventListener("click", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      handleAiSortClick();
    });
    panelEl.appendChild(aiSortBtnEl);

    // Tresor-Sektion (🔐, standardmäßig zu) — füllt sich je nach Zustand.
    vaultSectionEl = doc.createElement("div");
    vaultSectionEl.className = "sbkim-sw-vault";
    vaultSectionEl.style.display = "none";
    vaultSectionEl.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    panelEl.appendChild(vaultSectionEl);
    renderVaultSection();

    // Hinweis-Zeile + Treffer-Liste.
    hintEl = doc.createElement("div");
    hintEl.className = "sbkim-sw-hint";
    panelEl.appendChild(hintEl);
    resultsEl = doc.createElement("div");
    resultsEl.className = "sbkim-sw-results";
    panelEl.appendChild(resultsEl);

    // Resize-Griff unten rechts — Panel ziehbar (Breite + Lesefeld-Höhe). Nur
    // wenn Drag erlaubt ist (gepinnte Widgets bleiben unverändert in Größe/Ort).
    if (optAllowDrag) {
      resizeHandleEl = doc.createElement("div");
      resizeHandleEl.className = "sbkim-sw-resize";
      resizeHandleEl.setAttribute("aria-label", "Größe ziehen — Breite und Lesefeld-Höhe");
      resizeHandleEl.setAttribute("title", "Ziehen, um das Such-Panel breiter/höher zu machen");
      attachResizeHandlers(resizeHandleEl);
      panelEl.appendChild(resizeHandleEl);
    }

    // Overlays (Detail-Karte + Merkliste) — absolut über dem Panel, anfangs zu.
    detailOverlayEl = doc.createElement("div");
    detailOverlayEl.className = "sbkim-sw-overlay sbkim-sw-detail";
    detailOverlayEl.style.display = "none";
    detailOverlayEl.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    panelEl.appendChild(detailOverlayEl);

    merkOverlayEl = doc.createElement("div");
    merkOverlayEl.className = "sbkim-sw-overlay sbkim-sw-merk";
    merkOverlayEl.style.display = "none";
    merkOverlayEl.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    panelEl.appendChild(merkOverlayEl);

    root.appendChild(panelEl);

    if (optAllowDrag) attachDragHandlers(root);
    updateEuChip();
    updateSearxngFieldVisibility();
    applySizeToPanel();
    updateMerkBtn();
    renderOverlays();
    return root;
  }

  function updateEuChip() {
    if (!euChipEl) return;
    var label = optEuPolicy === "bindend"
      ? "EU-Politik: bindend (nur EU)"
      : "EU-Politik: frei (EU wählbar)";
    euChipEl.textContent = label;
    euChipEl.setAttribute("aria-label", label + " — Klick wechselt");
  }

  function setHint(text) {
    if (hintEl) hintEl.textContent = text || "";
  }

  function appendToInput(text) {
    if (!text) return;
    // UX-Erhalt: an den LIVE-Feldwert anhängen (nicht nur an den RAM-Spiegel),
    // damit programmatisch oder per Tastatur gesetzter Text nicht verloren geht.
    var base = inputEl ? inputEl.value : queryValue;
    queryValue = (base ? base + " " : "") + text;
    if (inputEl) inputEl.value = queryValue;
    persistQuery();
  }

  // Erkannten Text an ein beliebiges Feld anhängen (Such-Feld ODER Schärfen-Feld).
  function appendToField(el, text) {
    if (!text) return;
    if (el === inputEl || !el) { appendToInput(text); return; }
    var base = el.value || "";
    el.value = (base ? base + " " : "") + text;
  }

  // ---- EU-Politik ----

  function setEuPolicy(p) {
    optEuPolicy = normalizeEuPolicy(p);
    updateEuChip();
    rebuildAiProviderOptions();        // EU-bindend → nur EU-KI-Anbieter (DSGVO)
    rebuildRichterProviderOptions();   // dasselbe für den KI-Richter (Sortierung)
  }

  // bindend → euOnly:true erzwungen; frei → optEuOnly (Default false, EU wählbar).
  function euOnlyForPolicy() {
    return optEuPolicy === "bindend" ? true : !!optEuOnly;
  }

  // ---- KI-Richter-Anbieter (Sortierung) ----
  // Spiegelt Modul 04 HYBRID_PROVIDERS (Auswahl). EU-Politik "bindend" → nur
  // EU-Anbieter (DSGVO). Gemini/OpenRouter sind die gratis-tauglichen.
  var RICHTER_PROVIDERS = [
    { id: "gemini",     label: "Richter: Gemini (gratis)",     eu: false },
    { id: "openrouter", label: "Richter: OpenRouter (gratis)", eu: false },
    { id: "claude",     label: "Richter: Claude",              eu: false },
    { id: "mistral",    label: "Richter: Mistral (EU)",        eu: true },
  ];
  function richterProvidersForPolicy() {
    if (optEuPolicy === "bindend") {
      return RICHTER_PROVIDERS.filter(function (p) { return p.eu; });
    }
    return RICHTER_PROVIDERS.slice();
  }
  function richterModelDefaultFor(id) {
    if (id === "gemini") return "automatisch";
    if (id === "openrouter") return "meta-llama/llama-3.3-70b-instruct:free";
    if (id === "claude") return "claude-haiku-4-5";
    if (id === "mistral") return "mistral-small-latest";
    return "Standard";
  }
  function updateRichterModelPlaceholder() {
    if (!richterModelEl) return;
    richterModelEl.setAttribute("placeholder", "Modell (optional) · Standard: " + richterModelDefaultFor(optProvider));
  }
  function rebuildRichterProviderOptions() {
    if (!richterProviderSelectEl) return;
    var d = global.document;
    var list = richterProvidersForPolicy();
    var keep = optProvider, stillThere = false, i;
    while (richterProviderSelectEl.children.length) richterProviderSelectEl.removeChild(richterProviderSelectEl.children[0]);
    for (i = 0; i < list.length; i++) {
      var o = d.createElement("option");
      o.value = list[i].id; o.textContent = list[i].label;
      if (list[i].id === keep) { o.selected = true; stillThere = true; }
      richterProviderSelectEl.appendChild(o);
    }
    if (!stillThere && list.length) { optProvider = list[0].id; richterProviderSelectEl.children[0].selected = true; }
    updateRichterModelPlaceholder();
  }

  // ---- Spracheingabe (Modul 21) ----

  function onVoiceClick(targetEl) {
    var target = targetEl || inputEl;
    var speech = global.SbkimSpeech;
    if (!speech || typeof speech.pickEngine !== "function") {
      setHint("Modul 21 (Spracheingabe) nicht geladen — bitte tippen.");
      return;
    }
    var engine;
    try { engine = speech.pickEngine(optEuPolicy); }
    catch (e) { setHint(speech.speechErrorHint ? speech.speechErrorHint(e) : "Spracheingabe nicht möglich — bitte tippen."); return; }

    if (engine === "browser" && typeof speech.isBrowserSupported === "function" &&
        speech.isBrowserSupported()) {
      var lang = (speech.getLanguages()[0] || ["de-DE"])[0];
      try {
        activeRecognizer = speech.makeBrowserRecognizer({
          lang: lang,
          onResult: function (t) { appendToField(target, t); setHint("Erkannt: " + t); },
          onError: function (h) { setHint(h); },
          onEnd: function () { activeRecognizer = null; },
        });
        activeRecognizer.start();
        setHint("Sprich jetzt …");
      } catch (e) {
        setHint(speech.speechErrorHint ? speech.speechErrorHint(e) : "Spracheingabe nicht möglich — bitte tippen.");
      }
      return;
    }
    // EU-Engine braucht Schlüssel + Aufnahme — in Increment 1 fail-soft.
    setHint("Sprach-Engine '" + engine + "' braucht einen EU-Schlüssel — bitte tippen.");
  }

  // 📷 OCR-Eingabe (Strang B2): Foto/Handschrift → Suchtext via Modul 24.
  // Öffnet einen Datei-Wähler, lässt das Bild per Mistral OCR (EU, BYOK) erkennen
  // und hängt den Text ans Feld. EU-Politik des Widgets gilt. Fail-soft.
  function onOcrClick(targetEl) {
    var target = targetEl || inputEl;
    var ocr = global.SbkimOcr;
    if (!ocr || typeof ocr.recognize !== "function") {
      setHint("Modul 24 (OCR) nicht geladen — bitte tippen.");
      return;
    }
    var doc = global.document;
    if (!doc || typeof global.FileReader !== "function") {
      setHint("OCR braucht einen Browser — bitte tippen.");
      return;
    }
    var inp = doc.createElement("input");
    inp.type = "file";
    inp.accept = "image/*,application/pdf";
    inp.setAttribute("capture", "environment");
    inp.style.display = "none";
    inp.addEventListener("change", function () {
      var file = inp.files && inp.files[0];
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      if (!file) return;
      if (!ocrKey) {
        var k = (typeof global.prompt === "function")
          ? global.prompt("OCR-Schlüssel (EU/Mistral, nur diese Sitzung — wird nicht gespeichert):") : null;
        if (!k) return;
        ocrKey = String(k).trim();
      }
      setHint("📷 Texterkennung läuft …");
      var reader = new global.FileReader();
      reader.onload = function (ev) {
        ocr.recognize(String(ev.target.result),
          { provider: "mistral", apiKey: ocrKey, mimeType: file.type, euPolicy: optEuPolicy })
          .then(function (r) {
            if (r && r.available) {
              appendToField(target, r.text || "");
              var ver = r.model ? (" · Mistral OCR " + r.model) : "";
              setHint((r.text ? ("Erkannt (" + r.text.length + " Zeichen)") : "Kein Text erkannt") + ver);
            } else {
              var reason = (r && r.reason) || "Texterkennung nicht möglich.";
              if (/Schlüssel/.test(reason)) ocrKey = "";
              setHint("⚠️ " + reason);
            }
          })
          .catch(function (e) {
            setHint("⚠️ " + (ocr.ocrErrorHint ? ocr.ocrErrorHint(e) : "Texterkennung nicht möglich — bitte tippen."));
          });
      };
      reader.onerror = function () { setHint("Bild konnte nicht gelesen werden."); };
      reader.readAsDataURL(file);
    });
    (doc.body || doc.documentElement).appendChild(inp);
    inp.click();
  }

  // ---- Komponierte Suche (Vorfilter → Richter → Fail-soft) ----
  // Spiegelung des Helfers sbkimHybridSearch aus HYBRID-MATCH-EINBAU.md.

  function search(text, onLive) {
    return runMultiSearch(text, onLive);
  }

  // Lazy-Korpus-Vorbereitung: führt corpusPreparer EINMAL aus (Embedding etc.),
  // setzt den Korpus und cacht das Ergebnis. Parallele Aufrufe teilen sich eine
  // in-flight-Promise. Fehler lassen corpusReady false (nächster Versuch darf neu
  // vorbereiten). Zeigt während der Vorbereitung einen Hinweis.
  function ensureCorpusPrepared() {
    if (corpusReady) return Promise.resolve();
    if (typeof corpusPreparer !== "function") return Promise.resolve();
    if (corpusPrepPromise) return corpusPrepPromise;
    setHint("Suchindex wird vorbereitet … (einmalig, kann etwas dauern)");
    corpusPrepPromise = Promise.resolve()
      .then(function () { return corpusPreparer(); })
      .then(function (prepared) {
        if (Array.isArray(prepared)) setCorpus(prepared);
        corpusReady = true;
        corpusPrepPromise = null;
        setHint("");
      })
      .catch(function (err) {
        corpusPrepPromise = null;
        throw err;
      });
    return corpusPrepPromise;
  }

  // Lazy-Vorbereitung des Knoten-Korpus (verbundene Mycel-Knoten), analog
  // ensureCorpusPrepared für den App-Korpus.
  function ensureNodeCorpusPrepared() {
    if (nodeCorpusReady) return Promise.resolve();
    if (typeof nodeCorpusPreparer !== "function") return Promise.resolve();
    if (nodeCorpusPrepPromise) return nodeCorpusPrepPromise;
    nodeCorpusPrepPromise = Promise.resolve()
      .then(function () { return nodeCorpusPreparer(); })
      .then(function (prepared) {
        if (Array.isArray(prepared)) nodeCorpus = prepared.slice();
        nodeCorpusReady = true;
        nodeCorpusPrepPromise = null;
      })
      .catch(function (err) { nodeCorpusPrepPromise = null; throw err; });
    return nodeCorpusPrepPromise;
  }

  function activeAreaIds() {
    var out = [];
    if (areas.app.enabled) out.push("app");
    if (areas.knoten.enabled) out.push("knoten");
    if (areas.internet.enabled) out.push("internet");
    return out;
  }

  function engineById(id) {
    for (var i = 0; i < WEB_ENGINES.length; i++) { if (WEB_ENGINES[i].id === id) return WEB_ENGINES[i]; }
    return WEB_ENGINES[0]; // DuckDuckGo-Fallback
  }

  // Web-Suchmaschine frei wählbar (Klaus 2026-06-21); DuckDuckGo Default.
  // SearXNG nimmt die eigene Instanz aus dem SearXNG-Feld, sonst öffentliche.
  function webSearchUrl(query) {
    if (optWebEngine === "searxng") {
      var base = (searxngUrl ? searxngUrl : SEARXNG_PUBLIC_DEFAULT).replace(/\/+$/, "");
      return base + "/search?q=" + encodeURIComponent(query);
    }
    return engineById(optWebEngine).url + encodeURIComponent(query);
  }

  function loadEngineFromLs() {
    var raw = lsGet(LS_KEY_ENGINE);
    if (raw) { for (var i = 0; i < WEB_ENGINES.length; i++) { if (WEB_ENGINES[i].id === raw) { optWebEngine = raw; return; } } }
  }

  function persistEngine() { lsSet(LS_KEY_ENGINE, optWebEngine); }

  // ---- KI-Such-Brücke (Increment 2 Stufe A — Gratis-Kopier-Pfad) ----
  // Der Nutzer fragt eine KI mit Websuche; deren JSON-Quellen werden eingefügt
  // und semantisch sortiert. KEIN Schlüssel hier (Stufe A); Stufe B (Tresor +
  // automatischer API-Aufruf) ist eine eigene Folge-Sitzung. openUrl bettet den
  // Prompt best-effort in die Such-URL des Anbieters ein (Clipboard bleibt die
  // verlässliche Quelle). euBased = im EU-Raum gehostet (DSGVO).
  // Anbieter-Set für die KI-Such-Brücke. Mistral + Aleph Alpha bewusst RAUS
  // (Klaus-Entscheidung 2026-06-21): Aleph Alpha kann keine Web-Suche (für ein
  // Such-Werkzeug nutzlos), Mistral lieferte in mehreren Tests schwach. Das gilt
  // NUR für dieses Widget — BLP nutzt Mistral weiter intern für seine eigene
  // Sache. euBased bleibt als Mechanik erhalten, falls je ein brauchbarer
  // EU-Web-Such-Anbieter dazukommt.
  var AI_PROVIDERS = [
    { id: "chatgpt",    label: "ChatGPT (OpenAI)",   openUrl: "https://chatgpt.com/?q=",             euBased: false, webSearch: true },
    { id: "claude",     label: "Claude (Anthropic)", openUrl: "https://claude.ai/new?q=",            euBased: false, webSearch: true },
    { id: "gemini",     label: "Gemini (Google)",    openUrl: "https://gemini.google.com/app?q=",    euBased: false, webSearch: true },
    { id: "perplexity", label: "Perplexity",         openUrl: "https://www.perplexity.ai/search?q=", euBased: false, webSearch: true },
  ];

  function aiProviderById(id) {
    for (var i = 0; i < AI_PROVIDERS.length; i++) { if (AI_PROVIDERS[i].id === id) return AI_PROVIDERS[i]; }
    return AI_PROVIDERS[0];
  }
  // Bei EU-bindender Politik EU-Anbieter bevorzugen — solange es welche gibt.
  // Aktuell gibt es keinen (web-such-fähigen) EU-Anbieter mehr, also Fallback auf
  // alle, statt ein leeres Dropdown zu zeigen.
  function aiProvidersForPolicy() {
    if (optEuPolicy === "bindend") {
      var eu = AI_PROVIDERS.filter(function (p) { return p.euBased; });
      if (eu.length) return eu;
    }
    return AI_PROVIDERS.slice();
  }

  // Prompt aus der Such-Frage bauen. Führt mit der Agenten-Visitenkarte
  // (Klaus' Vision 2026-06-21): das Tool stellt ZUERST sein Ziel vor — das
  // semantische Verstehen beginnt am Handschlag, nicht erst bei der Frage.
  // Code-Block-Regel → ChatGPT zeigt einen „Copy"-Knopf + liefert saubere URLs.
  function buildAiPrompt(query, context) {
    var q = (typeof query === "string" ? query : "").trim();
    var ctx = (typeof context === "string" ? context : "").trim();
    var lines = [
      "— SBKIM-Such-Agent · Visitenkarte —",
      "Ich bin ein semantisches Such-Werkzeug des SBKIM-Mycels (server-los, peer-to-peer).",
      "Mein Ziel: nach BEDEUTUNG/Absicht finden, nicht nach Stichwörtern.",
      "Ich biete eine strukturierte JSON-Treffer-Liste, die ich selbst nach Bedeutung sortiere.",
      "Prüfe als Gegen-Agent zuerst, ob du zu diesem Ziel beitragen kannst — und arbeite dann in diesem Sinn.",
      "",
      "Suche im Internet zu meiner Frage und gib mir möglichst viele ECHTE, verschiedene Quellseiten.",
      "",
      "Meine Frage: " + q,
    ];
    if (ctx) lines.push("Was ich genau meine (Kontext): " + ctx);
    return lines.concat([
      "",
      "VERSTEHE ZUERST DIE BEDEUTUNG meiner Frage und suche danach — NICHT nach bloßen Wörtern:",
      "- Überlege zuerst kurz, was ich WIRKLICH meine: meine Absicht, mein Ziel, mein Kontext",
      "  (wozu, in welchem Land, welche Form, käuflich vs. selbstgemacht …). Wenige Worte sagen",
      "  nicht alles — lies die Absicht heraus, wie ein Mensch, der versteht, worauf ich hinauswill.",
      "- Suche dann nach dieser BEDEUTUNG/Absicht (Semantik), nicht nach exakten Stichwörtern.",
      "  Nimm ausdrücklich auch Treffer auf, die meine Wörter NICHT enthalten, aber meine Absicht",
      "  genau erfüllen — konkrete Produkt-/Markennamen, Wirkstoffe/Fachbegriffe, Nischen- und",
      "  Spezial-Anbieter, Fachhändler, Apotheken, Marktplätze. Mehrere Blickwinkel.",
      "- Nicht die Breite zählt, sondern die Bedeutungsnähe zu meiner eigentlichen Absicht.",
      "  Ich sortiere selbst nach Bedeutungsnähe.",
      "",
      "WICHTIG für die Ausgabe:",
      "- Lege die Antwort in EINEN Code-Block (```), damit ich sie mit einem Klick kopieren kann.",
      "- Im Code-Block NUR gültiges JSON, sonst nichts. EIN JSON-Objekt:",
      '  {"zusammenfassung": "...", "treffer": [ {"titel":"...","url":"https://...","quelle":"domain.de","text":"ein bis zwei Sätze"} ]}',
      "- zusammenfassung: 2–4 kurze Sätze IN DER SPRACHE MEINER FRAGE, die ERKLÄREN,",
      "  WARUM diese Reihenfolge/Auswahl sinnvoll ist (kurze inhaltliche Begründung — z.B. warum",
      "  bestimmte Quellen zuerst kommen, worauf zu achten ist), damit ich die Seiten NICHT alle",
      "  öffnen muss. Nüchtern, keine Werbung.",
      "- treffer: nach Bedeutungsnähe geordnet; erfinde KEINE URLs, nur echte Treffer, keine Dubletten.",
      "- So viele echte Treffer wie möglich (Ziel bis 100).",
    ]).join("\n");
  }

  // URL-Müll säubern: ChatGPT hängt im Render manchmal unsichtbare Zitat-Zeichen
  // ans URL-Ende (im Test 2026-06-21 gesehen). Nur bis zum ersten Whitespace/
  // Anführungszeichen nehmen, dann hinten alles abschneiden, was nicht URL ist.
  function cleanUrl(u) {
    if (typeof u !== "string") return "";
    var s = u.trim().split(/[\s"'<>]/)[0];
    s = s.replace(/[^A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/g, "");
    return s;
  }

  // Eingefügte KI-Antwort → saubere Eintrags-Liste. Verträgt Code-Fences
  // (```json … ```), Text drumherum und gesäuberte URLs. Akzeptiert ein blankes
  // Array ODER ein Objekt {zusammenfassung, treffer:[…]}. [] wenn nichts brauchbar.
  function parseAiAnswer(text) {
    if (typeof text !== "string" || !text.trim()) return [];
    var raw = text.trim();
    var fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    var arr = null;
    // Form 1: Objekt mit treffer-Array (neues Format mit Zusammenfassung).
    try {
      var os = raw.indexOf("{"), oe = raw.lastIndexOf("}");
      if (os >= 0 && oe > os) {
        var obj = JSON.parse(raw.slice(os, oe + 1));
        if (obj && Array.isArray(obj.treffer)) arr = obj.treffer;
      }
    } catch (_e) { /* nb — Fallback unten */ }
    // Form 2: blankes Array (altes Format).
    if (!arr) {
      var start = raw.indexOf("[");
      var end = raw.lastIndexOf("]");
      if (start < 0 || end <= start) return [];
      try { arr = JSON.parse(raw.slice(start, end + 1)); }
      catch (e) { return []; }
    }
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i] || {};
      var url = cleanUrl(it.url || it.link || "");
      var titel = String(it.titel || it.title || it.quelle || url || "").trim();
      var quelle = String(it.quelle || it.source || "").trim();
      var txt = String(it.text || it.snippet || it.beschreibung || "").trim();
      if (!titel && !url) continue;
      out.push({ titel: titel || url, url: url, quelle: quelle, text: txt });
    }
    return out;
  }

  // Kurze KI-Zusammenfassung („warum diese Reihenfolge") aus der Antwort ziehen.
  // "" wenn keine vorhanden (altes Array-Format / Mensch hat nur Treffer geliefert).
  function extractAiSummary(text) {
    if (typeof text !== "string" || !text.trim()) return "";
    var raw = text.trim();
    var fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    try {
      var os = raw.indexOf("{"), oe = raw.lastIndexOf("}");
      if (os >= 0 && oe > os) {
        var obj = JSON.parse(raw.slice(os, oe + 1));
        if (obj && typeof obj.zusammenfassung === "string") return obj.zusammenfassung.trim();
        if (obj && typeof obj.summary === "string") return obj.summary.trim();
      }
    } catch (_e) { /* fail-soft */ }
    return "";
  }

  function hasPastedAi() { return !!(pastedAiText && parseAiAnswer(pastedAiText).length); }

  // Anbieter-Dropdown nach EU-Politik (neu) befüllen; gewählten Eintrag halten.
  function rebuildAiProviderOptions() {
    if (!aiSelectEl) return;
    var d = global.document;
    var list = aiProvidersForPolicy();
    var keep = optAiProvider;
    var stillThere = false;
    while (aiSelectEl.children.length) aiSelectEl.removeChild(aiSelectEl.children[0]);
    for (var i = 0; i < list.length; i++) {
      var o = d.createElement("option");
      o.value = list[i].id;
      o.textContent = "KI: " + list[i].label + (list[i].webSearch ? "" : " (ohne Websuche)");
      if (list[i].id === keep) { o.selected = true; stillThere = true; }
      aiSelectEl.appendChild(o);
    }
    if (!stillThere && list.length) { optAiProvider = list[0].id; aiSelectEl.children[0].selected = true; }
  }

  function copyToClipboard(text) {
    try {
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        return Promise.resolve(global.navigator.clipboard.writeText(text)).then(function () { return true; })
          .catch(function () { return false; });
      }
    } catch (_e) { /* nb */ }
    return Promise.resolve(false);
  }

  // „Prompt → KI": Prompt aus der aktuellen Frage bauen, in die Zwischenablage
  // kopieren, gewählten Anbieter best-effort mit Prompt öffnen.
  function handleAiPromptClick() {
    var query = (inputEl ? inputEl.value : queryValue) || "";
    query = String(query).trim();
    if (!query) { setHint("Erst eine Frage eintippen, dann den KI-Knopf nutzen."); return; }
    var context = aiContextEl ? aiContextEl.value : "";
    var prompt = buildAiPrompt(query, context);
    var prov = aiProviderById(optAiProvider);
    // Kopieren UND öffnen (Klaus 2026-06-22, Befund App-Link): Anbieter wie
    // ChatGPT/Claude/Gemini haben oft eine EIGENE App — Android öffnet die URL dann
    // als parallele App in eigenem Task; die PWA läuft ungestört weiter (kein
    // Reload, Inhalt bleibt). Ist KEINE App installiert, öffnet die URL in Chrome
    // (gleiche Engine wie die PWA → mögliche Kollision) — darum bleibt der Prompt
    // zusätzlich in der Zwischenablage als verlässlicher Weg, und persistQuery +
    // Reload-Schutz sichern den Inhalt. Nur die reine Web-Suche (ohne eigene App)
    // ist konsequent copy-only.
    copyToClipboard(prompt).then(function (ok) {
      setHint(ok
        ? "Prompt kopiert + " + prov.label + " wird geöffnet (eigene App läuft parallel) — Antwort hierher zurück einfügen."
        : prov.label + " wird geöffnet — Prompt im Feld unten markieren/kopieren, falls nötig.");
    });
    try {
      if (typeof global.open === "function") {
        global.open(prov.openUrl + encodeURIComponent(prompt), "_blank", "noopener");
      }
    } catch (_e) { /* nb — Clipboard bleibt der verlässliche Weg */ }
  }

  // „Antwort sortieren": eingefügte KI-Antwort übernehmen und Suche auslösen.
  function handleAiSortClick() {
    var txt = aiPasteEl ? aiPasteEl.value : "";
    var entries = parseAiAnswer(txt);
    if (!entries.length) {
      setHint("Keine gültige KI-Antwort erkannt — JSON-Liste mit url/titel einfügen.");
      return;
    }
    pastedAiText = txt;
    if (!areas.internet.enabled) {
      areas.internet.enabled = true;
      if (internetCheckboxEl && internetCheckboxEl._input) internetCheckboxEl._input.checked = true;
      updateSearxngFieldVisibility();
    }
    setHint(entries.length + " KI-Quellen erkannt — sortiere …");
    runAndRender();
  }

  // ===================================================================
  // Stufe B · B2 (Probe) — automatischer KI-Aufruf, EIN Anbieter: Claude.
  // CORS-Realität: nur Anbieter mit dokumentiertem Browser-Direkt-Weg gehen.
  // Claude: api.anthropic.com + Header anthropic-dangerous-direct-browser-access
  // + eingebautes web_search-Tool. Alles fail-soft; der echte Beweis (CORS ja/
  // nein) ist Klaus' Live-Lauf. Schlüssel aus Tresor (B1) ODER init({apiKey}).
  // ===================================================================
  var optAiModel = null; // Modell-Override (Default je Anbieter)

  function aiAutoSupported() { return optAiProvider === "claude"; }

  // Fortschrittsbalken steuern (während des Web-Such-Aufrufs).
  function showProgress() {
    if (!aiProgressEl) return;
    aiProgressEl.classList.remove("done");
    aiProgressEl.style.display = "block";
  }
  function finishProgress() {
    if (!aiProgressEl) return;
    aiProgressEl.classList.add("done"); // Balken füllt sich voll
    var el = aiProgressEl;
    global.setTimeout(function () { if (el) { el.style.display = "none"; el.classList.remove("done"); } }, 600);
  }
  function hideProgress() {
    if (!aiProgressEl) return;
    aiProgressEl.style.display = "none";
    aiProgressEl.classList.remove("done");
  }

  function buildClaudeRequest(prompt, key) {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: optAiModel || "claude-sonnet-4-5",
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      }),
    };
  }

  function extractClaudeText(data) {
    if (!data || !Array.isArray(data.content)) return "";
    var out = "";
    for (var i = 0; i < data.content.length; i++) {
      var b = data.content[i];
      if (b && b.type === "text" && typeof b.text === "string") out += b.text + "\n";
    }
    return out.trim();
  }

  // Automatischer Aufruf: Prompt bauen → Anbieter-API mit Web-Suche → Text →
  // parseAiAnswer → sortieren. Fail-soft (CORS/Key/Netz → ruhiger Hinweis).
  function autoSearch(query) {
    query = (typeof query === "string" ? query : "").trim();
    if (!query) { setHint("Erst eine Frage eintippen."); return Promise.resolve(false); }
    if (!optApiKey) {
      setHint("Kein Schlüssel — Tresor (🔐) entsperren oder Schlüssel hinterlegen.");
      return Promise.resolve(false);
    }
    if (!aiAutoSupported()) {
      setHint("Automatischer Aufruf bisher nur für Claude (Probe). Für " +
        aiProviderById(optAiProvider).label + " den Kopier-Weg nutzen.");
      return Promise.resolve(false);
    }
    if (typeof global.fetch !== "function") {
      setHint("Kein fetch verfügbar — Kopier-Weg nutzen.");
      return Promise.resolve(false);
    }
    var context = aiContextEl ? aiContextEl.value : "";
    var req = buildClaudeRequest(buildAiPrompt(query, context), optApiKey);
    setHint("Frage Claude (mit Web-Suche) … (kann etwas dauern)");
    showProgress();
    return Promise.resolve(global.fetch(req.url, { method: "POST", headers: req.headers, body: req.body }))
      .then(function (resp) {
        if (!resp || !resp.ok) throw new Error("HTTP " + (resp && resp.status));
        return resp.json();
      })
      .then(function (data) {
        var text = extractClaudeText(data);
        var entries = parseAiAnswer(text);
        if (!entries.length) {
          // Diagnose sichtbar machen: Rohantwort ins Einfüge-Feld (prose?
          // Rückfrage? pause_turn?), damit Klaus sie sehen + schicken kann.
          var dump = text;
          if (!dump) {
            var kinds = (data && Array.isArray(data.content))
              ? data.content.map(function (b) { return b && b.type; }).join(", ") : "?";
            dump = "[keine Text-Antwort. stop_reason=" + (data && data.stop_reason) +
              ", content-Blöcke: " + kinds + "]";
          }
          if (aiPasteEl) aiPasteEl.value = dump;
          hideProgress();
          setHint("Claude antwortete, aber ohne JSON-Liste — die Rohantwort steht jetzt im Einfüge-Feld. Schau/kopiere sie.");
          return false;
        }
        pastedAiText = text;
        if (!areas.internet.enabled) {
          areas.internet.enabled = true;
          if (internetCheckboxEl && internetCheckboxEl._input) internetCheckboxEl._input.checked = true;
          updateSearxngFieldVisibility();
        }
        finishProgress(); // Balken füllt sich voll, dann verschwindet er
        setHint(entries.length + " Treffer von Claude — sortiere …");
        runAndRender();
        return true;
      })
      .catch(function (err) {
        hideProgress();
        var m = (err && err.message) || String(err);
        setHint(/fetch|NetworkError|CORS/i.test(m)
          ? "Browser-Aufruf blockiert (vermutlich CORS) — nutze den Kopier-Weg (🤖 Prompt → KI)."
          : "Automatischer Aufruf fehlgeschlagen (" + m + ") — Kopier-Weg nutzen.");
        return false;
      });
  }

  function handleAutoClick() { autoSearch((inputEl ? inputEl.value : queryValue) || ""); }

  // Eingefügte KI-Quellen → einbetten (Modul 03) → Korpus, damit die
  // Sortiermaschine sie semantisch ranken kann (wie App/Knoten/SearXNG).
  function buildAiCorpus() {
    var entries = parseAiAnswer(pastedAiText);
    if (!entries.length) return Promise.resolve([]);
    var embedding = global.SbkimEmbedding;
    if (!embedding || typeof embedding.embedPassageBatch !== "function") {
      return Promise.reject(new Error("Modul 03 (Embedding) nicht geladen — KI-Treffer können nicht sortiert werden."));
    }
    var texts = entries.map(function (e) { return e.titel + (e.text ? " — " + e.text : ""); });
    return Promise.resolve(embedding.embedPassageBatch(texts)).then(function (vecs) {
      return entries.map(function (e, i) {
        return { label: e.titel, text: texts[i], snippet: e.text || null,
                 anchorId: e.url || e.titel, url: e.url || null, passageVec: vecs[i] };
      });
    });
  }

  // ===================================================================
  // Stufe B · B1 — Widget-Tresor (self-contained, portabel).
  // Eigenes Schloss im Widget (Klaus 2026-06-21): speichert die API-Schlüssel
  // verschlüsselt in localStorage. Krypto spiegelt Modul 20/02 — PBKDF2-SHA256
  // (≥600k) → AES-GCM-256, Passwort-Recovery via Shamir 2-von-3 (GF256). KEINE
  // Abhängigkeit zu Modul 01/02/20, damit das Widget überall hin kopierbar ist.
  // Passwort wird NIE gehalten; Schlüssel nur im RAM nach Entsperren; nichts
  // verlässt je das Gerät.
  // ===================================================================
  var VAULT_LS_KEY = "sbkim_search_widget_vault";
  var VAULT_KDF_ITER = 600000;   // OWASP 2023+ (wie Modul 02 BACKUP_KDF_ITERATIONS)
  var VAULT_SALT_BYTES = 16;
  var VAULT_IV_BYTES = 12;
  var VAULT_SHAMIR_N = 3;
  var VAULT_SHAMIR_K = 2;
  var VAULT_SHARE_PREFIX = "sw1";
  var VAULT_MIN_PW_LEN = 8;

  var vaultKeys = null;          // entschlüsselte { provider: key } — RAM-only
  var vaultUnlocked = false;

  function vaultErr(name, message) { var e = new Error(message); e.name = name; return e; }

  // ---- GF(256) (Poly 0x11b, Generator 3) — portiert aus Modul 20 ----
  var V_GF_EXP = new Uint8Array(512);
  var V_GF_LOG = new Uint8Array(256);
  (function buildVaultTables() {
    function rawMul(a, b) {
      var p = 0;
      for (var i = 0; i < 8; i++) {
        if (b & 1) p ^= a;
        var hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1;
      }
      return p;
    }
    var x = 1;
    for (var i = 0; i < 255; i++) { V_GF_EXP[i] = x; V_GF_LOG[x] = i; x = rawMul(x, 3); }
    for (var j = 255; j < 512; j++) V_GF_EXP[j] = V_GF_EXP[j - 255];
  })();
  function vGfMul(a, b) { if (a === 0 || b === 0) return 0; return V_GF_EXP[V_GF_LOG[a] + V_GF_LOG[b]]; }
  function vGfInv(a) { return V_GF_EXP[255 - V_GF_LOG[a]]; }

  function vaultRandomBytes(n) {
    var out = new Uint8Array(n);
    if (global.crypto && typeof global.crypto.getRandomValues === "function") global.crypto.getRandomValues(out);
    else for (var i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }
  function vaultSplitBytes(secret, n, k) {
    var shares = [];
    for (var s = 0; s < n; s++) shares.push({ x: s + 1, bytes: new Uint8Array(secret.length) });
    for (var bi = 0; bi < secret.length; bi++) {
      var coeffs = new Uint8Array(k);
      coeffs[0] = secret[bi];
      var rnd = vaultRandomBytes(k - 1);
      for (var c = 1; c < k; c++) coeffs[c] = rnd[c - 1];
      for (var si = 0; si < n; si++) {
        var x = shares[si].x, y = 0;
        for (var d = k - 1; d >= 0; d--) y = vGfMul(y, x) ^ coeffs[d];
        shares[si].bytes[bi] = y;
      }
    }
    return shares;
  }
  function vaultCombineBytes(objs) {
    var len = objs[0].bytes.length, out = new Uint8Array(len), m = objs.length;
    for (var bi = 0; bi < len; bi++) {
      var acc = 0;
      for (var i = 0; i < m; i++) {
        var xi = objs[i].x, yi = objs[i].bytes[bi], num = 1, den = 1;
        for (var j = 0; j < m; j++) {
          if (j === i) continue;
          var xj = objs[j].x; num = vGfMul(num, xj); den = vGfMul(den, xj ^ xi);
        }
        acc ^= vGfMul(yi, vGfMul(num, vGfInv(den)));
      }
      out[bi] = acc;
    }
    return out;
  }

  // ---- base64url + Text <-> Bytes ----
  function vB64Encode(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64 = (typeof btoa === "function") ? btoa(bin)
      : (global.Buffer ? global.Buffer.from(bytes).toString("base64") : "");
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function vB64Decode(str) {
    var b64 = String(str).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    if (typeof atob === "function") {
      var bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return global.Buffer ? new Uint8Array(global.Buffer.from(b64, "base64")) : new Uint8Array(0);
  }
  function vTextToBytes(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    return global.Buffer ? new Uint8Array(global.Buffer.from(s, "utf8")) : new Uint8Array(0);
  }
  function vBytesToText(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
    return global.Buffer ? global.Buffer.from(bytes).toString("utf8") : "";
  }
  function vEncodeShare(share) { return VAULT_SHARE_PREFIX + "." + share.x + "." + vB64Encode(share.bytes); }
  function vDecodeShare(str) {
    var parts = String(str).trim().split(".");
    if (parts.length !== 3 || parts[0] !== VAULT_SHARE_PREFIX) {
      throw vaultErr("InvalidShareError", "Anteil-Format ungültig (erwartet sw1.<index>.<base64url>).");
    }
    var x = parseInt(parts[1], 10);
    if (!(x >= 1 && x <= 255)) throw vaultErr("InvalidShareError", "Anteil-Index ungültig: " + parts[1]);
    return { x: x, bytes: vB64Decode(parts[2]) };
  }

  // ---- WebCrypto: PBKDF2 → AES-GCM (generisch, für beliebigen Klartext) ----
  function vaultSubtle() {
    if (global.crypto && global.crypto.subtle) return global.crypto.subtle;
    throw vaultErr("CryptoUnavailableError", "WebCrypto (crypto.subtle) ist nicht verfügbar.");
  }
  function vDeriveKey(password, salt) {
    var subtle = vaultSubtle();
    return Promise.resolve(subtle.importKey("raw", vTextToBytes(password), { name: "PBKDF2" }, false, ["deriveKey"]))
      .then(function (baseKey) {
        return subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: VAULT_KDF_ITER, hash: "SHA-256" },
          baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      });
  }
  function vEncrypt(password, plaintext) {
    var salt = vaultRandomBytes(VAULT_SALT_BYTES), iv = vaultRandomBytes(VAULT_IV_BYTES);
    return vDeriveKey(password, salt).then(function (key) {
      return vaultSubtle().encrypt({ name: "AES-GCM", iv: iv }, key, vTextToBytes(plaintext));
    }).then(function (ct) {
      return { v: 1, salt: vB64Encode(salt), iv: vB64Encode(iv), ct: vB64Encode(new Uint8Array(ct)) };
    });
  }
  function vDecrypt(password, blob) {
    var salt = vB64Decode(blob.salt), iv = vB64Decode(blob.iv), ct = vB64Decode(blob.ct);
    return vDeriveKey(password, salt).then(function (key) {
      return vaultSubtle().decrypt({ name: "AES-GCM", iv: iv }, key, ct);
    }).then(function (pt) { return vBytesToText(new Uint8Array(pt)); });
  }

  // ---- Öffentliche Tresor-Logik ----
  function hasVault() { return !!lsGet(VAULT_LS_KEY); }
  function isVaultUnlocked() { return vaultUnlocked === true; }

  // Nach Entsperren: passenden Schlüssel in optApiKey spiegeln (KI-Richter/B2).
  function applyVaultKey() {
    if (!vaultKeys) { return; }
    var k = vaultKeys[optAiProvider] || vaultKeys[optProvider];
    if (!k) { for (var p in vaultKeys) { if (vaultKeys[p]) { k = vaultKeys[p]; break; } } }
    if (k) optApiKey = k;
  }

  // Tresor anlegen: secrets = { provider: key, ... }. Gibt die Shamir-Anteile
  // zurück (der Nutzer sichert sie getrennt — Recovery ohne Passwort).
  function createVault(password, secrets) {
    if (typeof password !== "string" || password.length < VAULT_MIN_PW_LEN) {
      return Promise.reject(vaultErr("WeakPasswordError",
        "Passwort braucht mindestens " + VAULT_MIN_PW_LEN + " Zeichen."));
    }
    if (hasVault()) {
      return Promise.reject(vaultErr("VaultExistsError",
        "Tresor existiert schon — erst entsperren oder löschen."));
    }
    var clean = (secrets && typeof secrets === "object") ? secrets : {};
    return vEncrypt(password, JSON.stringify(clean)).then(function (blob) {
      lsSet(VAULT_LS_KEY, JSON.stringify(blob));
      vaultKeys = clean;
      vaultUnlocked = true;
      applyVaultKey();
      var shareObjs = vaultSplitBytes(vTextToBytes(password), VAULT_SHAMIR_N, VAULT_SHAMIR_K);
      return { shares: shareObjs.map(vEncodeShare) };
    });
  }

  // Entsperren: Schlüssel in den RAM laden. Falsches Passwort → false (kein Oracle).
  function unlockVault(password) {
    if (typeof password !== "string" || password.length === 0) return Promise.resolve(false);
    var raw = lsGet(VAULT_LS_KEY);
    if (!raw) return Promise.resolve(false);
    var blob;
    try { blob = JSON.parse(raw); } catch (e) { return Promise.resolve(false); }
    return vDecrypt(password, blob).then(function (payload) {
      var secrets = JSON.parse(payload);
      vaultKeys = (secrets && typeof secrets === "object") ? secrets : {};
      vaultUnlocked = true;
      applyVaultKey();
      return true;
    }).catch(function () { vaultUnlocked = false; vaultKeys = null; return false; });
  }

  function lockVault() { vaultUnlocked = false; vaultKeys = null; }

  function deleteVault() { lsRemove(VAULT_LS_KEY); lockVault(); }

  // Schlüssel in einem ENTSPERRTEN Tresor setzen/ändern (Passwort zum Neu-
  // Verschlüsseln nötig — wir halten es bewusst nicht im RAM).
  function setVaultSecret(password, provider, key) {
    if (!hasVault()) return Promise.reject(vaultErr("NoVaultError", "Kein Tresor vorhanden."));
    return unlockVault(password).then(function (ok) {
      if (!ok) return false;
      var next = {};
      for (var p in vaultKeys) next[p] = vaultKeys[p];
      next[String(provider)] = String(key);
      return vEncrypt(password, JSON.stringify(next)).then(function (blob) {
        lsSet(VAULT_LS_KEY, JSON.stringify(blob));
        vaultKeys = next;
        applyVaultKey();
        return true;
      });
    });
  }

  // Passwort aus ≥ k Shamir-Anteilen rekonstruieren (rein lokal). null bei zu
  // wenigen/ungültigen Anteilen.
  function recoverVaultPassword(shares) {
    if (!Array.isArray(shares) || shares.length < VAULT_SHAMIR_K) return null;
    try {
      var objs = [], seen = {};
      for (var i = 0; i < shares.length; i++) {
        var o = vDecodeShare(shares[i]);
        if (seen[o.x]) continue;
        seen[o.x] = true; objs.push(o);
      }
      if (objs.length < VAULT_SHAMIR_K) return null;
      return vBytesToText(vaultCombineBytes(objs.slice(0, VAULT_SHAMIR_K)));
    } catch (e) { return null; }
  }

  // ---- B1b: Tresor-Bedien-Sektion (🔐) ----
  var vaultShownShares = null;  // nach Anlegen kurz die Anteile zeigen

  function vMakeInput(type, placeholder) {
    var d = global.document, i = d.createElement("input");
    i.type = type; i.className = "sbkim-sw-vinput";
    i.setAttribute("placeholder", placeholder);
    i.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    return i;
  }
  function vMakeBtn(label) {
    var d = global.document, b = d.createElement("button");
    b.type = "button"; b.className = "sbkim-sw-vbtn"; b.textContent = label;
    b.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    return b;
  }
  function vMakeNote(text) {
    var d = global.document, n = d.createElement("div");
    n.className = "sbkim-sw-vnote"; n.textContent = text; return n;
  }

  function renderVaultSection() {
    if (!vaultSectionEl) return;
    var d = global.document;
    vaultSectionEl.style.display = vaultSectionOpen ? "block" : "none";
    while (vaultSectionEl.firstChild) vaultSectionEl.removeChild(vaultSectionEl.firstChild);
    if (!vaultSectionOpen) return;

    // Nach dem Anlegen: Anteile sichern lassen.
    if (vaultShownShares) {
      vaultSectionEl.appendChild(vMakeNote("Tresor angelegt. Bewahre diese 3 Anteile GETRENNT auf — mit 2 davon stellst du dein Passwort wieder her:"));
      var ta = d.createElement("textarea");
      ta.className = "sbkim-sw-vshares"; ta.setAttribute("rows", "3"); ta.setAttribute("readonly", "readonly");
      ta.value = vaultShownShares.join("\n");
      ta.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
      vaultSectionEl.appendChild(ta);
      var done = vMakeBtn("Anteile gesichert — fertig");
      done.addEventListener("click", function () { vaultShownShares = null; renderVaultSection(); });
      vaultSectionEl.appendChild(done);
      return;
    }

    if (!hasVault()) {
      vaultSectionEl.appendChild(vMakeNote("Schlüssel-Tresor anlegen (für „" + aiProviderById(optAiProvider).label + "“). Passwort + Schlüssel bleiben verschlüsselt nur auf diesem Gerät."));
      var pw1 = vMakeInput("password", "Tresor-Passwort (min. 8 Zeichen)");
      var key1 = vMakeInput("password", "API-Schlüssel (z. B. sk-…)");
      var createBtn = vMakeBtn("🔐 Tresor anlegen");
      var status1 = vMakeNote("");
      createBtn.addEventListener("click", function () {
        var secrets = {}; secrets[optAiProvider] = key1.value;
        status1.textContent = "Verschlüssele …";
        createVault(pw1.value, secrets).then(function (res) {
          vaultShownShares = res.shares; renderVaultSection();
        }).catch(function (e) {
          status1.textContent = e && e.name === "WeakPasswordError"
            ? "Passwort braucht mindestens 8 Zeichen." : "Anlegen fehlgeschlagen.";
        });
      });
      vaultSectionEl.appendChild(pw1);
      vaultSectionEl.appendChild(key1);
      vaultSectionEl.appendChild(createBtn);
      vaultSectionEl.appendChild(status1);
      return;
    }

    if (!vaultUnlocked) {
      vaultSectionEl.appendChild(vMakeNote("Tresor entsperren:"));
      var pw2 = vMakeInput("password", "Tresor-Passwort");
      var unlockBtn = vMakeBtn("🔓 Entsperren");
      var status2 = vMakeNote("");
      unlockBtn.addEventListener("click", function () {
        status2.textContent = "Prüfe …";
        unlockVault(pw2.value).then(function (ok) {
          if (ok) { renderVaultSection(); }
          else { status2.textContent = "Falsches Passwort."; }
        });
      });
      vaultSectionEl.appendChild(pw2);
      vaultSectionEl.appendChild(unlockBtn);
      vaultSectionEl.appendChild(status2);
      var delLink = vMakeBtn("Tresor löschen");
      delLink.className = "sbkim-sw-vbtn sbkim-sw-vdelete";
      delLink.addEventListener("click", function () { deleteVault(); renderVaultSection(); });
      vaultSectionEl.appendChild(delLink);
      return;
    }

    // entsperrt
    vaultSectionEl.appendChild(vMakeNote("🔓 Tresor entsperrt — Schlüssel aktiv (KI-Richter / automatischer Aufruf können ihn nutzen)."));
    var lockBtn = vMakeBtn("🔒 Sperren");
    lockBtn.addEventListener("click", function () { lockVault(); renderVaultSection(); });
    vaultSectionEl.appendChild(lockBtn);
    var delLink2 = vMakeBtn("Tresor löschen");
    delLink2.className = "sbkim-sw-vbtn sbkim-sw-vdelete";
    delLink2.addEventListener("click", function () { deleteVault(); renderVaultSection(); });
    vaultSectionEl.appendChild(delLink2);
  }


  // Stufe 2 (Sortiermaschine): Modul 04 queryLocal-Cosinus über EINEN Korpus,
  // Treffer mit Quelle (source) + Bedeutungs-Text + URL angereichert.
  // Eine echte, extern öffenbare Adresse (http/https) — KEIN interner Seiten-Anker
  // wie "modul-06". Knoten-/Internet-Treffer tragen ihre App-URL im anchorId.
  function isExternalUrl(s) {
    return typeof s === "string" && /^https?:\/\//i.test(s);
  }

  // Query einmal einbetten (Modul 03), damit der „verwandt"-Modus relatedness()
  // gegen die Treffer-Inhalts-Vektoren rechnen kann. Fail-soft: ohne Modul 03 /
  // bei Fehler → null (dann degradiert die Sicht sauber auf „verbunden").
  function computeQueryVec(query) {
    var embedding = global.SbkimEmbedding;
    if (!embedding || typeof embedding.embedQuery !== "function") return Promise.resolve(null);
    return Promise.resolve()
      .then(function () { return embedding.embedQuery(query); })
      .then(function (vec) {
        return (vec && vec.length) ? vec : null;
      })
      .catch(function (err) { warn("Query-Embedding für 'verwandt'-Sicht fehlgeschlagen — Sicht bleibt 'verbunden'.", err); return null; });
  }

  // A4 (Bau 04.H): Frage-Varianten über die app-eigene Synonym-Karte bilden.
  // Fail-soft: A4 aus, kein expandQuerySimple oder Wurf → nur [query] (byte-
  // gleich zum Einzel-Fall, kein Regress).
  function expandVariants(match, query) {
    if (!optQueryExpand || typeof match.expandQuerySimple !== "function") return [query];
    try {
      var vs = match.expandQuerySimple(query, { synonyms: optSynonyms });
      return (Array.isArray(vs) && vs.length) ? vs : [query];
    } catch (e) { warn("Query-Expansion fehlgeschlagen — Einzel-Frage.", e); return [query]; }
  }

  // Rang-Liste (queryLocal / queryLocalMulti) → angereicherte Treffer mit
  // Quelle, Bedeutungs-Text, Öffnen-Link, nodeId, passageVec (aus dem Korpus
  // rekonstruiert — queryLocalMulti gibt nur label/score/anchorId zurück).
  function enrichRanked(res, corpus, source) {
    res = res || [];
    var byKey = {};
    for (var i = 0; i < corpus.length; i++) { var c = corpus[i]; byKey[c.anchorId || c.label] = c; }
    return res.map(function (r) {
      var src = byKey[r.anchorId || r.label] || {};
      return {
        label: r.label, score: r.score, anchorId: r.anchorId, source: source,
        text: src.text || r.label, snippet: src.snippet || null,
        // Öffnen-Link: explizite url ODER ein anchorId, das eine echte externe
        // Adresse ist (Knoten-Treffer → App-URL im anchorId). So zeigen Zeilen-
        // Link, Detail-Karte „↗ Seite öffnen", Merkliste + Text-Export den Link.
        url: src.url || (isExternalUrl(r.anchorId) ? r.anchorId : null),
        nodeId: src.nodeId || null,   // für den Live-Cross-Knoten-Pfad (Knoten-Bereich)
        // Inhalts-Vektor durchreichen — der „verwandt"-Modus braucht ihn für
        // relatedness(queryVec, passageVec). RAM-only, wird NICHT persistiert.
        passageVec: src.passageVec || null,
      };
    });
  }

  function queryCorpus(query, corpus, source) {
    var match = global.SbkimMatch;
    if (!match || typeof match.queryLocal !== "function") return Promise.resolve([]);
    if (!Array.isArray(corpus) || corpus.length === 0) return Promise.resolve([]);
    var k = Math.min(corpus.length, MAX_RANK); // viel ranken, UI paginiert

    // A1 (Bau 04.F): Vorfilter auf Hybrid BM25+Vektor heben — cross-phrased
    //   Wort-Treffer, die der reine Cosinus-Boden (PROVIDER_MIN_MATCH 0.80)
    //   ausschließt, werden über den lexikalischen Pfad AUFGENOMMEN. Fail-soft:
    //   ohne `text`-Feld fällt BM25 in Modul 04 auf `label` zurück.
    // A4 (Bau 04.H): mit mehreren Frage-Varianten suchen und via RRF verschmelzen
    //   (queryLocalMulti). Rein additiv — senkt keine Schwelle, gatet nichts;
    //   der Andock-Riegel (Modul 05) bleibt unberührt.
    var hybridOpts = { corpus: corpus, hybrid: true };
    var ranked;
    if (typeof match.queryLocalMulti === "function") {
      ranked = Promise.resolve(match.queryLocalMulti(expandVariants(match, query), k, hybridOpts));
    } else {
      ranked = Promise.resolve(match.queryLocal(query, k, hybridOpts));
    }
    return ranked
      .then(function (res) { return enrichRanked(res, corpus, source); })
      .catch(function (err) {
        // Fail-soft: A1/A4-Pfad-Fehler → zurück auf den einfachen Cosinus-Pfad
        // (Bau 04.C), damit die Suche nie an der Verbesserung scheitert.
        warn("Hybrid/Multi-Query fehlgeschlagen — Fallback auf einfachen Vorfilter.", err);
        return Promise.resolve(match.queryLocal(query, k, { corpus: corpus }))
          .then(function (res) { return enrichRanked(res, corpus, source); })
          .catch(function (err2) { warn("Vorfilter-Fallback fehlgeschlagen.", err2); return []; });
      });
  }

  // Stufe 1 (Eingang) für den Internet-Bereich: SearXNG-Roh-Treffer holen.
  function fetchSearxngResults(query) {
    if (typeof global.fetch !== "function") return Promise.reject(new Error("fetch nicht verfügbar."));
    var base = String(searxngUrl).replace(/\/+$/, "");
    var url = base + "/search?q=" + encodeURIComponent(query) + "&format=json";
    return Promise.resolve(global.fetch(url, { headers: { "Accept": "application/json" } }))
      .then(function (resp) {
        if (!resp || !resp.ok) throw new Error("SearXNG HTTP " + (resp && resp.status));
        return resp.json();
      })
      .then(function (data) {
        var arr = (data && Array.isArray(data.results)) ? data.results : [];
        return arr.slice(0, SEARXNG_MAX_RESULTS).map(function (r) {
          return { title: r.title || r.url || "", url: r.url || "", content: r.content || "" };
        }).filter(function (r) { return r.url; });
      });
  }

  // Internet-Roh-Treffer → einbetten (Modul 03) → Korpus mit passageVec, damit
  // die Sortiermaschine sie semantisch ranken kann (genau wie App/Knoten).
  function buildInternetCorpus(query) {
    if (!searxngUrl) return Promise.resolve([]);
    var embedding = global.SbkimEmbedding;
    return fetchSearxngResults(query).then(function (raw) {
      if (!raw.length) return [];
      if (!embedding || typeof embedding.embedPassageBatch !== "function") {
        throw new Error("Modul 03 (Embedding) nicht geladen — Web-Treffer können nicht sortiert werden.");
      }
      var texts = raw.map(function (r) { return r.title + (r.content ? " — " + r.content : ""); });
      return Promise.resolve(embedding.embedPassageBatch(texts)).then(function (vecs) {
        return raw.map(function (r, i) {
          return { label: r.title, text: texts[i], anchorId: r.url, url: r.url, passageVec: vecs[i] };
        });
      });
    });
  }

  function areaCandidates(area, query, onLive) {
    if (area === "app") {
      return ensureCorpusPrepared().then(function () { return queryCorpus(query, localCorpus, "app"); })
        .catch(function (err) { warn("App-Bereich-Suche fehlgeschlagen.", err); return []; });
    }
    if (area === "knoten") {
      return ensureNodeCorpusPrepared()
        .then(function () { return queryCorpus(query, nodeCorpus, "knoten"); })
        .then(function (localHits) {
          if (!Array.isArray(localHits)) localHits = [];
          // Live-Pfad (Bau Query-über-Relais) — NICHT-BLOCKIEREND (Pflege 2026-06-28):
          // den top-rangierten Nachbarn MIT nodeId LIVE übers Brett fragen. Die
          // lokalen Treffer (WELCHER Knoten passt) gehen SOFORT zurück; die Live-
          // Antwort (WAS der Knoten gerade dazu hat) wird — auch Minuten später bei
          // schwachem Netz / kaltem Embedding-Modell — über onLive in die Liste
          // NACHGEREICHT, statt die ganze Suche zu blockieren. Fail-soft: ohne
          // queryNode (Standalone) oder ohne onLive (programmatisch ohne Sink) bleibt
          // es beim lokalen Treffer; ohne/zu späte Antwort bleibt die Liste, wie sie ist.
          if (typeof queryNodeFn === "function" && typeof onLive === "function") {
            var targets = [], seen = {};
            for (var i = 0; i < localHits.length && targets.length < LIVE_NODE_MAX; i++) {
              var h = localHits[i];
              if (h && h.nodeId && !seen[h.nodeId]) { seen[h.nodeId] = 1; targets.push(h); }
            }
            if (targets.length) {
              var liveTasks = targets.map(function (t) {
                return Promise.resolve(queryNodeFn(t.nodeId, query))
                  .then(function (rows) {
                    if (!Array.isArray(rows)) return [];
                    return rows.map(function (r) {
                      var aId = (r && r.anchorId) ? r.anchorId : (t.anchorId || null);
                      return {
                        label: (r && r.label) ? r.label : "",
                        score: (r && typeof r.score === "number") ? r.score : 0,
                        anchorId: aId,
                        url: isExternalUrl(aId) ? aId : null,   // „↗ Seite öffnen" auch für Live-Treffer
                        source: "knoten", text: (r && r.label) ? r.label : "",
                        live: true, viaNode: t.label,
                      };
                    }).filter(function (x) { return x.label; });
                  })
                  .catch(function (err) { warn("Live-Frage an Knoten " + t.label + " fehlgeschlagen.", err); return []; });
              });
              // Fire-and-forget: sobald die (evtl. späten) Live-Antworten da sind,
              // über onLive nachreichen — der Aufrufer mischt sie in die Anzeige.
              Promise.all(liveTasks).then(function (lists) {
                var liveRows = [];
                for (var j = 0; j < lists.length; j++) liveRows = liveRows.concat(lists[j]);
                if (liveRows.length) { try { onLive(liveRows); } catch (e) {} }
              });
            }
          }
          return localHits;
        })
        .catch(function (err) { warn("Knoten-Bereich-Suche fehlgeschlagen.", err); return []; });
    }
    return Promise.resolve([]);
  }

  // KI-Richter über die zusammengeführten besten Kandidaten (ein Aufruf), nur
  // wenn richterOn UND ein Schlüssel da ist. Behält die Quelle pro Treffer.
  function richterRerank(query, candidates) {
    var match = global.SbkimMatch;
    var forJudge = candidates.map(function (c) {
      return { label: c.label, text: c.text || c.label, cosine: c.score, anchorId: c.anchorId };
    });
    var judgeOpts = { apiKey: optApiKey, provider: optProvider, euOnly: euOnlyForPolicy() };
    if (optRichterModel) judgeOpts.model = optRichterModel;  // leer = Standard/auto (z.B. Gemini)
    return Promise.resolve(match.hybridMatch(
        { text: query, label: optQueryLabel || null }, forJudge, judgeOpts))
      .then(function (judgment) {
        if (!judgment || !judgment.available) {
          return { mode: "semantisch", treffer: candidates, reason: judgment && judgment.reason };
        }
        var byKey = {};
        candidates.forEach(function (c) { byKey[c.anchorId || c.label] = c; });
        var treffer = (judgment.verdicts || []).filter(function (v) { return v.passt; })
          .map(function (v) {
            var c = byKey[v.anchorId || v.label] || {};
            return { label: v.label, score: v.score, anchorId: v.anchorId, source: c.source,
                     text: c.text, url: c.url, begruendung: v.begruendung, passageVec: c.passageVec || null };
          })
          .sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
        return { mode: "richter", treffer: treffer, attestation: judgment.attestation };
      })
      .catch(function (err) {
        return { mode: "semantisch", treffer: candidates, reason: (err && err.message) || String(err) };
      });
  }

  function kiRelKey(t) { return (t.anchorId || "") + "|" + (t.label || ""); }

  // „· KI"-Verwandtschaft: dieselbe hybridMatch-Brücke wie der Richter, aber das
  // Urteil wird NICHT auf passt gefiltert — wir wollen ALLE Verdikte (Score +
  // passt-Flag), um die ANZEIGE nach dem KI-Bedeutungs-Maß zu sortieren. Liefert
  // eine byKey-Karte, fail-soft (available:false bei Fehler / ohne Schlüssel).
  function kiRelatedness(query, treffer) {
    var match = global.SbkimMatch;
    if (!match || typeof match.hybridMatch !== "function") {
      return Promise.resolve({ available: false, byKey: {}, reason: "Modul 04 hybridMatch fehlt." });
    }
    var forJudge = treffer.map(function (c) {
      return { label: c.label, text: c.text || c.label, cosine: c.score, anchorId: c.anchorId };
    });
    var judgeOpts = { apiKey: optApiKey, provider: optProvider, euOnly: euOnlyForPolicy() };
    if (optRichterModel) judgeOpts.model = optRichterModel;
    return Promise.resolve(match.hybridMatch(
        { text: query, label: optQueryLabel || null }, forJudge, judgeOpts))
      .then(function (j) {
        if (!j || !j.available) return { available: false, byKey: {}, reason: j && j.reason };
        var byKey = {};
        (j.verdicts || []).forEach(function (v) {
          byKey[(v.anchorId || "") + "|" + (v.label || "")] =
            { score: v.score, passt: v.passt, begruendung: v.begruendung };
        });
        return { available: true, byKey: byKey, attestation: j.attestation };
      })
      .catch(function (err) {
        return { available: false, byKey: {}, reason: (err && err.message) || String(err) };
      });
  }

  // Stößt das KI-Verwandtschafts-Urteil an, wenn (und nur wenn) „verwandt" + „· KI"
  // + Schlüssel da sind und für die aktuelle Frage noch kein Urteil vorliegt. Zeigt
  // währenddessen weiter den gratis Cosinus (fail-soft); nach dem Urteil ein
  // Re-Render. Cache-Guard (query + available) verhindert eine Schleife/Doppelruf.
  function ensureKiRelated(res) {
    if (viewMode !== "verwandt" || !viewKiRelated || !optApiKey) return;
    var match = global.SbkimMatch;
    if (!match || typeof match.hybridMatch !== "function") return;
    var q = (queryValue || "").trim();
    if (!q) return;
    var treffer = (res && res.treffer) || [];
    if (!treffer.length) return;
    if (kiRelatedState.running) return;
    if (kiRelatedState.query === q && kiRelatedState.available) return;
    kiRelatedState.running = true;
    setHint("KI-Richter beurteilt die Verwandtschaft … (kann etwas dauern)");
    kiRelatedness(q, treffer).then(function (out) {
      kiRelatedState = { query: q, byKey: out.byKey || {}, available: !!out.available, running: false };
      if ((queryValue || "").trim() !== q) return;   // veraltet (neue Suche) → nicht zeichnen
      setHint(out.available
        ? "KI-Richter hat nach Verwandtschaft sortiert."
        : "KI-Richter nicht verfügbar — gratis Cosinus-Rangfolge." + (out.reason ? " (" + out.reason + ")" : ""));
      if (lastRenderRes) renderResults(lastRenderRes);
    }).catch(function (err) {
      kiRelatedState = { query: q, byKey: {}, available: false, running: false };
      warn("KI-Verwandtschaft fehlgeschlagen — gratis Cosinus.", err);
    });
  }

  // Greift das KI-Urteil gerade für die ANZEIGE (verwandt + KI + Schlüssel + Urteil
  // zur aktuellen Frage vorhanden)? Genutzt von displayTreffer + buildResultsText.
  function kiRelatedActive() {
    return viewMode === "verwandt" && viewKiRelated && !!optApiKey &&
      kiRelatedState.available && kiRelatedState.query === (queryValue || "").trim();
  }

  // Mehrfach-Suche: gewählte Bereiche → je Cosinus-Kandidaten → zusammenführen →
  // optional KI-Richter → gerankte Treffer mit Quellen-Badge. Internet ohne
  // SearXNG-URL → Neuer-Tab-Karte (webLink) statt Inline-Treffer.
  function runMultiSearch(text, onLive) {
    if (typeof text !== "string" || text.trim().length === 0) {
      lastSearchMode = "leer";
      return Promise.resolve({ mode: "leer", treffer: [], webLink: null });
    }
    var query = text.trim();
    var enabled = activeAreaIds();
    if (enabled.length === 0) {
      lastSearchMode = "leer";
      return Promise.resolve({ mode: "leer", treffer: [], webLink: null,
        reason: "Kein Such-Bereich gewählt — App, Knoten oder Internet ankreuzen." });
    }
    var match = global.SbkimMatch;
    var aiReady = hasPastedAi();
    var needsMatch = areas.app.enabled || areas.knoten.enabled ||
      (areas.internet.enabled && (!!searxngUrl || aiReady));
    if (needsMatch && (!match || typeof match.queryLocal !== "function")) {
      // App/Knoten/Internet-Re-Ranker brauchen Modul 04. Internet-Neuer-Tab geht
      // trotzdem (kein Matcher nötig).
      if (areas.internet.enabled && !searxngUrl) {
        lastSearchMode = "semantisch";
        return Promise.resolve({ mode: "semantisch", treffer: [],
          webLink: { query: query, url: webSearchUrl(query) } });
      }
      lastSearchMode = "modul-04-fehlt";
      return Promise.resolve({ mode: "modul-04-fehlt", treffer: [], webLink: null,
        reason: "Modul 04 (Match) nicht geladen — Suche nicht verfügbar." });
    }

    var tasks = [];
    if (areas.app.enabled) tasks.push(areaCandidates("app", query));
    if (areas.knoten.enabled) tasks.push(areaCandidates("knoten", query, onLive));

    // Internet-Bereich separat (kann Kandidaten ODER einen webLink liefern).
    var internetP = Promise.resolve({ candidates: [], webLink: null });
    if (areas.internet.enabled) {
      if (aiReady) {
        // Eingefügte KI-Antwort hat Vorrang vor SearXNG/Neuer-Tab — sie ist die
        // bewusst geholte Quelle, die das Vektor-Sortieren zündet.
        internetP = buildAiCorpus()
          .then(function (corpus) { return queryCorpus(query, corpus, "internet"); })
          .then(function (c) {
            return { candidates: c, webLink: c.length ? null : { query: query, url: webSearchUrl(query) } };
          })
          .catch(function (err) {
            warn("KI-Antwort-Sortierung fehlgeschlagen — Neuer-Tab-Weg angeboten.", err);
            return { candidates: [], webLink: { query: query, url: webSearchUrl(query) } };
          });
      } else if (searxngUrl) {
        internetP = buildInternetCorpus(query)
          .then(function (corpus) { return queryCorpus(query, corpus, "internet"); })
          .then(function (c) {
            return { candidates: c, webLink: c.length ? null : { query: query, url: webSearchUrl(query) } };
          })
          .catch(function (err) {
            warn("Internet-Re-Ranker fehlgeschlagen — Neuer-Tab-Weg angeboten.", err);
            return { candidates: [], webLink: { query: query, url: webSearchUrl(query) } };
          });
      } else {
        internetP = Promise.resolve({ candidates: [], webLink: { query: query, url: webSearchUrl(query) } });
      }
    }

    // Query-Vektor parallel einbetten (für den „verwandt"-Modus). Blockiert die
    // Suche nicht zusätzlich — läuft neben den Bereichs-Tasks.
    var qvecP = computeQueryVec(query);

    return Promise.all([Promise.all(tasks), internetP, qvecP]).then(function (both) {
      var lists = both[0];
      var internet = both[1];
      lastQueryVec = both[2] || null;
      var all = [];
      lists.forEach(function (l) { if (Array.isArray(l)) all = all.concat(l); });
      if (Array.isArray(internet.candidates)) all = all.concat(internet.candidates);
      all.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
      var top = all.slice(0, MAX_RANK);
      var webLink = internet.webLink;

      if (top.length === 0) {
        lastSearchMode = webLink ? "semantisch" : "leer";
        return { mode: lastSearchMode, treffer: [], webLink: webLink };
      }
      if (richterOn && optApiKey && match && typeof match.hybridMatch === "function") {
        return richterRerank(query, top).then(function (judged) {
          lastSearchMode = judged.mode;
          return { mode: judged.mode, treffer: judged.treffer, webLink: webLink,
                   reason: judged.reason, attestation: judged.attestation };
        });
      }
      lastSearchMode = "semantisch";
      return { mode: "semantisch", treffer: top, webLink: webLink };
    }).catch(function (err) {
      lastSearchMode = "fehler";
      return { mode: "fehler", treffer: [], webLink: null, reason: (err && err.message) || String(err) };
    });
  }

  function runAndRender() {
    if (activeRecognizer && typeof activeRecognizer.stop === "function") {
      try { activeRecognizer.stop(); } catch (_e) { /* idempotent */ }
      activeRecognizer = null;
    }
    var text = inputEl ? inputEl.value : queryValue;
    queryValue = text;
    setHint("Suche läuft …");
    kiRelatedState = { query: null, byKey: {}, available: false, running: false }; // neue Frage → KI-Urteil neu holen
    searchCount++;
    var myToken = searchCount;                // gegen veraltete Live-Antworten
    resultsVisibleCount = RESULT_PAGE_SIZE; // neue Suche → wieder die ersten 10
    expand(); // Ergebnis ist da bzw. kommt — Widget wächst.
    var baseRes = null;
    // Live-Antwort vom Knoten kommt evtl. erst Minuten später (schwaches Netz,
    // kaltes Embedding-Modell). Wir reichen sie dann in die schon gezeigte Liste
    // nach (einsortiert nach Score), statt die Suche so lange zu blockieren.
    function onLiveKnoten(liveRows) {
      if (myToken !== searchCount || !baseRes) return;   // neue Suche gestartet → verwerfen
      if (!Array.isArray(liveRows) || !liveRows.length) return;
      var merged = (baseRes.treffer || []).slice();
      var keyset = {};
      merged.forEach(function (t) { keyset[(t.anchorId || "") + "|" + t.label] = 1; });
      liveRows.forEach(function (r) {
        var k = (r.anchorId || "") + "|" + r.label;
        if (!keyset[k]) { keyset[k] = 1; merged.push(r); }
      });
      merged.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
      if (merged.length > MAX_RANK) merged = merged.slice(0, MAX_RANK);
      baseRes = { mode: baseRes.mode, treffer: merged, webLink: baseRes.webLink,
                  reason: baseRes.reason, attestation: baseRes.attestation };
      renderResults(baseRes);
      setHint("Live-Antwort vom Knoten ergänzt.");
    }
    return runMultiSearch(text, onLiveKnoten).then(function (res) {
      baseRes = res;
      renderResults(res);
      return res;
    }).catch(function (err) {
      setHint("Suche fehlgeschlagen — bitte erneut versuchen.");
      warn("runAndRender unerwartet", err);
    });
  }

  var SOURCE_LABELS = { app: "App", knoten: "Knoten", internet: "Netz" };

  // Neuen Tab öffnen — explizit, weil ein <a target="_blank"> auf Touch durch
  // setPointerCapture verschluckt werden kann. window.open im click-Handler
  // gilt als Nutzer-Geste (kein Popup-Block).
  function openUrl(url) {
    if (!url) return;
    try {
      var w = global.open ? global.open(url, "_blank", "noopener,noreferrer") : null;
      if (!w && global.location) { /* Fallback nur, wenn open blockiert wäre */ }
    } catch (e) { warn("Konnte Link nicht öffnen: " + url, e); }
  }

  // Sprache der Zusammenfassung grob erkennen (DE/EN/RU — wie Modul 21 SPEECH_LANGS),
  // damit die Vorlese-Stimme die RICHTIGE Sprache/Stimme nimmt (Klaus 2026-06-23).
  // Leichte Heuristik, server-los: Kyrillisch → ru; deutsche Sonderzeichen/Stoppwörter
  // → de; englische Stoppwörter → en; sonst Default de.
  function detectLangCode(text) {
    var t = String(text || "");
    if (/[Ѐ-ӿ]/.test(t)) return "ru-RU";
    var lower = " " + t.toLowerCase().replace(/[^\p{L}\s]/gu, " ") + " ";
    if (/[äöüß]/.test(lower)) return "de-DE";
    var de = (lower.match(/ (der|die|das|und|nicht|weil|eine|einen|für|ist|ich|mit|auch|wird|werden|zum|zur|sind|wurde|warum|reihenfolge|gewählt) /g) || []).length;
    var en = (lower.match(/ (the|and|because|why|this|with|are|was|were|of|to|is|for|that|chosen|order|first|should) /g) || []).length;
    if (en > de) return "en-US";
    return "de-DE";
  }

  function pickVoiceFor(lang) {
    try {
      var synth = global.speechSynthesis;
      if (!synth || typeof synth.getVoices !== "function") return null;
      var voices = synth.getVoices() || [];
      var two = lang.slice(0, 2).toLowerCase();
      // Exakte Sprach-Region zuerst, sonst gleiche Sprache.
      for (var i = 0; i < voices.length; i++) { if ((voices[i].lang || "").toLowerCase().replace("_", "-") === lang.toLowerCase()) return voices[i]; }
      for (var j = 0; j < voices.length; j++) { if ((voices[j].lang || "").toLowerCase().indexOf(two) === 0) return voices[j]; }
    } catch (_e) { /* nb */ }
    return null;
  }

  // Text vorlesen (Browser-Sprachausgabe, server-los, gratis), in der erkannten
  // Sprache. Toggle: läuft schon etwas → stoppen. Fail-soft ohne speechSynthesis.
  function readAloud(text) {
    try {
      var synth = global.speechSynthesis;
      if (!synth || typeof global.SpeechSynthesisUtterance !== "function") {
        setHint("Vorlesen wird vom Browser nicht unterstützt.");
        return;
      }
      if (synth.speaking) { synth.cancel(); return; }
      if (!text) return;
      var lang = detectLangCode(text);
      var u = new global.SpeechSynthesisUtterance(String(text));
      u.lang = lang;
      var v = pickVoiceFor(lang);
      if (v) u.voice = v;
      synth.speak(u);
    } catch (e) { warn("Vorlesen fehlgeschlagen.", e); }
  }

  function makeBadge(doc, srcKey) {
    var badge = doc.createElement("span");
    badge.className = "sbkim-sw-badge " + srcKey;
    badge.textContent = SOURCE_LABELS[srcKey] || srcKey;
    return badge;
  }

  // Alle gerankten Treffer als nüchterner Text-Block (zum Kopieren/Schicken).
  function buildResultsText(res) {
    var t = displayTreffer(res);
    var q = (queryValue || "").trim();
    var sortNote = (viewMode === "verwandt")
      ? (kiRelatedActive() ? "sortiert nach Verwandtschaft (KI-Richter)" : "sortiert nach Verwandtschaft (Rangfolge)")
      : "sortiert nach Bedeutung";
    var head = "SBKIM-Suche" + (q ? " — \"" + q + "\"" : "") +
      "  (" + t.length + " Treffer, " + sortNote + ")";
    var lines = [head, ""];
    for (var i = 0; i < t.length; i++) {
      var r = t[i];
      var relPct = (viewMode === "verwandt" && typeof r.relatedness === "number")
        ? ("~" + Math.round(r.relatedness * 100) + "%  ") : "";
      var pct = relPct + ((typeof r.score === "number") ? (Math.round(r.score * 100) + "%  ") : "");
      var src = r.source ? "[" + (SOURCE_LABELS[r.source] || r.source) + "] " : "";
      lines.push((i + 1) + ". " + src + pct + (r.label || ""));
      if (r.url) lines.push("    " + r.url);
      if (r.snippet) lines.push("    " + r.snippet);
      if (r.begruendung) lines.push("    → " + r.begruendung);
      lines.push("");
    }
    if (res && res.webLink && res.webLink.url) lines.push("↗ Im Netz weitersuchen: " + res.webLink.url);
    return lines.join("\n").replace(/\n+$/, "\n");
  }

  function shallowCopyTreffer(t) {
    var copy = {};
    for (var key in t) { if (Object.prototype.hasOwnProperty.call(t, key)) copy[key] = t[key]; }
    return copy;
  }

  // REINE Funktion (keine Seiteneffekte, headless testbar): wendet die Anzeige-Sicht
  // auf eine Trefferliste an.
  //   mode "verbunden" → Liste unverändert (gewohnte rohe Cosinus-Reihenfolge).
  //   mode "verwandt"  → je Treffer relatedness(queryVec, t.passageVec) (Modul 04,
  //                      zentrierter Cosinus) anhängen, absteigend sortieren;
  //                      opts.relatedOnly blendet nicht-isRelated-Treffer aus.
  // Fail-soft: ohne Modul 04 / ohne queryVec → Liste unverändert (degradiert auf
  // "verbunden"). Treffer ohne passageVec (z.B. wiederhergestellte Suche, Live-
  // Knoten-Antwort ohne Vektor) bekommen relatedness=null und wandern nach unten
  // (bzw. werden bei relatedOnly ausgeblendet). relatedness() wirft bei falscher
  // Eingabe InvalidVectorError → pro Treffer abgefangen, kein Bruch der ganzen Liste.
  function rankView(treffer, queryVec, opts) {
    opts = opts || {};
    var mode = opts.mode || "verbunden";
    var relatedOnly = !!opts.relatedOnly;
    var kiByKey = opts.kiByKey || null;
    var list = Array.isArray(treffer) ? treffer.slice() : [];
    if (mode !== "verwandt") return list;
    var match = global.SbkimMatch;
    // „· KI": liegt ein KI-Richter-Urteil vor (byKey), danach ranken — das echte
    // Bedeutungs-Maß (Score 0..1, passt-Flag) statt des zentrierten Cosinus.
    // Fail-soft: ohne Urteil fällt es unten auf den Cosinus-Pfad zurück.
    if (kiByKey) {
      var ek = list.map(function (t) {
        var v = kiByKey[(t.anchorId || "") + "|" + (t.label || "")];
        var copy = shallowCopyTreffer(t);
        var s = (v && typeof v.score === "number" && isFinite(v.score)) ? v.score : null;
        copy.relatedness = s;
        copy.isRelated = !!(v && v.passt);
        copy.kiJudged = true;
        if (v && v.begruendung && !copy.begruendung) copy.begruendung = v.begruendung;
        return copy;
      });
      ek.sort(function (a, b) {
        var ra = (a.relatedness === null) ? -Infinity : a.relatedness;
        var rb = (b.relatedness === null) ? -Infinity : b.relatedness;
        if (rb !== ra) return rb - ra;
        return (b.score || 0) - (a.score || 0);
      });
      if (relatedOnly) ek = ek.filter(function (t) { return t.isRelated; });
      return ek;
    }
    if (!match || typeof match.relatedness !== "function" || !queryVec) return list;
    var enriched = list.map(function (t) {
      var rel = null;
      if (t && t.passageVec) {
        try { rel = match.relatedness(queryVec, t.passageVec); }
        catch (_e) { rel = null; } // InvalidVectorError o.ä. → fail-soft, Treffer bleibt
      }
      var copy = shallowCopyTreffer(t);
      copy.relatedness = (typeof rel === "number" && isFinite(rel)) ? rel : null;
      copy.isRelated = copy.relatedness !== null &&
        (typeof match.isRelated === "function" ? match.isRelated(copy.relatedness) : copy.relatedness >= 0.30);
      return copy;
    });
    enriched.sort(function (a, b) {
      var ra = (a.relatedness === null) ? -Infinity : a.relatedness;
      var rb = (b.relatedness === null) ? -Infinity : b.relatedness;
      if (rb !== ra) return rb - ra;
      return (b.score || 0) - (a.score || 0);
    });
    if (relatedOnly) enriched = enriched.filter(function (t) { return t.isRelated; });
    return enriched;
  }

  // Die für die ANZEIGE aufbereitete Trefferliste (Sicht angewandt). Genutzt von
  // renderResults UND buildResultsText, damit Anzeige und „Block kopieren" gleich
  // sortiert sind.
  function displayTreffer(res) {
    var kiByKey = kiRelatedActive() ? kiRelatedState.byKey : null;
    return rankView((res && res.treffer) || [], lastQueryVec,
      { mode: viewMode, relatedOnly: viewRelatedOnly, kiByKey: kiByKey });
  }

  function renderResults(res) {
    if (!resultsEl) return;
    var doc = global.document;
    // Treffer-Liste neu zeichnen (createElement, kein innerHTML) — berührt das
    // Textfeld NICHT (UX-Erhalt).
    while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);
    // Anzeige-Sicht anwenden (verbunden = unverändert, verwandt = nach relatedness
    // umsortiert / optional gefiltert). Rein für die Darstellung — res.treffer (roh)
    // bleibt unangetastet, ebenso die Persistenz.
    var treffer = displayTreffer(res);
    var modeHint = {
      "modul-04-fehlt": "Modul 04 (Match) nicht geladen.",
      "fehler": "Suche fehlgeschlagen" + (res.reason ? " (" + res.reason + ")" : "") + ".",
      "leer": res.reason || "Keine Treffer.",
      "semantisch": treffer.length
        ? "Semantische Suche" + (richterOn && !optApiKey ? " (Richter aus — kein Schlüssel)." : ".")
        : (res.webLink ? "Im Netz weitersuchen:" : "Keine Treffer."),
      "richter": "KI-Richter-Urteil." + (res.reason ? " (Hinweis: " + res.reason + ")" : ""),
    };
    setHint(modeHint[res.mode] || "");

    // Kurze KI-Zusammenfassung („warum diese Reihenfolge") ganz oben — aus der
    // eingefügten/geholten KI-Antwort, sonst aus der wiederhergestellten Suche.
    var summary = "";
    if (hasPastedAi()) summary = extractAiSummary(pastedAiText);
    if (!summary && res && typeof res.summary === "string") summary = res.summary;
    res.summary = summary; // für Persistenz/Restore
    lastRenderRes = res;
    // „· KI": Urteil bei Bedarf anstoßen (nur verwandt + KI + Schlüssel). Zeigt bis
    // dahin den gratis Cosinus; bei Eintreffen folgt ein Re-Render. Fail-soft.
    ensureKiRelated(res);
    if (summary) {
      var sumEl = doc.createElement("div");
      sumEl.className = "sbkim-sw-summary";
      var sumHead = doc.createElement("div");
      sumHead.className = "sbkim-sw-summary-head";
      var sumLabel = doc.createElement("span");
      sumLabel.textContent = "Kurz erklärt — warum diese Reihenfolge";
      sumHead.appendChild(sumLabel);
      var sayBtn = doc.createElement("button");
      sayBtn.type = "button";
      sayBtn.className = "sbkim-sw-saybtn";
      sayBtn.textContent = "🔊 Vorlesen";
      sayBtn.setAttribute("title", "Zusammenfassung vorlesen (nochmal tippen stoppt)");
      sayBtn.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
      (function (txt) {
        sayBtn.addEventListener("click", function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (ev && ev.stopPropagation) ev.stopPropagation();
          readAloud(txt);
        });
      })(summary);
      sumHead.appendChild(sayBtn);
      sumEl.appendChild(sumHead);
      var sumText = doc.createElement("div");
      sumText.className = "sbkim-sw-summary-text";
      sumText.textContent = summary;
      sumEl.appendChild(sumText);
      resultsEl.appendChild(sumEl);
    }

    // 🖨 Block kopieren: ALLE gerankten Treffer als Text in die Zwischenablage,
    // damit Klaus den ganzen Block auf einen Klick rüberschicken kann.
    if (treffer.length > 0) {
      var copyBtn = doc.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "sbkim-sw-copyall";
      copyBtn.textContent = "🖨 Block kopieren (" + treffer.length + ")";
      copyBtn.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
      copyBtn.addEventListener("click", function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        copyToClipboard(buildResultsText(lastRenderRes)).then(function (ok) {
          setHint(ok ? "Treffer-Block kopiert — einfügen und losschicken." : "Kopieren nicht möglich (Browser blockiert).");
        });
      });
      resultsEl.appendChild(copyBtn);
    }

    // Nur die ersten resultsVisibleCount zeigen, Rest hinter dem ▾-Pfeil
    // (Klaus 2026-06-21: 10 zeigen, je Klick 10 mehr).
    var gkey = currentGroupKey();
    var shown = Math.min(treffer.length, resultsVisibleCount);
    for (var i = 0; i < shown; i++) {
      var t = treffer[i];
      var el = doc.createElement("div");
      el.className = "sbkim-sw-result";
      // Tippen auf die Treffer-Zeile (außer Haken/Titel) → Tool-eigene Detail-Karte.
      var detailItemForRow = merkItemOf(t);
      attachDetailHandler(el, detailItemForRow);
      var line = doc.createElement("div");
      line.className = "sbkim-sw-resultline";
      // Merken-Haken pro Treffer (Klaus 2026-06-22). Gemerktes → localStorage,
      // gruppiert unter der Suchfrage; funktioniert für alle Treffer-Arten.
      line.appendChild(makeMerkCheckbox(doc, t, gkey));
      line.appendChild(makeBadge(doc, t.source || "app"));

      var titleEl;
      if (t.url) {
        titleEl = doc.createElement("a");
        titleEl.className = "sbkim-sw-result-link";
        titleEl.href = t.url; // rechte Maustaste → „in neuem Tab öffnen" bleibt
        titleEl.target = "_blank";
        titleEl.rel = "noopener noreferrer";
        titleEl.textContent = t.label;
        attachDetailHandler(titleEl, detailItemForRow); // Linksklick → Detail-Karte
      } else {
        titleEl = doc.createElement("span");
        titleEl.className = "sbkim-sw-result-title";
        titleEl.textContent = t.label;
        attachDetailHandler(titleEl, detailItemForRow);
      }
      line.appendChild(titleEl);

      if (typeof t.score === "number") {
        line.appendChild(doc.createTextNode(" "));
        var scoreEl = doc.createElement("span");
        scoreEl.className = "sbkim-sw-score";
        // Cosinus → Prozent Bedeutungs-Übereinstimmung (anschaulich für Klaus).
        scoreEl.textContent = Math.round(t.score * 100) + " %";
        line.appendChild(scoreEl);
      }
      // Im "verwandt"-Modus zusätzlich den zentrierten Verwandtschafts-Wert zeigen
      // (🧬 = echter Themen-Bezug, getrennt vom rohen Andock-Cosinus).
      if (viewMode === "verwandt" && typeof t.relatedness === "number") {
        line.appendChild(doc.createTextNode(" "));
        var relEl = doc.createElement("span");
        relEl.className = "sbkim-sw-relscore" + (t.isRelated ? " is-related" : "");
        var kiJudged = t.kiJudged === true;
        relEl.setAttribute("title", kiJudged
          ? "Verwandtschaft — vom KI-Richter über die Bedeutung beurteilt, gatet nichts"
          : "Verwandtschaft (zentrierter Cosinus) — Rangfolge nach Themen-Bezug, gatet nichts");
        relEl.textContent = "🧬 " + Math.round(t.relatedness * 100) + " %" + (kiJudged ? " · KI" : "");
        line.appendChild(relEl);
      }
      el.appendChild(line);
      // Inhalt (KI-Snippet) zeigen, damit man SIEHT, worum es geht.
      if (t.snippet) {
        var snipEl = doc.createElement("div");
        snipEl.className = "sbkim-sw-snippet";
        snipEl.textContent = t.snippet;
        el.appendChild(snipEl);
      }
      // Begründung nur beim KI-Richter (erklärt das „worin").
      if (t.begruendung) {
        var reasonEl = doc.createElement("div");
        reasonEl.className = "sbkim-sw-reason";
        reasonEl.textContent = t.begruendung;
        el.appendChild(reasonEl);
      }
      resultsEl.appendChild(el);
    }

    // ▾-Pfeil: die nächsten 10 aufklappen (ohne neue Suche).
    if (treffer.length > shown) {
      var moreBtn = doc.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "sbkim-sw-more";
      var rest = treffer.length - shown;
      moreBtn.textContent = "▾ weitere " + Math.min(RESULT_PAGE_SIZE, rest) + " zeigen (noch " + rest + ")";
      moreBtn.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
      moreBtn.addEventListener("click", function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        resultsVisibleCount += RESULT_PAGE_SIZE;
        if (lastRenderRes) renderResults(lastRenderRes);
      });
      resultsEl.appendChild(moreBtn);
    }

    // Web-Karte (Internet ohne SearXNG-URL / Fallback) ans ENDE. KOPIEREN statt
    // öffnen (Klaus 2026-06-22): ein Direkt-Link würde die PWA in den Hintergrund
    // schieben und der Inhalt ginge verloren. Der Knopf kopiert die Frage; der
    // Nutzer öffnet die Suchmaschine selbst (Splitscreen) und fügt sie ein.
    if (res.webLink && res.webLink.url) {
      var linkEl = doc.createElement("div");
      linkEl.className = "sbkim-sw-result";
      var wline = doc.createElement("div");
      wline.className = "sbkim-sw-resultline";
      wline.appendChild(makeBadge(doc, "internet"));
      var wq = doc.createElement("span");
      wq.className = "sbkim-sw-result-title";
      wq.textContent = res.webLink.query || "";
      wline.appendChild(wq);
      linkEl.appendChild(wline);
      // Zwei Wege zur Wahl (Klaus 2026-06-22): kopieren (App bleibt offen) ODER
      // direkt im Browser öffnen (kann die App neu laden — Frage/Treffer sind
      // aber gesichert). So entscheidet der Nutzer selbst.
      var webActions = doc.createElement("div");
      webActions.className = "sbkim-sw-merk-actions";
      var webCopyBtn = doc.createElement("button");
      webCopyBtn.type = "button";
      webCopyBtn.className = "sbkim-sw-more sbkim-sw-webcopy";
      webCopyBtn.textContent = "📋 Frage kopieren";
      webCopyBtn.setAttribute("title", "Frage kopieren; Suchmaschine selbst öffnen (Splitscreen) und einfügen — App bleibt offen");
      webCopyBtn.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
      (function (q) {
        webCopyBtn.addEventListener("click", function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (ev && ev.stopPropagation) ev.stopPropagation();
          copyToClipboard(q).then(function (ok) {
            setHint(ok
              ? "Frage kopiert — Suchmaschine selbst öffnen (Splitscreen) und einfügen. Die App bleibt offen."
              : "Konnte nicht kopieren — Frage oben markieren und kopieren.");
          });
        });
      })(res.webLink.query || "");
      webActions.appendChild(webCopyBtn);
      var webOpenBtn = doc.createElement("button");
      webOpenBtn.type = "button";
      webOpenBtn.className = "sbkim-sw-more sbkim-sw-webopen";
      webOpenBtn.textContent = "↗ Im Browser öffnen";
      webOpenBtn.setAttribute("title", "Suchmaschine direkt öffnen — kann die App neu laden, Frage/Treffer sind aber gesichert");
      webOpenBtn.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
      (function (url) {
        webOpenBtn.addEventListener("click", function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (ev && ev.stopPropagation) ev.stopPropagation();
          openUrl(url);
        });
      })(res.webLink.url);
      webActions.appendChild(webOpenBtn);
      linkEl.appendChild(webActions);
      resultsEl.appendChild(linkEl);
    }

    // Letzte Suche lokal merken (Reload-Schutz) — überlebt einen PWA-Neustart.
    persistLastSearch(res);
  }

  // Klick/Tap auf einen Link: Drag verhindern + explizit öffnen (Touch-fest).
  function attachOpenHandler(linkEl, url) {
    linkEl.addEventListener("pointerdown", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
    });
    linkEl.addEventListener("click", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (ev && ev.stopPropagation) ev.stopPropagation();
      openUrl(url);
    });
  }

  // Klick/Tap auf einen Treffer → Tool-eigene Detail-Karte (Klaus 2026-06-22).
  function attachDetailHandler(el, item) {
    el.addEventListener("pointerdown", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
    });
    el.addEventListener("click", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (ev && ev.stopPropagation) ev.stopPropagation();
      openDetail(item);
    });
  }

  // ===================================================================
  // Merken-Liste (Klaus 2026-06-22) — pro Treffer ein Haken; das Gemerkte landet
  // in localStorage, GRUPPIERT unter der Suchfrage als Überschrift. Nur Text +
  // Link (+ Quelle/Datum für Anzeige) — keine Vektoren, keine PII, kein Protokoll.
  // Funktioniert für alle Treffer-Arten (App/Knoten/Netz) mit Badge je Art.
  // ===================================================================

  // Heading-Schlüssel = die Suchfrage (nicht der Seitenname). Aktuell laufende
  // Frage; leere Frage → Sammel-Gruppe.
  function currentGroupKey() {
    var q = (queryValue || "").trim();
    return q || "(ohne Frage)";
  }

  // Treffer → schlankes Merk-/Detail-Objekt (nur Text + Link + Anzeige-Felder).
  function merkItemOf(t) {
    return {
      titel: t.label || t.titel || t.url || "",
      url: t.url || null,
      text: t.snippet || t.text || null,
      source: t.source || "app",
      score: typeof t.score === "number" ? t.score : null,
      begruendung: t.begruendung || null,
    };
  }

  function merkKeyOf(item) {
    return String((item && (item.url || item.titel || item.label)) || "");
  }

  function loadMerkliste() {
    var raw = lsGet(LS_KEY_MERK);
    if (!raw) return {};
    try {
      var o = JSON.parse(raw);
      return (o && typeof o === "object" && !Array.isArray(o)) ? o : {};
    } catch (_e) { return {}; }
  }

  function saveMerkliste(obj) {
    try { lsSet(LS_KEY_MERK, JSON.stringify(obj || {})); } catch (_e) { /* fail-soft */ }
  }

  function merkCount() {
    var m = loadMerkliste(), n = 0;
    for (var q in m) { if (Array.isArray(m[q])) n += m[q].length; }
    return n;
  }

  function isMerkt(groupKey, item) {
    var arr = loadMerkliste()[groupKey];
    if (!Array.isArray(arr)) return false;
    var key = merkKeyOf(item);
    for (var i = 0; i < arr.length; i++) { if (merkKeyOf(arr[i]) === key) return true; }
    return false;
  }

  function addMerk(groupKey, item) {
    var m = loadMerkliste();
    if (!Array.isArray(m[groupKey])) m[groupKey] = [];
    var key = merkKeyOf(item);
    for (var i = 0; i < m[groupKey].length; i++) { if (merkKeyOf(m[groupKey][i]) === key) return; }
    m[groupKey].push({
      titel: String(item.titel || item.label || item.url || "").slice(0, 300),
      url: item.url ? String(item.url) : null,
      text: item.text ? String(item.text).slice(0, 600) : null,
      source: item.source || "app",
      addedAt: Date.now(),
    });
    saveMerkliste(m);
    updateMerkBtn();
  }

  function removeMerk(groupKey, key) {
    var m = loadMerkliste();
    if (!Array.isArray(m[groupKey])) return;
    m[groupKey] = m[groupKey].filter(function (it) { return merkKeyOf(it) !== key; });
    if (m[groupKey].length === 0) delete m[groupKey];
    saveMerkliste(m);
    updateMerkBtn();
  }

  function toggleMerk(groupKey, item) {
    if (isMerkt(groupKey, item)) removeMerk(groupKey, merkKeyOf(item));
    else addMerk(groupKey, item);
  }

  function clearMerkliste() {
    lsRemove(LS_KEY_MERK);
    updateMerkBtn();
    if (merkOverlayOpen) renderMerkOverlay();
  }

  function getMerkliste() {
    try { return JSON.parse(JSON.stringify(loadMerkliste())); } catch (_e) { return {}; }
  }

  // Kleiner Haken pro Treffer-Zeile (📌). Klick togglet Merken; stopPropagation,
  // damit weder der Drag noch die Detail-Karte mit anspringt.
  function makeMerkCheckbox(doc, t, groupKey) {
    var item = merkItemOf(t);
    var wrap = doc.createElement("label");
    wrap.className = "sbkim-sw-check sbkim-sw-merkbox";
    wrap.setAttribute("title", "Merken — in die Merkliste legen");
    var input = doc.createElement("input");
    input.type = "checkbox";
    input.checked = isMerkt(groupKey, item);
    input.addEventListener("change", function () { toggleMerk(groupKey, item); });
    wrap.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    wrap.addEventListener("click", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    var pin = doc.createElement("span");
    pin.textContent = "📌";
    wrap.appendChild(input);
    wrap.appendChild(pin);
    wrap._input = input;
    return wrap;
  }

  function updateMerkBtn() {
    if (!merkBtnEl) return;
    var n = merkCount();
    merkBtnEl.textContent = "📌";
    merkBtnEl.setAttribute("aria-label", "Merkliste" + (n ? " (" + n + " gemerkt)" : " (leer)"));
    merkBtnEl.setAttribute("title", "Merkliste — Gemerktes, gruppiert nach Suchfrage" + (n ? " (" + n + ")" : ""));
    if (merkBtnEl.classList) {
      if (n) merkBtnEl.classList.add("sbkim-sw-has-merk");
      else merkBtnEl.classList.remove("sbkim-sw-has-merk");
    }
  }

  // ---- Overlays (Detail-Karte + Merkliste) ----

  function renderOverlays() {
    if (detailOverlayEl) detailOverlayEl.style.display = detailOverlayOpen ? "flex" : "none";
    if (merkOverlayEl) merkOverlayEl.style.display = merkOverlayOpen ? "flex" : "none";
  }

  function hideOverlays() {
    detailOverlayOpen = false;
    merkOverlayOpen = false;
    renderOverlays();
  }

  // „Zurück": Overlay schließen; Treffer neu zeichnen, damit die Haken den evtl.
  // im Overlay geänderten Merk-Zustand spiegeln.
  function closeOverlays() {
    hideOverlays();
    if (lastRenderRes) renderResults(lastRenderRes);
  }

  function openDetail(item) {
    if (!item) return;
    detailItem = item;
    detailOverlayOpen = true;
    merkOverlayOpen = false;
    if (!expandedFlag) expand();
    renderDetailOverlay();
    renderOverlays();
  }

  function openMerkliste() {
    merkOverlayOpen = true;
    detailOverlayOpen = false;
    if (!expandedFlag) expand();
    renderMerkOverlay();
    renderOverlays();
  }

  function makeOverlayHead(doc, titleText) {
    var head = doc.createElement("div");
    head.className = "sbkim-sw-overlay-head";
    var backBtn = makeBtn(doc, "sbkim-sw-btn sbkim-sw-back", "‹", "Zurück");
    backBtn.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    backBtn.addEventListener("click", function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      closeOverlays();
    });
    head.appendChild(backBtn);
    var title = doc.createElement("span");
    title.className = "sbkim-sw-overlay-title";
    title.textContent = titleText;
    head.appendChild(title);
    return head;
  }

  // Tool-eigene Detail-Karte (in den Tool-Farben) für EINEN Treffer.
  function renderDetailOverlay() {
    if (!detailOverlayEl) return;
    var doc = global.document;
    while (detailOverlayEl.firstChild) detailOverlayEl.removeChild(detailOverlayEl.firstChild);
    detailOverlayEl.appendChild(makeOverlayHead(doc, "Treffer"));
    var item = detailItem || {};
    var gkey = currentGroupKey();

    var badgeLine = doc.createElement("div");
    badgeLine.appendChild(makeBadge(doc, item.source || "app"));
    var titleEl = doc.createElement("span");
    titleEl.className = "sbkim-sw-detail-titel";
    titleEl.textContent = item.titel || "(ohne Titel)";
    badgeLine.appendChild(titleEl);
    detailOverlayEl.appendChild(badgeLine);

    if (item.text) {
      var desc = doc.createElement("div");
      desc.className = "sbkim-sw-detail-desc";
      desc.textContent = item.text;
      detailOverlayEl.appendChild(desc);
    }
    if (item.url) {
      var urlEl = doc.createElement("div");
      urlEl.className = "sbkim-sw-detail-url";
      urlEl.textContent = item.url;
      detailOverlayEl.appendChild(urlEl);
    }

    // [📌 Merken] / [📌 Gemerkt ✓] — Merken aus dem Overlay; gilt sofort.
    var merkBtn = makeBtn(doc, "sbkim-sw-aibtn sbkim-sw-detail-merk", "", "Merken");
    function refreshMerkBtnLabel() {
      var on = isMerkt(gkey, item);
      merkBtn.textContent = on ? "📌 Gemerkt ✓ (entfernen)" : "📌 Merken";
    }
    refreshMerkBtnLabel();
    merkBtn.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    merkBtn.addEventListener("click", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      toggleMerk(gkey, item);
      refreshMerkBtnLabel();
    });
    detailOverlayEl.appendChild(merkBtn);

    // [↗ Seite öffnen] — echte Seite im neuen Tab (nur wenn es eine URL gibt).
    if (item.url) {
      var openBtn = makeBtn(doc, "sbkim-sw-aibtn sbkim-sw-detail-open", "↗ Seite öffnen", "Echte Seite im neuen Tab öffnen");
      openBtn.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
      openBtn.addEventListener("click", function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (ev && ev.stopPropagation) ev.stopPropagation();
        openUrl(item.url);
      });
      detailOverlayEl.appendChild(openBtn);
    }
  }

  // Merkliste-Overlay: gemerkte Treffer, gruppiert unter der Suchfrage.
  function renderMerkOverlay() {
    if (!merkOverlayEl) return;
    var doc = global.document;
    while (merkOverlayEl.firstChild) merkOverlayEl.removeChild(merkOverlayEl.firstChild);
    merkOverlayEl.appendChild(makeOverlayHead(doc, "Merkliste"));

    var m = loadMerkliste();
    var groups = Object.keys(m);
    if (groups.length === 0) {
      var empty = doc.createElement("div");
      empty.className = "sbkim-sw-merk-empty";
      empty.textContent = "Noch nichts gemerkt — Treffer ankreuzen (📌) oder in der Detail-Karte per 📌 Merken.";
      merkOverlayEl.appendChild(empty);
      return;
    }

    var clearBtn = makeBtn(doc, "sbkim-sw-aibtn sbkim-sw-merk-clear", "Alles entfernen", "Ganze Merkliste leeren");
    clearBtn.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    clearBtn.addEventListener("click", function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      clearMerkliste();
    });
    merkOverlayEl.appendChild(clearBtn);

    groups.forEach(function (groupKey) {
      var items = m[groupKey];
      if (!Array.isArray(items) || items.length === 0) return;
      var groupEl = doc.createElement("div");
      groupEl.className = "sbkim-sw-merk-group";
      var gt = doc.createElement("div");
      gt.className = "sbkim-sw-merk-group-title";
      gt.textContent = groupKey; // die Suchfrage als Überschrift
      groupEl.appendChild(gt);

      items.forEach(function (it) {
        var row = doc.createElement("div");
        row.className = "sbkim-sw-merk-item";
        var l = doc.createElement("div");
        l.className = "sbkim-sw-resultline";
        l.appendChild(makeBadge(doc, it.source || "app"));
        var titleEl;
        if (it.url) {
          titleEl = doc.createElement("a");
          titleEl.className = "sbkim-sw-result-link";
          titleEl.href = it.url;
          titleEl.target = "_blank";
          titleEl.rel = "noopener noreferrer";
          titleEl.textContent = it.titel || it.url;
          attachOpenHandler(titleEl, it.url);
        } else {
          titleEl = doc.createElement("span");
          titleEl.className = "sbkim-sw-result-title";
          titleEl.textContent = it.titel || "(ohne Titel)";
        }
        l.appendChild(titleEl);
        row.appendChild(l);
        if (it.text) {
          var sn = doc.createElement("div");
          sn.className = "sbkim-sw-snippet";
          sn.textContent = it.text;
          row.appendChild(sn);
        }
        var actions = doc.createElement("div");
        actions.className = "sbkim-sw-merk-actions";
        if (it.url) {
          var openA = makeBtn(doc, "sbkim-sw-more sbkim-sw-merk-open", "↗ öffnen", "Seite im neuen Tab öffnen");
          openA.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
          (function (url) {
            openA.addEventListener("click", function (ev) {
              if (ev && ev.preventDefault) ev.preventDefault();
              if (ev && ev.stopPropagation) ev.stopPropagation();
              openUrl(url);
            });
          })(it.url);
          actions.appendChild(openA);
        }
        var rm = makeBtn(doc, "sbkim-sw-more sbkim-sw-merk-remove", "✕ entfernen", "Aus der Merkliste entfernen");
        rm.addEventListener("pointerdown", function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
        (function (gk, key) {
          rm.addEventListener("click", function (ev) {
            if (ev && ev.preventDefault) ev.preventDefault();
            if (ev && ev.stopPropagation) ev.stopPropagation();
            removeMerk(gk, key);  // Haken weg → Eintrag weg
            renderMerkOverlay();
          });
        })(groupKey, merkKeyOf(it));
        actions.appendChild(rm);
        row.appendChild(actions);
        groupEl.appendChild(row);
      });
      merkOverlayEl.appendChild(groupEl);
    });
  }

  // ===================================================================
  // Letzte Suche merken (Reload-Schutz, Klaus 2026-06-22). Beim Öffnen eines
  // Web-Treffers im Splitscreen wirft Android die PWA gern aus dem Speicher →
  // Neustart, Trefferliste (RAM) weg. Darum die letzte Suche (Frage + Treffer,
  // nur Text+Link, keine Vektoren/PII) in localStorage spiegeln und beim Mount
  // wiederherstellen — so bleibt der Vergleichs-Ablauf erhalten.
  // ===================================================================

  function persistLastSearch(res) {
    try {
      if (!res) return;
      var treffer = (res.treffer || []).slice(0, 50).map(function (t) {
        return {
          label: t.label, score: typeof t.score === "number" ? t.score : null,
          source: t.source || "app", url: t.url || null, snippet: t.snippet || null,
          begruendung: t.begruendung || null, anchorId: t.anchorId || null, text: t.text || null,
        };
      });
      var hasWeb = !!(res.webLink && res.webLink.url);
      if (!treffer.length && !hasWeb) { lsRemove(LS_KEY_LAST); return; }
      lsSet(LS_KEY_LAST, JSON.stringify({
        query: queryValue || "", mode: res.mode || "semantisch",
        treffer: treffer, webLink: res.webLink || null,
        summary: (typeof res.summary === "string" ? res.summary : ""),
      }));
    } catch (_e) { /* fail-soft (Quota/Inkognito) */ }
  }

  // Beim Mount aufrufen (NACH localStorage-Prefs): setzt queryValue + lastRenderRes
  // aus der gespeicherten Suche, damit das Panel die Treffer wieder zeigen kann.
  function restoreLastSearch() {
    var raw = lsGet(LS_KEY_LAST);
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (!p || typeof p !== "object") return;
      if (typeof p.query === "string") queryValue = p.query;
      if (Array.isArray(p.treffer)) {
        lastRenderRes = { mode: p.mode || "semantisch", treffer: p.treffer,
                          webLink: p.webLink || null,
                          summary: (typeof p.summary === "string" ? p.summary : ""),
                          restored: true };
      }
    } catch (_e) { /* fail-soft */ }
  }

  // Anzeige-Sicht (verbunden/verwandt + nur-verwandte) persistieren/wiederherstellen.
  // User-Wahl ist heilig und übersteht Re-Init; Default bleibt "verbunden" (grob),
  // damit nichts an der gewohnten Sicht überrascht.
  function persistViewPref() {
    try { lsSet(LS_KEY_VIEW, JSON.stringify({ mode: viewMode, relatedOnly: viewRelatedOnly, kiRelated: viewKiRelated })); }
    catch (_e) { /* fail-soft (Quota/Inkognito) */ }
  }
  function restoreViewPref() {
    var raw = lsGet(LS_KEY_VIEW);
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (p && typeof p === "object") {
        if (p.mode === "verbunden" || p.mode === "verwandt") viewMode = p.mode;
        if (typeof p.relatedOnly === "boolean") viewRelatedOnly = p.relatedOnly;
        if (typeof p.kiRelated === "boolean") viewKiRelated = p.kiRelated;
      }
    } catch (_e) { /* fail-soft */ }
  }

  // Nur die eingetippte Frage sofort sichern (Klaus 2026-06-22): auch OHNE
  // gerenderte Trefferliste (z.B. wenn man nur den KI-Prompt kopiert) soll die
  // Frage einen App-Neustart überleben. Mergt in den lastsearch-Eintrag, ohne
  // vorhandene Treffer zu verlieren.
  function persistQuery() {
    try {
      var raw = lsGet(LS_KEY_LAST);
      var p = {};
      if (raw) { try { p = JSON.parse(raw) || {}; } catch (_e) { p = {}; } }
      p.query = queryValue || "";
      var hasTreffer = Array.isArray(p.treffer) && p.treffer.length;
      var hasWeb = p.webLink && p.webLink.url;
      if (!p.query && !hasTreffer && !hasWeb) { lsRemove(LS_KEY_LAST); return; }
      lsSet(LS_KEY_LAST, JSON.stringify(p));
    } catch (_e) { /* fail-soft */ }
  }

  // ---- Korpus ----

  function setCorpus(corpus) {
    if (corpus == null) { localCorpus = null; return; }
    if (!Array.isArray(corpus)) {
      warn("setCorpus erwartet ein Array — ignoriert.");
      return;
    }
    localCorpus = corpus.slice();
    // An Modul 04 durchreichen (fail-soft, wenn Modul 04 fehlt).
    var match = global.SbkimMatch;
    if (match && typeof match.setLocalCorpus === "function") {
      try { match.setLocalCorpus(localCorpus); }
      catch (e) { warn("SbkimMatch.setLocalCorpus warf — Korpus bleibt lokal gehalten.", e); }
    }
  }

  // ---- Drag-Mechanik (Pattern aus Modul 17) ----

  function attachDragHandlers(root) {
    root.addEventListener("pointerdown", onPointerDown);
  }

  function isInteractiveTarget(target) {
    // Bis zum Widget-Root hochlaufen: jeder Tap innerhalb eines Treffers, Links,
    // einer Checkbox oder eines Knopfs ist Bedienung, kein Drag. Wichtig gegen
    // setPointerCapture, das sonst auf Touch den Link-/Button-Klick frisst
    // (Klaus' Befund 2026-06-21: Netz-Link ließ sich nicht öffnen).
    var el = target;
    var depth = 0;
    while (el && el !== widgetRoot && depth < 10) {
      if (el.tagName === "A" || el.tagName === "INPUT" || el.tagName === "BUTTON" ||
          el.tagName === "LABEL" || el.tagName === "SELECT" || el.tagName === "OPTION" ||
          el.tagName === "TEXTAREA") return true;
      if (el.classList && (
          el.classList.contains("sbkim-sw-input") ||
          el.classList.contains("sbkim-sw-btn") ||
          el.classList.contains("sbkim-sw-iconbtn") ||
          el.classList.contains("sbkim-sw-euchip") ||
          el.classList.contains("sbkim-sw-result") ||
          el.classList.contains("sbkim-sw-result-link") ||
          el.classList.contains("sbkim-sw-result-title") ||
          el.classList.contains("sbkim-sw-check") ||
          el.classList.contains("sbkim-sw-merkbox") ||
          el.classList.contains("sbkim-sw-overlay") ||
          el.classList.contains("sbkim-sw-resize") ||
          el.classList.contains("sbkim-sw-searxng"))) return true;
      el = el.parentNode;
      depth++;
    }
    return false;
  }

  function onPointerDown(ev) {
    if (!optAllowDrag || !widgetRoot) return;
    if (isInteractiveTarget(ev.target)) return; // Controls bedienen, nicht draggen
    var rect = widgetRoot.getBoundingClientRect();
    dragState = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      moved: false,
    };
    try { widgetRoot.setPointerCapture(ev.pointerId); } catch (_e) { /* fail-soft */ }
    widgetRoot.addEventListener("pointermove", onPointerMove);
    widgetRoot.addEventListener("pointerup", onPointerUp);
    widgetRoot.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(ev) {
    if (!dragState) return;
    var dx = ev.clientX - dragState.startX;
    var dy = ev.clientY - dragState.startY;
    if (!dragState.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      dragState.moved = true;
      try { widgetRoot.classList.add("sbkim-sw-dragging"); } catch (_e) { /* nb */ }
    }
    try {
      var newX = dragState.origLeft + dx;
      var newY = dragState.origTop + dy;
      var vw = global.innerWidth || 1024;
      var vh = global.innerHeight || 768;
      var rect = widgetRoot.getBoundingClientRect();
      var minX = -rect.width + 24;
      var maxX = vw - 24;
      var minY = 0;
      var maxY = vh - 24;
      if (newX < minX) newX = minX;
      if (newX > maxX) newX = maxX;
      if (newY < minY) newY = minY;
      if (newY > maxY) newY = maxY;
      currentFreeX = newX;
      currentFreeY = newY;
      currentCorner = null;
      applyPositionToRoot();
    } catch (err) {
      warn("Drag-Pointer-Fehler — Drag abgebrochen.", err);
      onPointerUp(ev);
    }
  }

  function onPointerUp(ev) {
    if (!dragState) return;
    var moved = dragState.moved;
    try {
      if (widgetRoot && typeof widgetRoot.releasePointerCapture === "function" &&
          dragState.pointerId !== undefined) {
        widgetRoot.releasePointerCapture(dragState.pointerId);
      }
    } catch (_e) { /* nb */ }
    if (widgetRoot) {
      try { widgetRoot.classList.remove("sbkim-sw-dragging"); } catch (_e) { /* nb */ }
      widgetRoot.removeEventListener("pointermove", onPointerMove);
      widgetRoot.removeEventListener("pointerup", onPointerUp);
      widgetRoot.removeEventListener("pointercancel", onPointerUp);
    }
    if (moved) {
      persistPosition();
    } else if (!expandedFlag && (!ev || ev.type !== "pointercancel")) {
      // Tap ohne Bewegung im Ruhezustand → öffnen. Direkt hier statt im
      // click-Handler, weil setPointerCapture auf Touch-Geräten das
      // synthetische click-Event der Blase unterdrücken kann (Klaus' Befund
      // 2026-06-21: Blase ließ sich minimieren, aber nicht wieder antippen).
      expand();
    }
    var consumed = dragState;
    setTimeout(function () { if (dragState === consumed) dragState = null; }, 0);
  }

  // ---- Resize (ziehbare Panel-Größe, Griff unten rechts) ----

  function attachResizeHandlers(handle) {
    handle.addEventListener("pointerdown", onResizeDown);
  }

  function onResizeDown(ev) {
    // Resize ist KEIN Verschieben: Propagation stoppen, damit der Move-Drag
    // (root pointerdown) nicht zugleich anspringt.
    if (ev && ev.stopPropagation) ev.stopPropagation();
    if (ev && ev.preventDefault) ev.preventDefault();
    if (!optAllowDrag || !panelEl || !widgetRoot) return;
    // Auf freie Position umstellen, damit die obere-linke Ecke verankert bleibt
    // und der untere-rechte Griff natürlich nach unten-rechts wächst (sonst
    // wüchse ein ecken-verankertes Panel in die „falsche" Richtung).
    var rootRect = widgetRoot.getBoundingClientRect();
    currentFreeX = rootRect.left;
    currentFreeY = rootRect.top;
    currentCorner = null;
    applyPositionToRoot();
    var panelRect = panelEl.getBoundingClientRect();
    var startResH = resultsHeight !== null
      ? resultsHeight
      : (resultsEl ? resultsEl.getBoundingClientRect().height : MIN_RESULTS_HEIGHT);
    resizeState = {
      pointerId: ev ? ev.pointerId : undefined,
      startX: ev ? ev.clientX : 0,
      startY: ev ? ev.clientY : 0,
      startW: panelWidth !== null ? panelWidth : panelRect.width,
      startResH: startResH,
    };
    try {
      if (ev && resizeHandleEl && typeof resizeHandleEl.setPointerCapture === "function") {
        resizeHandleEl.setPointerCapture(ev.pointerId);
      }
    } catch (_e) { /* fail-soft */ }
    if (resizeHandleEl) {
      resizeHandleEl.addEventListener("pointermove", onResizeMove);
      resizeHandleEl.addEventListener("pointerup", onResizeUp);
      resizeHandleEl.addEventListener("pointercancel", onResizeUp);
    }
    try { widgetRoot.classList.add("sbkim-sw-resizing"); } catch (_e) { /* nb */ }
  }

  function onResizeMove(ev) {
    if (!resizeState) return;
    try {
      var dx = ev.clientX - resizeState.startX;
      var dy = ev.clientY - resizeState.startY;
      panelWidth = clampPanelWidth(resizeState.startW + dx);
      resultsHeight = clampResultsHeight(resizeState.startResH + dy);
      applySizeToPanel();
    } catch (err) {
      warn("Resize-Pointer-Fehler — Resize abgebrochen.", err);
      onResizeUp(ev);
    }
  }

  function onResizeUp(_ev) {
    if (!resizeState) return;
    try {
      if (resizeHandleEl && typeof resizeHandleEl.releasePointerCapture === "function" &&
          resizeState.pointerId !== undefined) {
        resizeHandleEl.releasePointerCapture(resizeState.pointerId);
      }
    } catch (_e) { /* nb */ }
    if (resizeHandleEl) {
      resizeHandleEl.removeEventListener("pointermove", onResizeMove);
      resizeHandleEl.removeEventListener("pointerup", onResizeUp);
      resizeHandleEl.removeEventListener("pointercancel", onResizeUp);
    }
    if (widgetRoot) { try { widgetRoot.classList.remove("sbkim-sw-resizing"); } catch (_e) { /* nb */ } }
    persistSize();
    persistPosition(); // freie Position wurde beim Resize-Start gesetzt
    resizeState = null;
  }

  // ---- Mount (mit MutationObserver-Fallback, Pattern aus Modul 17) ----

  function mountWidget() {
    var doc = global.document;
    if (!doc) { warn("document fehlt — Widget kann nicht gemountet werden."); return; }
    injectStyle(doc);
    if (!doc.body) { setupMountObserver(doc); return; }
    if (widgetRoot && widgetRoot.parentNode === doc.body) return; // idempotent
    if (widgetRoot && widgetRoot.parentNode) {
      try { widgetRoot.parentNode.removeChild(widgetRoot); } catch (_e) { /* nb */ }
    }
    widgetRoot = buildWidget(doc);
    doc.body.appendChild(widgetRoot);
    applyPositionToRoot();
    applyVisibility();
    applyState();
    applySizeToPanel();
    attachViewportListener();
    // Heilung: eine auf großem Schirm gezogene Position kann auf kleinem Schirm
    // (oder im Splitscreen) schon beim Mount aus dem Bild liegen.
    clampPositionIntoView();
    // Letzte Suche wiederherstellen (Reload-Schutz): Treffer wieder anzeigen.
    if (lastRenderRes && resultsEl) renderResults(lastRenderRes);
  }

  function setupMountObserver(doc) {
    if (mountObserver) return;
    if (typeof MutationObserver === "undefined") {
      if (typeof doc.addEventListener === "function") {
        doc.addEventListener("DOMContentLoaded", function () { mountWidget(); }, { once: true });
      }
      return;
    }
    var docElement = doc.documentElement;
    if (!docElement) return;
    mountObserver = new MutationObserver(function () {
      if (doc.body) { disconnectMountObserver(); mountWidget(); }
    });
    try {
      mountObserver.observe(docElement, { childList: true, subtree: true });
    } catch (err) {
      warn("MutationObserver für Widget-Mount konnte nicht starten.", err);
      mountObserver = null;
      return;
    }
    mountObserverTimeoutId = setTimeout(function () {
      if (mountObserver) {
        disconnectMountObserver();
        warn("document.body auch nach " + MOUNT_OBSERVER_TIMEOUT_MS + " ms nicht erschienen — Mount übersprungen.");
      }
    }, MOUNT_OBSERVER_TIMEOUT_MS);
  }

  function disconnectMountObserver() {
    if (mountObserver) {
      try { mountObserver.disconnect(); } catch (_e) { /* nb */ }
      mountObserver = null;
    }
    if (mountObserverTimeoutId !== null) {
      clearTimeout(mountObserverTimeoutId);
      mountObserverTimeoutId = null;
    }
  }

  function applyVisibility() {
    if (!widgetRoot) return;
    if (visibleFlag) widgetRoot.classList.remove("sbkim-sw-hidden");
    else widgetRoot.classList.add("sbkim-sw-hidden");
  }

  function applyState() {
    if (!widgetRoot) return;
    widgetRoot.setAttribute("data-state", expandedFlag ? "expanded" : "collapsed");
    if (expandedFlag && inputEl && typeof inputEl.focus === "function") {
      try { inputEl.focus(); } catch (_e) { /* nb */ }
    }
  }

  // App aktualisieren (Hard-Reload, Klaus 2026-06-22): leert Cache Storage + meldet
  // den Service-Worker ab, dann neu laden — so holt die installierte PWA die
  // neueste Version, ohne dass der Nutzer im Browser-Menü „Cache leeren" sucht.
  // Opt-in (optShowReload), weil es Host-Caches betrifft; in such-tool/ aktiv.
  function hardReload() {
    if (reloadInFlight) return;
    reloadInFlight = true;
    setHint("App wird aktualisiert — Cache leeren und neu laden …");
    var reloaded = false;
    var doReload = function () {
      if (reloaded) return;
      reloaded = true;
      try { if (global.location && typeof global.location.reload === "function") global.location.reload(); }
      catch (_e) { reloadInFlight = false; }
    };
    var tasks = [];
    try {
      if (global.caches && typeof global.caches.keys === "function") {
        tasks.push(Promise.resolve(global.caches.keys())
          .then(function (keys) { return Promise.all((keys || []).map(function (k) { return global.caches.delete(k); })); })
          .catch(function () {}));
      }
    } catch (_e) { /* nb */ }
    try {
      var sw = global.navigator && global.navigator.serviceWorker;
      if (sw && typeof sw.getRegistrations === "function") {
        tasks.push(Promise.resolve(sw.getRegistrations())
          .then(function (regs) { return Promise.all((regs || []).map(function (r) { return r.unregister ? r.unregister() : null; })); })
          .catch(function () {}));
      }
    } catch (_e) { /* nb */ }
    Promise.all(tasks).then(doReload, doReload);
    // Sicherheits-Timeout, falls eine Promise hängt — trotzdem neu laden.
    try { if (global.setTimeout) global.setTimeout(doReload, 1500); } catch (_e) { /* nb */ }
  }

  // ---- Öffentliche Sync-Methoden ----

  function show() {
    if (!ready) { warn("show() vor init() — no-op."); return; }
    visibleFlag = true;
    persistVisible();
    applyVisibility();
  }

  function hide() {
    if (!ready) { warn("hide() vor init() — no-op."); return; }
    visibleFlag = false;
    persistVisible();
    applyVisibility();
  }

  function isVisible() {
    if (!widgetRoot) return false;
    return !widgetRoot.classList.contains("sbkim-sw-hidden");
  }

  function expand() {
    if (!ready) { warn("expand() vor init() — no-op."); return; }
    var before = widgetRoot ? widgetRoot.getBoundingClientRect() : null;
    expandedFlag = true;
    persistState();
    applyState();
    keepCenterAcrossResize(before);
    persistPosition();
    // Korpus vorwärmen, damit die Suche beim ersten Tippen bereit ist
    // (fire-and-forget; der Hinweis zeigt einen evtl. Fehler).
    if (typeof corpusPreparer === "function" && !corpusReady) {
      ensureCorpusPrepared().catch(function (err) {
        setHint("Suchindex-Vorbereitung fehlgeschlagen — bitte erneut versuchen.");
        warn("Korpus-Vorbereitung (expand-Warmup) fehlgeschlagen.", err);
      });
    }
  }

  function collapse() {
    if (!ready) { warn("collapse() vor init() — no-op."); return; }
    hideOverlays();                        // Minimieren schließt offene Overlays
    if (fullscreenFlag) exitFullscreen();  // Minimieren beendet auch Vollbild
    var before = widgetRoot ? widgetRoot.getBoundingClientRect() : null;
    expandedFlag = false;
    persistState();
    applyState();
    keepCenterAcrossResize(before);
    persistPosition();
  }

  // ---- Vollbild-Modus (⛶, Klaus 2026-06-22) ----
  // Zweite Anzeige DERSELBEN Treffer (kein Kern-Umbau): das vorhandene Panel
  // füllt den ganzen Viewport. Bewusst NICHT persistiert — die Pille bleibt der
  // Standard-Start, Vollbild ist immer eine bewusste Nutzer-Aktion.

  function applyFullscreen() {
    if (!widgetRoot) return;
    if (fullscreenFlag) widgetRoot.classList.add("sbkim-sw-fullscreen");
    else widgetRoot.classList.remove("sbkim-sw-fullscreen");
    updateFullscreenBtn();
  }

  function updateFullscreenBtn() {
    if (!fullscreenBtnEl) return;
    fullscreenBtnEl.textContent = fullscreenFlag ? "🗗" : "⛶";
    fullscreenBtnEl.setAttribute("aria-label",
      fullscreenFlag ? "Vollbild verlassen — zurück zum Panel" : "Vollbild — Suchraum groß");
  }

  function enterFullscreen() {
    if (!ready) { warn("enterFullscreen() vor init() — no-op."); return; }
    fullscreenFlag = true;
    expandedFlag = true;   // Vollbild zeigt immer das Panel
    persistState();
    applyState();
    applyFullscreen();
  }

  function exitFullscreen() {
    if (!ready) { warn("exitFullscreen() vor init() — no-op."); return; }
    fullscreenFlag = false;
    applyFullscreen();
    // Inline-Position/-Größe wieder herstellen (Klasse mit !important ist weg).
    applyPositionToRoot();
    applySizeToPanel();
    clampPositionIntoView();
  }

  function toggleFullscreen() { if (fullscreenFlag) exitFullscreen(); else enterFullscreen(); }

  function isFullscreen() { return !!fullscreenFlag; }

  // Such-Inhalt leeren (Frage, eingefügte KI-Antwort, Schärfen-Kontext, Treffer).
  // Der Tresor bleibt unberührt — das ist Identität, kein „Inhalt".
  function clearContent() {
    queryValue = "";
    if (inputEl) inputEl.value = "";
    pastedAiText = "";
    if (aiContextEl) aiContextEl.value = "";
    if (aiPasteEl) aiPasteEl.value = "";
    resultsVisibleCount = RESULT_PAGE_SIZE;
    lastRenderRes = null;
    lsRemove(LS_KEY_LAST);   // frischer Start: gespeicherte Suche auch löschen
    if (resultsEl) { while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild); }
    setHint("");
  }

  // X-Knopf: NICHT verstecken, sondern als Lupe oben rechts „in der Navleiste"
  // parken (Klaus 2026-06-21). Bleibt sichtbar und antippbar — nie verloren.
  // X LEERT den Inhalt (frischer Start beim nächsten Öffnen); Minimieren (–)
  // BEHÄLT ihn (Klaus 2026-06-21).
  function dockToTop() {
    if (!ready) { warn("dockToTop() vor init() — no-op."); return; }
    if (fullscreenFlag) { fullscreenFlag = false; applyFullscreen(); }
    hideOverlays();
    expandedFlag = false;
    visibleFlag = true;
    currentCorner = NAV_DOCK_CORNER;
    currentOffsetX = NAV_DOCK_OFFSET.x;
    currentOffsetY = NAV_DOCK_OFFSET.y;
    currentFreeX = null;
    currentFreeY = null;
    clearContent();
    persistState();
    persistVisible();
    persistPosition();
    applyVisibility();
    applyState();
    applyPositionToRoot();
  }

  function isExpanded() { return !!expandedFlag; }

  function getPosition() {
    if (!ready) {
      return { corner: DEFAULT_CORNER, offsetX: DEFAULT_OFFSET.x, offsetY: DEFAULT_OFFSET.y, x: null, y: null };
    }
    return buildPositionSnapshot();
  }

  // Aktuelle ziehbare Größe (defensive Kopie). null = CSS-Default.
  function getSize() {
    return { panelWidth: panelWidth, resultsHeight: resultsHeight };
  }

  // Programmatische Größe (Tests / Reset / manual_check-Knopf). null setzt aufs
  // CSS-Default zurück; Zahlen werden auf die Min-/Maxmaße geklemmt.
  function setSize(opts) {
    opts = opts || {};
    if (opts.panelWidth === null) panelWidth = null;
    else if (typeof opts.panelWidth === "number" && isFinite(opts.panelWidth)) panelWidth = clampPanelWidth(opts.panelWidth);
    if (opts.resultsHeight === null) resultsHeight = null;
    else if (typeof opts.resultsHeight === "number" && isFinite(opts.resultsHeight)) resultsHeight = clampResultsHeight(opts.resultsHeight);
    if (panelEl) {
      if (panelWidth === null) panelEl.style.width = "";
      if (resultsHeight === null && resultsEl) resultsEl.style.maxHeight = "";
    }
    applySizeToPanel();
    persistSize();
  }

  // ---- Init ----

  function init(options) {
    options = options || {};

    // euPolicy validieren (einziger Sync-Throw-Pfad).
    if (options.euPolicy !== undefined && options.euPolicy !== null) {
      optEuPolicy = normalizeEuPolicy(options.euPolicy);
    }

    if (typeof options.apiKey === "string" && options.apiKey.length > 0) optApiKey = options.apiKey;
    if (typeof options.aiModel === "string" && options.aiModel.length > 0) optAiModel = options.aiModel;
    if (typeof options.provider === "string" && options.provider.length > 0) optProvider = options.provider;
    if (options.euOnly !== undefined) optEuOnly = !!options.euOnly;
    if (typeof options.queryLabel === "string") optQueryLabel = options.queryLabel;
    if (typeof options.k === "number" && isFinite(options.k) && options.k >= 1) optK = Math.floor(options.k);
    // A4: app-eigene Synonym-Karte ersetzt die generische Grundausstattung
    // (eine App kennt ihre Domäne besser). {} = A4 praktisch aus (nur [query]).
    if (options.synonyms && typeof options.synonyms === "object") optSynonyms = options.synonyms;
    if (options.queryExpand !== undefined) optQueryExpand = !!options.queryExpand;
    if (options.allowDrag !== undefined) optAllowDrag = !!options.allowDrag;
    if (options.rememberHidden !== undefined) optRememberHidden = !!options.rememberHidden;
    if (options.reloadButton !== undefined) optShowReload = !!options.reloadButton;
    if (typeof options.zIndex === "number" && isFinite(options.zIndex)) optZIndex = options.zIndex;
    // Optionale Start-Größe (localStorage = User-Wahl überschreibt sie unten).
    if (typeof options.panelWidth === "number" && isFinite(options.panelWidth)) panelWidth = clampPanelWidth(options.panelWidth);
    if (typeof options.resultsHeight === "number" && isFinite(options.resultsHeight)) resultsHeight = clampResultsHeight(options.resultsHeight);

    if (options.corpus !== undefined) setCorpus(options.corpus);
    if (typeof options.prepareCorpus === "function") corpusPreparer = options.prepareCorpus;

    // Mehrfach-Suche: Knoten-Korpus + SearXNG + Bereiche + Richter-Default.
    if (Array.isArray(options.nodeCorpus)) { nodeCorpus = options.nodeCorpus.slice(); nodeCorpusReady = true; }
    if (typeof options.prepareNodeCorpus === "function") nodeCorpusPreparer = options.prepareNodeCorpus;
    // Live-Cross-Knoten-Frage (Bau Query-über-Relais): (nodeId, text) -> Promise<Array<{label,score,anchorId}>>.
    if (typeof options.queryNode === "function") queryNodeFn = options.queryNode;
    if (typeof options.searxngUrl === "string") searxngUrl = options.searxngUrl.trim();
    if (typeof options.webSearchEngine === "string") {
      for (var wi = 0; wi < WEB_ENGINES.length; wi++) {
        if (WEB_ENGINES[wi].id === options.webSearchEngine) { optWebEngine = options.webSearchEngine; break; }
      }
    }
    if (typeof options.aiProvider === "string") {
      for (var pj = 0; pj < AI_PROVIDERS.length; pj++) {
        if (AI_PROVIDERS[pj].id === options.aiProvider) { optAiProvider = options.aiProvider; break; }
      }
    }
    if (options.richter !== undefined) richterOn = !!options.richter;
    // Anzeige-Sicht-Default (localStorage = User-Wahl überschreibt sie unten).
    if (options.viewMode === "verbunden" || options.viewMode === "verwandt") viewMode = options.viewMode;
    if (options.relatedOnly !== undefined) viewRelatedOnly = !!options.relatedOnly;
    if (options.kiRelated !== undefined) viewKiRelated = !!options.kiRelated;
    if (options.areas && typeof options.areas === "object") {
      ["app", "knoten", "internet"].forEach(function (id) {
        if (typeof options.areas[id] === "boolean") areas[id].enabled = options.areas[id];
      });
    }

    if (options.defaultCorner !== undefined &&
        ALLOWED_CORNERS.indexOf(options.defaultCorner) >= 0) {
      currentCorner = options.defaultCorner;
    }
    if (options.defaultOffset && typeof options.defaultOffset.x === "number" &&
        typeof options.defaultOffset.y === "number") {
      currentOffsetX = options.defaultOffset.x;
      currentOffsetY = options.defaultOffset.y;
    }

    // localStorage-Preferences laden (überschreibt Defaults, NICHT Position
    // wenn options.defaultCorner explizit gesetzt? — localStorage ist
    // User-Wahl und hat Vorrang, analog Modul 17).
    loadVisibleFromLs();
    loadStateFromLs();
    loadPositionFromLs();
    loadEngineFromLs();   // persistierte Suchmaschinen-Wahl (User-Wahl heilig)
    loadSizeFromLs();     // persistierte Panel-Größe (User-Wahl heilig)
    if (options.startExpanded === true) expandedFlag = true;

    if (ready) {
      // Idempotent: re-applizieren statt neu mounten.
      if (styleElement) { /* CSS bleibt */ }
      applyPositionToRoot();
      applyVisibility();
      applyState();
      applySizeToPanel();
      updateEuChip();
      return Promise.resolve();
    }

    ready = true;
    restoreViewPref();     // Anzeige-Sicht (verbunden/verwandt) aus localStorage — vor dem Mount
    restoreLastSearch();   // letzte Suche aus localStorage (vor dem Mount), Reload-Schutz
    mountWidget();
    return Promise.resolve();
  }

  // ---- Public surface ----

  var SbkimSearchWidget = {
    init: init,
    show: show,
    hide: hide,
    isVisible: isVisible,
    expand: expand,
    collapse: collapse,
    dockToTop: dockToTop,
    isExpanded: isExpanded,
    enterFullscreen: enterFullscreen,
    exitFullscreen: exitFullscreen,
    toggleFullscreen: toggleFullscreen,
    isFullscreen: isFullscreen,
    openMerkliste: openMerkliste,
    closeOverlays: closeOverlays,
    getMerkliste: getMerkliste,
    clearMerkliste: clearMerkliste,
    reload: hardReload,
    getPosition: getPosition,
    getSize: getSize,
    setSize: setSize,
    setCorpus: setCorpus,
    search: search,
    // Anzeige-Sicht „verbunden" (grob) ↔ „verwandt" (genau). Reine Anzeige.
    setViewMode: function (mode) {
      if (mode !== "verbunden" && mode !== "verwandt") return viewMode;
      viewMode = mode;
      persistViewPref();
      updateViewRowState();
      if (lastRenderRes) renderResults(lastRenderRes);
      return viewMode;
    },
    getViewMode: function () { return viewMode; },
    setRelatedOnly: function (on) {
      viewRelatedOnly = !!on;
      persistViewPref();
      updateViewRowState();
      if (lastRenderRes) renderResults(lastRenderRes);
      return viewRelatedOnly;
    },
    // „· KI": verwandt-Maß vom KI-Richter (opt-in, BYOK). Reine Anzeige.
    setKiRelated: function (on) {
      viewKiRelated = !!on;
      persistViewPref();
      updateViewRowState();
      if (lastRenderRes) renderResults(lastRenderRes);
      return viewKiRelated;
    },
    getKiRelated: function () { return viewKiRelated; },
    rankView: rankView,   // reine Funktion (treffer, queryVec, {mode,relatedOnly,kiByKey}) — headless testbar
    buildPrompt: buildAiPrompt,
    parseAiAnswer: parseAiAnswer,
    parseAiSummary: extractAiSummary,
    setAiAnswer: function (text) { pastedAiText = (typeof text === "string" ? text : ""); return hasPastedAi(); },
    resultsAsText: function () { return buildResultsText(lastRenderRes); },
    autoSearch: autoSearch,                 // B2-Probe: automatischer KI-Aufruf (Claude)
    aiAutoSupported: function () { return aiAutoSupported(); },
    // Stufe B · B1 — Widget-Tresor (self-contained).
    hasVault: hasVault,
    isVaultUnlocked: isVaultUnlocked,
    createVault: createVault,
    unlockVault: unlockVault,
    lockVault: lockVault,
    deleteVault: deleteVault,
    setVaultSecret: setVaultSecret,
    recoverVaultPassword: recoverVaultPassword,
    _meta: {
      get euPolicy() { return optEuPolicy; },
      get corpusSize() { return Array.isArray(localCorpus) ? localCorpus.length : 0; },
      get corpusReady() { return corpusReady; },
      get nodeCorpusSize() { return Array.isArray(nodeCorpus) ? nodeCorpus.length : 0; },
      get liveNodeQuery() { return typeof queryNodeFn === "function"; },
      get areas() { return { app: areas.app.enabled, knoten: areas.knoten.enabled, internet: areas.internet.enabled }; },
      get richterOn() { return richterOn; },
      // A1/A4-Verdrahtung (reine Diagnose): Vorfilter läuft hybrid, Multi-Query
      // an/aus + Größe der aktiven Synonym-Karte.
      get hybridPrefilter() { return true; },
      get queryExpand() { return optQueryExpand; },
      get synonymCount() { return optSynonyms ? Object.keys(optSynonyms).length : 0; },
      get viewMode() { return viewMode; },
      get relatedOnly() { return viewRelatedOnly; },
      get kiRelated() { return viewKiRelated; },
      get kiRelatedActive() { return kiRelatedActive(); },
      get hasQueryVec() { return !!lastQueryVec; },
      get hasSearxng() { return !!searxngUrl; },
      get webEngine() { return optWebEngine; },
      get aiProvider() { return optAiProvider; },
      get aiProviders() { return aiProvidersForPolicy().map(function (p) { return p.id; }); },
      get hasPastedAi() { return hasPastedAi(); },
      get hasVault() { return hasVault(); },
      get vaultUnlocked() { return vaultUnlocked; },
      get visible() { return isVisible(); },
      get expanded() { return !!expandedFlag; },
      get fullscreen() { return !!fullscreenFlag; },
      get merkCount() { return merkCount(); },
      get merkOverlayOpen() { return !!merkOverlayOpen; },
      get detailOverlayOpen() { return !!detailOverlayOpen; },
      get panelWidth() { return panelWidth; },
      get resultsHeight() { return resultsHeight; },
      get widgetMounted() { return !!(widgetRoot && widgetRoot.parentNode); },
      get lastSearchMode() { return lastSearchMode; },
      get searchCount() { return searchCount; },
      get hasApiKey() { return !!optApiKey; },
      coupled: false, // Increment 2 — bleibt false in Increment 1
    },
  };

  global.SbkimSearchWidget = SbkimSearchWidget;

  // Self-check: emitted on script load (synchronous). Uniform format — see INTERFACES.md.
  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 22 SUCH-WIDGET bereit, Funktionen: init/show/hide/expand/collapse/setCorpus/search, " +
        "komponiert Modul 21 (Sprache) + Modul 04 (queryLocal/hybridMatch), EU-Politik-Default: " +
        EU_POLICY_DEFAULT + " (KEIN Auto-Init — init() mountet).",
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
