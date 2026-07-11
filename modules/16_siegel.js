/*
 * SBKIM — Modul 16 — SBKIM-Siegel
 *
 * Self-inscribing-Selbst-Zertifikat einer PWA-Zelle. Bau-Sitzung 16
 * (2026-05-24) implementiert alle vier Sub-Bereiche aus Spec-Sitzung 16:
 *
 *   Sub (a) Selbst-Prüfung — Surface-Check für sieben Pflicht-Module
 *           (01/02/03/04/05/07/15) via typeof globalThis[globalName] +
 *           typeof ns[surfaceFn]==="function". Vier Status-Werte:
 *           "ok" / "deferred" / "missing" / "broken". Snapshot zur
 *           init()-Zeit, gecacht. Re-Init no-op.
 *   Sub (b) Badge-Rendering — rundes 40-px-Medaillon Edel-Gold auf
 *           Bronze-Ink, drei Hyphen-Bögen + Knoten-Punkt-Glyph,
 *           600 ms First-Boot-Animation einmalig pro Session.
 *           Anti-Greenwashing binär: Element wird gar nicht im DOM
 *           angelegt, wenn isCertified()===false.
 *   Sub (c) Erklärungs-Modal — eigenständig in document.body (analog
 *           Modul 15), Titel "SBKIM-Siegel — was bedeutet das?",
 *           Datum + Modul-Liste + Aspekte + zwei Zeilen Aussteller-
 *           Klärung. Backdrop/Esc/✕ schließen.
 *   Sub (d) ZERTIFIKAT_ASPEKTE — Start-Eintrag „Grund-Siegel-Bezeugung
 *           2026-05-24" verbindlich; künftige Sicherheits-Module
 *           ergänzen ihre Aspekt-Einträge per Pflege-PR.
 *
 * DOM-Mount-Variante: Option β (Bau-Sitzung-16-Entscheidung). Der
 * `badgeSelector` zeigt auf einen CONTAINER (Default `.lamps`); der
 * Badge-Span wird via JS darin erzeugt, ausschließlich wenn
 * isCertified()===true. Damit ist die Anti-Greenwashing-Klausel
 * binär erfüllt: kein DOM-Element überhaupt im Negativ-Fall. Wenn
 * der Selektor ein bereits-bestehendes Element matcht (z.B.
 * `#sbkim-siegel-badge` vor-injiziert), wird dieses Element als
 * Anker genutzt; sonst wird darin der Badge-Span erzeugt.
 *
 * Modul 16 ist NICHT protokoll-aktiv: kein Netz, keine Signatur, kein
 * Embedding, kein Handshake. Rein lokales Render-Modul. KEINE
 * benannten Error-Klassen — alle Fehlerpfade fail-soft via
 * console.warn (analog Modul 15).
 *
 * Public surface (registered on window.SbkimSiegel):
 *   init(options?)             -> Promise<void>
 *   isCertified()              -> boolean             (sync)
 *   getExplanation()           -> ExplanationSnapshot (sync, defensive Kopie)
 *   getCertifiedModules()      -> string[]            (sync, defensive Kopie)
 *   getAspects()               -> Aspect[]            (sync, defensive Kopie)
 *   _meta                      -> Read-Anker für Tests
 *
 * options-Form (init):
 *   { badgeSelector?: string,     // Default '.lamps' (Container, Option β)
 *     visible?: "visible"|"hidden", // Default "visible"
 *     mountModal?: boolean,        // Default true
 *     repoUrl?: string | null,     // Default null → Auto-Erkennung
 *     ribbonText?: string,         // Band-Text im Wappen unten (SELF-INSCRIBING).
 *                                  // Ohne Wert bleibt das Band OFFEN (leer) +
 *                                  // ein console.info-Vermerk; kein Auto-Label.
 *                                  // Host graviert seinen Namen via ribbonText.
 *     andockTool?: boolean }       // Default false. true → optionaler
 *                                  // „Fremden Knoten andocken"-Knopf im Modal,
 *                                  // öffnet Modul-18-Wizard (KI-unabhängiger
 *                                  // Handshake). „🔑"-Pfad bleibt unberührt.
 *
 * Self-check: emits a console.info line on script load (synchronous,
 * before any call). Siehe INTERFACES.md §1 Modul 16 und
 * docs/components/16_siegel.md.
 */
