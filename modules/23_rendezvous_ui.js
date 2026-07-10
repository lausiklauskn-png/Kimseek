/*
 * SBKIM — Modul 23 UI — Rendezvous-Floating-Knopf (öffentlich, app-agnostisch)
 *
 * Das app-eigene UI-Stück zu Modul 23 (Rendezvous). Klaus' Festlegung
 * 2026-06-28: ein **eigener kleiner Floating-Knopf** (wie family's „🔌 Andock-
 * Tool" / wie Modul 22), **öffentlich** sichtbar (kein ?dev-Gate). Self-mountet
 * einen dezenten 🌐-Knopf, der ein Mini-Panel mit den drei Rendezvous-Gesten
 * öffnet:
 *   🌐 Mit dem Netz verbinden   → SbkimRendezvous.connectAndAnnounce({createIdentity})
 *   👥 Wer ist im Raum?         → SbkimRendezvous.discover() → Karten + 🤝 Andocken
 *   📌 Nur neu anmelden         → SbkimRendezvous.announce()
 *   🧬 nur verwandte: aus/an    → REINE Anzeige-Filter über die Karten-Liste
 *                                 (zentrierter Verwandtschafts-Score aus Modul 23,
 *                                 gatet NICHTS; Default aus). Pro Karte zeigt ein
 *                                 Badge „🧬 verwandt 0.72" vs „· verbunden …".
 *
 * Dieses UI-Modul wird — wie Modul 23 selbst — **byte-1:1 in jede PWA kopiert**.
 * Die App parametrisiert nur:
 *   SbkimRendezvousUI.init({ nodeName, createIdentity, prepareCorpus?, corner?, accent? })
 * - nodeName:       Anzeigename der eigenen Visitenkarte (z.B. "Mein Rezeptbuch").
 * - createIdentity: optional async () -> void; erzeugt die lebende Identität,
 *                   falls noch keine da ist (app-spezifisch, da Domänen-
 *                   Stichworte app-spezifisch sind). Fehlt sie + keine Identität,
 *                   meldet das Panel das ruhig (kein Throw).
 * - corner:         "bl" | "br" | "tl" | "tr" (Default "bl" = unten links).
 * - accent:         Akzentfarbe (Default greift CSS-Var --accent oder #6ee7d3).
 *
 * Komponiert ausschliesslich Modul 23 (SbkimRendezvous) — keine direkten
 * Aufrufe an Modul 02/03/05/05b. DOM-only, fail-soft, idempotent. Baut die
 * Elemente per createElement (keine innerHTML-Struktur) — stub- und real-DOM-fest.
 *
 * Public surface (window.SbkimRendezvousUI):
 *   init(opts) -> Promise<void>   (self-mount; idempotent)
 *   show() / hide() -> void
 *   isOpen() -> boolean
 *   _meta -> { version, mounted, open, nodeName, hasRendezvous, relatedOnly }
 *
 * Verfassungstreu: alle Aktionen sind nutzer-ausgelöst (Knöpfe). Kein Dauer-
 * Piepser, kein Auto-Connect beim Laden (init mountet nur den Knopf).
 */
