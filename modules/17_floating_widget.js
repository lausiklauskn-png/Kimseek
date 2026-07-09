/*
 * SBKIM — Modul 17 — Floating-Widget
 *
 * Vier-Slot-Live-Status-Dashboard als Endknoten-Standard-Render-Schicht
 * für die Pflicht-Module 02 (LEBT) / 05 + 15 Sub (b) (VERKEHR) /
 * 15 Sub (e) (FREMD) / 16 (SIEGEL). Bau-Sitzung 17 vom 2026-05-25
 * implementiert die Karte 17 § Vier-Slot-Layout + § Event-Bus-Schema.
 *
 *   - Self-mountende Pille in document.body (kein Shadow-DOM in Stufe 1).
 *   - Standalone-CSS via <style>-Element bei init() ans Ende von <head>.
 *   - Vier Slots LEBT/VERKEHR/FREMD/SIEGEL (SIEGEL nur wenn isCertified()).
 *   - Drag via Pointer-Events (Touch + Maus), 5 px Threshold; X-Knopf.
 *   - localStorage-persistierte Visible + Position (UX-Preferences).
 *   - Fünf Event-Listener auf window:
 *       sbkim:alive            → LEBT pulsiert
 *       sbkim:handshake        → VERKEHR pulst + Mini-Log (FIFO 10)
 *       sbkim:postmessage      → VERKEHR pulst + Mini-Log
 *       sbkim:fremd-alert      → FREMD dauer-rot + Puls
 *       sbkim:siegel-certified → SIEGEL ins DOM mounten, First-Boot-Animation
 *   - Modal-Bridge für FREMD/SIEGEL via Proxy-Click auf #lamp-fremd /
 *     #sbkim-siegel-badge (Option 1 aus Brief, „Proxy-DOM-Element im
 *     Widget"). Widget erzeugt diese IDs unsichtbar in seinem Inneren —
 *     Modul 15/16 müssen ihre Click-Handler dort attachen, daher MUSS
 *     SbkimWidget.init() VOR SbkimMembrane.init() / SbkimSiegel.init()
 *     im Endknoten-Andocker stehen.
 *   - LEBT- und VERKEHR-Modals baut Modul 17 selbst (eigenständige Modals
 *     in document.body, kein Modul-15-/16-Reuse).
 *   - KEINE benannten Error-Klassen — Render-Schicht, fail-soft via
 *     console.warn (analog Modul 15/16).
 *   - KEIN IndexedDB-Schreiber, KEIN Netz-Pfad, KEIN Protokoll-Bump.
 *
 * Public surface (registered on window.SbkimWidget):
 *   init(options?)      -> Promise<void>   (idempotent)
 *   show()              -> void            (sync)
 *   hide()              -> void            (sync)
 *   isVisible()         -> boolean         (sync, aus DOM-State)
 *   getPosition()       -> PositionSnapshot (sync, defensive Kopie)
 *
 * options-Form siehe Karte 17 § Schnittstelle + INTERFACES.md § 1 Modul 17.
 *
 * Self-check: emits a console.info line on script load (synchronous,
 * before any call). Siehe INTERFACES.md §1 Modul 17 und
 * docs/components/17_floating_widget.md.
 */