(function (global) {
  "use strict";

  // ---- Pflicht-Modul-Liste (Karte 16 § Sub (a), INTERFACES § 1 Modul 16) ----
  //
  // Sieben Pflicht-Einträge. Code-versioniert, KEINE Runtime-API zum
  // Setzen (Karte 16 § Strikte Tabus). Aktualisierung NUR per Pflege-PR.

  var PFLICHT_MODULE = [
    { id: "01", name: "Storage",    globalName: "SbkimStorage",    surfaceFn: "init",                lazy: false },
    { id: "02", name: "Spore",      globalName: "SbkimSpore",      surfaceFn: "getOwnSpore",         lazy: false },
    { id: "03", name: "Embedding",  globalName: "SbkimEmbedding",  surfaceFn: "embedPassage",        lazy: true  },
    { id: "04", name: "Match",      globalName: "SbkimMatch",      surfaceFn: "match",               lazy: false },
    { id: "05", name: "Anastomose", globalName: "SbkimAnastomose", surfaceFn: "handshake",           lazy: false },
    { id: "07", name: "Apoptose",   globalName: "SbkimApoptose",   surfaceFn: "prepareSelfApoptose", lazy: false },
    { id: "15", name: "Membran",    globalName: "SbkimMembrane",   surfaceFn: "init",                lazy: false },
  ];

  // ---- Aspekte-Liste (Karte 16 § Sub (d), INTERFACES § 1 Modul 16) ----
  //
  // Code-versioniert. Jedes spätere Sicherheits-Modul (10/11/12/14/
  // künftige 15.B-Erweiterungen) MUSS in seiner Bau-/Pflege-Sitzung
  // hier einen Eintrag am Listen-Ende ergänzen (aktuelles Datum +
  // Modul-ID + ein-Satz-Beschreibung; siehe Karte 16 § Sub (d)
  // Pflicht-Konvention).

  var ZERTIFIKAT_ASPEKTE = [
    {
      since:       "2026-05-24",
      module:      "16",
      aspect:      "Grund-Siegel-Bezeugung (Protokoll)",
      description: "Grundlage jedes SBKIM-Siegels: Beim Start prüft die App selbst, ob die Pflicht-Module 01/02/03/04/05/07/15 geladen sind — nur dann entsteht das Siegel. Protokoll-Baustein, kein app-eigenes Datum (was DIESE App gerade lädt, steht oben unter „Pflicht-Module“).",
    },
    {
      since:       "2026-05-25",
      module:      "15",
      aspect:      "Sub (a) Read-API + Sub (b) postMessage-Brücke",
      description: "Finale Bedien-Pfade: MembraneSnapshot mit Siegel-Hook, vier op-Werte (sporeRef/query/hint/queryResult) mit Nonce-Pflicht, fail-soft Allowlist, Rate-Limit-Hook für Modul 11.",
    },
    {
      since:       "2026-05-25",
      module:      "17",
      aspect:      "Floating-Widget mit Vier-Slot-Live-Status",
      description: "Live-Status-Dashboard (LEBT/VERKEHR/FREMD/SIEGEL) als Endknoten-Standard; macht den SBKIM-Lauf sichtbar ohne Navleisten-Mount-Pflicht. Render-Schicht ohne Protokoll-Eingriff.",
    },
    // Aspekt 4 — Mycel-Aktivität (Karte 16 § Sub (e),
    // Spec-Erweiterung 2026-05-26). Dynamisch sichtbar:
    // _meta.mycelConnected === false → Modal rendert „pending"-Marker
    // statt Datum; _meta.mycelConnected === true → Modal rendert Datum.
    // Aktivierung über window-Event sbkim:handshake outcome:"established"
    // (Modul 05 Bau 17). RAM-only — Tab-Reload startet wieder Bronze.
    {
      since:       "2026-05-26",
      module:      "16",
      aspect:      "Mycel-Aktivität (erster Hyphen-Verkehr)",
      description: "Diese Zelle hatte in dieser Sitzung mindestens einen Hyphen-Verkehr (erfolgreicher Cross-Knoten-Handshake) — Leben im Mycel. SIEGEL-Stufe Gold.",
    },
    {
      since:       "2026-06-07",
      module:      "16",
      aspect:      "Semantische Selbst-Beschreibung im Siegel",
      description: "Direkt im Siegel lässt sich die App in eigenen Worten (oder per eingefügter README) beschreiben; der Text wird per Modul 03 (e5-small, 384-dim, L2-normalisiert) zum Domain-Vektor und mit dem vorhandenen Schlüssel neu in die Spore signiert — gleiche nodeId, treffenderer verified-match. Ein einziger, sauberer Identitäts-/Andock-Pfad ohne Modul-18-Verweis.",
    },
    {
      since:       "2026-06-20",
      module:      "20",
      aspect:      "Schlüssel-Tresor (Identitäts-Sicherung)",
      description: "Die SBKIM-Identität (nodeId + privater Knotenschlüssel + Spore) wird lokal verschlüsselt gesichert (Modul-02-Krypto-Kern: PBKDF2-SHA256 ≥600k + AES-GCM-256), mit Shamir-Recovery 2 von 3 über das Passwort — gegen Identitäts-Verlust/-Wandern. Nur Identität/Schlüssel, kein PII, nie übers Netz.",
    },
    {
      since:       "2026-07-01",
      module:      "15",
      aspect:      "KI-Richter im Cross-Knoten-Antwort-Pfad (opt-in)",
      description: "Der op:\"query\"-Empfänger (Membran Sub b) kann eingehende Fremd-Anfragen optional durch den KI-Richter (Modul 04 queryLocalJudged, BYOK) nach Bedeutung beurteilen und sortieren, statt nur nach rohem Cosinus. Default AUS (roher Vorfilter), Schlüssel RAM-only/nie im Code, fail-soft; der 0.80-Andock-Riegel bleibt unberührt.",
    },
    {
      since:       "2026-07-11",
      module:      "16",
      aspect:      "Ehrliche Aspekt-Darstellung (protokoll-weit, eingeklappt)",
      description: "Die Aspekte-Historie wird jetzt eingeklappt gezeigt und ausdrücklich als gemeinsame, netzweite SBKIM-Protokoll-Historie beschriftet — NICHT als app-eigenes Zertifizierungsdatum (Klaus-Befund: eine frisch zertifizierte App darf keine fremden Bau-Daten als ihre eigene Historie ausgeben). Die app-eigene, aktuelle Aussage bleibt die Pflicht-Modul-Selbstprüfung oben plus der lokale Start-Zeitpunkt.",
    },
    {
      since:       "2026-07-11",
      module:      "20",
      aspect:      "Verschlüsselte Geheimnis-Ablage im Safe (putSecret/getSecret)",
      description: "Der Safe kann jetzt beliebige kleine Geheimnisse (z.B. einen KI-Richter-API-Schlüssel) verschlüsselt ablegen — PBKDF2-SHA256 600k → AES-GCM-256, frisches Salt/IV je Geheimnis, kein Klartext in localStorage/IndexedDB. So überlebt ein Schlüssel Reload/App-Schließen, ohne dass eine andere App auf der geteilten Adresse ihn lesen kann (Fremdnutzer-/Marktplatz-Leitsatz). Falsches Passwort/Manipulation → fail-soft (null).",
    },
  ];

  // ---- Aspekt-4-Anker (Karte 16 § Sub (e) dynamische Render-Variante) ----
  //
  // Eindeutige Identifikation des „Mycel-Aktivitäts"-Aspekts
  // in der ZERTIFIKAT_ASPEKTE-Liste; das Modal rendert ihn in Bronze mit
  // „pending"-Marker statt Datum.

  var ASPEKT_4_SINCE = "2026-05-26";
  var ASPEKT_4_MODULE = "16";
  var ASPEKT_4_TITLE_PREFIX = "Mycel-Aktivität";

  function isAspect4(a) {
    return a && a.since === ASPEKT_4_SINCE && a.module === ASPEKT_4_MODULE &&
           typeof a.aspect === "string" && a.aspect.indexOf(ASPEKT_4_TITLE_PREFIX) === 0;
  }

  // ---- Konstanten ----

  var DEFAULT_BADGE_SELECTOR = ".lamps";      // Container; Option β
  var BADGE_ID = "sbkim-siegel-badge";
  var MODAL_ID = "sbkim-siegel-modal";
  var MODAL_TITLE = "SBKIM-Siegel — was bedeutet das?";
  var FIRST_BOOT_ANIMATION_MS = 600;
  var MOUNT_OBSERVER_TIMEOUT_MS = 10000;

  // Band-Text im Wappen (unteres Ribbon, SELF-INSCRIBING). DEFAULT_RIBBON_TEXT
  // ist der im inlined WAPPEN_SVG eingebackene Wert ("SAGE OBSERVATORIUM") —
  // er dient als (a) Sages explizite Marke und (b) No-Replace-Sentinel
  // (byte-identisch). Der Laufzeit-Default OHNE init({ribbonText}) ist NICHT
  // dieser Wert, sondern ein OFFENES (leeres) Band (Klaus-Entscheidung
  // 2026-06-20): kein geratenes Auto-Label, der Host graviert seinen Namen
  // bewusst ein. Befund-Anlass 2026-06-19: Rezeptbuch/Mixarium trugen statisch
  // "MEIN-TRESOR", weil die SVG-Datei kopiert + nie angepasst wurde.
  var DEFAULT_RIBBON_TEXT = "SAGE OBSERVATORIUM";
  // Eindeutiger Anker im WAPPEN_SVG (genau ein Vorkommen, im Ribbon-textPath).
  var RIBBON_MARKER = ">" + DEFAULT_RIBBON_TEXT + "</textPath>";

  // Sub (e) Bronze/Gold-Stufung (Spec-Erweiterung 2026-05-26).
  var STUFE_BRONZE = "bronze";
  var STUFE_GOLD = "gold";
  var STUFENWECHSEL_ANIMATION_MS = 600;
  var HANDSHAKE_EVENT = "sbkim:handshake";
  var ARIA_LABEL_BRONZE = "SBKIM-Siegel · im Mycel, ruhend";
  var ARIA_LABEL_GOLD = "SBKIM-Siegel · im Mycel, aktiv";

  // ---- Wappen-SVG (Akkretions-Disk-Korona + Auszeichnungs-Siegel) ----
  //
  // Inlined aus `assets/sbkim-siegel-wappen.svg` (source of truth — bei
  // Änderungen dort UND hier nachziehen, Konvention dokumentiert in
  // Karte 16 § Bauzustand). Korona-Ring (zwölf Arc-Segmente +
  // feGaussianBlur stdDeviation=22) folgt dem `.bh-disk`-Vorbild der
  // Sage-Page-Schwarzes-Loch-Karte (`index.html:498` conic-gradient
  // orange → gold → magenta → blau → türkis → orange). Im Badge
  // skaliert das SVG via viewBox-Attribute auf die CSS-Box (`width:40px;
  // height:40px`). aria-hidden auf dem SVG — das `title`/`aria-label`
  // am Badge-Span trägt das a11y-Label.
  var WAPPEN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">\n  <defs>\n    <linearGradient id="goldRingGrad" x1="0%" y1="0%" x2="0%" y2="100%">\n      <stop offset="0%"   stop-color="#FFF6C8"/>\n      <stop offset="15%"  stop-color="#FFE066"/>\n      <stop offset="40%"  stop-color="#F4C430"/>\n      <stop offset="70%"  stop-color="#A67C00"/>\n      <stop offset="100%" stop-color="#5B3D00"/>\n    </linearGradient>\n    <linearGradient id="goldText" x1="0%" y1="0%" x2="0%" y2="100%">\n      <stop offset="0%"   stop-color="#FFF1A8"/>\n      <stop offset="35%"  stop-color="#FFD700"/>\n      <stop offset="55%"  stop-color="#E5B312"/>\n      <stop offset="85%"  stop-color="#8B6914"/>\n      <stop offset="100%" stop-color="#5B3D00"/>\n    </linearGradient>\n    <linearGradient id="goldRibbonGrad" x1="0%" y1="0%" x2="0%" y2="100%">\n      <stop offset="0%"   stop-color="#FFE873"/>\n      <stop offset="50%"  stop-color="#D4A017"/>\n      <stop offset="100%" stop-color="#7A5800"/>\n    </linearGradient>\n    <linearGradient id="goldShieldGrad" x1="0%" y1="0%" x2="0%" y2="100%">\n      <stop offset="0%"   stop-color="#FFE066"/>\n      <stop offset="100%" stop-color="#A67C00"/>\n    </linearGradient>\n    <radialGradient id="navyDeep" cx="50%" cy="40%" r="70%">\n      <stop offset="0%"   stop-color="#1A2C5C"/>\n      <stop offset="60%"  stop-color="#0E1A40"/>\n      <stop offset="100%" stop-color="#050A1F"/>\n    </radialGradient>\n    <radialGradient id="gemGrad" cx="35%" cy="30%" r="70%">\n      <stop offset="0%"   stop-color="#9BC4FF"/>\n      <stop offset="35%"  stop-color="#3A6FE8"/>\n      <stop offset="100%" stop-color="#0B1F70"/>\n    </radialGradient>\n    <radialGradient id="treeGlow" cx="50%" cy="50%" r="50%">\n      <stop offset="0%"   stop-color="#FFF1A8" stop-opacity="1"/>\n      <stop offset="60%"  stop-color="#F4C430" stop-opacity="0.5"/>\n      <stop offset="100%" stop-color="#F4C430" stop-opacity="0"/>\n    </radialGradient>\n    <filter id="darkDropShadow" x="-30%" y="-30%" width="160%" height="160%">\n      <feGaussianBlur in="SourceAlpha" stdDeviation="2.5"/>\n      <feOffset dx="3" dy="5" result="shadow"/>\n      <feComponentTransfer><feFuncA type="linear" slope="1.0"/></feComponentTransfer>\n      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>\n    </filter>\n    <filter id="embossShadow" x="-20%" y="-20%" width="140%" height="140%">\n      <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>\n      <feOffset dx="0" dy="3" result="off"/>\n      <feComponentTransfer><feFuncA type="linear" slope="0.65"/></feComponentTransfer>\n      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>\n    </filter>\n    <filter id="strongShadow" x="-20%" y="-20%" width="140%" height="140%">\n      <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>\n      <feOffset dx="0" dy="5" result="off"/>\n      <feComponentTransfer><feFuncA type="linear" slope="0.8"/></feComponentTransfer>\n      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>\n    </filter>\n    <!-- Korona-Blur (Akkretions-Disk-Stil aus Sage-Page .bh-disk).\n         stdDeviation=22 entspricht in etwa dem \\`filter: blur(10px)\\` der\n         CSS-Variante bei 280-px-Skalierung; im 1024-Viewbox stärker\n         dosiert, damit die zwölf farbigen Arc-Segmente zu einem\n         weichen Conic-Gradient verschmelzen. -->\n    <filter id="bhCorona" x="-20%" y="-20%" width="140%" height="140%">\n      <feGaussianBlur in="SourceGraphic" stdDeviation="22"/>\n    </filter>\n    <filter id="bhCoronaInner" x="-20%" y="-20%" width="140%" height="140%">\n      <feGaussianBlur in="SourceGraphic" stdDeviation="14"/>\n    </filter>\n    <path id="topArc" d="M 141.1 412.6 A 384 384 0 0 1 882.9 412.6" fill="none"/>\n  </defs>\n\n  <rect width="1024" height="1024" fill="#050505"/>\n\n  <!-- Akkretions-Disk-Korona (Vorbild: .bh-disk auf Sage-Page).\n       Conic-Gradient orange → gold → magenta → blau → türkis → orange\n       als zwölf Arc-Segmente (je 30°) um den Siegel-Außenrand\n       (Radius 475, knapp außerhalb des Gold-Rings r=444), mit\n       feGaussianBlur stdDeviation=22 → smoothe Conic-Anmutung.\n       Innerer Ring (Radius 460, schmaler Stroke, weniger Blur)\n       entspricht .bh-disk-2 — dezente zweite Schicht. -->\n  <g filter="url(#bhCorona)" opacity="0.78">\n    <path d="M 512 37 A 475 475 0 0 1 749.5 100.6"        fill="none" stroke="#ff7a00" stroke-width="60" stroke-linecap="butt"/>\n    <path d="M 749.5 100.6 A 475 475 0 0 1 923.4 274.5"   fill="none" stroke="#ffaf36" stroke-width="60" stroke-linecap="butt"/>\n    <path d="M 923.4 274.5 A 475 475 0 0 1 987 512"       fill="none" stroke="#f7c569" stroke-width="60" stroke-linecap="butt"/>\n    <path d="M 987 512 A 475 475 0 0 1 923.4 749.5"       fill="none" stroke="#dd8598" stroke-width="60" stroke-linecap="butt"/>\n    <path d="M 923.4 749.5 A 475 475 0 0 1 749.5 923.4"   fill="none" stroke="#bf50c1" stroke-width="60" stroke-linecap="butt"/>\n    <path d="M 749.5 923.4 A 475 475 0 0 1 512 987"       fill="none" stroke="#8754c8" stroke-width="60" stroke-linecap="butt"/>\n    <path d="M 512 987 A 475 475 0 0 1 274.5 923.4"       fill="none" stroke="#4f57ce" stroke-width="60" stroke-linecap="butt"/>\n    <path d="M 274.5 923.4 A 475 475 0 0 1 100.6 749.5"   fill="none" stroke="#2a80c2" stroke-width="60" stroke-linecap="butt"/>\n    <path d="M 100.6 749.5 A 475 475 0 0 1 37 512"        fill="none" stroke="#0cb4af" stroke-width="60" stroke-linecap="butt"/>\n    <path d="M 37 512 A 475 475 0 0 1 100.6 274.5"        fill="none" stroke="#2abc8b" stroke-width="60" stroke-linecap="butt"/>\n    <path d="M 100.6 274.5 A 475 475 0 0 1 274.5 100.6"   fill="none" stroke="#71a65d" stroke-width="60" stroke-linecap="butt"/>\n    <path d="M 274.5 100.6 A 475 475 0 0 1 512 37"        fill="none" stroke="#b8902e" stroke-width="60" stroke-linecap="butt"/>\n  </g>\n  <g filter="url(#bhCoronaInner)" opacity="0.55">\n    <path d="M 512 52 A 460 460 0 0 1 742 113"            fill="none" stroke="#ff7a00" stroke-width="32" stroke-linecap="butt"/>\n    <path d="M 742 113 A 460 460 0 0 1 911 282"           fill="none" stroke="#ffaf36" stroke-width="32" stroke-linecap="butt"/>\n    <path d="M 911 282 A 460 460 0 0 1 972 512"           fill="none" stroke="#f7c569" stroke-width="32" stroke-linecap="butt"/>\n    <path d="M 972 512 A 460 460 0 0 1 911 742"           fill="none" stroke="#dd8598" stroke-width="32" stroke-linecap="butt"/>\n    <path d="M 911 742 A 460 460 0 0 1 742 911"           fill="none" stroke="#bf50c1" stroke-width="32" stroke-linecap="butt"/>\n    <path d="M 742 911 A 460 460 0 0 1 512 972"           fill="none" stroke="#8754c8" stroke-width="32" stroke-linecap="butt"/>\n    <path d="M 512 972 A 460 460 0 0 1 282 911"           fill="none" stroke="#4f57ce" stroke-width="32" stroke-linecap="butt"/>\n    <path d="M 282 911 A 460 460 0 0 1 113 742"           fill="none" stroke="#2a80c2" stroke-width="32" stroke-linecap="butt"/>\n    <path d="M 113 742 A 460 460 0 0 1 52 512"            fill="none" stroke="#0cb4af" stroke-width="32" stroke-linecap="butt"/>\n    <path d="M 52 512 A 460 460 0 0 1 113 282"            fill="none" stroke="#2abc8b" stroke-width="32" stroke-linecap="butt"/>\n    <path d="M 113 282 A 460 460 0 0 1 282 113"           fill="none" stroke="#71a65d" stroke-width="32" stroke-linecap="butt"/>\n    <path d="M 282 113 A 460 460 0 0 1 512 52"            fill="none" stroke="#b8902e" stroke-width="32" stroke-linecap="butt"/>\n  </g>\n\n  <!-- Drop shadow under seal -->\n  <circle cx="512" cy="520" r="444" fill="#000" opacity="0.5"/>\n\n  <!-- Gold ring + navy interior -->\n  <circle cx="512" cy="512" r="444" fill="url(#goldRingGrad)"/>\n  <circle cx="512" cy="512" r="368" fill="url(#navyDeep)"/>\n  <circle cx="512" cy="512" r="372" fill="none" stroke="url(#goldRingGrad)" stroke-width="4"/>\n  <circle cx="512" cy="512" r="367" fill="none" stroke="#3D2914" stroke-width="1" opacity="0.5"/>\n  <circle cx="512" cy="512" r="441" fill="none" stroke="#3D2914" stroke-width="1" opacity="0.4"/>\n  <circle cx="512" cy="512" r="445" fill="none" stroke="#FFE066" stroke-width="1" opacity="0.5"/>\n\n  <!-- Engraved dots on inner border -->\n  <g fill="#3A2A0A" opacity="0.55">\n    <circle cx="512.0" cy="120.0" r="1.5"/><circle cx="539.3" cy="121.0" r="1.5"/><circle cx="566.6" cy="123.8" r="1.5"/><circle cx="593.5" cy="128.6" r="1.5"/><circle cx="620.0" cy="135.2" r="1.5"/><circle cx="646.1" cy="143.6" r="1.5"/><circle cx="671.4" cy="153.9" r="1.5"/><circle cx="696.0" cy="165.9" r="1.5"/><circle cx="719.7" cy="179.6" r="1.5"/><circle cx="742.4" cy="194.9" r="1.5"/><circle cx="764.0" cy="211.7" r="1.5"/><circle cx="784.3" cy="230.0" r="1.5"/><circle cx="803.3" cy="249.7" r="1.5"/><circle cx="820.9" cy="270.7" r="1.5"/><circle cx="837.0" cy="292.8" r="1.5"/><circle cx="851.5" cy="316.0" r="1.5"/><circle cx="864.3" cy="340.2" r="1.5"/><circle cx="875.5" cy="365.2" r="1.5"/><circle cx="884.8" cy="390.9" r="1.5"/><circle cx="892.4" cy="417.2" r="1.5"/><circle cx="898.0" cy="443.9" r="1.5"/><circle cx="901.9" cy="471.0" r="1.5"/><circle cx="903.8" cy="498.3" r="1.5"/><circle cx="903.8" cy="525.7" r="1.5"/><circle cx="901.9" cy="553.0" r="1.5"/><circle cx="898.0" cy="580.1" r="1.5"/><circle cx="892.4" cy="606.8" r="1.5"/><circle cx="884.8" cy="633.1" r="1.5"/><circle cx="875.5" cy="658.8" r="1.5"/><circle cx="864.3" cy="683.8" r="1.5"/><circle cx="851.5" cy="708.0" r="1.5"/><circle cx="837.0" cy="731.2" r="1.5"/><circle cx="820.9" cy="753.3" r="1.5"/><circle cx="803.3" cy="774.3" r="1.5"/><circle cx="784.3" cy="794.0" r="1.5"/><circle cx="764.0" cy="812.3" r="1.5"/><circle cx="742.4" cy="829.1" r="1.5"/><circle cx="719.7" cy="844.4" r="1.5"/><circle cx="696.0" cy="858.1" r="1.5"/><circle cx="671.4" cy="870.1" r="1.5"/><circle cx="646.1" cy="880.4" r="1.5"/><circle cx="620.0" cy="888.8" r="1.5"/><circle cx="593.5" cy="895.4" r="1.5"/><circle cx="566.6" cy="900.2" r="1.5"/><circle cx="539.3" cy="903.0" r="1.5"/><circle cx="512.0" cy="904.0" r="1.5"/><circle cx="484.7" cy="903.0" r="1.5"/><circle cx="457.4" cy="900.2" r="1.5"/><circle cx="430.5" cy="895.4" r="1.5"/><circle cx="404.0" cy="888.8" r="1.5"/><circle cx="377.9" cy="880.4" r="1.5"/><circle cx="352.6" cy="870.1" r="1.5"/><circle cx="328.0" cy="858.1" r="1.5"/><circle cx="304.3" cy="844.4" r="1.5"/><circle cx="281.6" cy="829.1" r="1.5"/><circle cx="260.0" cy="812.3" r="1.5"/><circle cx="239.7" cy="794.0" r="1.5"/><circle cx="220.7" cy="774.3" r="1.5"/><circle cx="203.1" cy="753.3" r="1.5"/><circle cx="187.0" cy="731.2" r="1.5"/><circle cx="172.5" cy="708.0" r="1.5"/><circle cx="159.7" cy="683.8" r="1.5"/><circle cx="148.5" cy="658.8" r="1.5"/><circle cx="139.2" cy="633.1" r="1.5"/><circle cx="131.6" cy="606.8" r="1.5"/><circle cx="126.0" cy="580.1" r="1.5"/><circle cx="122.1" cy="553.0" r="1.5"/><circle cx="120.2" cy="525.7" r="1.5"/><circle cx="120.2" cy="498.3" r="1.5"/><circle cx="122.1" cy="471.0" r="1.5"/><circle cx="126.0" cy="443.9" r="1.5"/><circle cx="131.6" cy="417.2" r="1.5"/><circle cx="139.2" cy="390.9" r="1.5"/><circle cx="148.5" cy="365.2" r="1.5"/><circle cx="159.7" cy="340.2" r="1.5"/><circle cx="172.5" cy="316.0" r="1.5"/><circle cx="187.0" cy="292.8" r="1.5"/><circle cx="203.1" cy="270.7" r="1.5"/><circle cx="220.7" cy="249.7" r="1.5"/><circle cx="239.7" cy="230.0" r="1.5"/><circle cx="260.0" cy="211.7" r="1.5"/><circle cx="281.6" cy="194.9" r="1.5"/><circle cx="304.3" cy="179.6" r="1.5"/><circle cx="328.0" cy="165.9" r="1.5"/><circle cx="352.6" cy="153.9" r="1.5"/><circle cx="377.9" cy="143.6" r="1.5"/><circle cx="404.0" cy="135.2" r="1.5"/><circle cx="430.5" cy="128.6" r="1.5"/><circle cx="457.4" cy="123.8" r="1.5"/><circle cx="484.7" cy="121.0" r="1.5"/>\n  </g>\n\n  <!-- OFFIZIELLE BESTÄTIGUNG -->\n  <text font-family="Georgia, \'Times New Roman\', serif" font-size="62" font-weight="bold" fill="url(#goldText)" letter-spacing="1" filter="url(#darkDropShadow)">\n    <textPath href="#topArc" startOffset="50%" text-anchor="middle">OFFIZIELLE BESTÄTIGUNG</textPath>\n  </text>\n\n  <!-- SBKIM -->\n  <g filter="url(#strongShadow)">\n    <text x="512" y="500" font-family="Georgia, \'Times New Roman\', serif" font-size="190" font-weight="bold" fill="url(#goldText)" text-anchor="middle" stroke="#3D2914" stroke-width="2.5" letter-spacing="2">SBKIM</text>\n  </g>\n\n  <!-- SIEGEL -->\n  <g filter="url(#embossShadow)">\n    <text x="512" y="620" font-family="Georgia, \'Times New Roman\', serif" font-size="110" font-weight="bold" fill="url(#goldText)" text-anchor="middle" stroke="#3D2914" stroke-width="2" letter-spacing="6">SIEGEL</text>\n  </g>\n\n  <!-- Left medallion (Schild) -->\n  <g>\n    <circle cx="188" cy="555" r="84" fill="#3D2914" opacity="0.85"/>\n    <circle cx="188" cy="555" r="80" fill="url(#goldRingGrad)"/>\n    <circle cx="188" cy="555" r="70" fill="url(#navyDeep)"/>\n    <circle cx="188" cy="555" r="70" fill="none" stroke="#D4A017" stroke-width="1.5" opacity="0.7"/>\n    <g transform="translate(188 555)">\n      <path d="M -34 -36 L 34 -36 C 34 0, 22 30, 0 44 C -22 30, -34 0, -34 -36 Z" fill="url(#goldShieldGrad)" stroke="#3D2914" stroke-width="2"/>\n      <path d="M -16 0 L -4 14 L 20 -12" fill="none" stroke="#6B4A00" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>\n    </g>\n    <circle cx="188" cy="643" r="11" fill="#3D2914"/>\n    <circle cx="188" cy="643" r="9" fill="url(#gemGrad)"/>\n    <ellipse cx="185.3" cy="639.4" rx="3.15" ry="1.98" fill="#B8DCFF" opacity="0.85"/>\n    <circle cx="184.4" cy="638.5" r="1.17" fill="#FFFFFF" opacity="0.9"/>\n  </g>\n\n  <!-- Right medallion (Mycel) -->\n  <g>\n    <circle cx="836" cy="555" r="84" fill="#3D2914" opacity="0.85"/>\n    <circle cx="836" cy="555" r="80" fill="url(#goldRingGrad)"/>\n    <circle cx="836" cy="555" r="70" fill="url(#navyDeep)"/>\n    <circle cx="836" cy="555" r="70" fill="none" stroke="#D4A017" stroke-width="1.5" opacity="0.7"/>\n    <g transform="translate(836 555)">\n      <circle cx="0" cy="-10" r="14" fill="url(#treeGlow)"/>\n      <line x1="0" y1="40" x2="0" y2="-10" stroke="#F4C430" stroke-width="4" stroke-linecap="round"/>\n      <line x1="0" y1="-10" x2="-37.6" y2="-23.7" stroke="#F4C430" stroke-width="2.5" stroke-linecap="round"/>\n      <line x1="-37.6" y1="-23.7" x2="-55.5" y2="-22.1" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="-55.5" cy="-22.1" r="2.2" fill="#FFE873"/>\n      <line x1="-37.6" y1="-23.7" x2="-50.3" y2="-36.4" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="-50.3" cy="-36.4" r="2.2" fill="#FFE873"/>\n      <circle cx="-37.6" cy="-23.7" r="2.5" fill="#FFE873"/>\n      <line x1="0" y1="-10" x2="-28.3" y2="-38.3" stroke="#F4C430" stroke-width="2.5" stroke-linecap="round"/>\n      <line x1="-28.3" y1="-38.3" x2="-45.2" y2="-44.4" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="-45.2" cy="-44.4" r="2.2" fill="#FFE873"/>\n      <line x1="-28.3" y1="-38.3" x2="-34.4" y2="-55.2" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="-34.4" cy="-55.2" r="2.2" fill="#FFE873"/>\n      <circle cx="-28.3" cy="-38.3" r="2.5" fill="#FFE873"/>\n      <line x1="0" y1="-10" x2="-13.7" y2="-47.6" stroke="#F4C430" stroke-width="2.5" stroke-linecap="round"/>\n      <line x1="-13.7" y1="-47.6" x2="-26.4" y2="-60.3" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="-26.4" cy="-60.3" r="2.2" fill="#FFE873"/>\n      <line x1="-13.7" y1="-47.6" x2="-12.1" y2="-65.5" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="-12.1" cy="-65.5" r="2.2" fill="#FFE873"/>\n      <circle cx="-13.7" cy="-47.6" r="2.5" fill="#FFE873"/>\n      <line x1="0" y1="-10" x2="13.7" y2="-47.6" stroke="#F4C430" stroke-width="2.5" stroke-linecap="round"/>\n      <line x1="13.7" y1="-47.6" x2="12.1" y2="-65.5" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="12.1" cy="-65.5" r="2.2" fill="#FFE873"/>\n      <line x1="13.7" y1="-47.6" x2="26.4" y2="-60.3" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="26.4" cy="-60.3" r="2.2" fill="#FFE873"/>\n      <circle cx="13.7" cy="-47.6" r="2.5" fill="#FFE873"/>\n      <line x1="0" y1="-10" x2="28.3" y2="-38.3" stroke="#F4C430" stroke-width="2.5" stroke-linecap="round"/>\n      <line x1="28.3" y1="-38.3" x2="34.4" y2="-55.2" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="34.4" cy="-55.2" r="2.2" fill="#FFE873"/>\n      <line x1="28.3" y1="-38.3" x2="45.2" y2="-44.4" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="45.2" cy="-44.4" r="2.2" fill="#FFE873"/>\n      <circle cx="28.3" cy="-38.3" r="2.5" fill="#FFE873"/>\n      <line x1="0" y1="-10" x2="37.6" y2="-23.7" stroke="#F4C430" stroke-width="2.5" stroke-linecap="round"/>\n      <line x1="37.6" y1="-23.7" x2="50.3" y2="-36.4" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="50.3" cy="-36.4" r="2.2" fill="#FFE873"/>\n      <line x1="37.6" y1="-23.7" x2="55.5" y2="-22.1" stroke="#F4C430" stroke-width="1.6" stroke-linecap="round"/>\n      <circle cx="55.5" cy="-22.1" r="2.2" fill="#FFE873"/>\n      <circle cx="37.6" cy="-23.7" r="2.5" fill="#FFE873"/>\n    </g>\n    <circle cx="836" cy="643" r="11" fill="#3D2914"/>\n    <circle cx="836" cy="643" r="9" fill="url(#gemGrad)"/>\n    <ellipse cx="833.3" cy="639.4" rx="3.15" ry="1.98" fill="#B8DCFF" opacity="0.85"/>\n    <circle cx="832.4" cy="638.5" r="1.17" fill="#FFFFFF" opacity="0.9"/>\n  </g>\n\n  <!-- Infinity medallion -->\n  <g>\n    <circle cx="512" cy="750" r="84" fill="#3D2914" opacity="0.85"/>\n    <circle cx="512" cy="750" r="80" fill="url(#goldRingGrad)"/>\n    <circle cx="512" cy="750" r="70" fill="url(#navyDeep)"/>\n    <circle cx="512" cy="750" r="70" fill="none" stroke="#D4A017" stroke-width="1.5" opacity="0.7"/>\n    <path d="M 470.2 750 C 470.2 727.2, 500.6 727.2, 512 750 C 523.4 772.8, 553.8 772.8, 553.8 750 C 553.8 727.2, 523.4 727.2, 512 750 C 500.6 772.8, 470.2 772.8, 470.2 750 Z" fill="none" stroke="url(#goldRingGrad)" stroke-width="10" stroke-linejoin="round"/>\n    <g fill="#FFE873">\n      <circle cx="460" cy="710" r="2.5"/>\n      <circle cx="564" cy="710" r="2.5"/>\n      <circle cx="452" cy="786" r="2"/>\n      <circle cx="572" cy="786" r="2"/>\n    </g>\n  </g>\n\n  <!-- Bottom ribbon SELF-INSCRIBING -->\n  <g>\n    <path d="M 28 880 L 200 850 L 200 925 L 28 945 Z" fill="url(#goldRibbonGrad)" stroke="#3D2914" stroke-width="2"/>\n    <path d="M 28 880 L 70 905 L 28 945 Z" fill="#7A5800"/>\n    <path d="M 996 880 L 824 850 L 824 925 L 996 945 Z" fill="url(#goldRibbonGrad)" stroke="#3D2914" stroke-width="2"/>\n    <path d="M 996 880 L 954 905 L 996 945 Z" fill="#7A5800"/>\n    <path d="M 180 850 Q 512 935, 844 850 L 844 940 Q 512 1018, 180 940 Z" fill="url(#goldRibbonGrad)" stroke="#3D2914" stroke-width="2.5"/>\n    <path d="M 200 870 Q 512 950, 824 870" fill="none" stroke="#FFE873" stroke-width="1.2" opacity="0.55"/>\n    <path d="M 200 920 Q 512 995, 824 920" fill="none" stroke="#3D2914" stroke-width="1" opacity="0.5"/>\n    <path id="ribbonText" d="M 222 902 Q 512 980, 802 902" fill="none"/>\n    <text font-family="Georgia, \'Times New Roman\', serif" font-size="38" font-weight="bold" fill="#3D2914" letter-spacing="1">\n      <textPath href="#ribbonText" startOffset="50%" text-anchor="middle">SAGE OBSERVATORIUM</textPath>\n    </text>\n  </g>\n</svg>\n';

  // ---- Modul-Zustand (Closure) ----

  var ready = false;
  var badgeSelector = DEFAULT_BADGE_SELECTOR;
  var visibleMode = "visible";
  var mountModalFlag = true;
  var repoUrlOverride = null;
  var ribbonText = DEFAULT_RIBBON_TEXT;
  // true sobald init({ribbonText}) einen expliziten Wert gesetzt hat.
  // Ohne expliziten Wert wird der Band-Text aus dem Repo-/Pages-Namen
  // automatisch abgeleitet (deriveRibbonFromRepo), damit jeder Endknoten
  // ohne Config seinen EIGENEN Namen trägt und nie ein mitkopiertes
  // Fremd-Label zeigt (Mein-Rezeptbuch-Bitte 2026-06-20).
  var ribbonTextExplicit = false;
  // Optionaler Andock-Knopf im Modal (opt-in, Default aus). Wenn true,
  // hängt mountSiegelModal() einen „Fremden Knoten andocken"-Knopf ins
  // Modal, der den KI-unabhängigen Modul-18-Wizard (SbkimToolPwa.
  // openAndockTab) öffnet. Der bestehende „🔑"-Identitäts-Pfad bleibt
  // unberührt (Klaus 2026-06-19: Andocken als ZUSÄTZLICHE Option).
  var andockToolEnabled = false;

  var moduleStatuses = null;        // Array<{id, name, globalName, surfaceFn, lazy, status}>
  var certifiedFlag = false;
  var certifiedAt = null;
  var firstBootShown = false;

  var badgeElement = null;
  var badgeCreatedByModule = false;
  var badgeClickHandler = null;

  var modalRoot = null;
  var modalMounted = false;
  var modalOpen = false;
  var modalKeydownHandler = null;

  var mountObserver = null;
  var mountObserverTimeoutId = null;

  // Sub (e) Bronze/Gold-Stufe (Karte 16 § Sub (e)). RAM-only: Tab-Reload
  // startet wieder Bronze — gewollt (Karte 16 § Sub (e) Persistenz).
  var mycelConnected = false;
  var mycelConnectedAt = null;
  var handshakeListener = null;
  var stufenwechselTimeoutId = null;

  // ---- Hilfsfunktionen ----

  function warn(message, cause) {
    if (typeof console !== "undefined" && console.warn) {
      if (cause !== undefined) console.warn("[SbkimSiegel] " + message, cause);
      else console.warn("[SbkimSiegel] " + message);
    }
  }

  function nowIso() { return new Date().toISOString(); }

  // ---- Sub (e) Bronze/Gold-Stufe (Karte 16 § Sub (e)) ----
  //
  // siegelStufe() ist closure-intern — KEIN export auf public surface
  // (Brief Block 1 B). _meta.mycelConnected ist der publizierte Anker.
  function siegelStufe() {
    if (mycelConnected === true) return STUFE_GOLD;
    return STUFE_BRONZE;
  }

  // Setzt data-stufe + aria-label auf das Badge-Element. KEIN title-
  // Attribut (Konvention aus Pflege 17 Tooltips, Doppel-Tooltip-Problem
  // auf DeX-Chrome — aria-label trägt vollen Text).
  function applyStufeToBadge() {
    if (!badgeElement) return;
    var stufe = siegelStufe();
    try {
      badgeElement.setAttribute("data-stufe", stufe);
      badgeElement.setAttribute(
        "aria-label",
        stufe === STUFE_GOLD ? ARIA_LABEL_GOLD : ARIA_LABEL_BRONZE,
      );
      if (typeof badgeElement.removeAttribute === "function") {
        badgeElement.removeAttribute("title");
      }
    } catch (err) {
      warn("data-stufe / aria-label konnte nicht gesetzt werden.", err);
    }
  }

  // Stufenwechsel-Animation (600 ms .stufenwechsel-gold-Klasse).
  function playStufenwechselAnimation() {
    if (!badgeElement || !badgeElement.classList) return;
    try {
      badgeElement.classList.add("stufenwechsel-gold");
      if (stufenwechselTimeoutId !== null) {
        clearTimeout(stufenwechselTimeoutId);
      }
      stufenwechselTimeoutId = setTimeout(function () {
        if (badgeElement) {
          try { badgeElement.classList.remove("stufenwechsel-gold"); } catch (_e) { /* nb */ }
        }
        stufenwechselTimeoutId = null;
      }, STUFENWECHSEL_ANIMATION_MS);
    } catch (err) {
      warn("Stufenwechsel-Animation konnte nicht starten.", err);
    }
  }

  // window-Event-Listener-Handler für sbkim:handshake (Modul 05 Bau 17).
  // Idempotent + fail-soft (Karte 16 § Sub (e) Modul-16-Listener).
  function onHandshakeEvent(event) {
    var outcome = event && event.detail && event.detail.outcome;
    if (outcome !== "established") return;     // no-op (fail-soft)
    if (mycelConnected === true) return;       // idempotent
    mycelConnected = true;
    mycelConnectedAt = nowIso();
    applyStufeToBadge();
    playStufenwechselAnimation();
    if (modalOpen) {
      try { renderModalContents(); } catch (err) { warn("Modal-Refresh nach Stufenwechsel fehlgeschlagen.", err); }
    }
  }

  function registerHandshakeListener() {
    if (handshakeListener) return;            // idempotent
    if (typeof global.addEventListener !== "function") return;
    handshakeListener = onHandshakeEvent;
    try {
      global.addEventListener(HANDSHAKE_EVENT, handshakeListener);
    } catch (err) {
      warn("Handshake-Listener-Registrierung fehlgeschlagen.", err);
      handshakeListener = null;
    }
  }

  function escapeAttr(str) {
    // Modal/Badge-Title-Strings sind statisch oder kommen aus
    // ZERTIFIKAT_ASPEKTE / PFLICHT_MODULE — beide code-versioniert.
    // textContent reicht im Modal; für `title`-Attribute genügt es,
    // potenzielle Doublequotes als &quot; auszugeben.
    if (typeof str !== "string") return "";
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- Surface-Check (Karte 16 § Sub (a) Surface-Check-Form) ----

  function checkModuleSurface(entry) {
    var ns;
    try {
      ns = global[entry.globalName];
    } catch (_e) {
      ns = undefined;
    }
    if (ns === undefined) {
      return entry.lazy ? "deferred" : "missing";
    }
    if (ns === null || typeof ns !== "object") {
      return "broken";
    }
    if (typeof ns[entry.surfaceFn] !== "function") {
      return "broken";
    }
    return "ok";
  }

  function buildModuleStatuses() {
    var out = [];
    for (var i = 0; i < PFLICHT_MODULE.length; i++) {
      var entry = PFLICHT_MODULE[i];
      out.push({
        id:         entry.id,
        name:       entry.name,
        globalName: entry.globalName,
        surfaceFn:  entry.surfaceFn,
        lazy:       entry.lazy,
        status:     checkModuleSurface(entry),
      });
    }
    return out;
  }

  function deriveCertified(statuses) {
    if (!statuses || statuses.length === 0) return false;
    for (var i = 0; i < statuses.length; i++) {
      var s = statuses[i].status;
      if (s !== "ok" && s !== "deferred") return false;
    }
    return true;
  }

  function collectFailedIds(statuses) {
    var failed = [];
    for (var i = 0; i < statuses.length; i++) {
      var s = statuses[i].status;
      if (s === "missing" || s === "broken") {
        failed.push(statuses[i].id + " (" + s + ")");
      }
    }
    return failed;
  }

  // ---- Repo-URL (Karte 16 § Sub (c) Repo-URL-Quelle) ----

  function defaultRepoUrl() {
    var origin = "";
    var path = "/";
    try {
      if (global.location && typeof global.location.origin === "string") {
        origin = global.location.origin;
      }
      if (global.location && typeof global.location.pathname === "string") {
        path = global.location.pathname;
      }
    } catch (_e) { /* nb */ }
    var segments = path.split("/");
    var firstSegment = null;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].length > 0) { firstSegment = segments[i]; break; }
    }
    if (firstSegment) return origin + "/" + firstSegment + "/";
    return origin + "/";
  }

  function resolveRepoUrl() {
    if (typeof repoUrlOverride === "string" && repoUrlOverride.length > 0) {
      // Sanity-Check: muss mit http(s):// oder / anfangen, sonst
      // fail-soft auf Auto-Erkennung.
      if (/^(https?:\/\/|\/)/.test(repoUrlOverride)) {
        return repoUrlOverride;
      }
      warn("repoUrl-Override ist keine gültige URL — Auto-Erkennung als Fallback: " + repoUrlOverride);
    }
    return defaultRepoUrl();
  }

  // ---- Snapshot-Bau (defensive Kopie pro Aufruf) ----

  function buildExplanationSnapshot() {
    var modulesCopy = [];
    if (moduleStatuses) {
      for (var i = 0; i < moduleStatuses.length; i++) {
        var m = moduleStatuses[i];
        modulesCopy.push({
          id:         m.id,
          name:       m.name,
          globalName: m.globalName,
          surfaceFn:  m.surfaceFn,
          lazy:       m.lazy,
          status:     m.status,
        });
      }
    }
    var certifiedIds = [];
    for (var j = 0; j < modulesCopy.length; j++) {
      if (modulesCopy[j].status === "ok" || modulesCopy[j].status === "deferred") {
        certifiedIds.push(modulesCopy[j].id);
      }
    }
    var aspectsCopy = [];
    for (var k = 0; k < ZERTIFIKAT_ASPEKTE.length; k++) {
      var a = ZERTIFIKAT_ASPEKTE[k];
      aspectsCopy.push({
        since:       a.since,
        module:      a.module,
        aspect:      a.aspect,
        description: a.description,
      });
    }
    return {
      certifiedAt:      certifiedAt,
      isCertified:      certifiedFlag,
      repoUrl:          resolveRepoUrl(),
      modules:          modulesCopy,
      certifiedModules: certifiedIds,
      aspects:          aspectsCopy,
    };
  }

  function emptySnapshot() {
    return {
      certifiedAt:      null,
      isCertified:      false,
      repoUrl:          resolveRepoUrl(),
      modules:          [],
      certifiedModules: [],
      aspects:          [],
    };
  }

  // ---- Badge-Mount (Option β) ----

  function resolveBadgeAnchor() {
    if (!badgeSelector || typeof badgeSelector !== "string") return null;
    try {
      var doc = global.document;
      if (!doc || typeof doc.querySelector !== "function") return null;
      return doc.querySelector(badgeSelector);
    } catch (err) {
      warn("badgeSelector ist kein gültiger CSS-Selektor: " + badgeSelector, err);
      return null;
    }
  }

  // XML-Text-Escaping für den Band-Text (defensiv — Forker-Eingabe).
  function escapeXmlText(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Effektiver Band-Text. Bewusst KEINE Auto-Ableitung aus dem Repo-Namen
  // (Klaus-Entscheidung 2026-06-20): das untere Ribbon ist das SELF-
  // INSCRIBING-Element des Siegels — ein geratener Repo-Slug wirkt auf einer
  // Auszeichnung schnell falsch. Ohne expliziten `ribbonText` bleibt das Band
  // OFFEN (leer); ein Vermerk (console.info einmalig + Doku) bittet den Host,
  // seinen Namen via init({ribbonText}) einzugravieren. Der explizite Wert
  // übersteuert; ein mitkopiertes Fremd-Label entsteht so nie.
  function effectiveRibbonText() {
    return ribbonTextExplicit ? ribbonText : "";
  }

  // Liefert den WAPPEN_SVG mit dem effektiven Band-Text. Entspricht der
  // effektive Text der inlined Konstante (Sage: "SAGE OBSERVATORIUM"),
  // bleibt das SVG byte-identisch; sonst wird der Ribbon-Text ersetzt
  // (leerer Wert → offenes Band).
  function renderWappenSvg() {
    var eff = effectiveRibbonText();
    if (eff === DEFAULT_RIBBON_TEXT) return WAPPEN_SVG;
    return WAPPEN_SVG.replace(
      RIBBON_MARKER,
      ">" + escapeXmlText(eff) + "</textPath>",
    );
  }

  function buildBadgeElement() {
    var doc = global.document;
    var span = doc.createElement("span");
    span.id = BADGE_ID;
    span.setAttribute("role", "button");
    span.setAttribute("tabindex", "0");
    // aria-label wird in applyStufeToBadge() je nach Sub-(e)-Stufe gesetzt
    // (Bronze/Gold). KEIN title-Attribut — Pflege 17 Tooltips 2026-05-26:
    // Doppel-Tooltip-Problem auf DeX-Chrome.
    span.setAttribute("aria-label", ARIA_LABEL_BRONZE);
    // SVG-Wappen: Ritterschild-Siegel mit Akkretions-Disk-Korona
    // (source of truth: `assets/sbkim-siegel-wappen.svg`; inlined als
    // `WAPPEN_SVG`-Konstante oben im Modul). Skaliert via viewBox auf
    // die 40-px-Badge-Box; bei 40 px sind Text-Bänder mikro-klein, das
    // Medaillon ist als visueller Anker erkennbar. aria-hidden auf dem
    // SVG — `title`/`aria-label` am Span trägt das a11y-Label.
    // renderWappenSvg() setzt den konfigurierten Band-Text (init ribbonText).
    span.innerHTML = renderWappenSvg();
    return span;
  }

  function mountBadge() {
    // Option β: kein Render bei not-certified, kein DOM-Element.
    if (!certifiedFlag) return;
    if (visibleMode === "hidden") return;
    if (badgeElement) return; // idempotent

    var anchor = resolveBadgeAnchor();
    if (!anchor) {
      setupBadgeMountObserver();
      return;
    }

    var doc = global.document;
    if (!doc) return;

    // Wenn der Selektor bereits ein Element mit BADGE_ID gematcht
    // hat (vor-injiziert), benutzen wir dieses Element direkt.
    // Sonst (Standardfall: Container wie `.lamps`) erzeugen wir
    // den Badge-Span darin.
    if (anchor.id === BADGE_ID) {
      badgeElement = anchor;
      badgeCreatedByModule = false;
      // Wenn das bereits-bestehende Element leer ist, füllen wir
      // das Wappen nach; sonst lassen wir den Inhalt unangetastet.
      if (!anchor.firstChild) {
        anchor.innerHTML = buildBadgeElement().innerHTML;
      }
      if (!anchor.getAttribute("role")) anchor.setAttribute("role", "button");
      if (!anchor.getAttribute("tabindex")) anchor.setAttribute("tabindex", "0");
      // aria-label setzt applyStufeToBadge() je nach Sub-(e)-Stufe.
      // KEIN title-Attribut (Pflege 17 Tooltips, Doppel-Tooltip-Problem).
    } else {
      var span = buildBadgeElement();
      anchor.appendChild(span);
      badgeElement = span;
      badgeCreatedByModule = true;
    }

    applyStufeToBadge();   // Sub (e) Bronze/Gold (Karte 16 § Sub (e)).
    attachBadgeClickHandler();
    playFirstBootAnimation();
  }

  function setupBadgeMountObserver() {
    if (mountObserver) return;
    var doc = global.document;
    if (!doc || typeof MutationObserver === "undefined") return;
    if (!doc.body) {
      if (typeof doc.addEventListener === "function") {
        var onReady = function () {
          doc.removeEventListener("DOMContentLoaded", onReady);
          mountBadge();
        };
        doc.addEventListener("DOMContentLoaded", onReady);
      }
      return;
    }
    mountObserver = new MutationObserver(function () {
      var anchor = resolveBadgeAnchor();
      if (anchor) {
        disconnectMountObserver();
        mountBadge();
      }
    });
    try {
      mountObserver.observe(doc.body, { childList: true, subtree: true });
    } catch (err) {
      warn("MutationObserver konnte nicht starten — späten Badge-Mount aufgeben.", err);
      mountObserver = null;
      return;
    }
    mountObserverTimeoutId = setTimeout(function () {
      if (mountObserver) {
        disconnectMountObserver();
        warn(
          'badgeSelector "' + badgeSelector + '" auch nach ' +
          MOUNT_OBSERVER_TIMEOUT_MS + ' ms nicht gefunden — Badge-Mount übersprungen.',
        );
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

  function attachBadgeClickHandler() {
    if (!badgeElement) return;
    if (badgeClickHandler) return; // idempotent
    badgeClickHandler = function () {
      if (!mountModalFlag) return;
      if (modalOpen) closeModal(); else openModal();
    };
    try {
      badgeElement.addEventListener("click", badgeClickHandler);
      // Tastatur-A11y: Enter / Space am fokussierten Badge öffnet das Modal.
      badgeElement.addEventListener("keydown", function (ev) {
        if (!mountModalFlag) return;
        if (ev && (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar")) {
          ev.preventDefault();
          if (modalOpen) closeModal(); else openModal();
        }
      });
    } catch (err) {
      warn("Badge-Click-Handler konnte nicht registriert werden.", err);
    }
  }

  function playFirstBootAnimation() {
    if (firstBootShown) return;
    if (!badgeElement) return;
    try {
      badgeElement.classList.add("first-boot");
      setTimeout(function () {
        if (badgeElement) {
          try { badgeElement.classList.remove("first-boot"); } catch (_e) { /* nb */ }
        }
      }, FIRST_BOOT_ANIMATION_MS);
    } catch (err) {
      warn("First-Boot-Animation konnte nicht starten.", err);
    }
    firstBootShown = true;
  }

  // ---- Modal-Mount (Karte 16 § Sub (c)) ----

  // ---- Optionaler Andock-Knopf (opt-in, Modul 18 wiederverwendet) ----
  //
  // KI-unabhängiger Handshake: öffnet den Modul-18-Wizard
  // (SbkimToolPwa.openAndockTab: Repo-URL → Spore holen → verifyForeignSpore
  // → Match → Handshake via Modul 05). Reiner Browser-Pfad (WebCrypto+fetch),
  // keine Claude-Sitzung nötig. Fail-soft: fehlt Modul 18, zeigt der Knopf
  // einen Hinweis statt zu werfen. Der „🔑"-Identitäts-Pfad bleibt unberührt.

  function showAndockHint(text) {
    if (!modalRoot) return;
    var hint = modalRoot.querySelector("[data-siegel-andock-tool-hint]");
    if (!hint) return;
    hint.style.display = "block";
    hint.textContent = text;
  }

  function onAndockClick() {
    var tp = global.SbkimToolPwa;
    if (!tp || typeof tp.openAndockTab !== "function") {
      showAndockHint(
        "Andock-Werkzeug (Modul 18 SbkimToolPwa) ist nicht geladen — " +
        "bitte src/modules/18_tool_pwa.js einbinden und SbkimToolPwa.init({…}) aufrufen.",
      );
      warn("Andock-Knopf geklickt, aber Modul 18 (SbkimToolPwa) ist nicht geladen.");
      return;
    }
    var hint = modalRoot ? modalRoot.querySelector("[data-siegel-andock-tool-hint]") : null;
    if (hint) { hint.style.display = "none"; hint.textContent = ""; }
    try {
      var p = tp.openAndockTab();
      // Siegel-Modal schließen, damit der Modul-18-Wizard sichtbar ist:
      // der Wizard hat einen niedrigeren z-index (10000) als das Siegel-
      // Modal (99998) und läge sonst dahinter (Befund Klaus 2026-06-20:
      // „Knopf da, Klick öffnet nichts" — Wizard war verdeckt).
      closeModal();
      if (p && typeof p.catch === "function") {
        p.catch(function (err) {
          warn("Andock-Wizard-Start fehlgeschlagen.", err);
        });
      }
    } catch (err) {
      warn("Andock-Werkzeug-Start fehlgeschlagen.", err);
      showAndockHint("Andock-Werkzeug nicht bereit: " + (err && err.message ? err.message : String(err)));
    }
  }

  function buildAndockBlock(doc) {
    var block = doc.createElement("div");
    block.setAttribute("data-siegel-andock-tool", "");
    block.style.cssText = [
      "margin:0 0 1.2rem",
      "padding:0.85rem 0.9rem",
      "background:rgba(201,169,97,0.08)",
      "border:1px solid var(--siegel-line, rgba(201,169,97,0.45))",
      "border-radius:8px",
    ].join(";");

    var lead = doc.createElement("p");
    lead.style.cssText = [
      "margin:0 0 0.6rem",
      "font-family:'Geist', system-ui, sans-serif",
      "font-size:0.86rem",
      "line-height:1.5",
      "color:rgba(245,245,255,0.86)",
    ].join(";");
    lead.textContent =
      "Fremden Knoten verbinden — ohne KI, direkt im Browser: Repo-/App-URL " +
      "eingeben → Spore prüfen → Match → Handshake.";

    var btn = doc.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-siegel-andock-tool-btn", "");
    btn.textContent = "🔌 Fremden Knoten andocken →";
    btn.style.cssText = [
      "display:inline-block",
      "background:var(--siegel-gold, #C9A961)",
      "color:#1A1306",
      "border:none",
      "border-radius:8px",
      "padding:0.5rem 0.9rem",
      "font-family:'Geist', system-ui, sans-serif",
      "font-size:0.9rem",
      "font-weight:600",
      "cursor:pointer",
    ].join(";");

    var hint = doc.createElement("p");
    hint.setAttribute("data-siegel-andock-tool-hint", "");
    hint.style.cssText = [
      "display:none",
      "margin:0.55rem 0 0",
      "font-size:0.8rem",
      "line-height:1.45",
      "color:rgba(245,245,255,0.6)",
    ].join(";");

    block.appendChild(lead);
    block.appendChild(btn);
    block.appendChild(hint);
    btn.addEventListener("click", onAndockClick);
    return block;
  }

  function mountSiegelModal() {
    if (modalMounted) return;
    if (!mountModalFlag) return;
    if (!certifiedFlag) return; // Modal nur wenn Bezeugung grün
    var doc = global.document;
    if (!doc || !doc.body) return;

    var root = doc.createElement("div");
    root.id = MODAL_ID;
    root.setAttribute("aria-hidden", "true");
    root.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:99998",          // unter Modul-15-Modal-z-Index (99999), Reihenfolge ist konventionsfrei
      "display:none",
      "align-items:center",
      "justify-content:center",
    ].join(";");

    var backdrop = doc.createElement("div");
    backdrop.setAttribute("data-siegel-backdrop", "");
    backdrop.style.cssText = [
      "position:absolute",
      "inset:0",
      "background:rgba(0,0,0,0.62)",
    ].join(";");

    var panel = doc.createElement("div");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", MODAL_ID + "-title");
    // Bronze-Ink-Untergrund + Edel-Gold-Rahmen (Karte 16 § Sub (c) Modal-Form).
    panel.style.cssText = [
      "position:relative",
      "background:var(--siegel-ink, #1A1306)",
      "color:#F5F5FF",
      "border:1px solid var(--siegel-line, rgba(201,169,97,0.45))",
      "border-radius:10px",
      "padding:1.4rem 1.6rem",
      "min-width:320px",
      "max-width:min(560px, 92vw)",
      "max-height:80vh",
      "overflow:auto",
      "box-shadow:0 24px 64px rgba(0,0,0,0.7)",
      "font-family:'Geist', system-ui, sans-serif",
    ].join(";");

    var header = doc.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:0.8rem;margin-bottom:1rem;";

    var title = doc.createElement("h2");
    title.id = MODAL_ID + "-title";
    title.textContent = MODAL_TITLE;
    // Serif für Titel (Karte 16 § Sub (c) wertigere Typografie).
    title.style.cssText = [
      "margin:0",
      "font-family:'Spectral','Georgia','Times New Roman',serif",
      "font-size:1.25rem",
      "font-weight:500",
      "letter-spacing:0.01em",
      "color:var(--siegel-gold, #C9A961)",
      "flex:1",
    ].join(";");

    var closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("data-siegel-close", "");
    closeBtn.setAttribute("aria-label", "Schließen");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = [
      "background:transparent",
      "color:#F5F5FF",
      "border:1px solid var(--siegel-line, rgba(201,169,97,0.45))",
      "border-radius:8px",
      "padding:0.25rem 0.6rem",
      "cursor:pointer",
      "font-size:1rem",
    ].join(";");

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Sub (e) Bronze-Hinweis-Block (Karte 16 § Sub (e) Klick-Verhalten in
    // Bronze). Sichtbar nur wenn _meta.mycelConnected === false. Reiner
    // Hinweis-Text; der Andock-/Identitäts-Pfad ist der „🔑 …"-Knopf, den
    // der Host (Sage-Page / Endknoten) oben ins Modal einhängt (Pflege
    // 2026-06-07: kein Modul-18-Verweis mehr, ein Pfad statt mehrerer).
    var bronzeHinweisBlock = doc.createElement("div");
    bronzeHinweisBlock.setAttribute("data-siegel-bronze-hinweis", "");
    bronzeHinweisBlock.style.cssText = [
      "display:none",
      "margin:0 0 1rem",
      "padding:0.75rem 0.9rem",
      "background:rgba(140,110,47,0.12)",
      "border:1px solid var(--siegel-bronze-glow, rgba(140,110,47,0.45))",
      "border-radius:8px",
      "font-family:'Geist', system-ui, sans-serif",
      "font-size:0.86rem",
      "line-height:1.5",
      "color:rgba(245,245,255,0.88)",
    ].join(";");

    var dateLine = doc.createElement("p");
    dateLine.setAttribute("data-siegel-date", "");
    dateLine.style.cssText = "margin:0 0 1rem;font-size:0.86rem;color:rgba(245,245,255,0.78);";

    var modulesHeader = doc.createElement("h3");
    modulesHeader.textContent = "Pflicht-Module";
    modulesHeader.style.cssText = [
      "margin:0 0 0.5rem",
      "font-family:'Geist', system-ui, sans-serif",
      "font-size:0.92rem",
      "font-weight:500",
      "color:rgba(245,245,255,0.78)",
      "text-transform:uppercase",
      "letter-spacing:0.06em",
    ].join(";");

    var modulesList = doc.createElement("ul");
    modulesList.setAttribute("data-siegel-modules", "");
    modulesList.style.cssText = [
      "list-style:none",
      "padding:0",
      "margin:0 0 1.2rem",
      "font-family:'Geist', system-ui, sans-serif",
      "font-size:0.86rem",
    ].join(";");

    // Aspekte-Sektion: standardmäßig EINGEKLAPPT (<details> ohne "open") und
    // ehrlich als PROTOKOLL-weite, gemeinsame Historie gerahmt — NICHT als
    // app-eigene Zertifizierungs-Daten. Die since-Daten stammen aus der
    // netzweiten SBKIM-Bau-Historie und sind in jeder App identisch; die
    // app-eigene, aktuelle Aussage ist die „Pflicht-Module"-Liste oben +
    // die Bezeugt-seit-Zeile (lokaler Start-Zeitpunkt DIESER App).
    var aspectsDetails = doc.createElement("details");
    aspectsDetails.setAttribute("data-siegel-aspects-details", "");
    aspectsDetails.style.cssText = "margin:0 0 1.2rem;";

    var aspectsSummary = doc.createElement("summary");
    aspectsSummary.textContent = "SBKIM-Protokoll — Sicherheits-Aspekte (gemeinsam, netzweit)";
    aspectsSummary.style.cssText = modulesHeader.style.cssText + ";cursor:pointer;";

    var aspectsIntro = doc.createElement("p");
    aspectsIntro.textContent = "Historie der SBKIM-Sicherheits-Bausteine — für alle Knoten gleich. Das sind Protokoll-Daten, keine app-eigenen Zertifizierungs-Daten dieser App.";
    aspectsIntro.style.cssText = "margin:0.5rem 0 0.7rem;font-size:0.8rem;color:rgba(245,245,255,0.6);line-height:1.5;";

    var aspectsList = doc.createElement("ul");
    aspectsList.setAttribute("data-siegel-aspects", "");
    aspectsList.style.cssText = [
      "list-style:none",
      "padding:0",
      "margin:0",
      "font-family:'Geist', system-ui, sans-serif",
      "font-size:0.86rem",
    ].join(";");

    aspectsDetails.appendChild(aspectsSummary);
    aspectsDetails.appendChild(aspectsIntro);
    aspectsDetails.appendChild(aspectsList);

    var ausstellerBlock = doc.createElement("div");
    ausstellerBlock.setAttribute("data-siegel-aussteller", "");
    // Serif für die Aussteller-Klärung (Karte 16 § Sub (c)).
    ausstellerBlock.style.cssText = [
      "padding-top:0.9rem",
      "border-top:1px solid var(--siegel-line, rgba(201,169,97,0.45))",
      "font-family:'Spectral','Georgia','Times New Roman',serif",
      "font-size:0.92rem",
      "line-height:1.55",
      "color:rgba(245,245,255,0.86)",
    ].join(";");

    panel.appendChild(header);
    panel.appendChild(bronzeHinweisBlock);     // Sub (e) — sichtbar nur in Bronze
    panel.appendChild(dateLine);
    // Optionaler Andock-Knopf (opt-in via init({andockTool:true})). Nur
    // dann im DOM — Default-Render trägt KEIN [data-siegel-andock-tool].
    if (andockToolEnabled) {
      panel.appendChild(buildAndockBlock(doc));
    }
    panel.appendChild(modulesHeader);
    panel.appendChild(modulesList);
    panel.appendChild(aspectsDetails);
    panel.appendChild(ausstellerBlock);

    root.appendChild(backdrop);
    root.appendChild(panel);
    doc.body.appendChild(root);

    backdrop.addEventListener("click", closeModal);
    closeBtn.addEventListener("click", closeModal);

    modalRoot = root;
    modalMounted = true;
  }

  function statusMarkerDot(status) {
    var color;
    if (status === "ok")         color = "#16A34A";
    else if (status === "deferred") color = "var(--siegel-gold, #C9A961)";
    else                          color = "#DC2626";
    return (
      '<span aria-hidden="true" style="display:inline-block;width:8px;height:8px;border-radius:50%;' +
      'background:' + color + ';margin-right:0.55rem;vertical-align:middle;"></span>'
    );
  }

  function statusLabel(status) {
    if (status === "ok")       return "bereit";
    if (status === "deferred") return "bereit (lazy)";
    if (status === "missing")  return "fehlt";
    if (status === "broken")   return "defekt";
    return status;
  }

  // Sub (e) Bronze-Hinweis-Block-Render (Karte 16 § Sub (e) Klick-
  // Verhalten in Bronze). Wird aus renderModalContents() bei jedem
  // Modal-Render aufgerufen.
  function renderBronzeHinweisBlock(modalRoot) {
    var block = modalRoot.querySelector("[data-siegel-bronze-hinweis]");
    if (!block) return;
    var doc = global.document;
    block.textContent = "";

    // In Gold-Stufe: Block ausblenden.
    if (siegelStufe() === STUFE_GOLD) {
      block.style.display = "none";
      return;
    }

    block.style.display = "block";

    var p = doc.createElement("p");
    p.style.cssText = "margin:0;";
    var strong = doc.createElement("strong");
    strong.textContent = "Im Mycel · ruhend";
    strong.style.cssText = "color:var(--siegel-bronze, #8C6E2F);font-weight:600;";
    p.appendChild(strong);
    p.appendChild(doc.createTextNode(
      " — diese Zelle trägt das SBKIM-Siegel und ist damit Teil des Mycels, so klein sie auch ist. " +
      "In dieser Sitzung gab es noch keinen Hyphen-Verkehr (Handshake). Über den Knopf " +
      "„🔑 Eigene Identität & Spore erzeugen / verwalten →“ oben knüpfst du aktiv einen Faden " +
      "zu einem Geschwister-Knoten.",
    ));
    block.appendChild(p);
  }

  function renderModalContents() {
    if (!modalRoot) return;
    var doc = global.document;
    var snap = buildExplanationSnapshot();

    // Sub (e) Bronze-Hinweis-Block — vor allen anderen Render-Schritten.
    renderBronzeHinweisBlock(modalRoot);

    var dateLine = modalRoot.querySelector("[data-siegel-date]");
    if (dateLine) {
      if (snap.certifiedAt) {
        // Pflege Modal-Local-Time 2026-05-26 (Sub-(e)-Folge-Pflege 3/3):
        // certifiedAt ist UTC-ISO ("2026-05-24T18:42:31.123Z"). Vor der
        // Pflege wurden die ISO-Slices direkt angezeigt — Klaus' Befund
        // DeX-Chrome (MESZ, UTC+2): „Datum/Uhrzeit ist nicht aktuell,
        // ich vermute nicht Mitteleuropäische Zeit, eher Amerikan."
        // Fix: lokale Date-Methoden (getFullYear/getMonth/getDate/
        // getHours/getMinutes) statt UTC-ISO-Split. ISO-Datum-Format
        // (YYYY-MM-DD) bleibt, weil Klaus' Doku-Stil das überall nutzt
        // (Aspekte-since-Feld, Übergabeprotokoll-Dateinamen).
        var date = new Date(snap.certifiedAt);
        if (isNaN(date.getTime())) {
          dateLine.textContent = "Bezeugt seit " + snap.certifiedAt;
        } else {
          var yyyy = date.getFullYear();
          var mm = String(date.getMonth() + 1).padStart(2, "0");
          var dd = String(date.getDate()).padStart(2, "0");
          var HH = String(date.getHours()).padStart(2, "0");
          var MM = String(date.getMinutes()).padStart(2, "0");
          dateLine.textContent = "Bezeugt seit " + yyyy + "-" + mm + "-" + dd + ", " + HH + ":" + MM + " Uhr.";
        }
      } else {
        dateLine.textContent = "Bezeugt: —";
      }
    }

    var modulesList = modalRoot.querySelector("[data-siegel-modules]");
    if (modulesList) {
      modulesList.textContent = "";
      for (var i = 0; i < snap.modules.length; i++) {
        var m = snap.modules[i];
        var li = doc.createElement("li");
        li.style.cssText = "padding:0.32rem 0;border-bottom:1px solid rgba(255,255,255,0.05);";
        // Status-Punkt + ID/Name + Status-Label. Punkt-HTML ist
        // module-eigen und statisch — kein User-Input.
        li.innerHTML = statusMarkerDot(m.status) +
          '<span style="font-family:\'Geist Mono\',ui-monospace,monospace;color:rgba(245,245,255,0.86);">' +
          escapeAttr(m.id) + '</span>' +
          ' <span style="margin:0 0.5rem;color:rgba(245,245,255,0.45);">·</span> ' +
          '<span style="color:#F5F5FF;">' + escapeAttr(m.name) + '</span>' +
          ' <span style="margin:0 0.5rem;color:rgba(245,245,255,0.45);">·</span> ' +
          '<span style="color:rgba(245,245,255,0.62);">' + escapeAttr(statusLabel(m.status)) + '</span>';
        modulesList.appendChild(li);
      }
    }

    var aspectsList = modalRoot.querySelector("[data-siegel-aspects]");
    if (aspectsList) {
      aspectsList.textContent = "";
      // Chronologisch aufsteigend, Tie-Breaker module-ID aufsteigend
      // (Karte 16 § Sub (d) Reihenfolge).
      var sorted = snap.aspects.slice().sort(function (a, b) {
        if (a.since < b.since) return -1;
        if (a.since > b.since) return 1;
        if (a.module < b.module) return -1;
        if (a.module > b.module) return 1;
        return 0;
      });
      for (var k = 0; k < sorted.length; k++) {
        var a = sorted[k];
        var aLi = doc.createElement("li");
        aLi.style.cssText = "padding:0.5rem 0;border-bottom:1px solid rgba(255,255,255,0.05);";
        // Sub (e) Aspekt-4-Pending-Marker (Karte 16 § Sub (d) Sonderfall
        // dynamische Render-Variante): in Bronze-Stufe rendert das Modal
        // Aspekt 4 mit Marker „pending" statt Datum, mit grauer Farbe.
        var isPendingAspect4 = isAspect4(a) && mycelConnected !== true;
        var head = doc.createElement("div");
        head.style.cssText = "display:flex;gap:0.5rem;align-items:baseline;margin-bottom:0.2rem;";
        var since = doc.createElement("span");
        since.textContent = isPendingAspect4 ? "pending" : a.since;
        since.style.cssText = isPendingAspect4
          ? "font-family:'Geist Mono',ui-monospace,monospace;color:rgba(245,245,255,0.45);font-size:0.82rem;font-style:italic;"
          : "font-family:'Geist Mono',ui-monospace,monospace;color:var(--siegel-gold, #C9A961);font-size:0.82rem;";
        var moduleId = doc.createElement("span");
        moduleId.textContent = "· " + a.module;
        moduleId.style.cssText = "font-family:'Geist Mono',ui-monospace,monospace;color:rgba(245,245,255,0.62);font-size:0.82rem;";
        var aspect = doc.createElement("span");
        aspect.textContent = "· " + a.aspect;
        aspect.style.cssText = "color:#F5F5FF;font-size:0.9rem;flex:1;";
        head.appendChild(since);
        head.appendChild(moduleId);
        head.appendChild(aspect);
        var desc = doc.createElement("p");
        desc.textContent = a.description;
        desc.style.cssText = "margin:0;font-size:0.82rem;color:rgba(245,245,255,0.7);line-height:1.5;";
        aLi.appendChild(head);
        aLi.appendChild(desc);
        aspectsList.appendChild(aLi);
      }
    }

    var ausstellerBlock = modalRoot.querySelector("[data-siegel-aussteller]");
    if (ausstellerBlock) {
      ausstellerBlock.textContent = "";
      var doc2 = global.document;
      var p1 = doc2.createElement("p");
      p1.style.cssText = "margin:0 0 0.4rem;";
      // Verbindlicher Wortlaut (Karte 16 § Sub (c) Aussteller-Klärung).
      // textContent statt innerHTML → KEINE HTML-Interpretation, dafür
      // "self-inscribing" als Wort, das im Text betont aussieht durch
      // den Serif-Font des umgebenden Blocks.
      p1.appendChild(doc2.createTextNode("Dieses Siegel ist "));
      var strong = doc2.createElement("strong");
      strong.textContent = "self-inscribing";
      strong.style.cssText = "font-weight:500;color:var(--siegel-gold, #C9A961);";
      p1.appendChild(strong);
      p1.appendChild(doc2.createTextNode(": die App hat sich beim Boot selbst geprüft."));

      var p2 = doc2.createElement("p");
      p2.style.cssText = "margin:0;";
      p2.appendChild(doc2.createTextNode("Vertrauen kommt vom Repo, in dem sie gehostet ist: "));
      var link = doc2.createElement("a");
      link.href = snap.repoUrl;
      link.textContent = snap.repoUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.style.cssText = "color:var(--siegel-gold, #C9A961);text-decoration:underline;";
      p2.appendChild(link);
      p2.appendChild(doc2.createTextNode("."));

      ausstellerBlock.appendChild(p1);
      ausstellerBlock.appendChild(p2);
    }
  }

  function openModal() {
    if (!mountModalFlag) return;
    if (!certifiedFlag) return;
    if (!modalMounted) mountSiegelModal();
    if (!modalRoot) return;
    renderModalContents();
    modalRoot.style.display = "flex";
    modalRoot.setAttribute("aria-hidden", "false");
    modalOpen = true;
    if (!modalKeydownHandler) {
      modalKeydownHandler = function (event) {
        if (event && event.key === "Escape" && modalOpen) {
          closeModal();
        }
      };
      try { global.document.addEventListener("keydown", modalKeydownHandler); }
      catch (_e) { /* nb */ }
    }
  }

  function closeModal() {
    if (!modalOpen) return;
    if (modalRoot) {
      modalRoot.style.display = "none";
      modalRoot.setAttribute("aria-hidden", "true");
    }
    modalOpen = false;
    if (modalKeydownHandler) {
      try { global.document.removeEventListener("keydown", modalKeydownHandler); }
      catch (_e) { /* nb */ }
      modalKeydownHandler = null;
    }
  }

  // ---- init() ----

  async function init(options) {
    if (ready) {
      // Idempotent: keine Re-Check, kein Re-Mount, kein Doppel-Listener.
      // Wenn der Selektor erst nach init() im DOM erscheint, kann ein
      // Aufrufer `mountBadge()` indirekt via wiederholten init() NICHT
      // erzwingen — das ist Karte 16 § Sub (a) "idempotent" verbindlich.
      return;
    }

    var opts = (options && typeof options === "object") ? options : {};
    if (typeof opts.badgeSelector === "string" && opts.badgeSelector.length > 0) {
      badgeSelector = opts.badgeSelector;
    }
    if (opts.visible === "hidden") {
      visibleMode = "hidden";
    } else if (opts.visible === "visible") {
      visibleMode = "visible";
    }
    mountModalFlag = (opts.mountModal !== false);
    if (typeof opts.repoUrl === "string" && opts.repoUrl.length > 0) {
      repoUrlOverride = opts.repoUrl;
    } else if (opts.repoUrl === null) {
      repoUrlOverride = null;
    }
    // Band-Text im Wappen (Forker gravieren ihren Knoten-Namen ein). Fail-
    // soft: leerer/Nicht-String-Wert lässt das Band OFFEN (kein Auto-Label).
    if (typeof opts.ribbonText === "string" && opts.ribbonText.trim().length > 0) {
      ribbonText = opts.ribbonText.trim();
      ribbonTextExplicit = true;
    } else if (typeof console !== "undefined" && console.info) {
      // Vermerk (einmalig, init ist idempotent): Band bleibt bewusst offen.
      console.info(
        "[SbkimSiegel] Band offen gelassen — init({ ribbonText: \"DEIN-KNOTEN\" }) " +
        "setzen, um den eigenen Namen ins Siegel zu gravieren (kein Auto-Label).",
      );
    }
    // Optionaler Andock-Knopf (KI-unabhängiger Handshake via Modul 18).
    // Strikt boolean true → opt-in; alles andere lässt den Default (aus).
    if (opts.andockTool === true) {
      andockToolEnabled = true;
    }

    // Surface-Check: Snapshot zur init()-Zeit.
    moduleStatuses = buildModuleStatuses();
    certifiedFlag = deriveCertified(moduleStatuses);

    if (!certifiedFlag) {
      // Fail-Modus binär (Karte 16 § Sub (a) Fail-Modus):
      // EINE console.warn-Zeile mit ID-Liste; KEIN Badge, KEIN Modal.
      var failed = collectFailedIds(moduleStatuses);
      warn(
        "kein Render: Pflicht-Module fehlen/defekt — " + failed.join(", ") +
        ". Siehe docs/components/16_siegel.md § Sub (a).",
      );
      ready = true;
      return;
    }

    certifiedAt = nowIso();

    // Badge-Mount (Option β: kein DOM-Element bei not-certified).
    if (visibleMode !== "hidden") {
      mountBadge();
    }

    // Modal-Mount (default true). Modal hängt unabhängig vom Badge —
    // bei `visible:"hidden"` UND `mountModal:true` ist das Modal trotzdem
    // ansprechbar, aber ohne Click-Trigger (Aufrufer öffnet via JS).
    if (mountModalFlag) {
      try { mountSiegelModal(); } catch (err) { warn("Modal-Mount fehlgeschlagen", err); }
    }

    // Sub (e) Bronze/Gold-Stufung (Karte 16 § Sub (e), 2026-05-26):
    // window-Event-Listener für sbkim:handshake outcome:"established"
    // registrieren. Erst NACH Badge-Mount, damit applyStufeToBadge auf
    // einem existierenden Element arbeiten kann. Idempotent +
    // fail-soft im Handler.
    registerHandshakeListener();

    ready = true;

    // Bau 17: sbkim:siegel-certified-Custom-Event NUR bei
    // isCertified()===true (Anti-Greenwashing-Klausel binär). Wird
    // genau einmal pro Sitzung gefeuert — `ready`-Flag oben schützt
    // gegen Re-Init. Modul 17 (LEBT-Slot ... Pardon, SIEGEL-Slot)
    // hängt davon ab, dass dieser Event auf `window` ankommt.
    try {
      if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
        global.dispatchEvent(new global.CustomEvent("sbkim:siegel-certified", {
          detail: {
            certifiedAt: certifiedAt,
            repoUrl:     resolveRepoUrl(),
          },
          bubbles:    false,
          cancelable: false,
        }));
      }
    } catch (_e) {
      // fail-soft — Render-Schicht (Modul 17) ist optional.
    }
  }

  // ---- Öffentliche API ----

  function isCertified() {
    return certifiedFlag === true;
  }

  function getExplanation() {
    if (!ready) return emptySnapshot();
    return buildExplanationSnapshot();
  }

  function getCertifiedModules() {
    if (!ready || !moduleStatuses) return [];
    var out = [];
    for (var i = 0; i < moduleStatuses.length; i++) {
      var s = moduleStatuses[i].status;
      if (s === "ok" || s === "deferred") out.push(moduleStatuses[i].id);
    }
    return out;
  }

  function getAspects() {
    var out = [];
    for (var i = 0; i < ZERTIFIKAT_ASPEKTE.length; i++) {
      var a = ZERTIFIKAT_ASPEKTE[i];
      out.push({
        since:       a.since,
        module:      a.module,
        aspect:      a.aspect,
        description: a.description,
      });
    }
    return out;
  }

  // PFLICHT_MODULE-Spec-Kopie für _meta (defensive Kopie zur Skript-Lade-
  // Zeit; KEINE Runtime-Mutation, KEINE Aufrufer-Manipulation).
  function snapshotPflichtModuleSpec() {
    var out = [];
    for (var i = 0; i < PFLICHT_MODULE.length; i++) {
      var e = PFLICHT_MODULE[i];
      out.push({
        id:         e.id,
        name:       e.name,
        globalName: e.globalName,
        surfaceFn:  e.surfaceFn,
        lazy:       e.lazy,
      });
    }
    return out;
  }

  // Sub (e) Test-Brücke (Karte 16 § Sub (e), Panel 16 Knopf 12):
  // setzt _meta.mycelConnected zurück auf false, re-rendert Badge.
  // KEIN public-Use; ausschließlich Test-Brücke (Convention analog
  // Modul 08 _clearOutbox, Modul 15 clear). Tab-Reload erreicht das
  // gleiche, aber Panel-Test braucht Reset ohne Reload.
  function _resetMycelConnectedForTest() {
    mycelConnected = false;
    mycelConnectedAt = null;
    if (stufenwechselTimeoutId !== null) {
      clearTimeout(stufenwechselTimeoutId);
      stufenwechselTimeoutId = null;
    }
    if (badgeElement && badgeElement.classList) {
      try { badgeElement.classList.remove("stufenwechsel-gold"); } catch (_e) { /* nb */ }
    }
    applyStufeToBadge();
    if (modalOpen) {
      try { renderModalContents(); } catch (err) { warn("Modal-Refresh nach _resetMycelConnectedForTest fehlgeschlagen.", err); }
    }
  }

  var SbkimSiegel = {
    init:                init,
    isCertified:         isCertified,
    getExplanation:      getExplanation,
    getCertifiedModules: getCertifiedModules,
    getAspects:          getAspects,
    _resetMycelConnectedForTest: _resetMycelConnectedForTest,
    _meta: {
      badgeId:           BADGE_ID,
      modalId:           MODAL_ID,
      defaultSelector:   DEFAULT_BADGE_SELECTOR,
      get ready()             { return ready; },
      get firstBootShown()    { return firstBootShown; },
      get certifiedAt()       { return certifiedAt; },
      get pflichtModuleSpec() { return snapshotPflichtModuleSpec(); },
      get badgeMounted()      { return badgeElement !== null; },
      get badgeCreatedByModule() { return badgeCreatedByModule; },
      get modalMounted()      { return modalMounted; },
      get modalOpen()         { return modalOpen; },
      get visibleMode()       { return visibleMode; },
      get mountModalFlag()    { return mountModalFlag; },
      get badgeSelector()     { return badgeSelector; },
      get ribbonText()        { return effectiveRibbonText(); },
      get andockToolEnabled() { return andockToolEnabled; },
      // Sub (e) Bronze/Gold-Stufung (Karte 16 § Sub (e)).
      get mycelConnected()    { return mycelConnected; },
      get mycelConnectedAt()  { return mycelConnectedAt; },
      get siegelStufe()       { return siegelStufe(); },
    },
  };

  global.SbkimSiegel = SbkimSiegel;

  // Self-check (synchron, beim Skript-Laden — vor jedem Aufruf).
  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 16 SIEGEL bereit, Funktionen: init/isCertified/getExplanation/getCertifiedModules/getAspects",
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