(function (global) {
  "use strict";

  var VERSION = "0.1";

  var cfg = { nodeName: "SBKIM-Knoten", createIdentity: null, dbSuffix: null, prepareCorpus: null, corner: "bl", accent: null };
  var mounted = false;
  var btnEl = null, panelEl = null, outEl = null, cardsEl = null, relOnlyBtn = null;
  var askInputEl = null, answerBtn = null;   // Bau 23.B — Frage-Feld + Antwortrecht-Schalter
  var relatedOnly = false;   // „nur verwandte zeigen" (reine Anzeige, Default aus)
  var lastCards = [];        // letzte gelesene Karten (für Re-Render beim Umschalten)

  function doc() { return global.document; }
  function rdv() { return global.SbkimRendezvous || null; }
  function accent() { return cfg.accent || "var(--accent,#6ee7d3)"; }

  function el(tag, css, text) {
    var d = doc();
    var e = d.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function cornerCss(corner, panel) {
    var off = panel ? "64px" : "14px";
    switch (corner) {
      case "br": return "right:14px;bottom:" + off;
      case "tl": return "left:14px;top:" + off;
      case "tr": return "right:14px;top:" + off;
      case "bl":
      default: return "left:14px;bottom:" + off;
    }
  }

  function setOut(text) { if (outEl) outEl.textContent = text; if (cardsEl) clear(cardsEl); }
  function appendOut(text) { if (outEl) outEl.textContent += text; }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  // PFLICHT (Klaus 2026-07-08): jede Operation, die das ~30-MB-Embedding-Modell
  // laden kann (Verbinden / Nur-neu-anmelden / „Wer ist im Raum?" — über
  // getOwnLiveSpore/createIdentity), zeigt einen Prozent-Balken im Panel. Ohne
  // ihn wirkt die Seite eingefroren (Modell-Laden > 12 s) und wird zu früh
  // geschlossen. Quelle: Modul-03-Event sbkim:embedding-progress.
  var _progHandler = null, _progBase = "";
  function startModelProgress(baseText) {
    _progBase = baseText || "";
    if (_progHandler || !outEl) return;
    _progHandler = function (ev) {
      var dd = ev && ev.detail; if (!dd || !outEl) return;
      if (typeof dd.progress === "number" && isFinite(dd.progress)) {
        var pct = Math.max(0, Math.min(100, Math.round(dd.progress)));
        var filled = Math.round(pct / 5);
        var bar = new Array(filled + 1).join("█") + new Array(20 - filled + 1).join("░");
        outEl.textContent = _progBase + "\nSprach-Modell lädt  " + bar + "  " + pct + " %" +
          "\n(einmalig ~30 MB — kann am Tablet 1–2 Min dauern, bitte offen lassen)";
      } else if (dd.status === "done" || dd.status === "ready") {
        outEl.textContent = _progBase + "\nSprach-Modell geladen ✓";
      }
    };
    try { global.addEventListener("sbkim:embedding-progress", _progHandler); } catch (_e) {}
  }
  function stopModelProgress() {
    if (!_progHandler) return;
    try { global.removeEventListener("sbkim:embedding-progress", _progHandler); } catch (_e) {}
    _progHandler = null;
  }

  // ---- Flying-Widget: frei verschiebbar + minimierbar (Klaus 2026-07-10) ----
  // Das „Mit dem Netz verbinden"-Panel klebte in einer Ecke und verdeckte die
  // Seite. Jetzt: an der Kopfzeile frei ziehbar, per „–" zur Blase minimierbar,
  // Position in localStorage gemerkt. Bubble ⇄ Panel teilen sich EINE Position.
  var POS_KEY = "sbkim_rdv_ui_pos";
  function loadPos() {
    try {
      var s = global.localStorage.getItem(POS_KEY);
      if (!s) return null;
      var p = JSON.parse(s);
      if (p && typeof p.x === "number" && typeof p.y === "number") return p;
    } catch (_e) {}
    return null;
  }
  function savePos(x, y) {
    try { global.localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(x), y: Math.round(y) })); } catch (_e) {}
  }
  function clampInts(x, y, node) {
    var vw = global.innerWidth || 1024, vh = global.innerHeight || 768;
    var w = (node && node.offsetWidth) || 60, h = (node && node.offsetHeight) || 60;
    var mx = Math.max(4, vw - w - 4), my = Math.max(4, vh - h - 4);
    return { x: Math.min(Math.max(4, x), mx), y: Math.min(Math.max(4, y), my) };
  }
  function applyPos(node, p) {
    if (!node || !p) return;
    node.style.left = p.x + "px"; node.style.top = p.y + "px";
    node.style.right = "auto"; node.style.bottom = "auto";
  }
  function makeDraggable(node, handle) {
    handle = handle || node;
    handle.style.touchAction = "none";
    var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false;
    handle.addEventListener("pointerdown", function (ev) {
      var tg = ev.target;
      if (tg && tg !== handle && (tg.tagName === "BUTTON" || tg.tagName === "INPUT" ||
          tg.tagName === "TEXTAREA" || tg.tagName === "A" || tg.tagName === "SELECT")) return;
      dragging = true; moved = false;
      var r = node.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = ev.clientX; sy = ev.clientY;
      try { handle.setPointerCapture(ev.pointerId); } catch (_e) {}
    });
    handle.addEventListener("pointermove", function (ev) {
      if (!dragging) return;
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
      if (!moved) return;
      applyPos(node, clampInts(ox + dx, oy + dy, node));
      ev.preventDefault();
    });
    function end(ev) {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(ev.pointerId); } catch (_e) {}
      if (moved) {
        var r = node.getBoundingClientRect();
        var c = clampInts(r.left, r.top, node);
        savePos(c.x, c.y);
        if (node === panelEl && btnEl) applyPos(btnEl, c);
        if (node === btnEl && panelEl) applyPos(panelEl, c);
      }
    }
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    // Nach einem Zug den nachfolgenden Klick verschlucken (Bubble ist ein Button).
    node.addEventListener("click", function (ev) {
      if (moved) { ev.stopPropagation(); ev.preventDefault(); moved = false; }
    }, true);
  }

  function mount() {
    if (mounted) return;
    var d = doc();
    if (!d || !d.body) return;
    var ac = accent();
    var bs = "padding:7px 12px;border-radius:8px;border:1px solid " + ac + ";" +
      "background:rgba(110,231,211,.12);color:#eef2f8;cursor:pointer;font:inherit";
    var bsGhost = "padding:7px 12px;border-radius:8px;border:1px solid var(--line,#2a3340);" +
      "background:transparent;color:#eef2f8;cursor:pointer;font:inherit";

    btnEl = el("button", "position:fixed;" + cornerCss(cfg.corner, false) + ";z-index:2147483600;" +
      "font:600 .8rem var(--mono,system-ui,sans-serif);padding:8px 12px;border-radius:10px;" +
      "border:1px solid " + ac + ";background:rgba(10,12,20,.7);color:" + ac + ";cursor:pointer;" +
      "backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(0,0,0,.35)", "🌐 Mit dem Netz verbinden");
    btnEl.type = "button";
    btnEl.id = "sbkim-rdv-btn";
    btnEl.title = "SBKIM-Rendezvous: dich im gemeinsamen Raum anmelden + andere Knoten finden.";

    panelEl = el("div", "position:fixed;" + cornerCss(cfg.corner, true) + ";z-index:2147483600;" +
      "width:min(420px,92vw);display:none;max-height:80vh;overflow-y:auto;-webkit-overflow-scrolling:touch;" +
      "background:rgba(10,12,20,.94);border:1px solid " + ac + ";border-radius:12px;padding:14px;" +
      "color:#eef2f8;font:.82rem/1.5 var(--sans,system-ui,sans-serif);backdrop-filter:blur(10px);" +
      "box-shadow:0 12px 34px rgba(0,0,0,.5)");
    panelEl.id = "sbkim-rdv-panel";

    var head = el("div", "display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;cursor:move");
    head.title = "Ziehen zum Verschieben";
    head.appendChild(el("strong", "color:" + ac, "🌐 Mit dem Netz verbinden"));
    var headBtns = el("div", "display:flex;align-items:center;gap:2px");
    var minBtn = el("button", "background:none;border:none;color:#9aa7b6;font-size:1.4rem;line-height:.6;cursor:pointer;padding:0 6px", "–");
    minBtn.type = "button";
    minBtn.title = "Minimieren — zur Blase verkleinern";
    headBtns.appendChild(minBtn);
    var closeBtn = el("button", "background:none;border:none;color:#9aa7b6;font-size:1.1rem;cursor:pointer", "✕");
    closeBtn.type = "button";
    closeBtn.title = "Schließen (zur Blase)";
    headBtns.appendChild(closeBtn);
    head.appendChild(headBtns);
    panelEl.appendChild(head);

    panelEl.appendChild(el("p", "margin:0 0 10px;color:#9aa7b6",
      "Triff andere SBKIM-Knoten im gemeinsamen Raum — server-los, direkt aus deinem Browser. Lass diesen Tab offen, damit du erreichbar bleibst."));

    var row = el("div", "display:flex;gap:8px;flex-wrap:wrap");
    var connectBtn = el("button", bs, "🌐 Mit dem Netz verbinden"); connectBtn.type = "button";
    var discoverBtn = el("button", bsGhost, "👥 Wer ist im Raum?"); discoverBtn.type = "button";
    var announceBtn = el("button", bsGhost, "📌 Nur neu anmelden"); announceBtn.type = "button";
    row.appendChild(connectBtn); row.appendChild(discoverBtn); row.appendChild(announceBtn);
    panelEl.appendChild(row);

    // „🧬 nur verwandte" — REINE Anzeige: filtert die Karten-Liste auf echte
    // Verwandte (zentrierter Score, Modul 04 via Modul 23). Gatet NICHTS, der
    // 0.80-Andock-Riegel bleibt unberührt. Default aus.
    var filterRow = el("div", "margin-top:8px");
    relOnlyBtn = el("button", bsGhost + ";font-size:.74rem;padding:5px 10px", "🧬 nur verwandte: aus");
    relOnlyBtn.type = "button";
    relOnlyBtn.title = "Nur Knoten zeigen, deren Domäne wirklich verwandt ist (zentrierter Bedeutungs-Score). Reine Anzeige — am Andocken ändert das nichts.";
    filterRow.appendChild(relOnlyBtn);
    panelEl.appendChild(filterRow);

    // Modus B — „🧹 Aufräumen & neu anmelden" (Identitäts-Hygiene, zerstörend,
    // dezent gestrichelt). Löscht NUR den geteilten Alt-Topf `sbkim` dieser
    // Origin, behält die eigene Schublade + stabile Identität; erst mit dem
    // Notfall gibt es eine ganz neue Identität.
    var repairRow = el("div", "margin-top:8px");
    var repairBtn = el("button", "padding:6px 11px;border-radius:8px;border:1px dashed var(--line,#5a4a3a);" +
      "background:transparent;color:#e6b980;cursor:pointer;font:inherit;font-size:.74rem",
      "🧹 Aufräumen & neu anmelden"); repairBtn.type = "button";
    repairBtn.title = "Löscht den geteilten Alt-Speicher dieser Adresse (nicht deine eigene Schublade), " +
      "meldet Service-Worker ab, behält deine stabile Identität und meldet dich neu an. Danach hart neu laden.";
    repairBtn.addEventListener("click", function () { onRepair(); });
    repairRow.appendChild(repairBtn);
    panelEl.appendChild(repairRow);

    // Bau 23.B — Cross-Knoten-Frage: EIN Frage-Feld + „Antworten"-Schalter.
    // Fragen ist nutzer-ausgelöst (❓-Knopf je Karte nutzt dieses Feld);
    // Antworten ist das Antwortrecht (Default AUS, bewusster Schalter).
    var askRow = el("div", "margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center");
    askInputEl = el("input", "flex:1;min-width:150px;padding:6px 9px;border-radius:8px;border:1px solid rgba(154,167,182,.35);" +
      "background:rgba(10,16,24,.6);color:#e8eef6;font-size:.78rem");
    askInputEl.id = "sbkim-rdv-q";
    askInputEl.type = "text";
    askInputEl.placeholder = "Frage nach Bedeutung, z.B. kuchen …";
    answerBtn = el("button", bsGhost + ";font-size:.74rem;padding:5px 10px", "💬 Antworten: aus");
    answerBtn.type = "button";
    answerBtn.title = "Antwortrecht: eingeschaltet beantwortet dein Knoten Fragen anderer Knoten mit den Top-Treffern seiner eigenen Bedeutungs-Suche (nur Titel, keine Inhalte). Gilt nur, solange dieser Tab offen ist.";
    askRow.appendChild(askInputEl);
    askRow.appendChild(answerBtn);
    panelEl.appendChild(askRow);

    cardsEl = el("div", "margin-top:10px");
    cardsEl.id = "sbkim-rdv-cards";
    panelEl.appendChild(cardsEl);

    outEl = el("pre", "margin:10px 0 0;white-space:pre-wrap;word-break:break-word;" +
      "font:.74rem/1.5 var(--mono,monospace);color:#cfe0ff;max-height:42vh;overflow:auto");
    outEl.id = "sbkim-rdv-out";
    panelEl.appendChild(outEl);

    panelEl.appendChild(el("p", "margin:8px 0 0;color:#9aa7b6;font-size:.72rem",
      "Es wird nur deine öffentliche Visitenkarte (Spore) im Raum gezeigt — dein privater Schlüssel bleibt in diesem Browser."));

    d.body.appendChild(btnEl);
    d.body.appendChild(panelEl);

    btnEl.addEventListener("click", function () { toggle(); });
    closeBtn.addEventListener("click", function () { hide(); });
    minBtn.addEventListener("click", function () { hide(); });
    connectBtn.addEventListener("click", function () { onConnect(); });
    discoverBtn.addEventListener("click", function () { onDiscover(); });
    announceBtn.addEventListener("click", function () { onAnnounce(); });
    relOnlyBtn.addEventListener("click", function () {
      relatedOnly = !relatedOnly;
      relOnlyBtn.textContent = "🧬 nur verwandte: " + (relatedOnly ? "an" : "aus");
      renderCards(lastCards); // ohne Neu-Lesen umsortieren/filtern
    });
    answerBtn.addEventListener("click", function () { onToggleAnswering(); });

    // Flying-Widget: gemerkte Position wiederherstellen + Drag verdrahten.
    var savedPos = loadPos();
    if (savedPos) applyPos(btnEl, savedPos);
    makeDraggable(btnEl, btnEl);   // Blase direkt ziehbar
    makeDraggable(panelEl, head);  // Panel an der Kopfzeile ziehbar
    // Bei Fenster-/Splitscreen-Änderung ins Sichtfeld zurückklemmen (fail-soft).
    try {
      global.addEventListener("resize", function () {
        var p = loadPos(); if (!p) return;
        var vis = isOpen() ? panelEl : btnEl;
        var c = clampInts(p.x, p.y, vis); applyPos(vis, c); savePos(c.x, c.y);
      });
    } catch (_e) { /* kein Fenster-Kontext (Test) */ }

    mounted = true;
  }

  // Modul 23 mit der vollen Konfig füttern (nodeName + dbSuffix + createIdentity)
  // — dbSuffix ist Pflicht, damit Modus B (repairAndReconnect) NUR den geteilten
  // Alt-Topf `sbkim` löscht und die eigene Schublade `sbkim_<suffix>` behält.
  function configModule() {
    var r = rdv();
    if (!r) return;
    var o = { nodeName: cfg.nodeName };
    if (cfg.dbSuffix) o.dbSuffix = cfg.dbSuffix;
    if (typeof cfg.createIdentity === "function") o.createIdentity = cfg.createIdentity;
    if (typeof cfg.prepareCorpus === "function") o.prepareCorpus = cfg.prepareCorpus;
    try { r.configure(o); } catch (_e) {}
  }

  function ensureRdv() {
    var r = rdv();
    if (!r) { setOut("Modul 23 (SbkimRendezvous) nicht geladen."); return null; }
    configModule();
    return r;
  }

  // Modus B — „🧹 Aufräumen & neu anmelden" (zerstörend, nur hinter Nutzer-Knopf).
  function onRepair() {
    var r = ensureRdv();
    if (!r) return;
    if (typeof r.repairAndReconnect !== "function") {
      setOut("Aufräumen ist in dieser Version noch nicht verfügbar (Modul 23 zu alt).");
      return;
    }
    setOut("🧹 Räume den geteilten Alt-Speicher dieser Adresse auf …\n");
    startModelProgress("🧹 Räume auf & melde neu an …");
    r.repairAndReconnect().then(function (res) {
      stopModelProgress(); if (outEl) outEl.textContent = "🧹 Aufgeräumt & neu angemeldet:\n";
      var c = res && res.cleaned;
      if (c) {
        appendOut("• Alt-Topf „sbkim“ gelöscht: " + (c.dbDeleted ? "ja" : "nein") + "\n");
        appendOut("• Service-Worker abgemeldet: " + (c.swUnregistered || 0) + "\n");
        appendOut("• Caches geleert: " + (c.cachesDeleted || 0) + "\n");
      }
      if (res && res.ok) {
        if (res.created) appendOut("✓ Frische Identität: " + res.nodeId + "\n");
        else appendOut("Identität (eigene Schublade bleibt): " + res.nodeId + "\n");
        appendOut("✓ Neu im Raum angemeldet.\n");
      } else {
        appendOut("✗ " + ((res && res.reason) || "Neu-Anmelden fehlgeschlagen.") + "\n");
      }
      if (res && res.reloadHint) appendOut("\nℹ️ " + res.reloadHint);
    }).catch(function (e) { stopModelProgress(); setOut("✗ Aufräumen fehlgeschlagen: " + (e && e.message ? e.message : e)); });
  }

  function onConnect() {
    var r = ensureRdv();
    if (!r) return;
    setOut("→ Verbinde mit dem Netz …\n");
    startModelProgress("→ Verbinde mit dem Netz …");
    r.connectAndAnnounce({ createIdentity: cfg.createIdentity || undefined }).then(function (res) {
      stopModelProgress(); if (outEl) outEl.textContent = "";
      if (res.ok) {
        if (res.created) appendOut("✓ Identität erzeugt: " + res.nodeId + "\n");
        else appendOut("Identität vorhanden: " + res.nodeId + "\n");
        appendOut("✓ Du bist im Raum — deine Visitenkarte hängt, du lauschst.\n");
        appendOut("  Lass diesen Tab offen — eine geschlossene Seite ist nicht erreichbar.");
      } else {
        appendOut("✗ " + (res.reason || "Verbinden fehlgeschlagen.") +
          (cfg.createIdentity ? "\n(Bei Netz-/Modell-Fehler: Verbindung prüfen und nochmal.)" : ""));
      }
    }).catch(function (e) { stopModelProgress(); setOut("✗ Verbinden fehlgeschlagen: " + (e && e.message ? e.message : e)); });
  }

  function onAnnounce() {
    var r = ensureRdv();
    if (!r) return;
    setOut("→ Hefte deine Visitenkarte in den gemeinsamen Raum …\n");
    startModelProgress("→ Hefte deine Visitenkarte in den gemeinsamen Raum …");
    r.announce().then(function (res) {
      stopModelProgress(); if (outEl) outEl.textContent = "";
      if (res.ok) appendOut("✓ Du bist im Raum (nodeId " + res.nodeId + "). Lass den Tab offen.");
      else appendOut("✗ " + (res.reason || "Anmelden fehlgeschlagen."));
    }).catch(function (e) { stopModelProgress(); setOut("✗ Anmelden fehlgeschlagen: " + (e && e.message ? e.message : e)); });
  }

  function onDiscover() {
    var r = ensureRdv();
    if (!r) return;
    setOut("👥 Lese den gemeinsamen Raum …\n");
    startModelProgress("👥 Lese den gemeinsamen Raum …");
    r.discover().then(function (res) {
      stopModelProgress();
      if (!res.ok) { setOut("✗ Raum-Lesen fehlgeschlagen: " + (res.reason || "(unbekannt)")); return; }
      renderCards(res.cards);
    }).catch(function (e) { stopModelProgress(); setOut("✗ Raum-Lesen fehlgeschlagen: " + (e && e.message ? e.message : e)); });
  }

  function renderCards(cards) {
    lastCards = Array.isArray(cards) ? cards : [];
    if (outEl) outEl.textContent = "";
    if (!cardsEl) return;
    clear(cardsEl);
    if (lastCards.length === 0) {
      if (outEl) outEl.textContent = "Niemand (Fremdes) im Raum. Lass den Gegenknoten zuerst „🌐 Mit dem Netz verbinden“ drücken — dann hier nochmal „👥 Wer ist im Raum?“.";
      return;
    }
    var ac = accent();
    var bs = "padding:5px 10px;border-radius:8px;border:1px solid " + ac + ";" +
      "background:rgba(110,231,211,.12);color:#eef2f8;cursor:pointer;font:inherit";
    var shown = relatedOnly ? lastCards.filter(function (c) { return c.isRelated === true; }) : lastCards;
    if (shown.length === 0) {
      cardsEl.appendChild(el("div", "color:#9aa7b6", "Keiner der " + lastCards.length +
        " Knoten im Raum ist (im engen Maß) verwandt. Schalte „🧬 nur verwandte“ wieder auf „aus“, um alle zu sehen."));
      return;
    }
    var head = relatedOnly
      ? ("🧬 " + shown.length + " verwandte von " + lastCards.length + " im Raum:")
      : ("👥 " + lastCards.length + " Knoten im Raum:");
    cardsEl.appendChild(el("div", "color:#9ff7df;margin-bottom:6px", head));
    shown.forEach(function (c) {
      var ageTxt = c.ageSec < 60 ? "gerade eben" : (Math.floor(c.ageSec / 60) + " min");
      var rowEl = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0;padding:6px 8px;" +
        "border:1px solid var(--line,#2a3340);border-radius:8px");
      var info = el("span", "flex:1;min-width:150px");
      info.appendChild(el("b", null, c.nodeName || "Knoten"));
      info.appendChild(el("br"));
      info.appendChild(el("span", "font:.66rem/1.3 var(--mono,monospace);color:#9aa7b6;word-break:break-all", c.nodeId));
      info.appendChild(el("br"));
      info.appendChild(el("span", "font-size:.7rem;color:#9aa7b6", "angemeldet " + ageTxt));
      // Verwandtschafts-Badge (reine Anzeige; nur wenn Modul 04 einen Score lieferte).
      if (typeof c.relatedness === "number" && isFinite(c.relatedness)) {
        info.appendChild(el("br"));
        var badgeCss = c.isRelated
          ? ("display:inline-block;margin-top:3px;padding:1px 7px;border-radius:6px;font-size:.68rem;" +
             "background:rgba(110,231,211,.18);color:" + ac)
          : ("display:inline-block;margin-top:3px;padding:1px 7px;border-radius:6px;font-size:.68rem;" +
             "background:rgba(154,167,182,.14);color:#9aa7b6");
        var badgeTxt = (c.isRelated ? "🧬 verwandt " : "· verbunden ") + c.relatedness.toFixed(2);
        var badge = el("span", badgeCss, badgeTxt);
        badge.title = "Zentrierter Bedeutungs-Score zur eigenen Domäne — reine Anzeige, gatet das Andocken nicht.";
        info.appendChild(badge);
      }
      rowEl.appendChild(info);
      var b = el("button", bs, "🤝 Andocken"); b.type = "button";
      b.addEventListener("click", function () { onHandshake(c); });
      rowEl.appendChild(b);
      var qb = el("button", bs + ";margin-left:6px;opacity:.85", "❓ Fragen"); qb.type = "button";
      qb.title = "Stellt diesem Knoten die Frage aus dem Feld oben — er antwortet mit den Top-Treffern seiner eigenen Bedeutungs-Suche.";
      qb.addEventListener("click", function () { onAsk(c); });
      rowEl.appendChild(qb);
      cardsEl.appendChild(rowEl);
    });
  }

  // Bau 23.B — Cross-Knoten-Frage per Knopf (nutzt das Frage-Feld oben).
  function onAsk(card) {
    var r = rdv();
    if (!r || typeof r.askNode !== "function") { setOut("Modul 23 mit Bau 23.B (askNode) nicht geladen."); return; }
    var text = askInputEl ? String(askInputEl.value || "").trim() : "";
    if (!text) { if (outEl) outEl.textContent = "❓ Zuerst oben eine Frage eintippen (z.B. kuchen), dann ❓ Fragen antippen."; return; }
    if (outEl) outEl.textContent = "❓ Frage <" + text + "> an " + (card.nodeName || "Knoten") + " — warte auf Antwort (max ~15 s) …";
    r.askNode(card, text).then(function (res) {
      if (!outEl) return;
      if (res && res.ok) {
        var lines = ["✓ Antwort von " + (card.nodeName || "Knoten") + " (" + Math.round((res.tookMs || 0) / 100) / 10 + " s):"];
        if (res.results && res.results.length) {
          res.results.forEach(function (h, i) {
            lines.push("  " + (i + 1) + ". " + h.label + (typeof h.score === "number" ? "  (" + h.score.toFixed(2) + ")" : ""));
          });
          lines.push("— Das ist die bidirektionale Bedeutungs-Suche: sein Knoten hat in SEINEM Buch nach deinem Sinn gesucht.");
        } else {
          lines.push("  (keine Treffer in seinem Buch — ehrlich leer)");
        }
        outEl.textContent = lines.join("\n");
      } else {
        outEl.textContent = "✗ " + (res && res.reason ? res.reason : "Keine Antwort.") +
          "\nTipp: der Gegenknoten muss <💬 Antworten: an> geschaltet haben und den Tab offen halten.";
      }
    }).catch(function (e) { if (outEl) outEl.textContent = "✗ Fehler: " + (e && e.message ? e.message : e); });
  }

  // Bau 23.B — Antwortrecht bewusst an/aus (Default aus, nicht persistiert).
  function onToggleAnswering() {
    var r = rdv();
    if (!r || typeof r.enableAnswering !== "function") { setOut("Modul 23 mit Bau 23.B (enableAnswering) nicht geladen."); return; }
    if (r._meta && r._meta.answering) {
      try { r.disableAnswering(); } catch (_e) {}
      if (answerBtn) answerBtn.textContent = "💬 Antworten: aus";
      if (outEl) outEl.textContent = "💬 Antworten ausgeschaltet.";
      return;
    }
    r.enableAnswering().then(function (res) {
      if (res && res.ok) {
        if (answerBtn) answerBtn.textContent = "💬 Antworten: an";
        if (outEl) outEl.textContent = "💬 Antworten AN — dein Knoten beantwortet jetzt Fragen anderer Knoten mit den Top-Treffern seiner Bedeutungs-Suche (nur Titel). Tab offen lassen.";
      } else {
        if (outEl) outEl.textContent = "✗ " + (res && res.reason ? res.reason : "Antworten konnte nicht eingeschaltet werden.");
      }
    }).catch(function (e) { if (outEl) outEl.textContent = "✗ Fehler: " + (e && e.message ? e.message : e); });
  }

  function onHandshake(card) {
    var r = rdv();
    if (!r) { setOut("Modul 23 (SbkimRendezvous) nicht geladen."); return; }
    if (outEl) outEl.textContent = "🤝 Handshake an " + (card.nodeName || "Knoten") + " (lebende ID, max ~12 s) …";
    r.handshakeCard(card).then(function (res) {
      var oc = res && res.outcome;
      function line(s) { if (outEl) outEl.textContent += "\n" + s; }
      if (oc === "established") {
        line("✓ ANDOCK ETABLIERT mit " + (card.nodeName || "Knoten") + "! 🎉");
        line("   Server-loser Live-Cross-Knoten-Handshake — ihr seid verbunden.");
      } else if (oc === "rejected-local") {
        line("• Lokal abgelehnt — Bedeutungs-Ähnlichkeit " + (res.score != null ? Number(res.score).toFixed(4) : "?") + " < 0.80 (kein Fehler, zu verschiedene Domänen).");
      } else if (oc === "rejected") {
        line("• Vom Gegenknoten abgelehnt: " + (res.reason || "(kein Grund)"));
      } else if (oc === "timeout") {
        line("✗ " + (res.reason || "Keine Antwort — Knoten offline/nicht wach (Visitenkarte veraltet)."));
      } else {
        line("✗ Fehler: " + (res && res.reason ? res.reason : JSON.stringify(res)));
      }
    }).catch(function (e) { if (outEl) outEl.textContent += "\n✗ Fehler: " + (e && e.message ? e.message : e); });
  }

  function show() {
    if (panelEl) { panelEl.style.display = "block"; var p = loadPos(); if (p) applyPos(panelEl, p); }
    if (btnEl) btnEl.style.display = "none";      // Panel offen → Blase weg (Flying-Widget)
  }
  function hide() {
    if (panelEl) panelEl.style.display = "none";
    if (btnEl) btnEl.style.display = "";          // minimiert → Blase zeigt sich wieder
  }
  function isOpen() { return !!(panelEl && panelEl.style.display !== "none"); }
  function toggle() { if (isOpen()) hide(); else show(); }

  function applyOpts(opts) {
    if (!opts || typeof opts !== "object") return;
    if (typeof opts.nodeName === "string" && opts.nodeName.length > 0) cfg.nodeName = opts.nodeName;
    if (typeof opts.createIdentity === "function") cfg.createIdentity = opts.createIdentity;
    if (typeof opts.prepareCorpus === "function") cfg.prepareCorpus = opts.prepareCorpus;
    if (typeof opts.dbSuffix === "string" && opts.dbSuffix.length > 0) cfg.dbSuffix = opts.dbSuffix;
    if (typeof opts.corner === "string") cfg.corner = opts.corner;
    if (typeof opts.accent === "string") cfg.accent = opts.accent;
  }

  function init(opts) {
    applyOpts(opts);
    configModule();
    var d = doc();
    if (!d) return Promise.resolve();
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", mount);
    else mount();
    return Promise.resolve();
  }

  var api = {
    init: init,
    show: show,
    hide: hide,
    isOpen: isOpen,
    get _meta() {
      return { version: VERSION, mounted: mounted, open: isOpen(), nodeName: cfg.nodeName, hasRendezvous: rdv() !== null, relatedOnly: relatedOnly };
    },
  };

  global.SbkimRendezvousUI = api;

  if (typeof console !== "undefined" && console.info) {
    console.info("MODUL 23 UI RENDEZVOUS-KNOPF bereit (öffentlich, app-agnostisch), Funktionen: init/show/hide/isOpen");
  }
})(typeof window !== "undefined" ? window : globalThis);
