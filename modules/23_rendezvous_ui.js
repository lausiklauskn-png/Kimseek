/*
 * SBKIM — Modul 23 UI — Rendezvous-Floating-Knopf (öffentlich, app-agnostisch)
 *
 * Das app-eigene UI-Stück zu Modul 23 (Rendezvous). Klaus' Festlegung
 * 2026-06-28: ein **eigener kleiner Floating-Knopf** (wie family's „🔌 Andock-
 * Tool" / wie Modul 22), **öffentlich** sichtbar (kein ?dev-Gate). Self-mountet
 * einen dezenten 🌐-Knopf, der ein Mini-Panel mit den drei Rendezvous-Gesten
 * öffnet:
 *   🌐 Mit dem Knotennetz verbinden   → SbkimRendezvous.connectAndAnnounce({createIdentity})
 *   👥 Wer ist im Raum?         → SbkimRendezvous.discover() → Karten + 🤝 Andocken
 *   🙋 Nur neu anmelden         → SbkimRendezvous.announce()
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

  var cfg = { nodeName: "SBKIM-Knoten", createIdentity: null, dbSuffix: null, prepareCorpus: null, corner: "bl", accent: null, euOnly: false };
  var mounted = false;
  var btnEl = null, panelEl = null, outEl = null, cardsEl = null, relOnlyBtn = null, incomingEl = null;

  // Empfänger-Hinweis (Klaus 2026-07-11): wenn ein FREMDER Knoten sich mit
  // diesem hier verbindet, beantwortet Modul 05 den Handshake live und meldet
  // sbkim:handshake mit direction:"incoming". Ohne diesen Hinweis geschieht das
  // Andocken beim Antworter unsichtbar (Klaus' Befund: „Handshake gemacht, aber
  // die Gegenseite hat's nicht registriert"). REINE Anzeige — ändert nichts am
  // Protokoll oder am 0.80-Andock-Riegel. Fail-soft.
  var _hsHandler = null;
  var _incoming = [];   // [{id}] neueste zuerst, dedupe nach nodeId, Cap 5
  function _shortNodeId(id) {
    return (typeof id === "string" && id.length > 10) ? id.slice(0, 9) + "…" : (id || "?");
  }
  function renderIncoming() {
    if (!incomingEl) return;
    if (!_incoming.length) { incomingEl.style.display = "none"; incomingEl.textContent = ""; return; }
    var title = _incoming.length === 1
      ? "🤝 Ein Knoten hat sich gerade mit dir verbunden:"
      : "🤝 " + _incoming.length + " Knoten haben sich mit dir verbunden:";
    var lines = _incoming.map(function (e) { return "  • " + _shortNodeId(e.id); }).join("\n");
    incomingEl.textContent = title + "\n" + lines +
      "\n(Du bist im Raum und erreichbar. „👥 Wer ist im Raum?“ zeigt sie, sobald ihre Karte frisch ist.)";
    incomingEl.style.display = "block";
  }
  function startIncomingWatch() {
    if (_hsHandler) return;
    _hsHandler = function (ev) {
      var dd = ev && ev.detail; if (!dd) return;
      if (dd.direction !== "incoming" || dd.outcome !== "established") return;
      var id = (typeof dd.peerNodeId === "string" && dd.peerNodeId) ? dd.peerNodeId : "?";
      _incoming = _incoming.filter(function (e) { return e.id !== id; });
      _incoming.unshift({ id: id });
      if (_incoming.length > 5) _incoming.length = 5;
      renderIncoming();
      // Auch minimiert wahrnehmbar: Blasen-Titel als Hinweis.
      try { if (btnEl) btnEl.title = "Ein Knoten hat sich verbunden — öffnen"; } catch (_e) {}
    };
    try { global.addEventListener("sbkim:handshake", _hsHandler); } catch (_e) {}
  }

  // ── A12 Phase 2: Briefkasten-UI (offene Fragen + Antworten nachlesen) ──
  // LEHRE aus dem git-Briefkasten (Klaus 2026-07-11): ein Briefkasten scheitert
  // am LESEN, nicht am Schreiben — weil das Lesen freiwillig/unsichtbar ist.
  // Darum hier: (1) offene Fragen werden gemerkt, (2) beim Öffnen wird AUTOMATISCH
  // nachgelesen (kein Knopf-Erinnern), (3) ein sichtbarer 📬-Zähler an der Blase
  // meldet ungelesene Post von selbst. Speicher app-eigen (dbSuffix-Suffix →
  // keine Kollision auf geteilter github.io-Adresse). Nur eigene Fragen/Antworten,
  // kein Fremd-PII. Grenze: Relais-Aufbewahrung (Modul 23 fetchAnswers).
  var RDV_BUBBLE_BASE = "🌐 Mit dem Knotennetz verbinden";
  var mailBtn = null, reAskBtn = null, clearMailBtn = null;
  // Lebenszyklus-Regelung (Klaus 2026-07-11) — gegen Überladung, per Browser:
  //  · RDV_MAILBOX_MAX  : Obergrenze der lokalen Liste (einstellbar via init).
  //  · OPEN_TTL_MS      : nach dieser Zeit gilt eine unbeantwortete Frage als
  //    „abgelaufen" (die Relais-Frage ist dann weg — realistisch am Lookback-
  //    Fenster orientiert, mit Reserve). Abgelaufene nerven nicht (kein Zähler),
  //    lassen sich aber per „🔁 nochmal fragen" neu stellen.
  //  · Beantwortete + gesehene werden automatisch entfernt (erledigt → weg).
  // WICHTIG: die RELAIS-Aufbewahrung regelt das Relais selbst — der Client kann
  // Relais-Ereignisse nicht zuverlässig löschen. Hier wird nur der LOKALE
  // Briefkasten gepflegt.
  var RDV_MAILBOX_MAX = 20;
  var RDV_MAILBOX_OPEN_TTL_MS = 45 * 60 * 1000; // 45 min (> 30-min-Lookback + Reserve)
  function pendingKey() { return "sbkim_rdv_pending_" + (cfg.dbSuffix || "default"); }
  function loadPending() {
    try { var s = global.localStorage.getItem(pendingKey()); var a = s ? JSON.parse(s) : []; return Array.isArray(a) ? a : []; }
    catch (_e) { return []; }
  }
  function savePending(list) {
    try { global.localStorage.setItem(pendingKey(), JSON.stringify((list || []).slice(0, RDV_MAILBOX_MAX))); } catch (_e) {}
  }
  // Lokale Müllabfuhr: beantwortet+gesehen raus; offene > TTL → abgelaufen.
  function pruneMail() {
    var now = Date.now();
    var list = loadPending().map(function (e) {
      if (e.status === "offen" && typeof e.ts === "number" && (now - e.ts) > RDV_MAILBOX_OPEN_TTL_MS) {
        var c = {}; for (var k in e) { if (Object.prototype.hasOwnProperty.call(e, k)) c[k] = e[k]; }
        c.status = "abgelaufen"; return c;
      }
      return e;
    }).filter(function (e) { return !(e.status === "beantwortet" && e.seen === true); });
    savePending(list);
    return list;
  }
  // Entdoppeln (Klaus 2026-07-12, Screenshot: dieselbe Frage x-fach im Kasten):
  // Der Briefkasten-Eintrag wird nach (Frage-Text, Ziel-Name) zusammengefasst —
  // nicht nach der jedes Mal neuen qid. Normalisiert (trim + lowercase). So wird
  // aus 13 identischen „offen: Erfrischungsgetränk … an Mixarium“ EIN Eintrag mit
  // Zähler. Reiner Anzeige-/Speicher-Fix — kein Protokoll, kein PII.
  function normQ(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function dedupeKey(text, toName) { return normQ(text) + "→" + normQ(toName); }
  function recordOpenQuestion(res, card, text) {
    // Nur wenn die Frage wirklich offen blieb (Timeout mit qid). Byte-gleich
    // no-op, wenn Modul 23 noch kein pending/qid liefert (ältere Fassung).
    if (!res || res.ok || !res.qid) return;
    var toName = (card && card.nodeName) || "Knoten";
    var toNodeId = (card && card.nodeId) || null;
    // Partner-Link je Eintrag (Klaus 2026-07-12): Adresse beim Schreiben mit
    // ablegen, damit der Briefkasten später „↗ App öffnen“ zeigen kann.
    var endpoint = (card && card.spore && typeof card.spore.endpoint === "string") ? card.spore.endpoint : null;
    var key = dedupeKey(text, toName);
    var list = loadPending();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].status !== "beantwortet" && dedupeKey(list[i].text, list[i].toName) === key) { idx = i; break; }
    }
    var now = Date.now();
    if (idx >= 0) {
      // Bestehende offene Gruppe aktualisieren: neueste qid gilt, Zähler +1,
      // lastTs frisch, wieder ganz nach oben. Endpoint nur ergänzen, nie leeren.
      var e = list[idx];
      e.qid = res.qid;
      e.toNodeId = toNodeId || e.toNodeId;
      e.endpoint = endpoint || e.endpoint || null;
      e.tries = (typeof e.tries === "number" ? e.tries : 1) + 1;
      e.ts = now;
      e.status = "offen"; e.seen = true;
      list.splice(idx, 1); list.unshift(e);
    } else {
      list.unshift({ qid: res.qid, toNodeId: toNodeId, toName: toName, endpoint: endpoint,
                     text: String(text || ""), ts: now, tries: 1, status: "offen", seen: true });
    }
    savePending(list);
    updateMailBadge();
  }
  function mailUnreadCount() {
    // abgelaufene zählen NICHT (kein Nörgeln); offen + neu-beantwortet schon.
    return loadPending().filter(function (e) { return e.status === "offen" || (e.status === "beantwortet" && !e.seen); }).length;
  }
  function updateMailBadge() {
    var n = mailUnreadCount();
    if (btnEl) btnEl.textContent = RDV_BUBBLE_BASE + (n ? "  📬" + n : "");
    if (mailBtn) mailBtn.textContent = "📬 Antworten abholen" + (n ? " (" + n + ")" : "");
  }
  // Nachlesen über Modul 23 fetchAnswers (Lookback). silent → nur Badge updaten;
  // sonst zusätzlich die Briefkasten-Ansicht zeigen. Fail-soft.
  function recheckMail(opts) {
    opts = opts || {};
    pruneMail();
    var r = rdv();
    if (!r || typeof r.fetchAnswers !== "function") { updateMailBadge(); if (opts.show) renderMail(); return; }
    var open = loadPending().filter(function (e) { return e.status === "offen"; });
    if (!open.length) { updateMailBadge(); if (opts.show) renderMail(); return; }
    r.fetchAnswers(open.map(function (e) { return e.qid; })).then(function (res) {
      if (res && res.ok && Array.isArray(res.answers) && res.answers.length) {
        var byQid = {}; res.answers.forEach(function (a) { if (a && a.qid) byQid[a.qid] = a; });
        var cur = loadPending().map(function (e) {
          if (e.status === "offen" && byQid[e.qid]) {
            var a = byQid[e.qid];
            return { qid: e.qid, toNodeId: e.toNodeId || null, toName: e.toName, text: e.text, ts: e.ts, status: "beantwortet", seen: false,
                     answer: { fromName: a.fromName || e.toName, results: Array.isArray(a.results) ? a.results : [] } };
          }
          return e;
        });
        savePending(cur);
      }
      updateMailBadge();
      if (opts.show || (opts.surfaceIfNews && mailUnreadCount() > 0)) renderMail();
    }).catch(function () { updateMailBadge(); if (opts.show) renderMail(); });
  }
  // 🔄 Offene/abgelaufene Fragen ERNEUT stellen (neu aufs Relais) — damit ein
  // jetzt wacher Antworter sie fängt. Genau das „gespeicherte Suche wieder
  // aktivieren" (Marktplatz-Muster). Fail-soft; braucht toNodeId je Eintrag.
  function reAskOpen() {
    var r = rdv();
    if (!r || typeof r.askNode !== "function") { setOut("Modul 23 mit Bau 23.B (askNode) nicht geladen."); return; }
    var toAsk = pruneMail().filter(function (e) { return e.status === "offen" || e.status === "abgelaufen"; });
    if (!toAsk.length) { renderMail(); return; }
    if (outEl) outEl.textContent = "🔁 Stelle " + toAsk.length + " offene Frage(n) erneut …";
    Promise.all(toAsk.map(function (e) {
      if (!e.toNodeId) return Promise.resolve();
      return Promise.resolve(r.askNode(e.toNodeId, e.text)).then(function (res) {
        var cur = loadPending();
        var upd = (res && res.ok)
          ? { qid: res.qid || e.qid, toNodeId: e.toNodeId, toName: e.toName, endpoint: e.endpoint || null, tries: e.tries || 1, text: e.text, ts: Date.now(), status: "beantwortet", seen: false, answer: { fromName: res.fromNodeId || e.toName, results: Array.isArray(res.results) ? res.results : [] } }
          : { qid: (res && res.qid) || e.qid, toNodeId: e.toNodeId, toName: e.toName, endpoint: e.endpoint || null, tries: (typeof e.tries === "number" ? e.tries : 1) + 1, text: e.text, ts: Date.now(), status: "offen", seen: true };
        var idx = -1;
        for (var i = 0; i < cur.length; i++) { if (cur[i].qid === e.qid) { idx = i; break; } }
        if (idx >= 0) cur[idx] = upd; else cur.unshift(upd);
        savePending(cur);
      }).catch(function () {});
    })).then(function () { updateMailBadge(); renderMail(); });
  }
  function clearMail() { savePending([]); updateMailBadge(); renderMail(); }
  // „vor N min“ aus einem Zeitstempel (lastTs). Fail-soft ohne Stempel.
  function timeAgo(ts) {
    if (typeof ts !== "number" || !isFinite(ts)) return "";
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return "gerade eben";
    var m = Math.floor(s / 60);
    if (m < 60) return "vor " + m + " min";
    var h = Math.floor(m / 60);
    if (h < 24) return "vor " + h + " h";
    return "vor " + Math.floor(h / 24) + " d";
  }
  // 🗑 je Eintrag (Klaus 2026-07-12): genau diese Gruppe (qid) aus dem lokalen
  // Briefkasten entfernen — nicht nur „alles leeren“. Reine Speicher-/Anzeige.
  function deleteMailEntry(qid) {
    savePending(loadPending().filter(function (e) { return e.qid !== qid; }));
    updateMailBadge();
    renderMail();
  }
  // Text-Fassung (fail-soft, wenn kein cardsEl da ist — z.B. sehr alter Mount).
  function mailLines(list) {
    var lines = ["📬 Dein Briefkasten:"];
    list.forEach(function (e) {
      var meta = (e.tries > 1 ? "×" + e.tries + " · " : "") + (timeAgo(e.ts) ? "zuletzt " + timeAgo(e.ts) : "");
      if (e.status === "beantwortet" && e.answer) {
        var res = (e.answer.results || []).map(function (r) { return r.label; }).filter(Boolean);
        lines.push("✓ „" + e.text + "“ → " + (e.answer.fromName || e.toName) + ": " + (res.length ? res.join(", ") : "(ehrlich leer — nichts Passendes im Buch)") + (meta ? "  (" + meta + ")" : ""));
      } else if (e.status === "abgelaufen") {
        lines.push("🕗 abgelaufen: „" + e.text + "“ an " + e.toName + (meta ? "  (" + meta + ")" : "") + " — „🔁 nochmal fragen“ stellt sie neu.");
      } else {
        lines.push("⏳ offen: „" + e.text + "“ an " + e.toName + (meta ? "  (" + meta + ")" : "") + " — warte auf Antwort (hole ich beim Öffnen ab).");
      }
    });
    return lines.join("\n");
  }
  // Briefkasten-Ansicht: offene / abgelaufene / beantwortete Fragen — je Gruppe
  // EINE Karte mit „×N · zuletzt vor …“, einem 🗑-Knopf (nur diese Gruppe) und —
  // falls die Adresse bekannt ist — „↗ App öffnen“ (Selbst-Suche ohne Warten).
  // Markiert Beantwortetes als gesehen (seen:true) → Zähler runter; beim nächsten
  // pruneMail werden gesehene Beantwortete automatisch entfernt (erledigt → weg).
  function renderMail() {
    var list = pruneMail();
    if (cardsEl) clear(cardsEl);
    if (!list.length) {
      if (outEl) outEl.textContent = "📬 Keine offenen Fragen. Stelle über „🔎 Antwort holen“ eine Frage an einen Knoten — bleibt er stumm (z.B. gerade zu), bleibt die Frage hier offen und ich hole die Antwort automatisch beim nächsten Öffnen.";
      return;
    }
    // Fail-soft ohne cardsEl: Text-Fassung in outEl (wie zuvor).
    if (!cardsEl) { if (outEl) outEl.textContent = mailLines(list); markMailSeen(); return; }
    if (outEl) outEl.textContent = "";
    var ac = accent();
    var bs = "padding:4px 9px;border-radius:8px;border:1px solid " + ac + ";" +
      "background:rgba(110,231,211,.12);color:#eef2f8;cursor:pointer;font:inherit;font-size:.72rem";
    cardsEl.appendChild(el("div", "color:#9ff7df;margin-bottom:6px", "📬 Dein Briefkasten (" + list.length + "):"));
    list.forEach(function (e) {
      var rowEl = el("div", "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0;padding:6px 8px;" +
        "border:1px solid var(--line,#2a3340);border-radius:8px");
      var info = el("span", "flex:1;min-width:150px");
      if (e.status === "beantwortet" && e.answer) {
        var res = (e.answer.results || []).map(function (r) { return r.label; }).filter(Boolean);
        info.appendChild(el("b", null, "✓ „" + e.text + "“"));
        info.appendChild(el("br"));
        info.appendChild(el("span", "font-size:.72rem;color:#cfe0ff",
          (e.answer.fromName || e.toName) + ": " + (res.length ? res.join(", ") : "(ehrlich leer — nichts Passendes im Buch)")));
      } else if (e.status === "abgelaufen") {
        info.appendChild(el("b", null, "🕗 „" + e.text + "“"));
        info.appendChild(el("br"));
        info.appendChild(el("span", "font-size:.72rem;color:#9aa7b6",
          "an " + e.toName + " — keiner hat rechtzeitig geantwortet. „🔁 nochmal fragen“ stellt sie neu."));
      } else {
        info.appendChild(el("b", null, "⏳ „" + e.text + "“"));
        info.appendChild(el("br"));
        info.appendChild(el("span", "font-size:.72rem;color:#9aa7b6",
          "an " + e.toName + " — warte auf Antwort (hole ich beim Öffnen ab)."));
      }
      // Zähler + Zeit: „×N · zuletzt vor …“ (nur was da ist).
      var metaTxt = (e.tries > 1 ? "×" + e.tries + " · " : "") + (timeAgo(e.ts) ? "zuletzt " + timeAgo(e.ts) : "");
      if (metaTxt) { info.appendChild(el("br")); info.appendChild(el("span", "font-size:.68rem;color:#9aa7b6", metaTxt)); }
      rowEl.appendChild(info);
      // ↗ App öffnen (falls Adresse bekannt) — Selbst-Suche ohne Warten.
      var ep = (typeof e.endpoint === "string") ? e.endpoint.trim() : "";
      if (/^https?:\/\//i.test(ep)) {
        var link = el("a", bs + ";text-decoration:none;display:inline-block", "↗ App öffnen");
        link.href = ep; link.target = "_blank"; link.rel = "noopener noreferrer";
        link.title = "App öffnen (neuer Tab)";
        rowEl.appendChild(link);
      }
      // 🗑 nur diese Gruppe entfernen.
      var del = el("button", bs, "🗑"); del.type = "button";
      del.title = "Eintrag entfernen";
      (function (qid) { del.addEventListener("click", function () { deleteMailEntry(qid); }); })(e.qid);
      rowEl.appendChild(del);
      cardsEl.appendChild(rowEl);
    });
    markMailSeen();
  }
  // Beantwortetes als gesehen markieren (Zähler runter).
  function markMailSeen() {
    var cur = loadPending().map(function (e) {
      if (e.status === "beantwortet" && !e.seen) { var c = {}; for (var k in e) { if (Object.prototype.hasOwnProperty.call(e, k)) c[k] = e[k]; } c.seen = true; return c; }
      return e;
    });
    savePending(cur);
    updateMailBadge();
  }
  function onMailClick() { recheckMail({ show: true }); }

  var askInputEl = null, answerBtn = null;   // Bau 23.B — Frage-Feld + Antwortrecht-Schalter
  var voiceBtnEl = null, activeRecognizer = null;   // 🎤 Spracheingabe (Modul 21)
  var answerFetchBtn = null;   // A11 — „🔎 Antwort holen": bestpassenden Knoten automatisch fragen
  // A11-Last-Schoner (Klaus 2026-07-11, Tablet friert bei Mehrfach-Klick ein):
  // eine laufende Auto-Suche sperrt weitere Klicks, und dieselbe Frage wird nicht
  // sofort erneut eingebettet (Embedding ist teuer). Rein lokal, fail-soft.
  var autoAskBusy = false, lastAutoAskText = null, lastAutoAskTs = 0;
  var AUTOASK_COOLDOWN_MS = 4000;
  var relatedOnly = false;   // „nur verwandte zeigen" (reine Anzeige, Default aus)
  var lastCards = [];        // letzte gelesene Karten (für Re-Render beim Umschalten)

  // KI-Richter (A4/B3, opt-in): die Antworten eines anderen Knoten nach
  // BEDEUTUNG neu beurteilen/sortieren (Modul 04 hybridMatch, BYOK) statt nur
  // nach rohem Cosinus. Default AUS (gratis). Der Schlüssel bleibt NUR im
  // Speicher (nie persistiert, nie ins Repo). Fail-soft: ohne Modul 04 / ohne
  // Schlüssel / bei Fehler bleibt die rohe Cosinus-Reihenfolge. Der
  // 0.80-Andock-Riegel (Modul 05) ist davon UNBERÜHRT — reine Anzeige.
  var kiOn = false, kiProvider = "", kiKey = "";
  var kiToggleEl = null, kiProvSelEl = null, kiKeyEl = null, kiKeyLinkEl = null;
  var kiSaveBtnEl = null, kiUnlockBtnEl = null;   // 🔒 im Tresor merken / 🔓 entsperren (Modul 20)
  // Anbieter → Seite, auf der man seinen EIGENEN Schlüssel holt. Fremdnutzer-
  // Hilfe (Klaus 2026-07-11): wählt jemand den KI-Richter und hat noch keinen
  // Schlüssel, verlinken wir direkt dorthin — statt „irgendwo in einem anderen
  // Tab suchen". Unbekannter Anbieter → kein Link (fail-soft).
  var KI_KEY_URLS = {
    claude: "https://console.anthropic.com/settings/keys",
    mistral: "https://console.mistral.ai/api-keys/",
    openai: "https://platform.openai.com/api-keys",
    gemini: "https://aistudio.google.com/app/apikey",
    openrouter: "https://openrouter.ai/keys",
  };
  var lastAnswer = null;     // { card, text, res } — für Re-Judge beim Umschalten
  var answerSeq = 0;         // Race-Schutz: nur die neueste Antwort rendern

  function doc() { return global.document; }
  function rdv() { return global.SbkimRendezvous || null; }
  // Modul 03 nur, wenn die Frage-Einbettung (embedQuery) wirklich da ist — A11
  // Auto-Auswahl; fail-soft: ohne Modul 03 rankt rankCardsByQuery nicht und der
  // Aufrufer degradiert auf die Recency-Reihenfolge (frischeste Karte).
  function embedMod() { var e = global.SbkimEmbedding; return (e && typeof e.embedQuery === "function") ? e : null; }
  // Modul 04 nur, wenn der KI-Richter (hybridMatch) wirklich da ist — fail-soft.
  function matchMod() { var m = global.SbkimMatch; return (m && typeof m.hybridMatch === "function") ? m : null; }
  // Anbieter-Liste aus Modul 04 (id/label/region), EU-gefiltert bei cfg.euOnly.
  function kiProviders() {
    var m = matchMod();
    var list = (m && m._meta && Array.isArray(m._meta.hybridProviders)) ? m._meta.hybridProviders : [];
    return list.filter(function (p) { return cfg.euOnly ? (p.region === "eu") : true; });
  }
  function accent() { return cfg.accent || "var(--accent,#6ee7d3)"; }

  function el(tag, css, text) {
    var d = doc();
    var e = d.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---- Eigener Tooltip statt nativem `title` (Klaus 2026-07-12) ----
  // Native title-Tooltips landen im Split-Screen/DeX oft halb hinter dem Panel
  // (der Browser platziert sie selbst). Wir übernehmen die Platzierung: `title`
  // → `data-sbtip`, nativen Tooltip AUS; eigener Tooltip am <body> (position:fixed,
  // entkommt jedem overflow/z-index), unter dem Element, in den Viewport geklemmt,
  // über allem (z-index max). DOM-only, fail-soft.
  var _tipEl = null;
  function ensureTipEl() {
    if (_tipEl && _tipEl.parentNode) return _tipEl;
    var d = doc();
    if (!d || !d.body) return null;
    _tipEl = d.createElement("div");
    _tipEl.setAttribute("role", "tooltip");
    _tipEl.style.cssText = "position:fixed;z-index:2147483647;max-width:min(320px,80vw);" +
      "background:rgba(15,18,28,.97);color:#eef2f8;font:500 .72rem/1.4 var(--mono,system-ui,sans-serif);" +
      "padding:6px 9px;border:1px solid rgba(255,255,255,.18);border-radius:8px;" +
      "box-shadow:0 6px 22px rgba(0,0,0,.55);pointer-events:none;opacity:0;transition:opacity .12s;display:none";
    d.body.appendChild(_tipEl);
    return _tipEl;
  }
  function showTip(target, text) {
    var t = ensureTipEl();
    if (!t || !text || !target || typeof target.getBoundingClientRect !== "function") return;
    t.textContent = text;
    t.style.display = "block";
    var r = target.getBoundingClientRect();
    var vw = global.innerWidth || 1024, vh = global.innerHeight || 768;
    var tw = t.offsetWidth, th = t.offsetHeight;
    var left = Math.max(6, Math.min(r.left, vw - tw - 6));
    var top = r.bottom + 6;
    if (top + th > vh - 6) top = Math.max(6, r.top - th - 6); // kein Platz unten → oben
    t.style.left = left + "px";
    t.style.top = top + "px";
    t.style.opacity = "1";
  }
  function hideTip() { if (_tipEl) { _tipEl.style.opacity = "0"; _tipEl.style.display = "none"; } }
  // Alle nativen `title` unter root (inkl. root selbst) auf den eigenen Tooltip
  // umstellen: Text nach data-sbtip, title entfernen, Hover/Focus-Listener setzen.
  function adoptTips(root) {
    try {
      if (!root || typeof root.querySelectorAll !== "function") return;
      var list = [];
      if (root.getAttribute && root.getAttribute("title")) list.push(root);
      var nodes = root.querySelectorAll("[title]");
      for (var i = 0; i < nodes.length; i++) list.push(nodes[i]);
      list.forEach(function (elm) {
        var txt = elm.getAttribute("title");
        if (txt == null) return;
        elm.setAttribute("data-sbtip", txt);
        elm.removeAttribute("title"); // nativen Browser-Tooltip abschalten
        elm.addEventListener("mouseenter", function () { showTip(elm, elm.getAttribute("data-sbtip")); });
        elm.addEventListener("mouseleave", hideTip);
        elm.addEventListener("focus", function () { showTip(elm, elm.getAttribute("data-sbtip")); });
        elm.addEventListener("blur", hideTip);
        elm.addEventListener("pointerdown", hideTip);
      });
    } catch (_e) { /* fail-soft — dann bleibt es beim Label ohne Tooltip */ }
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
  // Das „Mit dem Knotennetz verbinden"-Panel klebte in einer Ecke und verdeckte die
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
      "backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(0,0,0,.35)", "🌐 Mit dem Knotennetz verbinden");
    btnEl.type = "button";
    btnEl.id = "sbkim-rdv-btn";
    btnEl.title = "Andere Knoten treffen";

    panelEl = el("div", "position:fixed;" + cornerCss(cfg.corner, true) + ";z-index:2147483600;" +
      "width:min(420px,92vw);display:none;max-height:80vh;overflow-y:auto;-webkit-overflow-scrolling:touch;" +
      "background:rgba(10,12,20,.94);border:1px solid " + ac + ";border-radius:12px;padding:14px;" +
      "color:#eef2f8;font:.82rem/1.5 var(--sans,system-ui,sans-serif);backdrop-filter:blur(10px);" +
      "box-shadow:0 12px 34px rgba(0,0,0,.5)");
    panelEl.id = "sbkim-rdv-panel";

    var head = el("div", "display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;cursor:move");
    head.title = "Ziehen zum Verschieben";
    head.appendChild(el("strong", "color:" + ac, "🌐 Mit dem Knotennetz verbinden"));
    var headBtns = el("div", "display:flex;align-items:center;gap:2px");
    var minBtn = el("button", "background:none;border:none;color:#9aa7b6;font-size:1.4rem;line-height:.6;cursor:pointer;padding:0 6px", "–");
    minBtn.type = "button";
    minBtn.title = "Minimieren";
    headBtns.appendChild(minBtn);
    var closeBtn = el("button", "background:none;border:none;color:#9aa7b6;font-size:1.1rem;cursor:pointer", "✕");
    closeBtn.type = "button";
    closeBtn.title = "Schließen";
    headBtns.appendChild(closeBtn);
    head.appendChild(headBtns);
    panelEl.appendChild(head);

    // Empfänger-Hinweis-Zeile (eingehender Handshake) — unter der Kopfzeile,
    // getrennt von outEl, damit sie nie Such-/Raum-Ausgaben überschreibt.
    incomingEl = el("div", "display:none;margin:2px 0 8px;padding:7px 10px;border-radius:8px;" +
      "border:1px solid " + ac + ";background:rgba(110,231,211,.14);color:#eef2f8;" +
      "font-size:.76rem;white-space:pre-wrap;word-break:break-word");
    incomingEl.id = "sbkim-rdv-incoming";
    panelEl.appendChild(incomingEl);
    renderIncoming();   // falls schon vor mount ein Handshake ankam

    panelEl.appendChild(el("p", "margin:0 0 10px;color:#9aa7b6",
      "Triff andere SBKIM-Knoten im gemeinsamen Raum — server-los, direkt aus deinem Browser. Lass diesen Tab offen, damit du erreichbar bleibst."));

    var row = el("div", "display:flex;gap:8px;flex-wrap:wrap");
    var connectBtn = el("button", bs, "🌐 Mit dem Knotennetz verbinden"); connectBtn.type = "button";
    var discoverBtn = el("button", bsGhost, "👥 Wer ist im Raum?"); discoverBtn.type = "button";
    var announceBtn = el("button", bsGhost, "🙋 Nur neu anmelden"); announceBtn.type = "button";
    mailBtn = el("button", bsGhost, "📬 Antworten abholen"); mailBtn.type = "button";
    mailBtn.title = "Antworten abholen";
    reAskBtn = el("button", bsGhost + ";font-size:.74rem", "🔁 offene nochmal fragen"); reAskBtn.type = "button";
    reAskBtn.title = "Offene Fragen neu stellen";
    clearMailBtn = el("button", bsGhost + ";font-size:.74rem", "🗑 leeren"); clearMailBtn.type = "button";
    clearMailBtn.title = "Briefkasten leeren";
    row.appendChild(connectBtn); row.appendChild(discoverBtn); row.appendChild(announceBtn); row.appendChild(mailBtn);
    row.appendChild(reAskBtn); row.appendChild(clearMailBtn);
    panelEl.appendChild(row);

    // „🧬 nur verwandte" — REINE Anzeige: filtert die Karten-Liste auf echte
    // Verwandte (zentrierter Score, Modul 04 via Modul 23). Gatet NICHTS, der
    // 0.80-Andock-Riegel bleibt unberührt. Default aus.
    var filterRow = el("div", "margin-top:8px");
    relOnlyBtn = el("button", bsGhost + ";font-size:.74rem;padding:5px 10px", "🧬 nur verwandte: aus");
    relOnlyBtn.type = "button";
    relOnlyBtn.title = "Nur verwandte Knoten zeigen";
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
    repairBtn.title = "Aufräumen & neu anmelden";
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
    // 🎤 Spracheingabe (Modul 21). Fremdnutzer-sicher: ohne Modul 21 bleibt das
    // Textfeld voll nutzbar (der Knopf gibt dann nur eine ehrliche Notiz).
    voiceBtnEl = el("button", bsGhost + ";font-size:.9rem;padding:5px 8px", "🎤");
    voiceBtnEl.type = "button";
    voiceBtnEl.title = "Frage einsprechen";
    answerBtn = el("button", bsGhost + ";font-size:.74rem;padding:5px 10px", "💬 Antworten: aus");
    answerBtn.type = "button";
    answerBtn.title = "Anderen Knoten antworten";
    // A11 — Primär-Knopf „🔎 Antwort holen": rankt alle Raum-Knoten nach Passung
    // zur getippten Frage und fragt den bestpassenden AUTOMATISCH (Klaus: „ich
    // weiß nicht, wer von hundert am besten passt"). Solide Akzent-Optik, direkt
    // neben dem Frage-Feld. Reine Auswahl/Anzeige — der 0.80-Andock-Riegel bleibt
    // unberührt; das per-Karte „❓ gezielt fragen" bleibt als manueller Override.
    answerFetchBtn = el("button", "padding:6px 12px;border-radius:8px;border:1px solid " + accent() + ";" +
      "background:" + accent() + ";color:#0a1018;cursor:pointer;font:inherit;font-size:.78rem;font-weight:600", "🔎 Antwort holen");
    answerFetchBtn.type = "button";
    answerFetchBtn.title = "Beste Antwort automatisch holen";
    askRow.appendChild(askInputEl);
    askRow.appendChild(answerFetchBtn);
    askRow.appendChild(voiceBtnEl);
    askRow.appendChild(answerBtn);
    panelEl.appendChild(askRow);
    voiceBtnEl.addEventListener("click", function () { onVoiceClick(); });
    answerFetchBtn.addEventListener("click", function () { onAutoAsk(); });

    // KI-Richter-Zeile (A4/B3, opt-in). Fremdnutzer-Perspektive: ohne
    // Schlüssel läuft alles gratis weiter (roher Cosinus); mit Schlüssel
    // beurteilt der KI-Richter nach BEDEUTUNG. Klar benannt, was passiert:
    // kostet (eigener Schlüssel), Schlüssel bleibt NUR im Browser, und die
    // Antwort-TITEL gehen an den gewählten KI-Anbieter (Daten-Abfluss benannt).
    var kiRow = el("div", "margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center");
    kiToggleEl = el("button", bsGhost + ";font-size:.72rem;padding:4px 9px", "🧠 KI-Richter: aus");
    kiToggleEl.type = "button";
    kiToggleEl.title = "KI bewertet die Antworten (eigener Schlüssel)";
    kiProvSelEl = doc().createElement("select");
    kiProvSelEl.style.cssText = "display:none;font-size:.72rem;padding:4px 6px;border-radius:8px;border:1px solid rgba(154,167,182,.35);background:rgba(10,16,24,.6);color:#e8eef6";
    kiProvSelEl.title = "KI-Anbieter wählen";
    kiKeyEl = el("input", "display:none;flex:1;min-width:120px;padding:4px 8px;border-radius:8px;border:1px solid rgba(154,167,182,.35);background:rgba(10,16,24,.6);color:#e8eef6;font-size:.72rem");
    kiKeyEl.type = "password";
    kiKeyEl.autocomplete = "off";
    kiKeyEl.placeholder = "dein KI-Schlüssel — bleibt nur im Browser";
    // „🔑 Schlüssel holen ↗" — Direktlink zur Schlüsselseite des gewählten
    // Anbieters. Sichtbar nur, wenn KI-Richter an ist UND noch KEIN Schlüssel
    // eingegeben wurde (dann braucht man ihn ja gerade). Neuer Tab, fail-soft.
    kiKeyLinkEl = doc().createElement("a");
    kiKeyLinkEl.textContent = "🔑 Schlüssel holen ↗";
    kiKeyLinkEl.target = "_blank"; kiKeyLinkEl.rel = "noopener noreferrer";
    kiKeyLinkEl.title = "Schlüssel beim Anbieter holen";
    kiKeyLinkEl.style.cssText = "display:none;font-size:.72rem;padding:4px 8px;border-radius:8px;border:1px solid rgba(154,167,182,.35);color:#9fd2ff;text-decoration:none;white-space:nowrap";
    // 🔒 im Tresor merken / 🔓 entsperren (Modul 20 Safe). Nur sichtbar, wenn
    // der Safe geladen ist (fail-soft für Forker ohne Modul 20). Sicher: der
    // Schlüssel wird verschlüsselt abgelegt (PBKDF2+AES-GCM), nie im Klartext.
    kiSaveBtnEl = el("button", bsGhost + ";font-size:.72rem;padding:4px 8px", "🔒 im Tresor merken");
    kiSaveBtnEl.type = "button";
    kiSaveBtnEl.title = "Schlüssel sicher merken";
    kiSaveBtnEl.style.display = "none";
    kiUnlockBtnEl = el("button", bsGhost + ";font-size:.72rem;padding:4px 8px", "🔓 Tresor entsperren");
    kiUnlockBtnEl.type = "button";
    kiUnlockBtnEl.title = "Gemerkten Schlüssel holen";
    kiUnlockBtnEl.style.display = "none";
    kiRow.appendChild(kiToggleEl);
    kiRow.appendChild(kiProvSelEl);
    kiRow.appendChild(kiKeyEl);
    kiRow.appendChild(kiKeyLinkEl);
    kiRow.appendChild(kiSaveBtnEl);
    kiRow.appendChild(kiUnlockBtnEl);
    kiSaveBtnEl.addEventListener("click", function () { onKiSaveToVault(); });
    kiUnlockBtnEl.addEventListener("click", function () { onKiUnlockVault(); });
    panelEl.appendChild(kiRow);
    kiToggleEl.addEventListener("click", function () { onToggleKiRichter(); });
    kiProvSelEl.addEventListener("change", function () { kiProvider = kiProvSelEl.value; updateKiKeyLink(); updateKiVaultButtons(); renderAnswer(); });
    kiKeyEl.addEventListener("input", function () { kiKey = kiKeyEl.value; updateKiKeyLink(); updateKiVaultButtons(); });

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

    // Native title-Tooltips durch den eigenen, sauber platzierten Tooltip ersetzen
    // (Klaus 2026-07-12: nativ landete er im Split-Screen halb hinter dem Panel).
    adoptTips(panelEl);
    adoptTips(btnEl);

    btnEl.addEventListener("click", function () { toggle(); });
    closeBtn.addEventListener("click", function () { hide(); });
    minBtn.addEventListener("click", function () { hide(); });
    connectBtn.addEventListener("click", function () { onConnect(); });
    discoverBtn.addEventListener("click", function () { onDiscover(); });
    announceBtn.addEventListener("click", function () { onAnnounce(); });
    mailBtn.addEventListener("click", function () { onMailClick(); });
    reAskBtn.addEventListener("click", function () { reAskOpen(); });
    clearMailBtn.addEventListener("click", function () { clearMail(); });
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

    startIncomingWatch();   // eingehende Handshakes ab jetzt sichtbar machen
    updateMailBadge();      // A12: Zähler aus gespeichertem Briefkasten-Stand
    recheckMail();          // A12: offene Fragen still nachlesen (Badge aktualisiert sich)
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

  // A11 — „🔎 Antwort holen": bestpassenden Knoten AUTOMATISCH wählen + fragen.
  // Klaus 2026-07-11: bei vielen Knoten kann der Nutzer nicht selbst wissen, wer
  // am besten passt. Ablauf: Frage einbetten (Modul 03, fail-soft) → Raum lesen →
  // rankCardsByQuery (Modul 23, Passung zur Frage) → Karten sortiert zeigen →
  // besten Knoten fragen, Rest als Nächstbester-Nachfass. Reine Auswahl/Anzeige;
  // der 0.80-Andock-Riegel bleibt unberührt.
  function onAutoAsk() {
    var r = ensureRdv();
    if (!r) return;
    if (typeof r.askNode !== "function") { setOut("Modul 23 mit Bau 23.B (askNode) nicht geladen."); return; }
    var text = askInputEl ? String(askInputEl.value || "").trim() : "";
    if (!text) { setOut("🔎 Zuerst oben eine Frage eintippen, dann „🔎 Antwort holen“."); return; }
    // Last-Schoner: laufende Suche sperrt weitere Klicks (kein Stapeln auf dem
    // einkernigen Browser-Tab); identische Frage im Cooldown nicht neu einbetten.
    if (autoAskBusy) { setOut("🔎 Suche läuft schon — einen Moment …"); return; }
    var nowMs = Date.now();
    if (text === lastAutoAskText && (nowMs - lastAutoAskTs) < AUTOASK_COOLDOWN_MS) {
      setOut("🔎 Diese Frage lief gerade — kurz warten, dann erneut."); return;
    }
    autoAskBusy = true; lastAutoAskText = text; lastAutoAskTs = nowMs;
    if (answerFetchBtn) answerFetchBtn.disabled = true;
    function autoAskDone() { autoAskBusy = false; if (answerFetchBtn) answerFetchBtn.disabled = false; }
    // Fail-soft: älteres Modul 23 ohne A11 → wie „Wer ist im Raum?" (manuell fragen).
    var canRank = typeof r.rankCardsByQuery === "function";
    setOut("🔎 Suche im Raum den Knoten, der am besten zu deiner Frage passt …");
    startModelProgress("🔎 Suche den passenden Knoten …");
    var emb = embedMod();
    var qvP = (canRank && emb)
      ? Promise.resolve().then(function () { return emb.embedQuery(text); }).catch(function () { return null; })
      : Promise.resolve(null);
    qvP.then(function (qv) {
      return r.discover().then(function (res) {
        stopModelProgress();
        if (!res || !res.ok) { setOut("✗ Raum-Lesen fehlgeschlagen: " + ((res && res.reason) || "(unbekannt)")); return; }
        var cards = Array.isArray(res.cards) ? res.cards : [];
        if (cards.length === 0) { renderCards(cards); return; }   // „niemand im Raum"-Notiz
        var ranked = canRank ? r.rankCardsByQuery(cards, qv) : cards;
        renderCards(ranked, { queryRanked: canRank && !!qv });
        var best = ranked[0];
        // Ehrliche Grenze: sehr schwache Passung benennen (aber NICHT gaten).
        if (qv && typeof best.queryFit === "number" && best.queryFit < 0.15) {
          setOut("🔎 Kein wirklich gut passender Knoten im Raum — ich frage trotzdem den nächstliegenden (" +
            (best.nodeName || "Knoten") + ") …");
        }
        askWithRetry(r, best, text, true, ranked.slice(1));
      });
    }).then(autoAskDone, function (e) { autoAskDone(); stopModelProgress(); setOut("✗ " + (e && e.message ? e.message : e)); });
  }

  function renderCards(cards, opts) {
    lastCards = Array.isArray(cards) ? cards : [];
    var o = opts || {};
    var queryRanked = o.queryRanked === true;   // A11: nach Frage-Passung sortiert
    if (outEl) outEl.textContent = "";
    if (!cardsEl) return;
    clear(cardsEl);
    if (lastCards.length === 0) {
      if (outEl) outEl.textContent = "Niemand (Fremdes) im Raum. Lass den Gegenknoten zuerst „🌐 Mit dem Knotennetz verbinden“ drücken — dann hier nochmal „👥 Wer ist im Raum?“.";
      return;
    }
    var ac = accent();
    var bs = "padding:5px 10px;border-radius:8px;border:1px solid " + ac + ";" +
      "background:rgba(110,231,211,.12);color:#eef2f8;cursor:pointer;font:inherit";
    // Der „nur verwandte"-Filter (eigene Domäne) gilt für die „Wer ist im Raum?"-
    // Ansicht; bei der Frage-Rangfolge (A11) NICHT filtern, sonst versteckt er
    // womöglich genau den frage-besten Knoten.
    var shown = (relatedOnly && !queryRanked) ? lastCards.filter(function (c) { return c.isRelated === true; }) : lastCards;
    if (shown.length === 0) {
      cardsEl.appendChild(el("div", "color:#9aa7b6", "Keiner der " + lastCards.length +
        " Knoten im Raum ist (im engen Maß) verwandt. Schalte „🧬 nur verwandte“ wieder auf „aus“, um alle zu sehen."));
      return;
    }
    var head = queryRanked
      ? ("🔎 " + shown.length + " Knoten nach Passung zu deiner Frage (bester zuerst):")
      : (relatedOnly
        ? ("🧬 " + shown.length + " verwandte von " + lastCards.length + " im Raum:")
        : ("👥 " + lastCards.length + " Knoten im Raum:"));
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
        badge.title = "Wie verwandt die Domäne ist";
        info.appendChild(badge);
      }
      // A11 — Passung zur getippten Frage (nur wenn rankCardsByQuery einen Score lieferte).
      if (typeof c.queryFit === "number" && isFinite(c.queryFit)) {
        info.appendChild(el("br"));
        var qBadge = el("span", "display:inline-block;margin-top:3px;padding:1px 7px;border-radius:6px;font-size:.68rem;" +
          "background:rgba(159,210,255,.16);color:#9fd2ff", "🔎 Frage-Passung " + c.queryFit.toFixed(2));
        qBadge.title = "Wie gut der Knoten zur Frage passt";
        info.appendChild(qBadge);
      }
      rowEl.appendChild(info);
      var b = el("button", bs, "🤝 Andocken"); b.type = "button";
      b.addEventListener("click", function () { onHandshake(c); });
      rowEl.appendChild(b);
      var qb = el("button", bs + ";margin-left:6px;opacity:.72;font-size:.72rem", "❓ gezielt fragen"); qb.type = "button";
      qb.title = "Gezielt diesen Knoten fragen";
      qb.addEventListener("click", function () { onAsk(c); });
      rowEl.appendChild(qb);
      // Partner-Link (Klaus 2026-07-12): direkt die App/PWA des Knotens öffnen,
      // um selbst dort zu suchen — ohne auf die Cross-Knoten-Antwort zu warten
      // (die server-los nur kommt, wenn der andere Tab offen+wach ist). Adresse
      // aus der Spore (endpoint). Fail-soft: ohne endpoint kein Link.
      var ep = (c.spore && typeof c.spore.endpoint === "string") ? c.spore.endpoint.trim() : "";
      if (/^https?:\/\//i.test(ep)) {
        var link = el("a", bs + ";margin-left:6px;font-size:.72rem;text-decoration:none;display:inline-block", "↗ App öffnen");
        link.href = ep; link.target = "_blank"; link.rel = "noopener noreferrer";
        link.title = "App des Knotens öffnen (neuer Tab)";
        rowEl.appendChild(link);
      }
      cardsEl.appendChild(rowEl);
    });
  }

  // Bau 23.B — Cross-Knoten-Frage per Knopf (nutzt das Frage-Feld oben).
  function onAsk(card) {
    var r = rdv();
    if (!r || typeof r.askNode !== "function") { setOut("Modul 23 mit Bau 23.B (askNode) nicht geladen."); return; }
    var text = askInputEl ? String(askInputEl.value || "").trim() : "";
    if (!text) { if (outEl) outEl.textContent = "❓ Zuerst oben eine Frage eintippen (z.B. kuchen), dann ❓ Fragen antippen."; return; }
    askWithRetry(r, card, text, true);
  }

  // Provider-Auswahl mit der (EU-gefilterten) Modul-04-Liste füllen. Fremd-
  // nutzer-sicher: ist Modul 04 nicht da / Liste leer, bleibt der KI-Richter
  // schlicht ohne Anbieter (Knopf tut dann nichts als eine ehrliche Notiz).
  function populateKiProviders() {
    if (!kiProvSelEl) return;
    var list = kiProviders();
    kiProvSelEl.innerHTML = "";
    list.forEach(function (p) {
      var o = doc().createElement("option");
      o.value = p.id; o.textContent = p.label || p.id;
      kiProvSelEl.appendChild(o);
    });
    if (list.length && !kiProvider) kiProvider = list[0].id;
    if (kiProvider) kiProvSelEl.value = kiProvider;
  }

  // Modul 20 (Safe) nur, wenn die Geheimnis-Ablage wirklich da ist — fail-soft.
  function safeMod() {
    var s = global.SbkimSafe;
    return (s && typeof s.putSecret === "function" && typeof s.getSecret === "function") ? s : null;
  }
  function kiSecretName() { return "ki_richter_key:" + (kiProvider || "default"); }
  // Passwort-Abfrage (Browser-prompt; in Tests stubbar). null = abgebrochen.
  function askVaultPassword(purpose) {
    if (typeof global.prompt === "function") { try { return global.prompt(purpose); } catch (e) { return null; } }
    return null;
  }
  // Optionale Merkhilfe-Abfrage (leer erlaubt = keine Merkhilfe). Getrennt
  // stubbar von askVaultPassword, damit Tests beide unterscheiden können.
  function askVaultHint(purpose) {
    if (typeof global.prompt === "function") { try { return global.prompt(purpose); } catch (e) { return null; } }
    return null;
  }
  // Ehrlicher Vergessen-Hinweis: der KI-Schlüssel ist BYOK (jeder holt seinen
  // eigenen, gratis) — Passwort vergessen ist kein Datenverlust.
  var FORGOT_HINT = "Passwort vergessen? Kein Drama — hol dir beim Anbieter gratis einen neuen Schlüssel und leg ihn neu ab.";
  // Tresor-Knöpfe: „merken" wenn KI an + Schlüssel getippt + Safe da;
  // „entsperren" wenn KI an + KEIN Schlüssel getippt + Safe da.
  function updateKiVaultButtons() {
    var safe = safeMod();
    var canSave = kiOn && !!(kiKey && kiKey.length) && !!safe;
    var canUnlock = kiOn && !(kiKey && kiKey.length) && !!safe;
    if (kiSaveBtnEl) kiSaveBtnEl.style.display = canSave ? "" : "none";
    if (kiUnlockBtnEl) kiUnlockBtnEl.style.display = canUnlock ? "" : "none";
  }
  function onKiSaveToVault() {
    var safe = safeMod();
    if (!safe) { setVoiceHint("Tresor (Modul 20) nicht geladen."); return; }
    if (!(kiKey && kiKey.length)) { setVoiceHint("Erst einen Schlüssel eingeben, dann merken."); return; }
    var pw = askVaultPassword("Tresor-Passwort (min. 8 Zeichen) — verschlüsselt deinen KI-Schlüssel:");
    if (!pw) return;
    // Optionale Merkhilfe (leer lassen erlaubt). NICHT das Passwort selbst
    // hier eintragen — die Merkhilfe ist unverschlüsselt lesbar.
    var hintRaw = askVaultHint("Merkhilfe fürs Passwort (freiwillig, leer lassen möglich) — NICHT das Passwort selbst:");
    var opts = (hintRaw && hintRaw.trim()) ? { hint: hintRaw.trim() } : undefined;
    return Promise.resolve().then(function () { return safe.putSecret(kiSecretName(), kiKey, pw, opts); })
      .then(function () { setVoiceHint("🔒 Schlüssel verschlüsselt im Tresor gemerkt — beim nächsten Mal mit 🔓 entsperren. " + FORGOT_HINT); })
      .catch(function (e) { setVoiceHint("Tresor-Fehler: " + (e && e.message ? e.message : e)); });
  }
  function onKiUnlockVault() {
    var safe = safeMod();
    if (!safe) { setVoiceHint("Tresor (Modul 20) nicht geladen."); return; }
    var name = kiSecretName();
    // Erst die (unverschlüsselte) Merkhilfe holen und in die Passwort-Frage
    // einblenden, damit der Nutzer eine Erinnerungsstütze hat.
    var getHint = (typeof safe.getSecretHint === "function") ? safe.getSecretHint(name) : Promise.resolve(null);
    return Promise.resolve(getHint).catch(function () { return null; }).then(function (hint) {
      var prompt = "Tresor-Passwort — holt deinen gemerkten KI-Schlüssel:";
      if (hint) prompt = "Merkhilfe: " + hint + "\n\n" + prompt;
      var pw = askVaultPassword(prompt);
      if (!pw) return;
      return Promise.resolve().then(function () { return safe.getSecret(name, pw); })
        .then(function (v) {
          if (v) {
            kiKey = v; if (kiKeyEl) kiKeyEl.value = v;
            updateKiKeyLink(); updateKiVaultButtons(); renderAnswer();
            setVoiceHint("🔓 Schlüssel aus dem Tresor geholt.");
          } else { setVoiceHint("Kein gemerkter Schlüssel oder falsches Passwort. " + FORGOT_HINT); }
        })
        .catch(function (e) { setVoiceHint("Tresor-Fehler: " + (e && e.message ? e.message : e)); });
    });
  }

  // „🔑 Schlüssel holen"-Link nur zeigen, wenn KI-Richter an ist, noch KEIN
  // Schlüssel getippt ist und wir für den Anbieter eine Seite kennen.
  function updateKiKeyLink() {
    if (!kiKeyLinkEl) return;
    var url = KI_KEY_URLS[kiProvider];
    var need = kiOn && !(kiKey && kiKey.length) && !!url;
    kiKeyLinkEl.style.display = need ? "" : "none";
    if (url) kiKeyLinkEl.href = url;
  }

  function onToggleKiRichter() {
    kiOn = !kiOn;
    if (kiOn) populateKiProviders();
    var show = kiOn ? "" : "none";
    if (kiProvSelEl) kiProvSelEl.style.display = show;
    if (kiKeyEl) kiKeyEl.style.display = show;
    if (kiToggleEl) kiToggleEl.textContent = "🧠 KI-Richter: " + (kiOn ? "an" : "aus");
    updateKiKeyLink();
    updateKiVaultButtons();
    renderAnswer();   // vorhandene Antwort sofort neu beurteilen/zurückstufen
  }

  // Zeigt die letzte Antwort an. Default: rohe Cosinus-Reihenfolge (gratis).
  // Ist der KI-Richter an UND ein Schlüssel gesetzt UND Modul 04 da, wird die
  // Trefferliste zusätzlich vom KI-Richter (hybridMatch) nach Bedeutung neu
  // sortiert (mit Begründung). Alles fail-soft: jeder Fehler → Cosinus bleibt.
  function renderAnswer() {
    if (!outEl || !lastAnswer) return;
    var card = lastAnswer.card, res = lastAnswer.res, text = lastAnswer.text;
    var head = "✓ Antwort von " + (card.nodeName || "Knoten") + " (" + Math.round((res.tookMs || 0) / 100) / 10 + " s):";
    if (!res.results || !res.results.length) {
      outEl.textContent = head + "\n  (keine Treffer in seinem Buch — ehrlich leer)";
      return;
    }
    function cosineLines() {
      var lines = [head];
      res.results.forEach(function (h, i) {
        lines.push("  " + (i + 1) + ". " + h.label + (typeof h.score === "number" ? "  (" + h.score.toFixed(2) + ")" : ""));
      });
      lines.push("— Bedeutungs-Suche: sein Knoten hat in SEINEM Buch nach deinem Sinn gesucht.");
      return lines.join("\n");
    }
    var m = matchMod();
    if (!(kiOn && kiKey && kiKey.length && m)) {
      outEl.textContent = cosineLines();
      return;
    }
    // KI-Richter-Pfad (opt-in, BYOK). Erst Cosinus zeigen + „urteilt …", dann
    // ersetzen, wenn das Urteil da ist. Race-Schutz über answerSeq.
    var seq = ++answerSeq;
    outEl.textContent = cosineLines() + "\n\n🧠 KI-Richter beurteilt nach Bedeutung …";
    // Cross-Knoten-Antworten tragen nur TITEL (keine Inhalte, Datenschutz) — der
    // Richter (Modul 04 hybridMatch) verlangt aber pro Kandidat einen nicht-leeren
    // `text`. Also den Titel als Bedeutungs-Text durchreichen; leere überspringen.
    var candidates = res.results.map(function (h) {
      var label = (typeof h.label === "string") ? h.label : "";
      var t = (typeof h.text === "string" && h.text.length) ? h.text : label;
      return { label: label, text: t, cosine: (typeof h.score === "number") ? h.score : null };
    }).filter(function (c) { return c.label && c.text; });
    // Nichts Beurteilbares → ehrlich beim Cosinus bleiben (kein Richter-Fehler).
    if (candidates.length === 0) { outEl.textContent = cosineLines(); return; }
    var opts = { apiKey: kiKey, euOnly: !!cfg.euOnly };
    if (kiProvider) opts.provider = kiProvider;
    Promise.resolve()
      .then(function () { return m.hybridMatch(text, candidates, opts); })
      .then(function (v) {
        if (seq !== answerSeq) return;            // veraltet — neue Frage/Antwort
        if (!v || v.available === false || !Array.isArray(v.verdicts)) {
          var why = (v && v.reason) ? " (" + v.reason + ")" : "";
          outEl.textContent = cosineLines() + "\n\n🧠 KI-Richter: kein Urteil" + why + " — rohe Reihenfolge bleibt.";
          return;
        }
        // Nach KI-Score absteigend sortieren (Bedeutungs-Urteil), stabil.
        var judged = v.verdicts.slice().sort(function (a, b) {
          return (Number(b.score) || 0) - (Number(a.score) || 0);
        });
        var lines = [head + "   🧠 KI-Richter (" + (v.provider || "?") + (v.region ? ", " + v.region : "") + ")"];
        judged.forEach(function (r, i) {
          var sc = (typeof r.score === "number") ? "  (" + r.score.toFixed(2) + ")" : "";
          var mark = (r.passt === false) ? " ·" : " ✓";
          lines.push("  " + (i + 1) + "." + mark + " " + (r.label != null ? r.label : "?") + sc);
          if (r.begruendung) lines.push("      – " + r.begruendung);
        });
        lines.push("— Beurteilt nach Bedeutung (✓ = passt). Nur die Titel gingen an den KI-Anbieter; dein Schlüssel blieb im Browser.");
        outEl.textContent = lines.join("\n");
      })
      .catch(function (e) {
        if (seq !== answerSeq) return;
        outEl.textContent = cosineLines() + "\n\n🧠 KI-Richter-Fehler: " + (e && e.message ? e.message : e) + " — rohe Reihenfolge bleibt.";
      });
  }

  // Kurze, transiente Notiz im Ausgabe-Bereich (Spracheingabe-Status/Fehler).
  function setVoiceHint(t) { if (outEl) outEl.textContent = t; }

  // 🎤 Spracheingabe (Modul 21) — Frage einsprechen. Spiegelt Modul 22
  // onVoiceClick, fail-soft. Fremdnutzer-sicher: ohne Modul 21 / ohne
  // Browser-Unterstützung bleibt das Textfeld voll nutzbar.
  function onVoiceClick() {
    var speech = global.SbkimSpeech;
    if (!speech || typeof speech.pickEngine !== "function") {
      setVoiceHint("🎤 Spracheingabe (Modul 21) nicht geladen — bitte tippen.");
      return;
    }
    var engine;
    try { engine = speech.pickEngine(cfg.euOnly ? "bindend" : "frei"); }
    catch (e) { setVoiceHint(speech.speechErrorHint ? speech.speechErrorHint(e) : "🎤 nicht möglich — bitte tippen."); return; }
    if (engine === "browser" && typeof speech.isBrowserSupported === "function" && speech.isBrowserSupported()) {
      var langs = (typeof speech.getLanguages === "function") ? speech.getLanguages() : [];
      var lang = (langs[0] || ["de-DE"])[0];
      try {
        activeRecognizer = speech.makeBrowserRecognizer({
          lang: lang,
          onResult: function (t) { if (askInputEl) { askInputEl.value = t; } setVoiceHint("Erkannt: " + t + "  — jetzt einen Knoten <❓ Fragen>."); },
          onError: function (h) { setVoiceHint("🎤 " + h); },
          onEnd: function () { activeRecognizer = null; },
        });
        activeRecognizer.start();
        setVoiceHint("🎤 Sprich jetzt deine Frage …");
      } catch (e) {
        setVoiceHint(speech.speechErrorHint ? speech.speechErrorHint(e) : "🎤 nicht möglich — bitte tippen.");
      }
      return;
    }
    setVoiceHint("🎤 Sprach-Engine braucht einen EU-Schlüssel — bitte tippen.");
  }

  function renderAskSuccess(card, res, text) {
    var q = (typeof text === "string" && text.length) ? text
          : ((askInputEl && askInputEl.value) ? String(askInputEl.value).trim() : "");
    lastAnswer = { card: card, res: res, text: q };
    renderAnswer();
  }

  // Fragen mit EINEM automatischen Nachschlag (Klaus 2026-07-10): bleibt die
  // Antwort aus (Karte evtl. veraltet, Alt-Identität nicht wach), den Raum
  // EINMAL neu lesen, die frischeste Karte desselben Knoten-NAMENS nehmen und
  // nachfragen. Fängt genau den „Visitenkarte veraltet"-Fall ab.
  // A11: bleibt der (beste) Knoten stumm, versuche EINMAL den nächstbesten Knoten
  // aus der nach Frage-Passung sortierten Liste (fallbackCards) — bevor die Frage
  // in den Briefkasten wandert. Findet keinen distinkten Nächsten → A12-Briefkasten.
  function giveUpOrFallback(r, res, card, text, fallbackCards) {
    if (!outEl) return;
    var rest = Array.isArray(fallbackCards) ? fallbackCards : [];
    var next = null, tail = [];
    for (var i = 0; i < rest.length; i++) {
      if (rest[i] && (rest[i].nodeId || "") !== (card.nodeId || "")) { next = rest[i]; tail = rest.slice(i + 1); break; }
    }
    if (next) {
      outEl.textContent = "… " + (card.nodeName || "Knoten") + " hat nicht geantwortet — ich frage den nächstbesten passenden Knoten (" +
        (next.nodeName || "Knoten") + ") …";
      askWithRetry(r, next, text, true, tail);
      return;
    }
    recordOpenQuestion(res, card, text);   // A12: Frage bleibt „offen"
    var epHint = (card && card.spore && typeof card.spore.endpoint === "string" && /^https?:\/\//i.test(card.spore.endpoint))
      ? "\nOder hol dir die Antwort selbst: „↗ App öffnen“ in der Karte oben öffnet " + (card.nodeName || "den Knoten") + " direkt — dort suchen, ohne zu warten."
      : "";
    outEl.textContent = "📭 " + (res && res.reason ? res.reason : "Keine Antwort — der Knoten ist gerade nicht offen/wach.") +
      "\nDie Frage bleibt in deinem Briefkasten offen — ich hole die Antwort automatisch beim nächsten Öffnen (oder tippe 📬 Antworten abholen)." + epHint;
  }

  function askWithRetry(r, card, text, allowRetry, fallbackCards) {
    if (outEl) outEl.textContent = "❓ Frage <" + text + "> an " + (card.nodeName || "Knoten") + " — warte auf Antwort …";
    r.askNode(card, text).then(function (res) {
      if (!outEl) return;
      if (res && res.ok) { renderAskSuccess(card, res, text); return; }
      if (allowRetry && typeof r.discover === "function") {
        outEl.textContent = "… keine Antwort — Karte evtl. veraltet. Ich lese den Raum neu und frage die frischeste Karte …";
        r.discover().then(function (d) {
          var fresh = null;
          if (d && d.ok && Array.isArray(d.cards)) {
            for (var i = 0; i < d.cards.length; i++) {
              if ((d.cards[i].nodeName || "") === (card.nodeName || "")) { fresh = d.cards[i]; break; }
            }
          }
          if (fresh && fresh.nodeId !== card.nodeId) {
            askWithRetry(r, fresh, text, false, fallbackCards);   // EIN Nachschlag mit frischer ID (Fallbacks weitergereicht)
          } else {
            giveUpOrFallback(r, res, card, text, fallbackCards);  // A11: nächstbester Knoten, sonst Briefkasten
          }
        }).catch(function () {
          if (outEl) outEl.textContent = "✗ " + (res && res.reason ? res.reason : "Keine Antwort.") + "\n(Raum-Neulesen fehlgeschlagen.)";
        });
        return;
      }
      giveUpOrFallback(r, res, card, text, fallbackCards);   // A11: nächstbester Knoten, sonst A12-Briefkasten
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
    // A12: beim Öffnen automatisch nachlesen; sind neue Antworten da, zeigen.
    recheckMail({ surfaceIfNews: true });
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
    // EU-Politik (Fremdnutzer-klar): euOnly:true → der KI-Richter bietet NUR
    // EU-Anbieter (z.B. Mistral) an. Default false (freie Anbieter-Wahl).
    if (typeof opts.euOnly === "boolean") cfg.euOnly = opts.euOnly;
    // A12: Briefkasten-Obergrenze per App/Browser einstellbar (Marktplatz-Muster —
    // jeder entscheidet, wie viel gespeichert wird). Default 20.
    if (typeof opts.mailboxMax === "number" && isFinite(opts.mailboxMax) && opts.mailboxMax >= 1) RDV_MAILBOX_MAX = Math.floor(opts.mailboxMax);
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
      return {
        version: VERSION, mounted: mounted, open: isOpen(), nodeName: cfg.nodeName,
        hasRendezvous: rdv() !== null, relatedOnly: relatedOnly, euOnly: cfg.euOnly,
        kiRichter: { on: kiOn, provider: kiProvider, hasKey: !!(kiKey && kiKey.length) },
      };
    },
    // Test-Brücke (headless): KI-Richter-Zustand setzen + eine Antwort rendern.
    // Kein Produktiv-Use (Konvention analog Modul 08 _clearOutbox). renderAnswer
    // ist bei KI-an async — der Test wartet einen Tick nach dem hybridMatch-Stub.
    _test: {
      setKi: function (o) { o = o || {}; kiOn = !!o.on; if ("key" in o) kiKey = o.key || ""; if ("provider" in o) kiProvider = o.provider || ""; },
      renderAnswer: function (card, res, text) { renderAskSuccess(card, res, text); return outEl ? outEl.textContent : null; },
      outText: function () { return outEl ? outEl.textContent : null; },
      providers: function () { return kiProviders(); },
      voiceClick: function () { onVoiceClick(); return outEl ? outEl.textContent : null; },
      askValue: function () { return askInputEl ? askInputEl.value : null; },
      setKeyInput: function (v) { kiKey = v || ""; if (kiKeyEl) kiKeyEl.value = kiKey; updateKiKeyLink(); updateKiVaultButtons(); },
      keyLink: function () { return kiKeyLinkEl ? { visible: kiKeyLinkEl.style.display !== "none", href: kiKeyLinkEl.href } : null; },
      toggleKi: function () { onToggleKiRichter(); },
      kiSecretName: function () { return kiSecretName(); },
      saveToVault: function () { return onKiSaveToVault(); },
      unlockFromVault: function () { return onKiUnlockVault(); },
      vaultBtns: function () { return { save: !!(kiSaveBtnEl && kiSaveBtnEl.style.display !== "none"), unlock: !!(kiUnlockBtnEl && kiUnlockBtnEl.style.display !== "none") }; },
    },
  };

  global.SbkimRendezvousUI = api;

  if (typeof console !== "undefined" && console.info) {
    console.info("MODUL 23 UI RENDEZVOUS-KNOPF bereit (öffentlich, app-agnostisch), Funktionen: init/show/hide/isOpen");
  }
})(typeof window !== "undefined" ? window : globalThis);