(function (global) {
  "use strict";

  // ---- Konstanten ----

  var WIDGET_ID = "sbkim-widget";
  var STYLE_ID = "sbkim-widget-style";
  var LEBT_MODAL_ID = "sbkim-widget-lebt-modal";
  var VERKEHR_MODAL_ID = "sbkim-widget-verkehr-modal";

  var DEFAULT_Z_INDEX = 9990;
  var DEFAULT_CORNER = "bottom-right";
  var DEFAULT_OFFSET = { x: 16, y: 16 };
  var DRAG_THRESHOLD_PX = 5;
  var FIRST_BOOT_ANIMATION_MS = 600;
  var VERKEHR_PULSE_MS = 600;
  var FREMD_PULSE_MS = 600;
  var TRAFFIC_LOG_MAX = 10;
  var MOUNT_OBSERVER_TIMEOUT_MS = 10000;
  var SHOW_WARN_THROTTLE_MS = 60000;
  // Pflege 17 Heartbeat 2026-05-26: Self-Heartbeat-Fallback für LEBT.
  // Wenn 5 s nach `init()` kein `sbkim:alive`-Event eingegangen ist UND
  // `window.SbkimSpore._meta.ready === true`, dispatcht Modul 17 selbst
  // ein synthetisches `sbkim:alive` mit `nodeId:null` und `synthetic:true`-
  // Marker. Anti-Greenwashing intakt: das Modul-02-`init()`-Lauf IST ein
  // realer Event — die Lampe leuchtet nur, wenn Modul 02 tatsächlich
  // geladen + initialisiert ist. Für Endknoten-PWAs, die keinen explizit
  // `getOrCreateIdentity()`-Aufruf im Init-Pfad haben (Identität wird erst
  // beim Andock-Wizard erzeugt).
  var SELF_HEARTBEAT_DELAY_MS = 5000;

  // localStorage-Schlüssel (Karte 17 § Persistenz / § localStorage-Schema).
  // Pflege 17 UX 2026-05-25: dritter Schlüssel `sbkim_widget_minimized`
  // für den Drei-Zustand-Pfad full / minimized / hidden.
  var LS_KEY_VISIBLE = "sbkim_widget_visible";
  var LS_KEY_POSITION = "sbkim_widget_position";
  var LS_KEY_MINIMIZED = "sbkim_widget_minimized";

  // Custom-Event-Namen (Karte 17 § Event-Bus-Schema).
  var EVENT_ALIVE = "sbkim:alive";
  var EVENT_HANDSHAKE = "sbkim:handshake";
  var EVENT_POSTMESSAGE = "sbkim:postmessage";
  var EVENT_FREMD_ALERT = "sbkim:fremd-alert";
  var EVENT_SIEGEL_CERTIFIED = "sbkim:siegel-certified";
  // Stufe 2 (2026-06-27): Auto-Lauschen am Nostr-Relais. `sbkim:nostr-listening`
  // {active:true} → VERKEHR leuchtet ruhig grün ("am Relais verbunden, lauscht");
  // {active:false} → aus. Echter Handschlag pulst weiterhin obendrauf.
  var EVENT_NOSTR_LISTENING = "sbkim:nostr-listening";

  // Slot-IDs (Karte 17 § Vier-Slot-Layout).
  var ALL_SLOTS = ["lebt", "verkehr", "fremd", "siegel"];

  // Pflege 17 UX 2026-05-25: volle Tooltip-Texte (Touch-Devices zeigen
  // sie nicht direkt, aber Desktop-Hover + Reader-Modus + Screenreader
  // nutzen sie). Klick-Modals geben den Kontext am Touch-Tablet.
  var SLOT_TOOLTIPS = {
    lebt:    "LEBT — Page lebt seit init() (Modul 02 Spore). Klick öffnet Status-Modal.",
    verkehr: "VERKEHR — grün = am Relais verbunden, lauscht (Empfangsmodus, antwortet nur). Pulst bei Handschlag (Modul 05) / postMessage (Modul 15). Klick öffnet Mini-Log.",
    fremd:   "FREMD — Fremdzugriff-Buffer (Modul 15 Sub e). Rot wenn Buffer nicht leer. Klick öffnet Modul-15-Modal.",
    siegel:  "SBKIM-Siegel — Modul 16 Self-Inscribing-Bezeugung. Klick öffnet Aspekte-Modal.",
  };

  // Pflege 17 UX 2026-05-25 (Klaus-Wunsch: 1:1 Sage-Page-Stil):
  // Text-Labels neben den Lampen. Klein-geschrieben wie auf der
  // Sage-Page (`<span class="lamp-label">lebt</span>` etc.).
  var SLOT_LABELS = {
    lebt:    "lebt",
    verkehr: "verkehr",
    fremd:   "fremd",
    siegel:  "siegel",
  };

  // Sage-Page-Stil-Anker: Tafel siehe index.html § :root + .lamps + .lamp.
  // 9 px Lampen in einer Pill mit border-radius:999px + Glow + Atmung.

  // Proxy-IDs für Modal-Bridge (Brief § Modal-Bridge Option 1).
  var PROXY_LAMP_FREMD_ID = "lamp-fremd";
  var PROXY_SIEGEL_BADGE_ID = "sbkim-siegel-badge";

  // Erlaubte Corner-Werte (Karte 17 § Schnittstelle).
  var ALLOWED_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];
  var ALLOWED_THEMES = ["auto", "dark", "light", "transparent"];

  // Pflege 17 Stufen-Render 2026-05-26 (Sub-(e)-Sichttest-Befund 1):
  // Sichtbarer SIEGEL-Slot bekommt `data-siegel-stufe`-Attribut, damit
  // Bronze (im Mycel, ruhend) vs. Gold (im Mycel, aktiv) visuell unterscheidbar
  // wird. Modul 16 setzt `data-stufe` am unsichtbaren Proxy-Span — das
  // griff bisher nur am Proxy, nicht am sichtbaren Slot-Button.
  var SIEGEL_STUFE_BRONZE = "bronze";
  var SIEGEL_STUFE_GOLD = "gold";
  var SIEGEL_STUFENWECHSEL_MS = 600;

  // ---- Modul-Zustand (Closure) ----

  var ready = false;
  var widgetRoot = null;
  var styleElement = null;
  var enabledSlots = ALL_SLOTS.slice();
  var slotElements = {};       // slotId → DOM-Element (oder null)
  var siegelMounted = false;
  var firstBootShown = false;

  // Position + Sichtbarkeit (localStorage-persistiert).
  var currentCorner = DEFAULT_CORNER;
  var currentOffsetX = DEFAULT_OFFSET.x;
  var currentOffsetY = DEFAULT_OFFSET.y;
  var currentFreeX = null;     // wenn Free-Drag aktiv: abs. px von links
  var currentFreeY = null;     // wenn Free-Drag aktiv: abs. px von oben
  var visibleFlag = true;
  // Pflege 17 UX 2026-05-25: dritter Sichtbarkeits-Zustand „minimiert"
  // (nur SIEGEL sichtbar, oder LEBT als Fallback wenn kein SIEGEL).
  // Default false (voll). State-Maschine: full → minimized via minimize();
  // minimized → full via maximize(); jeder Zustand → hidden via hide();
  // hidden → vorheriger Zustand via show().
  var minimizedFlag = false;
  var minimizeBtnEl = null;

  // Options aus init().
  var optAllowClose = true;
  var optAllowDrag = true;
  var optRememberHidden = true;
  var optZIndex = DEFAULT_Z_INDEX;
  var optTheme = "auto";

  // VERKEHR-Mini-Log (RAM-only FIFO 10).
  var trafficLog = [];

  // Event-Counts (für _meta-Anker).
  var eventCounts = {
    alive: 0,
    handshake: 0,
    postmessage: 0,
    fremdAlert: 0,
    siegelCertified: 0,
  };

  // Stufe 2: lauscht der Knoten gerade am Nostr-Relais? Hält VERKEHR ruhig
  // grün, auch ohne aktuellen Verkehr (Dauerzustand "Empfangsmodus aktiv").
  var nostrListening = false;

  // Listener-Referenzen (für sauberes Re-Init).
  var listeners = {};
  var pulseTimers = {};        // slotId → setTimeout-Handle
  var dragState = null;        // {pointerId, startX, startY, origX, origY, moved}
  var verkehrModalEl = null;
  var lebtModalEl = null;
  var lebtUptimeTimer = null;
  var lastShowWarnAt = 0;
  var mountObserver = null;
  var mountObserverTimeoutId = null;
  var selfHeartbeatTimerId = null;
  var selfHeartbeatFired = false;
  var lebtSince = null;        // ISO-String, aus sbkim:alive
  var lebtNodeIdPrefix = null; // Erste 12 Zeichen
  var siegelCertifiedAt = null;
  var siegelRepoUrl = null;
  var fremdBufferSize = 0;
  // Pflege 17 Stufen-Render 2026-05-26: was der sichtbare SIEGEL-Slot
  // gerade rendert. null wenn SIEGEL noch nicht gemountet. Sonst
  // "bronze" oder "gold". Diagnose-Anker für _meta.
  var siegelStufeRendered = null;
  var siegelStufenwechselTimerId = null;

  // ---- Hilfsfunktionen ----

  function warn(message, cause) {
    if (typeof console !== "undefined" && console.warn) {
      if (cause !== undefined) console.warn("[SbkimWidget] " + message, cause);
      else console.warn("[SbkimWidget] " + message);
    }
  }

  function safeGetLocalStorage() {
    try {
      return global.localStorage || null;
    } catch (_e) {
      return null;
    }
  }

  function lsGet(key) {
    var ls = safeGetLocalStorage();
    if (!ls) return null;
    try { return ls.getItem(key); }
    catch (_e) { return null; }
  }

  function lsSet(key, value) {
    var ls = safeGetLocalStorage();
    if (!ls) return;
    try { ls.setItem(key, value); }
    catch (_e) { /* fail-soft (Quota, Inkognito) */ }
  }

  function loadVisibleFromLs() {
    if (!optRememberHidden) {
      visibleFlag = true;
      return;
    }
    var raw = lsGet(LS_KEY_VISIBLE);
    if (raw === "false") visibleFlag = false;
    else visibleFlag = true;
  }

  function persistVisible() {
    if (!optRememberHidden) return;
    lsSet(LS_KEY_VISIBLE, visibleFlag ? "true" : "false");
  }

  function loadMinimizedFromLs() {
    var raw = lsGet(LS_KEY_MINIMIZED);
    minimizedFlag = (raw === "true");
  }

  function persistMinimized() {
    lsSet(LS_KEY_MINIMIZED, minimizedFlag ? "true" : "false");
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
    } catch (_e) {
      /* fail-soft — defekter localStorage-Eintrag, Defaults bleiben */
    }
  }

  function persistPosition() {
    var snap = buildPositionSnapshot();
    try {
      lsSet(LS_KEY_POSITION, JSON.stringify(snap));
    } catch (_e) { /* fail-soft */ }
  }

  function buildPositionSnapshot() {
    return {
      corner:  currentCorner,
      offsetX: currentOffsetX,
      offsetY: currentOffsetY,
      x:       currentFreeX,
      y:       currentFreeY,
    };
  }

  function applyPositionToRoot() {
    if (!widgetRoot) return;
    // Reset alle Position-Properties zuerst.
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
    if (corner === "top-left")     { widgetRoot.style.top = oy + "px"; widgetRoot.style.left = ox + "px"; }
    else if (corner === "top-right")    { widgetRoot.style.top = oy + "px"; widgetRoot.style.right = ox + "px"; }
    else if (corner === "bottom-left")  { widgetRoot.style.bottom = oy + "px"; widgetRoot.style.left = ox + "px"; }
    else                                { widgetRoot.style.bottom = oy + "px"; widgetRoot.style.right = ox + "px"; }
  }

  // ---- CSS-Injektion ----

  function buildCss() {
    // Pflege 17 UX 2026-05-25 (Klaus-Wunsch: 1:1 Sage-Page-Stil):
    // Lampen + Text-Labels nebeneinander wie auf der Sage-Page.
    // CSS-Variablen auf `:root` definiert — PWA kann sie via eigenem
    // `:root`-Block überschreiben (Hintergrund/Akzent-Farben/Text-Farbe).
    // Theme-Option `"transparent"` setzt den Hintergrund auf `transparent`
    // (für PWAs mit eigenem Outer-Frame). Default folgt dem Sage-Page-
    // Wert `rgba(0,0,0,0.45)` direkt.
    return [
      "/* SBKIM Modul 17 Floating-Widget — 1:1 Sage-Page-Stil (Pflege UX 2026-05-25). */",
      "/* CSS-Variablen auf :root für PWA-Override. Eigene PWA setzt z.B. */",
      "/*   :root { --sbkim-widget-bg: var(--meine-pwa-card-bg); }       */",
      ":root {",
      "  --sbkim-widget-bg: rgba(0, 0, 0, 0.45);",
      "  --sbkim-widget-fg: #F5F5FF;",
      "  --sbkim-widget-fg-dim: rgba(245, 245, 255, 0.55);",
      "  --sbkim-widget-line: rgba(255, 255, 255, 0.18);",
      "  --sbkim-widget-lamp-bg: rgba(255, 255, 255, 0.12);",
      "  --sbkim-widget-accent-green: #6EE7D3;",
      "  --sbkim-widget-accent-gold: #F4B435;",
      "  --sbkim-widget-accent-red: #DC2626;",
      "  --sbkim-widget-siegel-gold: #C9A961;",
      "  --sbkim-widget-pulse-ms: 600ms;",
      "}",
      // Theme-Override per data-theme-Attribut am Widget-Root.
      "#" + WIDGET_ID + "[data-theme=\"transparent\"] { background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; box-shadow: none; }",
      "#" + WIDGET_ID + "[data-theme=\"light\"] { background: rgba(255, 255, 255, 0.85); color: #1A1A1A; border-color: rgba(0, 0, 0, 0.18); }",
      "#" + WIDGET_ID + "[data-theme=\"light\"] .sbkim-widget-label { color: rgba(0, 0, 0, 0.55); }",
      "#" + WIDGET_ID + " {",
      "  position: fixed;",
      "  z-index: " + optZIndex + ";",
      "  background: var(--sbkim-widget-bg);",
      "  color: var(--sbkim-widget-fg);",
      "  border: 1px solid var(--sbkim-widget-line);",
      "  border-radius: 999px;",
      // Sage-Page-Werte: padding: 0.32rem 0.7rem; gap: 0.45rem
      "  padding: 0.32rem 0.7rem;",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 0.45rem;",
      "  font-family: 'Geist', system-ui, sans-serif;",
      "  font-size: 0.66rem;",
      "  user-select: none;",
      "  -webkit-user-select: none;",
      "  touch-action: none;",
      "  backdrop-filter: blur(8px);",
      "  -webkit-backdrop-filter: blur(8px);",
      "  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);",
      "}",
      "#" + WIDGET_ID + ".sbkim-widget-hidden { display: none; }",
      "#" + WIDGET_ID + ".sbkim-widget-dragging {",
      "  cursor: grabbing;",
      "  transform: scale(1.04);",
      "  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);",
      "}",
      // Slide-Animation für Minimieren/Maximieren (Pflege 17 Slide 2026-05-25):
      // Die transition + max-width + overflow sind auf .sbkim-widget-slot
      // weiter unten als Teil der Default-Regel definiert (single source).
      // Im minimierten Zustand rutschen LEBT/VERKEHR/FREMD sichtbar nach links,
      // schrumpfen auf 0 px Breite und werden unsichtbar — die Pille zieht sich
      // visuell auf SIEGEL (oder LEBT-Fallback) zusammen. Animation 280 ms.
      // Minimierter Zustand: LEBT/VERKEHR/FREMD schieben hinter SIEGEL.
      "#" + WIDGET_ID + "[data-minimized=\"true\"] .sbkim-widget-slot[data-slot=\"lebt\"],",
      "#" + WIDGET_ID + "[data-minimized=\"true\"] .sbkim-widget-slot[data-slot=\"verkehr\"],",
      "#" + WIDGET_ID + "[data-minimized=\"true\"] .sbkim-widget-slot[data-slot=\"fremd\"] {",
      "  max-width: 0;",
      "  opacity: 0;",
      "  margin: 0;",
      "  padding-left: 0;",
      "  padding-right: 0;",
      "  transform: translateX(-20px);",
      "  pointer-events: none;",
      "}",
      // Wenn kein SIEGEL gemountet ist und minimiert, behält LEBT seinen Platz
      // (Fallback). LEBT rutscht NICHT weg.
      "#" + WIDGET_ID + "[data-minimized=\"true\"][data-fallback=\"lebt\"] .sbkim-widget-slot[data-slot=\"lebt\"] {",
      "  max-width: 220px;",
      "  opacity: 1;",
      "  margin: 0;",
      "  padding: 4px 6px;",
      "  transform: translateX(0);",
      "  pointer-events: auto;",
      "}",
      "#" + WIDGET_ID + "[data-minimized=\"true\"][data-fallback=\"lebt\"] .sbkim-widget-slot[data-slot=\"verkehr\"],",
      "#" + WIDGET_ID + "[data-minimized=\"true\"][data-fallback=\"lebt\"] .sbkim-widget-slot[data-slot=\"fremd\"] {",
      "  max-width: 0;",
      "  opacity: 0;",
      "  margin: 0;",
      "  padding-left: 0;",
      "  padding-right: 0;",
      "  transform: translateX(-20px);",
      "  pointer-events: none;",
      "}",
      "#" + WIDGET_ID + " .sbkim-widget-proxy {",
      "  position: absolute;",
      "  width: 1px;",
      "  height: 1px;",
      "  visibility: hidden;",
      "  pointer-events: none;",
      "  overflow: hidden;",
      "}",
      // Slot-Button: Sage-Page-Stil — Lampe + Label nebeneinander.
      // Button-Touch-Target ist die ganze Lampe+Label-Gruppe.
      // max-width + overflow + erweiterte transition für die Slide-Animation
      // beim Minimieren (siehe oben).
      // Pflege CSS-Spezifität 2026-05-26: `#sbkim-widget`-Prefix schlägt
      // PWA-`button { padding: ... }`-User-Agent-Overrides — sonst
      // verschoben sich Lampe + Label durch fremde Button-Defaults.
      "#" + WIDGET_ID + " .sbkim-widget-slot {",
      "  position: relative;",
      "  background: transparent;",
      "  border: none;",
      "  padding: 4px 6px;",
      "  margin: 0;",
      "  cursor: pointer;",
      "  display: inline-flex;",
      "  align-items: center;",
      "  gap: 0.35rem;",
      "  outline: none;",
      "  border-radius: 999px;",
      "  max-width: 220px;",
      // Pflege 17 lamp-breath 2026-05-26: overflow:visible explizit
      // überschreibt Chrome's User-Agent-`button { overflow: hidden }`-
      // Default, sonst clippt der Browser den `::after`-Atmungs-Ring an
      // den Button-Kanten (Klaus' Sichttest: Ring nur als Halbbögen
      // oben/unten sichtbar). overflow:hidden wird nur im minimized-
      // State unten gesetzt.
      "  overflow: visible;",
      "  transition: background 180ms ease, max-width 280ms ease, opacity 220ms ease, margin 280ms ease, padding 280ms ease, transform 280ms ease;",
      "}",
      // overflow:hidden NUR im minimierten Zustand, damit max-width:0 sauber clippt.
      "#" + WIDGET_ID + "[data-minimized=\"true\"] .sbkim-widget-slot {",
      "  overflow: hidden;",
      "}",
      "#" + WIDGET_ID + " .sbkim-widget-slot:hover { background: rgba(255, 255, 255, 0.06); }",
      "#" + WIDGET_ID + " .sbkim-widget-slot:focus-visible {",
      "  outline: 1px solid var(--sbkim-widget-accent-gold);",
      "  outline-offset: 2px;",
      "}",
      // Innere Lampe via ::before — exakt 9 px wie auf der Sage-Page.
      "#" + WIDGET_ID + " .sbkim-widget-slot::before {",
      "  content: \"\";",
      "  display: block;",
      "  width: 9px;",
      "  height: 9px;",
      "  border-radius: 50%;",
      "  background: var(--sbkim-widget-lamp-bg);",
      "  transition: background 0.2s, box-shadow 0.2s;",
      "  flex-shrink: 0;",
      "}",
      // Text-Label rechts neben der Lampe (Sage-Page `.lamp-label`).
      "#" + WIDGET_ID + " .sbkim-widget-label {",
      "  font-family: 'Geist Mono', ui-monospace, monospace;",
      "  font-size: 0.66rem;",
      "  letter-spacing: 0.06em;",
      "  text-transform: uppercase;",
      "  color: var(--sbkim-widget-fg-dim);",
      "  line-height: 1;",
      "  white-space: nowrap;",
      "}",
      // LEBT aktiv: grünes Glow + Atmungs-Ring (Sage-Page `.lamp.alive`).
      // Plus: kontinuierlicher `box-shadow`-Pulse direkt auf der Lampe
      // Pflege 17 CSS-Spezifität 2026-05-26: Atmungs-Ring umgebaut von
      // `.sbkim-widget-slot::after` (Slot-relativ mit hardcoded left:calc(...))
      // auf box-shadow-spread auf `::before` (Lampe-relativ). Vorteil: Ring
      // ist immer um die Lampe zentriert, unabhängig vom Slot-Padding —
      // schützt gegen PWA-`button { padding: ... }`-Overrides (Klaus' MR-
      // Befund: Ring rechtsversetzt + grauer Rand vom button-default).
      // Plus `#sbkim-widget`-Spezifitäts-Prefix schlägt PWA-Klassen-Overrides.
      "#" + WIDGET_ID + " .sbkim-widget-slot.lebt.active::before {",
      "  background: var(--sbkim-widget-accent-green);",
      "  box-shadow:",
      "    0 0 8px rgba(110, 231, 211, 0.7),",
      "    0 0 0 0 rgba(110, 231, 211, 0.6);",
      "  animation: sbkim-widget-lamp-alive-pulse 2.6s ease-in-out infinite;",
      "}",
      "#" + WIDGET_ID + " .sbkim-widget-slot.verkehr.active::before {",
      "  background: var(--sbkim-widget-accent-gold);",
      "  box-shadow: 0 0 6px rgba(244, 180, 53, 0.55);",
      "}",
      "#" + WIDGET_ID + " .sbkim-widget-slot.verkehr.verkehr-pulse::before {",
      "  animation: sbkim-widget-lamp-pulse var(--sbkim-widget-pulse-ms) ease-out;",
      "}",
      "#" + WIDGET_ID + " .sbkim-widget-slot.fremd.active::before, #" + WIDGET_ID + " .sbkim-widget-slot.fremd.fremd-alert::before {",
      "  background: var(--sbkim-widget-accent-red);",
      "  box-shadow:",
      "    0 0 8px rgba(220, 38, 38, 0.75),",
      "    0 0 0 0 rgba(220, 38, 38, 0.6);",
      "  animation: sbkim-widget-lamp-fremd-breath 3.2s ease-in-out infinite;",
      "}",
      "#" + WIDGET_ID + " .sbkim-widget-slot.fremd.fremd-pulse::before {",
      "  animation: sbkim-widget-lamp-alert-pulse var(--sbkim-widget-pulse-ms) ease-out;",
      "}",
      // Aktive Slots: Label etwas heller anzeigen (Sage-Page-Pattern).
      "#" + WIDGET_ID + " .sbkim-widget-slot.active .sbkim-widget-label, #" + WIDGET_ID + " .sbkim-widget-slot.fremd-alert .sbkim-widget-label {",
      "  color: var(--sbkim-widget-fg);",
      "}",
      // SIEGEL: kleines Gold-Medaillon mit ★ — Sage-Page hat hier ein
      // großes Wappen-SVG (#sbkim-siegel-badge 40 px). Im Widget halten
      // wir es kleiner (22 px), das Wappen-Modal von Modul 16 bleibt das
      // volle Identitäts-Symbol beim Click.
      "#" + WIDGET_ID + " .sbkim-widget-slot.siegel {",
      "  padding: 2px 4px 2px 6px;",
      "}",
      "#" + WIDGET_ID + " .sbkim-widget-slot.siegel::before {",
      "  width: 22px;",
      "  height: 22px;",
      "  border-radius: 50%;",
      "  background: radial-gradient(circle at 35% 30%, #FFE066 0%, var(--sbkim-widget-siegel-gold) 55%, #A67C00 100%);",
      "  border: 1px solid rgba(201, 169, 97, 0.85);",
      "  box-shadow: 0 0 6px rgba(201, 169, 97, 0.5);",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  color: #1A1306;",
      "  font-size: 0.78rem;",
      "  font-weight: 700;",
      "  line-height: 1;",
      "  text-align: center;",
      // Stern-Glyph via ::before-content nicht möglich (würde content="" überschreiben).
      // Stattdessen: das Slot-Element bekommt den ★ als zusätzliches Element. Siehe buildSlotButton.
      "}",
      "#" + WIDGET_ID + " .sbkim-widget-slot.siegel.siegel-first-boot::before {",
      "  animation: sbkim-widget-siegel-first-boot 600ms ease-out;",
      "}",
      // Pflege 17 Stufen-Render 2026-05-26 (Sub-(e)-Sichttest-Befund 1):
      // Bronze („im Mycel, ruhend") = Surface-Check grün, aber noch kein
      // Cross-Knoten-Handshake; Gold („im Mycel, aktiv") = mind. ein
      // sbkim:handshake outcome:"established" empfangen. Spiegelt das
      // Spec-Pattern aus index.html § Sub (e) (dort wirkt der Filter am
      // 40 px Wappen-SVG; hier am 22 px Gold-Medaillon + ★-Glyph).
      "#" + WIDGET_ID + " .sbkim-widget-slot.siegel[data-siegel-stufe=\"bronze\"]::before,",
      "#" + WIDGET_ID + " .sbkim-widget-slot.siegel[data-siegel-stufe=\"bronze\"] .sbkim-widget-siegel-glyph {",
      "  filter: saturate(0.6) brightness(0.85);",
      "}",
      "#" + WIDGET_ID + " .sbkim-widget-slot.siegel[data-siegel-stufe=\"bronze\"]:hover::before {",
      "  filter: saturate(0.6) brightness(0.85);",
      "  box-shadow: 0 0 8px rgba(140, 110, 47, 0.55);",
      "}",
      "#" + WIDGET_ID + " .sbkim-widget-slot.siegel[data-siegel-stufe=\"gold\"] { /* Default-Render — keine Override */ }",
      // Bronze→Gold-Animation 600 ms (analog index.html § siegel-stufenwechsel-gold).
      "#" + WIDGET_ID + " .sbkim-widget-slot.siegel.sbkim-widget-siegel-stufenwechsel::before {",
      "  animation: sbkim-widget-siegel-stufenwechsel-gold 600ms ease-out;",
      "}",
      "@keyframes sbkim-widget-siegel-stufenwechsel-gold {",
      "  0%   { transform: scale(1.00); box-shadow: 0 0 0 0 rgba(201, 169, 97, 0.55); }",
      "  40%  { transform: scale(1.15); box-shadow: 0 0 18px 4px rgba(201, 169, 97, 0.55); }",
      "  100% { transform: scale(1.00); box-shadow: 0 0 6px rgba(201, 169, 97, 0.5); }",
      "}",
      // Stern-Glyph zentriert über der Lampe-::before (per absoluten Span).
      "#" + WIDGET_ID + " .sbkim-widget-siegel-glyph {",
      "  position: absolute;",
      "  left: 6px;",                 // selber Wert wie padding-left vom Slot
      "  top: 50%;",
      "  transform: translateY(-50%);",
      "  width: 22px;",
      "  height: 22px;",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  color: #1A1306;",
      "  font-size: 0.78rem;",
      "  font-weight: 700;",
      "  line-height: 1;",
      "  pointer-events: none;",
      "}",
      // Atmungs-Ring auf .sbkim-widget-slot.{lebt,fremd}.active::after.
      // Beachte: die ::after-Regeln nutzen `top:50%; transform:translateY(-50%);`
      // Pflege 17 CSS-Spezifität 2026-05-26: Atmungs-Ring jetzt als
      // box-shadow-Spread auf `::before` (Lampe selbst). Box-shadow-
      // Position ist immer relativ zur Lampe — robust gegen PWA-CSS-
      // Konflikte (Slot-Padding-Overrides hätten sonst den `::after`-
      // left:calc(...) verschoben).
      // LEBT: ein-und-aus mit fade-in beim 100%-Ende (smooth loop).
      "@keyframes sbkim-widget-lamp-alive-pulse {",
      "  0%, 100% {",
      "    box-shadow:",
      "      0 0 8px rgba(110, 231, 211, 0.7),",
      "      0 0 0 0 rgba(110, 231, 211, 0.6);",
      "  }",
      "  50% {",
      "    box-shadow:",
      "      0 0 8px rgba(110, 231, 211, 0.7),",
      "      0 0 0 6px rgba(110, 231, 211, 0);",
      "  }",
      "}",
      // FREMD: dauer-rotes Glow + Atmungs-Ring analog LEBT, aber rot.
      "@keyframes sbkim-widget-lamp-fremd-breath {",
      "  0%, 100% {",
      "    box-shadow:",
      "      0 0 8px rgba(220, 38, 38, 0.75),",
      "      0 0 0 0 rgba(220, 38, 38, 0.6);",
      "  }",
      "  50% {",
      "    box-shadow:",
      "      0 0 8px rgba(220, 38, 38, 0.75),",
      "      0 0 0 6px rgba(220, 38, 38, 0);",
      "  }",
      "}",
      "@keyframes sbkim-widget-lamp-pulse {",
      "  0% { box-shadow: 0 0 0 0 rgba(244, 180, 53, 0.7); transform: scale(1); }",
      "  50% { transform: scale(1.45); }",
      "  100% { box-shadow: 0 0 0 10px rgba(244, 180, 53, 0); transform: scale(1); }",
      "}",
      "@keyframes sbkim-widget-lamp-alert-pulse {",
      "  0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.75); transform: scale(1); }",
      "  50% { transform: scale(1.45); }",
      "  100% { box-shadow: 0 0 0 10px rgba(220, 38, 38, 0); transform: scale(1); }",
      "}",
      "@keyframes sbkim-widget-siegel-first-boot {",
      "  0% { transform: scale(0.6); opacity: 0; }",
      "  60% { transform: scale(1.2); opacity: 1; }",
      "  100% { transform: scale(1); opacity: 1; }",
      "}",
      // Minimize-/Close-Knöpfe: kleine Icon-Buttons rechts. Touch-Größe 18 px.
      "#" + WIDGET_ID + " .sbkim-widget-btn {",
      "  width: 18px;",
      "  height: 18px;",
      "  border-radius: 50%;",
      "  background: rgba(255, 255, 255, 0.08);",
      "  color: var(--sbkim-widget-fg);",
      "  border: 1px solid var(--sbkim-widget-line);",
      "  cursor: pointer;",
      "  font-size: 0.62rem;",
      "  line-height: 1;",
      "  padding: 0;",
      "  display: inline-flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  opacity: 0.55;",
      "  transition: opacity 0.18s, background 0.18s;",
      "  margin-left: 2px;",
      "}",
      "#" + WIDGET_ID + " .sbkim-widget-btn:hover { opacity: 1; background: rgba(255, 255, 255, 0.15); }",
      "#" + WIDGET_ID + " .sbkim-widget-close { color: #F5C4C4; }",
      ".sbkim-widget-modal {",
      "  position: fixed;",
      "  inset: 0;",
      "  z-index: 9999;",
      "  display: none;",
      "  align-items: center;",
      "  justify-content: center;",
      "  font-family: 'Geist', system-ui, sans-serif;",
      "}",
      ".sbkim-widget-modal[data-open=\"true\"] { display: flex; }",
      ".sbkim-widget-modal-backdrop {",
      "  position: absolute;",
      "  inset: 0;",
      "  background: rgba(0, 0, 0, 0.62);",
      "}",
      ".sbkim-widget-modal-panel {",
      "  position: relative;",
      "  background: #10102A;",
      "  color: #F5F5FF;",
      "  border: 1px solid rgba(255, 255, 255, 0.18);",
      "  border-radius: 12px;",
      "  padding: 1.2rem 1.4rem;",
      "  max-width: min(540px, 92vw);",
      "  max-height: 80vh;",
      "  overflow: auto;",
      "  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);",
      "}",
      ".sbkim-widget-modal-header {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 0.8rem;",
      "  margin-bottom: 0.9rem;",
      "}",
      ".sbkim-widget-modal-title {",
      "  margin: 0;",
      "  font-size: 1rem;",
      "  font-weight: 600;",
      "  flex: 1;",
      "}",
      ".sbkim-widget-modal-close {",
      "  background: transparent;",
      "  color: #F5F5FF;",
      "  border: 1px solid rgba(255, 255, 255, 0.18);",
      "  border-radius: 8px;",
      "  padding: 0.25rem 0.6rem;",
      "  cursor: pointer;",
      "}",
      ".sbkim-widget-traffic-table {",
      "  width: 100%;",
      "  border-collapse: collapse;",
      "  font-size: 0.78rem;",
      "  font-family: 'Geist Mono', ui-monospace, monospace;",
      "}",
      ".sbkim-widget-traffic-table th,",
      ".sbkim-widget-traffic-table td {",
      "  text-align: left;",
      "  padding: 0.3rem 0.4rem;",
      "  border-bottom: 1px solid rgba(255, 255, 255, 0.08);",
      "}",
      ".sbkim-widget-lebt-grid {",
      "  display: grid;",
      "  grid-template-columns: max-content 1fr;",
      "  gap: 0.4rem 0.9rem;",
      "  font-size: 0.86rem;",
      "  font-family: 'Geist Mono', ui-monospace, monospace;",
      "}",
      ".sbkim-widget-lebt-grid dt { color: var(--sbkim-widget-fg-dim, rgba(245,245,255,0.55)); }",
      ".sbkim-widget-lebt-grid dd { margin: 0; }",
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

  function buildSlotButton(doc, slotId) {
    // Pflege 17 UX 2026-05-25 (Klaus-Wunsch 1:1 Sage-Page-Stil):
    // Slot = Lampe (::before-Pseudo, 9 px) + Text-Label (kleingeschrieben,
    // monospace, dimmed). SIEGEL bekommt zusätzlich ein zentriertes
    // ★-Span über der Lampe-::before (kann CSS pseudo nicht setzen, wenn
    // content="" für die Lampe genutzt wird).
    var btn = doc.createElement("button");
    btn.type = "button";
    btn.id = "sbkim-widget-slot-" + slotId;
    btn.className = "sbkim-widget-slot " + slotId;
    btn.setAttribute("data-slot", slotId);
    btn.setAttribute("aria-label", SLOT_TOOLTIPS[slotId] || slotId);
    // Pflege 17 Tooltips 2026-05-26 (Klaus' Sichttest-Befund DeX-Chrome):
    // Browser-Standard-`title`-Tooltip auf rechten Slots (FREMD/SIEGEL/
    // Minimize/Close) zeigte sich doppelt auf Touch-Devices (Browser-
    // Tooltip via title + Android-Touch-Action-Bubble). Fix: title-Attribut
    // weggelassen, aria-label trägt den Tooltip-Text weiter für A11y +
    // Screenreader. Tap öffnet das jeweilige Modal — das ist der Kontext-
    // Pfad am Touch-Tablet.
    if (slotId === "siegel") {
      // ★-Glyph zentriert auf der Gold-Lampe (Idee Klaus 2026-05-25:
      // SIEGEL wird später als Tool-PWA-Container für Andocken + Sporen-
      // Installation gestaltet — Spec-Notiz für eigene Folge-Sitzung).
      var glyph = doc.createElement("span");
      glyph.className = "sbkim-widget-siegel-glyph";
      glyph.textContent = "★";
      glyph.setAttribute("aria-hidden", "true");
      btn.appendChild(glyph);
    }
    var label = doc.createElement("span");
    label.className = "sbkim-widget-label";
    label.textContent = SLOT_LABELS[slotId] || slotId;
    btn.appendChild(label);
    return btn;
  }

  function buildProxyContainer(doc) {
    var proxy = doc.createElement("div");
    proxy.className = "sbkim-widget-proxy";
    proxy.setAttribute("aria-hidden", "true");
    // Brief § Modal-Bridge Option 1: Widget legt unsichtbare Spans
    // <span id="lamp-fremd"> + <span id="sbkim-siegel-badge"> in seinem
    // Inneren an. Modul 15/16 attachen ihre Click-Handler dort, sobald
    // ihre init() läuft. Voraussetzung: SbkimWidget.init() läuft VOR
    // SbkimMembrane.init() / SbkimSiegel.init() im Endknoten.
    var fremdSpan = doc.createElement("span");
    fremdSpan.id = PROXY_LAMP_FREMD_ID;
    proxy.appendChild(fremdSpan);
    var siegelSpan = doc.createElement("span");
    siegelSpan.id = PROXY_SIEGEL_BADGE_ID;
    proxy.appendChild(siegelSpan);
    return proxy;
  }

  function buildWidget(doc) {
    var root = doc.createElement("div");
    root.id = WIDGET_ID;
    root.className = "sbkim-widget";
    root.setAttribute("role", "complementary");
    root.setAttribute("aria-label", "SBKIM Live-Status-Widget");
    // Pflege 17 UX 2026-05-25: Theme via data-theme-Attribut. Default "auto"
    // setzt das Attribut NICHT (gesteuert via :root-CSS-Variablen). Andere
    // Werte ("transparent", "light", "dark") aktivieren spezifische CSS-Regeln.
    if (optTheme && optTheme !== "auto") {
      root.setAttribute("data-theme", optTheme);
    }

    // Slots in der Reihenfolge ALL_SLOTS, gefiltert via enabledSlots.
    slotElements = {};
    for (var i = 0; i < ALL_SLOTS.length; i++) {
      var slotId = ALL_SLOTS[i];
      if (enabledSlots.indexOf(slotId) < 0) {
        slotElements[slotId] = null;
        continue;
      }
      // SIEGEL nur, wenn schon zertifiziert beim init-Zeitpunkt.
      // Sonst wartet siegel auf sbkim:siegel-certified-Event.
      if (slotId === "siegel") {
        if (!isSiegelCertifiedNow()) {
          slotElements[slotId] = null;
          continue;
        }
        var siegelBtn = buildSlotButton(doc, slotId);
        attachSlotClick(siegelBtn, slotId);
        root.appendChild(siegelBtn);
        slotElements[slotId] = siegelBtn;
        siegelMounted = true;
        // Pflege 17 Stufen-Render 2026-05-26: initial-Stufe-Attribut
        // direkt nach Mount setzen (Modul 16 hat dann bereits init()
        // gelaufen, sonst wären wir nicht in diesem Zweig — fail-soft
        // Default ist "bronze").
        applySiegelStufeToSlot(getSiegelStufe());
        continue;
      }
      var btn = buildSlotButton(doc, slotId);
      attachSlotClick(btn, slotId);
      root.appendChild(btn);
      slotElements[slotId] = btn;
    }

    // Pflege 17 UX 2026-05-25: Minimieren- und Schließen-Knöpfe RECHTS
    // am Pillen-Ende (statt schwebend über der Pille). Sage-Page-Stil:
    // kleine Icon-Buttons, dezent (opacity 0.55), Hover-Aufhellung.
    minimizeBtnEl = doc.createElement("button");
    minimizeBtnEl.type = "button";
    minimizeBtnEl.className = "sbkim-widget-btn sbkim-widget-minimize";
    minimizeBtnEl.setAttribute("aria-label", "Widget minimieren — zeigt nur das SBKIM-Siegel. Erneuter Klick maximiert.");
    // Pflege 17 Tooltips 2026-05-26: kein title-Attribut (siehe buildSlotButton-Kommentar).
    minimizeBtnEl.textContent = minimizedFlag ? "+" : "−";
    minimizeBtnEl.addEventListener("click", function (ev) {
      if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
      if (minimizedFlag) maximize();
      else minimize();
    });
    root.appendChild(minimizeBtnEl);

    if (optAllowClose) {
      var closeBtn = doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "sbkim-widget-btn sbkim-widget-close";
      closeBtn.setAttribute("aria-label", "Widget schließen — wiederherstellbar via SbkimWidget.show()");
      // Pflege 17 Tooltips 2026-05-26: kein title-Attribut.
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", function (ev) {
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        hide();
      });
      root.appendChild(closeBtn);
    }

    // Proxy-Container für #lamp-fremd / #sbkim-siegel-badge.
    root.appendChild(buildProxyContainer(doc));

    // Drag-Handler (wenn allowDrag).
    if (optAllowDrag) {
      attachDragHandlers(root);
    }

    return root;
  }

  function attachSlotClick(btn, slotId) {
    btn.addEventListener("click", function (ev) {
      // Drag-Threshold: wenn ein Drag stattfand, NICHT als Click werten.
      if (dragState && dragState.moved) return;
      if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
      handleSlotClick(slotId);
    });
  }

  // ---- Slot-Klick-Verhalten ----

  function handleSlotClick(slotId) {
    if (slotId === "lebt") {
      openLebtModal();
      return;
    }
    if (slotId === "verkehr") {
      openVerkehrModal();
      return;
    }
    if (slotId === "fremd") {
      proxyClickModalBridge(PROXY_LAMP_FREMD_ID, "Modul 15 (Fremdzugriff)");
      return;
    }
    if (slotId === "siegel") {
      proxyClickModalBridge(PROXY_SIEGEL_BADGE_ID, "Modul 16 (SBKIM-Siegel)");
      return;
    }
  }

  function proxyClickModalBridge(elementId, moduleHint) {
    var doc = global.document;
    if (!doc || typeof doc.querySelectorAll !== "function") {
      warn("document fehlt — Modal-Bridge no-op.");
      return;
    }
    // Suche das #-Element. Bevorzuge ein Element AUSSERHALB des Widgets
    // (echte Sage-Page-Lampe / Modul-15-Modal-Anker), fall back auf das
    // Widget-interne Proxy-Element. So funktioniert die Bridge sowohl
    // im Sage-Page-Setup (echtes #lamp-fremd in Navleiste) als auch im
    // Endknoten-Setup (Proxy-Span im Widget, Modul 15 hat dort
    // Click-Handler attached).
    var candidates = doc.querySelectorAll("#" + elementId);
    var target = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (widgetRoot && widgetRoot.contains(c)) continue;
      target = c;
      break;
    }
    if (!target) {
      // Fallback: Widget-internes Proxy-Element.
      target = doc.getElementById(elementId);
    }
    if (!target) {
      warn("Modal-Bridge no-op: #" + elementId + " nicht im DOM (" + moduleHint + " nicht gemountet?).");
      return;
    }
    try {
      if (typeof target.click === "function") {
        target.click();
      } else if (doc.createEvent) {
        var ev = doc.createEvent("MouseEvents");
        ev.initEvent("click", true, true);
        target.dispatchEvent(ev);
      }
    } catch (err) {
      warn("Modal-Bridge click fehlgeschlagen für #" + elementId, err);
    }
  }

  // ---- Drag-Mechanik ----

  function attachDragHandlers(root) {
    // Pointer-Events: Touch + Maus vereinheitlicht.
    root.addEventListener("pointerdown", onPointerDown);
  }

  function onPointerDown(ev) {
    if (!optAllowDrag || !widgetRoot) return;
    // Drag nur, wenn der Klick AUSSERHALB der Slots + Icon-Buttons landet.
    var target = ev.target;
    if (target && target.classList) {
      if (target.classList.contains("sbkim-widget-slot")) return;
      if (target.classList.contains("sbkim-widget-btn")) return;
      if (target.classList.contains("sbkim-widget-close")) return;
      if (target.classList.contains("sbkim-widget-minimize")) return;
    }
    var rect = widgetRoot.getBoundingClientRect();
    dragState = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      moved: false,
    };
    try { widgetRoot.setPointerCapture(ev.pointerId); }
    catch (_e) { /* fail-soft: manche Browser werfen */ }
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
      try { widgetRoot.classList.add("sbkim-widget-dragging"); }
      catch (_e) { /* nb */ }
    }
    try {
      var newX = dragState.origLeft + dx;
      var newY = dragState.origTop + dy;
      // Verhindern, dass das Widget komplett aus dem Viewport rutscht.
      var vw = global.innerWidth || 1024;
      var vh = global.innerHeight || 768;
      var rect = widgetRoot.getBoundingClientRect();
      var minX = -rect.width + 24;          // 24 px immer sichtbar
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
      // Drag-Pointer-Event-Fehler (Karte 17 § Fehlerverhalten): Drag
      // abbrechen, Position springt zurück zur Last-Known-Good (durch
      // den nächsten applyPositionToRoot-Aufruf in onPointerUp).
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
      try { widgetRoot.classList.remove("sbkim-widget-dragging"); }
      catch (_e) { /* nb */ }
      widgetRoot.removeEventListener("pointermove", onPointerMove);
      widgetRoot.removeEventListener("pointerup", onPointerUp);
      widgetRoot.removeEventListener("pointercancel", onPointerUp);
    }
    if (moved) {
      persistPosition();
    }
    // Nach kurzer Verzögerung dragState zurücksetzen, damit der pending
    // Click-Handler den `moved`-Flag noch lesen kann.
    var consumed = dragState;
    setTimeout(function () {
      if (dragState === consumed) dragState = null;
    }, 0);
  }

  // ---- Mount in body (mit MutationObserver-Fallback analog Modul 00/16) ----

  function mountWidget() {
    var doc = global.document;
    if (!doc) {
      warn("document fehlt — Widget kann nicht gemountet werden.");
      return;
    }
    injectStyle(doc);
    if (!doc.body) {
      setupMountObserver(doc);
      return;
    }
    if (widgetRoot && widgetRoot.parentNode === doc.body) return; // idempotent
    if (widgetRoot && widgetRoot.parentNode) {
      try { widgetRoot.parentNode.removeChild(widgetRoot); }
      catch (_e) { /* nb */ }
    }
    widgetRoot = buildWidget(doc);
    doc.body.appendChild(widgetRoot);
    applyPositionToRoot();
    applyVisibility();
    applyMinimizedState();
    applySlotActiveStatesFromCounts();
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
      if (doc.body) {
        disconnectMountObserver();
        mountWidget();
      }
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
        warn("document.body auch nach " + MOUNT_OBSERVER_TIMEOUT_MS + " ms nicht erschienen — Widget-Mount übersprungen.");
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
    if (visibleFlag) widgetRoot.classList.remove("sbkim-widget-hidden");
    else widgetRoot.classList.add("sbkim-widget-hidden");
  }

  function applyMinimizedState() {
    // Pflege 17 UX 2026-05-25: setzt data-minimized + data-fallback am Root.
    // CSS regelt das Ausblenden der anderen Slots. Wenn SIEGEL nicht gemountet
    // ist (kein Modul 16), fallback auf LEBT als sichtbarer Marker.
    if (!widgetRoot) return;
    if (minimizedFlag) {
      widgetRoot.setAttribute("data-minimized", "true");
      if (!siegelMounted) {
        widgetRoot.setAttribute("data-fallback", "lebt");
      } else {
        widgetRoot.removeAttribute("data-fallback");
      }
    } else {
      widgetRoot.removeAttribute("data-minimized");
      widgetRoot.removeAttribute("data-fallback");
    }
    if (minimizeBtnEl) {
      minimizeBtnEl.textContent = minimizedFlag ? "+" : "−";
      // Pflege 17 Tooltips 2026-05-26: aria-label trägt Tooltip-Text;
      // title-Attribut weggelassen (Touch-Devices zeigten doppel-Tooltips).
      minimizeBtnEl.setAttribute(
        "aria-label",
        minimizedFlag
          ? "Widget maximieren — zeigt alle vier Slots."
          : "Widget minimieren — zeigt nur das SBKIM-Siegel. Erneuter Klick maximiert."
      );
      // Idempotent: removeAttribute ist no-op wenn nicht gesetzt.
      try { minimizeBtnEl.removeAttribute("title"); }
      catch (_e) { /* nb */ }
    }
  }

  function applySlotActiveStatesFromCounts() {
    // Wenn Widget nach init() neu gemountet wird (z.B. via show() nach
    // hide()), zeigt die aktuelle counts-Map welche Slots aktiv sind.
    if (eventCounts.alive > 0) setSlotActive("lebt", true);
    if (eventCounts.handshake + eventCounts.postmessage > 0 || nostrListening) setSlotActive("verkehr", true);
    if (fremdBufferSize > 0) setSlotActive("fremd", true);
  }

  function setSlotActive(slotId, active) {
    var el = slotElements[slotId];
    if (!el) return;
    if (active) el.classList.add("active");
    else el.classList.remove("active");
  }

  function pulseSlot(slotId, pulseClass, durationMs) {
    var el = slotElements[slotId];
    if (!el) return;
    try {
      el.classList.remove(pulseClass);
      void el.offsetWidth; // reflow → Animation neu starten
      el.classList.add(pulseClass);
      if (pulseTimers[slotId]) clearTimeout(pulseTimers[slotId]);
      pulseTimers[slotId] = setTimeout(function () {
        if (el && el.classList) {
          try { el.classList.remove(pulseClass); }
          catch (_e) { /* nb */ }
        }
        pulseTimers[slotId] = null;
      }, durationMs);
    } catch (err) {
      warn("pulseSlot fehlgeschlagen (" + slotId + ").", err);
    }
  }

  // ---- Event-Listener (window) ----

  // Pflege 17 Heartbeat 2026-05-26: Self-Heartbeat-Fallback für LEBT.
  function scheduleSelfHeartbeat() {
    if (selfHeartbeatTimerId !== null) return;        // idempotent
    if (selfHeartbeatFired) return;
    selfHeartbeatTimerId = setTimeout(function () {
      selfHeartbeatTimerId = null;
      if (eventCounts.alive > 0) {
        // Modul 02 hat schon einen echten `sbkim:alive` gefeuert —
        // Self-Heartbeat nicht mehr nötig.
        return;
      }
      var spore = global.SbkimSpore;
      if (!spore || !spore._meta || spore._meta.ready !== true) {
        // Modul 02 ist NICHT initialisiert — Anti-Greenwashing: keine
        // synthetische LEBT-Aktivierung. LEBT bleibt grau.
        return;
      }
      selfHeartbeatFired = true;
      try {
        if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
          global.dispatchEvent(new global.CustomEvent("sbkim:alive", {
            detail: {
              since:     new Date().toISOString(),
              nodeId:    null,
              synthetic: true,
            },
            bubbles:    false,
            cancelable: false,
          }));
        }
      } catch (_e) { /* fail-soft */ }
    }, SELF_HEARTBEAT_DELAY_MS);
  }

  function registerEventListeners() {
    if (listeners.alive) return; // idempotent
    listeners.alive = function (ev) { onAlive(ev); };
    listeners.handshake = function (ev) { onHandshake(ev); };
    listeners.postmessage = function (ev) { onPostmessage(ev); };
    listeners.fremdAlert = function (ev) { onFremdAlert(ev); };
    listeners.siegelCertified = function (ev) { onSiegelCertified(ev); };
    listeners.nostrListening = function (ev) { onNostrListening(ev); };
    try {
      global.addEventListener(EVENT_ALIVE, listeners.alive);
      global.addEventListener(EVENT_HANDSHAKE, listeners.handshake);
      global.addEventListener(EVENT_POSTMESSAGE, listeners.postmessage);
      global.addEventListener(EVENT_FREMD_ALERT, listeners.fremdAlert);
      global.addEventListener(EVENT_SIEGEL_CERTIFIED, listeners.siegelCertified);
      global.addEventListener(EVENT_NOSTR_LISTENING, listeners.nostrListening);
    } catch (err) {
      warn("Event-Listener-Registrierung fehlgeschlagen — Widget bleibt passiv.", err);
    }
  }

  function onAlive(ev) {
    eventCounts.alive += 1;
    var detail = (ev && ev.detail) || {};
    if (typeof detail.since === "string") lebtSince = detail.since;
    if (typeof detail.nodeId === "string") lebtNodeIdPrefix = detail.nodeId.slice(0, 12);
    setSlotActive("lebt", true);
  }

  // Stufe 2: Auto-Lauschen-Status. VERKEHR ruhig grün, solange der Knoten am
  // Relais lauscht — sichtbar auch ohne aktuellen Verkehr. Echter Handschlag
  // pulst weiterhin über onHandshake. Verkehr bleibt aktiv, solange entweder
  // schon Verkehr gesehen wurde ODER der Lausch-Kanal offen ist.
  function onNostrListening(ev) {
    var detail = (ev && ev.detail) || {};
    nostrListening = (detail.active !== false);
    var hasTraffic = (eventCounts.handshake + eventCounts.postmessage) > 0;
    setSlotActive("verkehr", hasTraffic || nostrListening);
  }

  function onHandshake(ev) {
    eventCounts.handshake += 1;
    var detail = (ev && ev.detail) || {};
    var entry = {
      at:        nowIso(),
      source:    "handshake",
      direction: typeof detail.direction === "string" ? detail.direction : "outgoing",
      decision:  typeof detail.outcome === "string" ? detail.outcome : "",
    };
    pushTrafficLog(entry);
    setSlotActive("verkehr", true);
    pulseSlot("verkehr", "verkehr-pulse", VERKEHR_PULSE_MS);
    refreshVerkehrModalIfOpen();
    // Pflege 17 Stufen-Render 2026-05-26 (Sub-(e)-Sichttest-Befund 1):
    // bei established-Handshake den sichtbaren SIEGEL-Slot von Bronze
    // auf Gold umschalten + 600 ms Stufenwechsel-Animation. Idempotent:
    // wenn schon Gold, no-op (kein Re-Animate-Spam). Slot muss
    // gemountet sein (sonst gibt's nichts zu re-stylen).
    if (detail.outcome === "established" && siegelMounted) {
      if (siegelStufeRendered !== SIEGEL_STUFE_GOLD) {
        applySiegelStufeToSlot(SIEGEL_STUFE_GOLD);
        playSiegelStufenwechselAnimation();
      }
    }
  }

  function onPostmessage(ev) {
    eventCounts.postmessage += 1;
    var detail = (ev && ev.detail) || {};
    var entry = {
      at:        nowIso(),
      source:    "postmessage",
      direction: typeof detail.direction === "string" ? detail.direction : "incoming",
      decision:  typeof detail.decision === "string" ? detail.decision : "",
    };
    pushTrafficLog(entry);
    setSlotActive("verkehr", true);
    pulseSlot("verkehr", "verkehr-pulse", VERKEHR_PULSE_MS);
    refreshVerkehrModalIfOpen();
  }

  function onFremdAlert(ev) {
    eventCounts.fremdAlert += 1;
    var detail = (ev && ev.detail) || {};
    if (typeof detail.bufferSize === "number" && isFinite(detail.bufferSize)) {
      fremdBufferSize = detail.bufferSize;
    } else {
      // Schema-Check fail-soft: ohne bufferSize-Feld bleibt der Slot grau.
      // (Karte 17 § Fehlerverhalten "fremd-alert ohne bufferSize → Slot
      // bleibt grau".) Wir zählen den Event trotzdem.
      return;
    }
    if (fremdBufferSize > 0) {
      setSlotActive("fremd", true);
      pulseSlot("fremd", "fremd-pulse", FREMD_PULSE_MS);
    } else {
      setSlotActive("fremd", false);
    }
  }

  function onSiegelCertified(ev) {
    var detail = (ev && ev.detail) || {};
    // Anti-Greenwashing binär: erst prüfen, ob das Modul 16 wirklich
    // certified meldet (defensive Doppel-Prüfung — Spec-Mandat).
    var siegel = global.SbkimSiegel;
    if (!siegel || typeof siegel.isCertified !== "function" || siegel.isCertified() !== true) {
      warn("sbkim:siegel-certified empfangen, aber SbkimSiegel.isCertified()!==true — Anti-Greenwashing-Klausel: kein DOM-Render.");
      return;
    }
    eventCounts.siegelCertified += 1;
    if (typeof detail.certifiedAt === "string") siegelCertifiedAt = detail.certifiedAt;
    if (typeof detail.repoUrl === "string") siegelRepoUrl = detail.repoUrl;
    mountSiegelSlot();
  }

  function mountSiegelSlot() {
    if (siegelMounted) return;
    if (enabledSlots.indexOf("siegel") < 0) return;
    if (!widgetRoot) return;
    var doc = global.document;
    if (!doc) return;
    var btn = buildSlotButton(doc, "siegel");
    attachSlotClick(btn, "siegel");
    // Pflege 17 SIEGEL-Reihenfolge 2026-05-25: SIEGEL gehört in die Slot-
    // Reihe (LEBT/VERKEHR/FREMD/SIEGEL), VOR den Aktions-Knöpfen Minimize
    // und Close. Bevorzugt einfügen vor minimizeBtnEl, sonst vor Proxy-
    // Container, sonst ans Ende.
    var insertRef = minimizeBtnEl ||
                    widgetRoot.querySelector(".sbkim-widget-proxy");
    if (insertRef && insertRef.parentNode === widgetRoot) {
      widgetRoot.insertBefore(btn, insertRef);
    } else {
      widgetRoot.appendChild(btn);
    }
    slotElements.siegel = btn;
    siegelMounted = true;
    // Pflege 17 Stufen-Render 2026-05-26: initial-Stufe-Attribut direkt
    // nach Mount setzen. Modul 16 hat zu diesem Zeitpunkt
    // `_meta.siegelStufe` gesetzt (Bau 16 Sub e).
    applySiegelStufeToSlot(getSiegelStufe());
    // Pflege 17 UX 2026-05-25: SIEGEL ist jetzt da — wenn das Widget
    // minimiert war (mit data-fallback="lebt"), data-fallback entfernen,
    // damit SIEGEL zum sichtbaren Slot wird.
    if (minimizedFlag) applyMinimizedState();
    // First-Boot-Animation (analog Modul 16 § Sub (b)).
    if (!firstBootShown) {
      try {
        btn.classList.add("siegel-first-boot");
        setTimeout(function () {
          try { btn.classList.remove("siegel-first-boot"); }
          catch (_e) { /* nb */ }
        }, FIRST_BOOT_ANIMATION_MS);
      } catch (err) {
        warn("Siegel-First-Boot-Animation fehlgeschlagen.", err);
      }
      firstBootShown = true;
    }
  }

  function isSiegelCertifiedNow() {
    var siegel = global.SbkimSiegel;
    if (!siegel || typeof siegel.isCertified !== "function") return false;
    try { return siegel.isCertified() === true; }
    catch (_e) { return false; }
  }

  // Pflege 17 Stufen-Render 2026-05-26: lookup auf
  // SbkimSiegel._meta.siegelStufe (Modul-16-Getter aus Bau 16 Sub (e)).
  // Fail-soft Default = "bronze" (sicheres minus). Architektur-Pfad (ii)
  // aus dem Brief — robust gegen Event-Reihenfolge.
  function getSiegelStufe() {
    var siegel = global.SbkimSiegel;
    if (!siegel || !siegel._meta) return SIEGEL_STUFE_BRONZE;
    try {
      var s = siegel._meta.siegelStufe;
      if (s === SIEGEL_STUFE_GOLD) return SIEGEL_STUFE_GOLD;
    } catch (_e) { /* fail-soft */ }
    return SIEGEL_STUFE_BRONZE;
  }

  // Schreibt data-siegel-stufe ans sichtbare Slot-Element. Idempotent +
  // fail-soft. Ruft KEIN Modul 16 auf.
  function applySiegelStufeToSlot(stufe) {
    var el = slotElements.siegel;
    if (!el) return;
    try {
      el.setAttribute("data-siegel-stufe", stufe);
      siegelStufeRendered = stufe;
    } catch (err) {
      warn("data-siegel-stufe konnte nicht gesetzt werden.", err);
    }
  }

  // Bronze→Gold-Stufenwechsel-Animation am sichtbaren Slot (600 ms).
  function playSiegelStufenwechselAnimation() {
    var el = slotElements.siegel;
    if (!el || !el.classList) return;
    try {
      el.classList.add("sbkim-widget-siegel-stufenwechsel");
      if (siegelStufenwechselTimerId !== null) {
        clearTimeout(siegelStufenwechselTimerId);
      }
      siegelStufenwechselTimerId = setTimeout(function () {
        if (el && el.classList) {
          try { el.classList.remove("sbkim-widget-siegel-stufenwechsel"); }
          catch (_e) { /* nb */ }
        }
        siegelStufenwechselTimerId = null;
      }, SIEGEL_STUFENWECHSEL_MS);
    } catch (err) {
      warn("Siegel-Stufenwechsel-Animation fehlgeschlagen.", err);
    }
  }

  function nowIso() { return new Date().toISOString(); }

  function pushTrafficLog(entry) {
    trafficLog.push(entry);
    if (trafficLog.length > TRAFFIC_LOG_MAX) {
      trafficLog.splice(0, trafficLog.length - TRAFFIC_LOG_MAX);
    }
  }

  // ---- LEBT-Modal ----

  function ensureLebtModal() {
    var doc = global.document;
    if (!doc || !doc.body) return null;
    if (lebtModalEl && lebtModalEl.parentNode) return lebtModalEl;

    var root = doc.createElement("div");
    root.id = LEBT_MODAL_ID;
    root.className = "sbkim-widget-modal";
    root.setAttribute("aria-hidden", "true");
    root.style.zIndex = String(optZIndex + 9);

    var backdrop = doc.createElement("div");
    backdrop.className = "sbkim-widget-modal-backdrop";
    backdrop.addEventListener("click", closeLebtModal);

    var panel = doc.createElement("div");
    panel.className = "sbkim-widget-modal-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    var header = doc.createElement("div");
    header.className = "sbkim-widget-modal-header";
    var title = doc.createElement("h2");
    title.className = "sbkim-widget-modal-title";
    title.textContent = "LEBT — Page-Status";
    var closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "sbkim-widget-modal-close";
    closeBtn.setAttribute("aria-label", "Schließen");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", closeLebtModal);
    header.appendChild(title);
    header.appendChild(closeBtn);

    var grid = doc.createElement("dl");
    grid.className = "sbkim-widget-lebt-grid";
    grid.setAttribute("data-widget-lebt-grid", "");

    panel.appendChild(header);
    panel.appendChild(grid);

    root.appendChild(backdrop);
    root.appendChild(panel);
    doc.body.appendChild(root);

    lebtModalEl = root;
    return root;
  }

  function openLebtModal() {
    var modal = ensureLebtModal();
    if (!modal) { warn("LEBT-Modal-Mount fehlgeschlagen (document.body fehlt)."); return; }
    renderLebtModalContents();
    modal.setAttribute("data-open", "true");
    modal.setAttribute("aria-hidden", "false");
    // Uptime-Counter aktualisiert jede Sekunde.
    if (lebtUptimeTimer) clearInterval(lebtUptimeTimer);
    lebtUptimeTimer = setInterval(renderLebtModalContents, 1000);
  }

  function closeLebtModal() {
    if (!lebtModalEl) return;
    lebtModalEl.removeAttribute("data-open");
    lebtModalEl.setAttribute("aria-hidden", "true");
    if (lebtUptimeTimer) { clearInterval(lebtUptimeTimer); lebtUptimeTimer = null; }
  }

  function renderLebtModalContents() {
    if (!lebtModalEl) return;
    var doc = global.document;
    var grid = lebtModalEl.querySelector("[data-widget-lebt-grid]");
    if (!grid) return;
    grid.textContent = "";
    var spore = global.SbkimSpore;
    var moduleReady = !!(spore && spore._meta && typeof spore._meta === "object");
    var uptimeText = "—";
    if (lebtSince) {
      try {
        var start = new Date(lebtSince).getTime();
        var now = Date.now();
        if (isFinite(start) && now >= start) {
          uptimeText = formatUptime(now - start);
        }
      } catch (_e) { /* nb */ }
    }
    var rows = [
      ["Uptime",          uptimeText],
      ["Modul-02 init",   moduleReady ? "ja" : "nein"],
      ["nodeId-Präfix",   lebtNodeIdPrefix || "—"],
      ["Events:alive",    String(eventCounts.alive)],
      ["since (ISO)",     lebtSince || "—"],
    ];
    for (var i = 0; i < rows.length; i++) {
      var dt = doc.createElement("dt");
      dt.textContent = rows[i][0];
      var dd = doc.createElement("dd");
      dd.textContent = rows[i][1];
      grid.appendChild(dt);
      grid.appendChild(dd);
    }
  }

  function formatUptime(ms) {
    var sec = Math.floor(ms / 1000);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    if (h > 0) return h + "h " + pad(m) + "m " + pad(s) + "s";
    if (m > 0) return m + "m " + pad(s) + "s";
    return s + "s";
  }

  // ---- VERKEHR-Modal ----

  function ensureVerkehrModal() {
    var doc = global.document;
    if (!doc || !doc.body) return null;
    if (verkehrModalEl && verkehrModalEl.parentNode) return verkehrModalEl;

    var root = doc.createElement("div");
    root.id = VERKEHR_MODAL_ID;
    root.className = "sbkim-widget-modal";
    root.setAttribute("aria-hidden", "true");
    root.style.zIndex = String(optZIndex + 9);

    var backdrop = doc.createElement("div");
    backdrop.className = "sbkim-widget-modal-backdrop";
    backdrop.addEventListener("click", closeVerkehrModal);

    var panel = doc.createElement("div");
    panel.className = "sbkim-widget-modal-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    var header = doc.createElement("div");
    header.className = "sbkim-widget-modal-header";
    var title = doc.createElement("h2");
    title.className = "sbkim-widget-modal-title";
    title.textContent = "VERKEHR — letzte " + TRAFFIC_LOG_MAX + " Events";
    var closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "sbkim-widget-modal-close";
    closeBtn.setAttribute("aria-label", "Schließen");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", closeVerkehrModal);
    header.appendChild(title);
    header.appendChild(closeBtn);

    var table = doc.createElement("table");
    table.className = "sbkim-widget-traffic-table";
    table.innerHTML =
      "<thead><tr>" +
      "<th>Zeit</th><th>Quelle</th><th>Richtung</th><th>Entscheidung</th>" +
      "</tr></thead><tbody data-widget-verkehr-tbody></tbody>";

    var tip = doc.createElement("p");
    tip.textContent = "RAM-only FIFO — Tab-Reload leert die Liste.";
    tip.style.cssText = "margin: 0.9rem 0 0; font-size: 0.78rem; color: rgba(245,245,255,0.55);";

    panel.appendChild(header);
    panel.appendChild(table);
    panel.appendChild(tip);

    root.appendChild(backdrop);
    root.appendChild(panel);
    doc.body.appendChild(root);

    verkehrModalEl = root;
    return root;
  }

  function openVerkehrModal() {
    var modal = ensureVerkehrModal();
    if (!modal) { warn("VERKEHR-Modal-Mount fehlgeschlagen (document.body fehlt)."); return; }
    renderVerkehrModalContents();
    modal.setAttribute("data-open", "true");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeVerkehrModal() {
    if (!verkehrModalEl) return;
    verkehrModalEl.removeAttribute("data-open");
    verkehrModalEl.setAttribute("aria-hidden", "true");
  }

  function refreshVerkehrModalIfOpen() {
    if (!verkehrModalEl) return;
    if (verkehrModalEl.getAttribute("data-open") !== "true") return;
    renderVerkehrModalContents();
  }

  function renderVerkehrModalContents() {
    if (!verkehrModalEl) return;
    var doc = global.document;
    var tbody = verkehrModalEl.querySelector("[data-widget-verkehr-tbody]");
    if (!tbody) return;
    tbody.textContent = "";
    for (var i = 0; i < trafficLog.length; i++) {
      var entry = trafficLog[i];
      var tr = doc.createElement("tr");
      var cells = [entry.at, entry.source, entry.direction, entry.decision];
      for (var c = 0; c < cells.length; c++) {
        var td = doc.createElement("td");
        td.textContent = cells[c];
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  // Globaler Esc-Handler — schließt alle offenen Widget-Modals.
  function onGlobalKeydown(ev) {
    if (!ev || ev.key !== "Escape") return;
    if (lebtModalEl && lebtModalEl.getAttribute("data-open") === "true") closeLebtModal();
    if (verkehrModalEl && verkehrModalEl.getAttribute("data-open") === "true") closeVerkehrModal();
  }

  // ---- init / show / hide ----

  function parseOptions(options) {
    var opts = (options && typeof options === "object") ? options : {};

    if (typeof opts.zIndex === "number" && isFinite(opts.zIndex)) {
      optZIndex = opts.zIndex;
    }
    if (opts.allowClose === false) optAllowClose = false;
    else optAllowClose = true;
    if (opts.allowDrag === false) optAllowDrag = false;
    else optAllowDrag = true;
    if (opts.rememberHidden === false) optRememberHidden = false;
    else optRememberHidden = true;

    if (typeof opts.theme === "string" && ALLOWED_THEMES.indexOf(opts.theme) >= 0) {
      optTheme = opts.theme;
    }
    // Pflege 17 UX 2026-05-25: Theme via data-theme-Attribut am Widget-Root,
    // damit PWAs ihren eigenen Hintergrund anwenden können. `theme:"transparent"`
    // (NEU) macht den Hintergrund vollständig durchsichtig. Die CSS-Variablen
    // auf `:root` (siehe buildCss) kann die PWA via eigenem `:root`-Block
    // überschreiben — das ist der saubere Weg für Theme-Anpassung.

    if (Array.isArray(opts.slots) && opts.slots.length > 0) {
      var filtered = [];
      for (var i = 0; i < opts.slots.length; i++) {
        var s = opts.slots[i];
        if (typeof s === "string" && ALL_SLOTS.indexOf(s) >= 0 && filtered.indexOf(s) < 0) {
          filtered.push(s);
        }
      }
      if (filtered.length > 0) enabledSlots = filtered;
    } else {
      enabledSlots = ALL_SLOTS.slice();
    }

    // Default-Position aus options übernehmen (wenn kein localStorage-Wert).
    if (typeof opts.defaultCorner === "string" && ALLOWED_CORNERS.indexOf(opts.defaultCorner) >= 0) {
      currentCorner = opts.defaultCorner;
    }
    if (opts.defaultOffset && typeof opts.defaultOffset === "object") {
      if (typeof opts.defaultOffset.x === "number") currentOffsetX = opts.defaultOffset.x;
      if (typeof opts.defaultOffset.y === "number") currentOffsetY = opts.defaultOffset.y;
    }
    // allowedOrigins + repoUrl sind reine Doku-Spiegelung (Karte 17 §
    // Schnittstelle): NICHT durchgereicht an Modul 15/16; Andocker
    // initialisiert die Backends explizit.
  }

  function init(options) {
    if (ready) {
      // Idempotenz: zweiter Aufruf no-op (Karte 17 § Fehlerverhalten).
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      try {
        parseOptions(options);
        loadVisibleFromLs();
        loadPositionFromLs();
        loadMinimizedFromLs();

        mountWidget();
        registerEventListeners();
        try { global.addEventListener("keydown", onGlobalKeydown); }
        catch (_e) { /* nb */ }
        // Pflege 17 Heartbeat 2026-05-26: 5-s-Fallback-Timer starten.
        scheduleSelfHeartbeat();

        ready = true;
      } catch (err) {
        warn("init fehlgeschlagen — Widget bleibt unmontiert.", err);
      }
      resolve();
    });
  }

  function show() {
    if (!ready) {
      var now = Date.now();
      if (now - lastShowWarnAt > SHOW_WARN_THROTTLE_MS) {
        lastShowWarnAt = now;
        warn("show() vor init() — no-op. Erst SbkimWidget.init() aufrufen.");
      }
      return;
    }
    visibleFlag = true;
    persistVisible();
    applyVisibility();
  }

  function hide() {
    if (!ready) {
      var now = Date.now();
      if (now - lastShowWarnAt > SHOW_WARN_THROTTLE_MS) {
        lastShowWarnAt = now;
        warn("hide() vor init() — no-op. Erst SbkimWidget.init() aufrufen.");
      }
      return;
    }
    visibleFlag = false;
    persistVisible();
    applyVisibility();
  }

  function isVisible() {
    if (!widgetRoot) return false;
    try {
      // DOM-State-Wahrheit: Klasse sbkim-widget-hidden steuert display:none.
      return !widgetRoot.classList.contains("sbkim-widget-hidden");
    } catch (_e) {
      return false;
    }
  }

  function getPosition() {
    return buildPositionSnapshot();
  }

  // Pflege 17 UX 2026-05-25: Drei-Zustand-Schnittstelle. minimize() klappt
  // die Pille auf nur den SIEGEL-Slot zusammen (oder LEBT-Fallback wenn
  // kein SIEGEL gemountet). maximize() macht den Voll-Zustand wieder her.
  // hide() / show() bleiben unverändert (komplettes Wegklicken).
  function minimize() {
    if (!ready) {
      var now = Date.now();
      if (now - lastShowWarnAt > SHOW_WARN_THROTTLE_MS) {
        lastShowWarnAt = now;
        warn("minimize() vor init() — no-op.");
      }
      return;
    }
    minimizedFlag = true;
    persistMinimized();
    applyMinimizedState();
  }

  function maximize() {
    if (!ready) {
      var now = Date.now();
      if (now - lastShowWarnAt > SHOW_WARN_THROTTLE_MS) {
        lastShowWarnAt = now;
        warn("maximize() vor init() — no-op.");
      }
      return;
    }
    minimizedFlag = false;
    persistMinimized();
    applyMinimizedState();
  }

  function isMinimized() {
    return minimizedFlag === true;
  }

  // ---- Public Surface ----

  var SbkimWidget = {
    init:        init,
    show:        show,
    hide:        hide,
    isVisible:   isVisible,
    minimize:    minimize,
    maximize:    maximize,
    isMinimized: isMinimized,
    getPosition: getPosition,
    _meta: {
      widgetId:        WIDGET_ID,
      styleId:         STYLE_ID,
      trafficLogMax:   TRAFFIC_LOG_MAX,
      dragThresholdPx: DRAG_THRESHOLD_PX,
      defaultZIndex:   DEFAULT_Z_INDEX,
      lsKeyVisible:    LS_KEY_VISIBLE,
      lsKeyPosition:   LS_KEY_POSITION,
      lsKeyMinimized:  LS_KEY_MINIMIZED,
      events: {
        alive:           EVENT_ALIVE,
        handshake:       EVENT_HANDSHAKE,
        postmessage:     EVENT_POSTMESSAGE,
        fremdAlert:      EVENT_FREMD_ALERT,
        siegelCertified: EVENT_SIEGEL_CERTIFIED,
        nostrListening:  EVENT_NOSTR_LISTENING,
      },
      get ready()          { return ready; },
      get nostrListening() { return nostrListening; },
      get widgetMounted()  { return !!(widgetRoot && widgetRoot.parentNode); },
      get firstBootShown() { return firstBootShown; },
      get siegelMounted()  { return siegelMounted; },
      get minimizedFlag()  { return minimizedFlag; },
      get slots()          { return enabledSlots.slice(); },
      get eventCounts()    {
        return {
          alive:           eventCounts.alive,
          handshake:       eventCounts.handshake,
          postmessage:     eventCounts.postmessage,
          fremdAlert:      eventCounts.fremdAlert,
          siegelCertified: eventCounts.siegelCertified,
        };
      },
      get trafficLogSize() { return trafficLog.length; },
      get trafficLogSnapshot() {
        var copy = [];
        for (var i = 0; i < trafficLog.length; i++) {
          copy.push({
            at:        trafficLog[i].at,
            source:    trafficLog[i].source,
            direction: trafficLog[i].direction,
            decision:  trafficLog[i].decision,
          });
        }
        return copy;
      },
      get fremdBufferSize()    { return fremdBufferSize; },
      get selfHeartbeatFired() { return selfHeartbeatFired; },
      selfHeartbeatDelayMs:    SELF_HEARTBEAT_DELAY_MS,
      get lebtSince()          { return lebtSince; },
      get lebtNodeIdPrefix()   { return lebtNodeIdPrefix; },
      get siegelCertifiedAt()  { return siegelCertifiedAt; },
      get siegelRepoUrl()      { return siegelRepoUrl; },
      // Pflege 17 Stufen-Render 2026-05-26: was der sichtbare SIEGEL-Slot
      // gerade anzeigt ("bronze" | "gold" | null). null = nicht gemountet.
      get siegelStufeRendered() { return siegelStufeRendered; },
      get visibleFlag()        { return visibleFlag; },
      get optAllowClose()      { return optAllowClose; },
      get optAllowDrag()       { return optAllowDrag; },
      get optRememberHidden()  { return optRememberHidden; },
      get optTheme()           { return optTheme; },
      get zIndex()             { return optZIndex; },
    },
  };

  global.SbkimWidget = SbkimWidget;

  // Self-check (synchron, beim Skript-Laden — vor jedem Aufruf).
  // Pflege 17 UX 2026-05-25: minimize/maximize/isMinimized ergänzt.
  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 17 FLOATING-WIDGET bereit, Funktionen: init/show/hide/isVisible/minimize/maximize/isMinimized/getPosition",
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
