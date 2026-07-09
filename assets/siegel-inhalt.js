/*
 * Kimseek — Siegel-Modal-Inhalt (das Andock-Werkzeug IM Siegel).
 *
 * Modul 16 (16_siegel.js) rendert nur das GERÜST (Badge + Modal + Bronze/Gold
 * + PFLICHT-MODULE-Selbstprüfliste). Den INHALT — das Andock-Werkzeug — injiziert
 * die App host-seitig, sobald Modul 16 sein Modal (#sbkim-siegel-modal) ins DOM
 * hängt. Modul 16 bleibt dabei UNANGETASTET (netzweit geteiltes Render-Modul).
 *
 * Muster 1:1 aus Kim-Bell/assets/siegel-inhalt.js (Ursprung: Sage index.html).
 * Drei Blöcke ins Modal:
 *   (1) 🔑 Eigene Identität & Spore erzeugen/verwalten — Wizard (4 Schritte:
 *       Identität · Spore signieren+Download · verschl. Backup · Wiederherstellen).
 *   (2) ✍ Semantische Beschreibung → Vektor & Spore neu signieren (gleiche nodeId).
 *   (3) 🛡 Schutz-Block + „Ausführlich erklärt →" (sicherheit.html als In-Page-Overlay).
 *
 * Nutzt die ECHTEN Module 02 (Spore) + 03 (Embedding). Privater Schlüssel verlässt
 * den Browser NIE; nur die öffentliche spore.json wird heruntergeladen/committet.
 * Fail-soft, idempotent (Guard via data-Attribut / IDs). Siehe Skill
 * „status-leiste-siegel".
 *
 * ⤷ VORLAGE: in eine andere App kopiert, nur WIZ (unten) anpassen.
 */
(function () {
  "use strict";
  if (window.__ksSiegelInhalt) return;
  window.__ksSiegelInhalt = true;

  // ---- App-eigene Config (nur das variiert pro Knoten) --------------------
  var WIZ = {
    domain: "Semantische Bedeutungs-Suche",
    endpoint: "https://lausiklauskn-png.github.io/Kimseek/",
    nodeType: "hybrid",
    nodeName: "Kimseek",
    domainDescription: "Kimseek — semantisches Such-Werkzeug, das die Bedeutung und Absicht hinter einer Frage versteht (nicht nur Stichwörter). Ordnet Treffer nach Bedeutungs-Nähe, server-los im Browser; optional Spracheingabe, Bild-/Handschrift-Erkennung (OCR) und eine KI-Brücke mit Web-Suche.",
    domainKeywords: ["Semantische Suche", "Bedeutung", "Absicht", "Embedding", "Sprachsuche", "OCR", "SBKIM", "Mycel"],
    stammCategories: ["Semantische Suche", "Bedeutungs-Sortierung", "Sprach-/Bild-Eingabe"],
    guestCategories: ["Spore-Erzeugung", "Backup", "Handshake"],
  };
  var lastSpore = null;

  function downloadJson(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function autoGrow(ta) { if (!ta) return; ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }

  // ---- Injektion ins Siegel-Modal -----------------------------------------
  function injectIntoSiegel(modal) {
    if (!modal || modal.querySelector("#ks-ident-open")) return;
    var panel = modal.querySelector('[role="dialog"]') || modal.firstElementChild || modal;
    if (!panel) return;

    // (1) 🔑 Identität & Spore erzeugen/verwalten → öffnet den Wizard.
    var openBtn = document.createElement("button");
    openBtn.type = "button"; openBtn.id = "ks-ident-open";
    openBtn.textContent = "🔑 Eigene Identität & Spore erzeugen / verwalten →";
    openBtn.style.cssText = "display:block;width:100%;margin:0 0 0.9rem;padding:0.6rem 0.9rem;" +
      "font:inherit;cursor:pointer;border-radius:10px;border:1px solid #C9A961;" +
      "background:rgba(201,169,97,0.14);color:#F5E6B8;font-weight:700;text-align:left;";
    openBtn.addEventListener("click", openWizard);
    if (panel.firstChild) panel.insertBefore(openBtn, panel.firstChild);
    else panel.appendChild(openBtn);

    // (2) ✍ Semantik-Beschreibung direkt darunter.
    var semantik = buildSemantikBlock();
    if (openBtn.nextSibling) panel.insertBefore(semantik, openBtn.nextSibling);
    else panel.appendChild(semantik);

    // (3) 🛡 Schutz-/Vertrauens-Block darunter.
    var schutz = buildSchutzInfoBlock();
    if (semantik.nextSibling) panel.insertBefore(schutz, semantik.nextSibling);
    else panel.appendChild(schutz);

    if (!document.getElementById("ks-ident-wizard")) buildWizardDialog();
  }

  // ---- (2) Semantik-Block --------------------------------------------------
  function buildSemantikBlock() {
    var wrap = document.createElement("div");
    wrap.id = "ks-semantik-block";
    wrap.style.cssText = "margin:0 0 1rem;padding:0.75rem 0.9rem;border-radius:10px;" +
      "border:1px solid rgba(201,169,97,0.3);background:rgba(201,169,97,0.06);";
    var label = document.createElement("p");
    label.style.cssText = "margin:0 0 0.5rem;font-weight:700;color:#F5E6B8;";
    label.textContent = "✍ Semantische Beschreibung — macht deinen Domain-Vektor treffender";
    var ta = document.createElement("textarea");
    ta.id = "ks-semantik-text"; ta.rows = 4;
    ta.placeholder = "Beschreibe deine App neu oder kopiere die Beschreibung / README hier hinein.";
    ta.style.cssText = "display:block;width:100%;box-sizing:border-box;resize:none;overflow:hidden;" +
      "min-height:5.5em;padding:0.55rem 0.65rem;font:inherit;font-size:0.88rem;line-height:1.5;" +
      "color:#F5F5FF;background:rgba(0,0,0,0.35);border:1px solid rgba(201,169,97,0.35);border-radius:8px;";
    ta.value = WIZ.domainDescription;
    try {
      if (window.SbkimSpore && window.SbkimSpore.getOwnSpore) {
        window.SbkimSpore.getOwnSpore().then(function (sp) {
          if (sp && typeof sp.domainDescription === "string" && sp.domainDescription.trim()) {
            ta.value = sp.domainDescription; autoGrow(ta);
          }
        }).catch(function () {});
      }
    } catch (e) {}
    ta.addEventListener("input", function () { autoGrow(ta); });
    var hint = document.createElement("p");
    hint.style.cssText = "margin:0.55rem 0 0;font-size:0.8rem;line-height:1.5;color:rgba(245,245,255,0.7);";
    hint.textContent = "Je konkreter, desto besser findet dich das Mycel. Beschreibe in eigenen " +
      "Worten: was die App/Seite ist, wofür man sie nutzt, welche Themen/Stichworte sie abdeckt, " +
      "für wen sie gedacht ist. Ein gut gefüllter Absatz (ca. 3–8 Sätze) ist ideal — gern auch die " +
      "README hineinkopieren. Vermeide reine Schlagwort-Listen ohne Kontext.";
    var btn = document.createElement("button");
    btn.type = "button"; btn.id = "ks-semantik-resign";
    btn.textContent = "Beschreibung übernehmen → Vektor & Spore neu signieren";
    btn.style.cssText = "display:block;width:100%;margin:0.7rem 0 0;padding:0.5rem 0.8rem;font:inherit;" +
      "font-weight:700;cursor:pointer;border-radius:8px;border:1px solid #C9A961;" +
      "background:rgba(201,169,97,0.12);color:#F5E6B8;";
    var out = document.createElement("div");
    out.id = "ks-semantik-out";
    out.style.cssText = "margin:0.6rem 0 0;font-family:monospace;font-size:0.78rem;line-height:1.5;color:#6ee7d3;word-break:break-word;";
    btn.addEventListener("click", function () { reSignWithDescription(ta, btn, out); });
    wrap.appendChild(label); wrap.appendChild(ta); wrap.appendChild(hint); wrap.appendChild(btn); wrap.appendChild(out);
    setTimeout(function () { autoGrow(ta); }, 0);
    return wrap;
  }

  function reSignWithDescription(ta, btn, out) {
    function say(msg, bad) { out.textContent = msg; out.style.color = bad ? "#e5484d" : "#6ee7d3"; }
    var beschreibung = (ta.value || "").trim();
    if (!beschreibung) { say("Bitte zuerst eine Beschreibung eintippen.", true); return; }
    if (!window.SbkimSpore || !window.SbkimEmbedding) { say("Module 02/03 nicht geladen.", true); return; }
    btn.disabled = true;
    var onProg = function (ev) {
      var d = ev && ev.detail; if (!d) return;
      var pct = (typeof d.progress === "number") ? " " + Math.round(d.progress) + "%" : "";
      say("Lade Sprachmodell (einmalig ~30 MB)" + pct + " …");
    };
    window.addEventListener("sbkim:embedding-progress", onProg);
    say("Erzeuge / lade Identität …");
    window.SbkimSpore.getOrCreateIdentity()
      .then(function (id) { say("Identität: " + id.nodeId + " — initialisiere Embedding …"); return window.SbkimEmbedding.init(); })
      .then(function () { say("Berechne semantischen Vektor (384-dim) …"); return window.SbkimEmbedding.embedPassage(beschreibung); })
      .then(function (vec) {
        say("Signiere Spore …");
        var arr = Array.from(vec);
        return window.SbkimSpore.generateOwnSpore({
          domain: WIZ.domain, endpoint: WIZ.endpoint, nodeType: WIZ.nodeType, nodeName: WIZ.nodeName,
          domainDescription: beschreibung, domainKeywords: WIZ.domainKeywords,
          domainVector: arr, stammCategories: WIZ.stammCategories, guestCategories: WIZ.guestCategories,
        });
      })
      .then(function (spore) {
        lastSpore = spore; downloadJson("spore.json", spore);
        say("Spore neu signiert + ⬇  ·  nodeId=" + spore.id + ". Datei nach sbkim/spore.json committen.");
      })
      .catch(function (e) { say("Fehler: " + (e && e.message || e), true); })
      .then(function () { window.removeEventListener("sbkim:embedding-progress", onProg); btn.disabled = false; });
  }

  // ---- (3) Schutz-Block + Erklär-Overlay ----------------------------------
  function buildSchutzInfoBlock() {
    var wrap = document.createElement("div");
    wrap.id = "ks-schutz-block";
    wrap.style.cssText = "margin:0 0 1rem;padding:0.75rem 0.9rem;border-radius:10px;" +
      "border:1px solid rgba(201,169,97,0.3);background:rgba(201,169,97,0.06);";
    var h = document.createElement("p");
    h.style.cssText = "margin:0 0 0.4rem;font-weight:700;color:#F5E6B8;";
    h.textContent = "🛡 Was bedeutet dieses Siegel — und wie bist du geschützt?";
    var p = document.createElement("p");
    p.style.cssText = "margin:0;font-size:0.84rem;line-height:1.55;color:rgba(245,245,255,0.78);";
    p.textContent = "Das Siegel ist selbst-ausgestellt: der Knoten hat beim Start geprüft, dass " +
      "seine Schutz-Bausteine geladen sind, und zeigt das offen. Es wandern nur Daten, nie " +
      "Programme; dein privater Schlüssel verlässt diesen Browser nie. Kein Server in der Mitte, " +
      "keine Anmeldung.";
    var btn = document.createElement("button");
    btn.type = "button"; btn.id = "ks-schutz-open";
    btn.textContent = "Ausführlich erklärt → So funktioniert das Mycel & wie du geschützt bist";
    btn.style.cssText = "display:block;width:100%;margin:0.7rem 0 0;padding:0.5rem 0.8rem;font:inherit;" +
      "font-weight:700;cursor:pointer;border-radius:8px;border:1px solid #C9A961;" +
      "background:rgba(201,169,97,0.12);color:#F5E6B8;";
    btn.addEventListener("click", openSchutzModal);
    wrap.appendChild(h); wrap.appendChild(p); wrap.appendChild(btn);
    return wrap;
  }

  var schutzKeyHandler = null;
  function openSchutzModal() {
    var ov = document.getElementById("ks-schutz-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "ks-schutz-overlay";
      ov.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);";
      var frame = document.createElement("div");
      frame.style.cssText = "position:relative;width:min(900px,94vw);height:min(88vh,900px);background:#0a0d16;border:1px solid rgba(201,169,97,0.45);border-radius:12px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.7);";
      var closeBtn = document.createElement("button");
      closeBtn.type = "button"; closeBtn.setAttribute("aria-label", "Schließen"); closeBtn.textContent = "✕";
      closeBtn.style.cssText = "position:absolute;top:0.5rem;right:0.6rem;z-index:1;cursor:pointer;background:rgba(0,0,0,0.5);color:#F5F5FF;border:1px solid rgba(201,169,97,0.45);border-radius:8px;padding:0.25rem 0.6rem;font-size:1rem;";
      closeBtn.addEventListener("click", closeSchutzModal);
      var iframe = document.createElement("iframe");
      iframe.src = "sicherheit.html"; iframe.title = "So funktioniert das Mycel & wie du geschützt bist";
      iframe.style.cssText = "width:100%;height:100%;border:0;display:block;background:#0a0d16;";
      frame.appendChild(closeBtn); frame.appendChild(iframe); ov.appendChild(frame);
      ov.addEventListener("click", function (e) { if (e.target === ov) closeSchutzModal(); });
      document.body.appendChild(ov);
    }
    ov.style.display = "flex";
    if (!schutzKeyHandler) { schutzKeyHandler = function (e) { if (e && e.key === "Escape") closeSchutzModal(); }; document.addEventListener("keydown", schutzKeyHandler); }
  }
  function closeSchutzModal() {
    var ov = document.getElementById("ks-schutz-overlay");
    if (ov) ov.style.display = "none";
    if (schutzKeyHandler) { document.removeEventListener("keydown", schutzKeyHandler); schutzKeyHandler = null; }
  }

  // ---- (1) Der Wizard-Dialog (4 Schritte) ---------------------------------
  function buildWizardDialog() {
    var dlg = document.createElement("dialog");
    dlg.id = "ks-ident-wizard";
    dlg.setAttribute("aria-label", "Identität & Spore erzeugen");
    dlg.style.cssText = "max-width:min(560px,94vw);border:1px solid rgba(201,169,97,0.5);border-radius:14px;background:#0a0d16;color:#eef2f8;padding:1.2rem 1.3rem;";
    dlg.innerHTML =
      '<h3 style="margin:0 0 .3em;color:#F5E6B8">🔑 Eigene Identität & Spore</h3>' +
      '<p style="color:#9aa7b6;margin:.2em 0 1em;font-size:.88rem">Erzeugt eine SBKIM-Identität <b>im Browser</b> (Ed25519, IndexedDB) — der private Schlüssel verlässt diesen Browser nie. Notfall-tauglich: jederzeit eine <b>neue</b> Spore/Identität erzeugen und sichern. Erstes Embedding lädt ~30 MB (Modul 03, einmalig).</p>' +
      '<ol style="padding-left:1.1rem;line-height:1.5;font-size:.9rem">' +
        '<li><b>Identität erzeugen</b> — Ed25519-Schlüsselpaar, nodeId aus dem Public Key.<br>' +
          '<button type="button" id="kswiz-s1" style="margin:.4em 0;cursor:pointer;border-radius:8px;border:1px solid #C9A961;background:rgba(201,169,97,0.12);color:#F5E6B8;padding:.3em .7em;font:inherit">Identität erzeugen</button>' +
          '<div id="kswiz-o1" style="font-family:monospace;font-size:.8rem;color:#6ee7d3;word-break:break-all"></div></li>' +
        '<li style="margin-top:.6em"><b>Spore signieren + herunterladen</b> — mit echtem 384-dim domainVector.<br>' +
          '<button type="button" id="kswiz-s2" disabled style="margin:.4em 0;cursor:pointer;border-radius:8px;border:1px solid #C9A961;background:rgba(201,169,97,0.12);color:#F5E6B8;padding:.3em .7em;font:inherit">Spore erzeugen + ⬇</button>' +
          '<div id="kswiz-o2" style="font-family:monospace;font-size:.8rem;color:#6ee7d3;word-break:break-all"></div></li>' +
        '<li style="margin-top:.6em"><b>Verschlüsseltes Backup</b> — Passwort-Sicherung (AES-256-GCM/PBKDF2 600k) gegen IndexedDB-Verlust.<br>' +
          '<button type="button" id="kswiz-s3" disabled style="margin:.4em 0;cursor:pointer;border-radius:8px;border:1px solid #C9A961;background:rgba(201,169,97,0.12);color:#F5E6B8;padding:.3em .7em;font:inherit">Backup erzeugen + ⬇</button>' +
          '<div id="kswiz-o3" style="font-family:monospace;font-size:.8rem;color:#6ee7d3;word-break:break-all"></div></li>' +
        '<li style="margin-top:.6em"><b>Identität wiederherstellen</b> — Backup-Datei (Schritt 3) + Passwort zurückspielen: Schlüssel <em>und</em> Spore landen wieder in der Browser-IndexedDB. Auch auf neuem Gerät.<br>' +
          '<input type="file" id="kswiz-s4-file" accept=".json,application/json" hidden />' +
          '<button type="button" id="kswiz-s4" style="margin:.4em 0;cursor:pointer;border-radius:8px;border:1px solid #C9A961;background:rgba(201,169,97,0.12);color:#F5E6B8;padding:.3em .7em;font:inherit">Backup-Datei wählen + wiederherstellen</button>' +
          '<div id="kswiz-o4" style="font-family:monospace;font-size:.8rem;color:#6ee7d3;word-break:break-all"></div></li>' +
      '</ol>' +
      '<p style="color:#9aa7b6;font-size:.78rem;margin:.7em 0 0">Die heruntergeladene <code>spore.json</code> nach <code>sbkim/spore.json</code> ins Repo legen. Backup-Datei + Passwort sicher aufbewahren — ohne beides keine Wiederherstellung.</p>' +
      '<button type="button" id="kswiz-close" style="margin-top:1em;cursor:pointer;border-radius:8px;border:1px solid rgba(154,167,182,.4);background:transparent;color:#eef2f8;padding:.4em .9em;font:inherit">Schließen</button>';
    document.body.appendChild(dlg);

    function out(id, msg, bad) { var e = dlg.querySelector(id); if (!e) return; e.textContent = msg; e.style.color = bad ? "#e5484d" : "#6ee7d3"; }

    dlg.querySelector("#kswiz-s1").addEventListener("click", function () {
      var b = dlg.querySelector("#kswiz-s1");
      if (!window.SbkimSpore || !window.SbkimSpore.getOrCreateIdentity) { out("#kswiz-o1", "Modul 02 nicht geladen.", true); return; }
      b.disabled = true; out("#kswiz-o1", "Erzeuge Identität …");
      window.SbkimSpore.getOrCreateIdentity().then(function (id) {
        out("#kswiz-o1", "nodeId: " + id.nodeId); dlg.querySelector("#kswiz-s2").disabled = false;
      }).catch(function (e) { out("#kswiz-o1", "Fehler: " + (e && e.message || e), true); b.disabled = false; });
    });
    dlg.querySelector("#kswiz-s2").addEventListener("click", function () {
      var b = dlg.querySelector("#kswiz-s2");
      if (!window.SbkimEmbedding || !window.SbkimSpore) { out("#kswiz-o2", "Modul 02/03 nicht geladen.", true); return; }
      b.disabled = true;
      // PFLICHT (Klaus 2026-07-08): beim ~30-MB-Modell-Laden IMMER Prozent zeigen —
      // sonst wirkt es eingefroren und wird zu früh geschlossen. Live aus dem
      // sbkim:embedding-progress-Event, in EINER Zeile.
      var onProg = function (ev) {
        var d = ev && ev.detail; if (!d) return;
        if (typeof d.progress === "number" && isFinite(d.progress)) {
          var pct = Math.max(0, Math.min(100, Math.round(d.progress)));
          var filled = Math.round(pct / 5);
          out("#kswiz-o2", "Modell laedt  " + "█".repeat(filled) + "░".repeat(20 - filled) + "  " + pct + " %  (~30 MB einmalig)");
        } else if (d.status === "done" || d.status === "ready") {
          out("#kswiz-o2", "Modell geladen ✓");
        }
      };
      window.addEventListener("sbkim:embedding-progress", onProg);
      out("#kswiz-o2", "Lade Embedding-Modell (~30 MB, einmalig) …");
      window.SbkimEmbedding.init()
        .then(function () { out("#kswiz-o2", "Erzeuge domainVector (384) …"); return window.SbkimEmbedding.embedPassage(WIZ.domainDescription + ". " + WIZ.domainKeywords.join(", ")); })
        .then(function (vec) { out("#kswiz-o2", "Signiere Spore …");
          return window.SbkimSpore.generateOwnSpore({
            domain: WIZ.domain, endpoint: WIZ.endpoint, nodeType: WIZ.nodeType, nodeName: WIZ.nodeName,
            domainDescription: WIZ.domainDescription, domainKeywords: WIZ.domainKeywords,
            domainVector: Array.from(vec), stammCategories: WIZ.stammCategories, guestCategories: WIZ.guestCategories,
          }); })
        .then(function (spore) { lastSpore = spore; downloadJson("spore.json", spore);
          out("#kswiz-o2", "Spore erzeugt + ⬇ (nodeId=" + spore.id + "). Nach sbkim/spore.json committen.");
          dlg.querySelector("#kswiz-s3").disabled = false; })
        .catch(function (e) { out("#kswiz-o2", "Fehler: " + (e && e.message || e), true); b.disabled = false; })
        .then(function () { window.removeEventListener("sbkim:embedding-progress", onProg); });
    });
    dlg.querySelector("#kswiz-s3").addEventListener("click", function () {
      if (!window.SbkimSpore || !window.SbkimSpore.exportBackup) { out("#kswiz-o3", "Modul 02 exportBackup fehlt.", true); return; }
      var pw = window.prompt("Backup-Passwort (mind. 8 Zeichen, KEIN Reset möglich):");
      if (!pw) { out("#kswiz-o3", "Abgebrochen — kein Passwort.", true); return; }
      var b = dlg.querySelector("#kswiz-s3"); b.disabled = true;
      out("#kswiz-o3", "Erzeuge Backup (PBKDF2 600k + AES-GCM-256) …");
      window.SbkimSpore.exportBackup(pw).then(function (blob) {
        downloadJson("kimseek-backup-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sbkim.json", blob);
        out("#kswiz-o3", "Backup ⬇ — Datei + Passwort sicher aufbewahren.");
      }).catch(function (e) { out("#kswiz-o3", "Fehler: " + (e && e.message || e), true); b.disabled = false; });
    });
    dlg.querySelector("#kswiz-s4").addEventListener("click", function () { dlg.querySelector("#kswiz-s4-file").click(); });
    dlg.querySelector("#kswiz-s4-file").addEventListener("change", function (ev) {
      var input = ev.target; var file = input.files && input.files[0];
      if (!window.SbkimSpore || !window.SbkimSpore.importBackup) { out("#kswiz-o4", "Modul 02 importBackup fehlt.", true); return; }
      if (!file) { out("#kswiz-o4", "Keine Datei gewählt.", true); return; }
      file.text().then(function (text) {
        var blob; try { blob = JSON.parse(text); } catch (e) { out("#kswiz-o4", "Datei ist kein gültiges JSON-Backup.", true); input.value = ""; return; }
        var pw = window.prompt("Backup-Passwort eingeben (das beim Sichern vergebene):");
        if (!pw) { out("#kswiz-o4", "Abgebrochen — kein Passwort.", true); input.value = ""; return; }
        out("#kswiz-o4", "Entschlüssele Backup + spiele Identität zurück …");
        window.SbkimSpore.importBackup(blob, pw).then(afterRestore).catch(function (err) {
          var msg = (err && err.message) ? err.message : String(err);
          var name = (err && err.name) ? err.name : "";
          if (/Overwrite/i.test(name) || /vorhanden|überschreib|overwrite/i.test(msg)) {
            if (window.confirm("Eine Identität existiert bereits im Browser. Mit der Backup-Version überschreiben? (Die jetzige lokale Identität geht verloren.)")) {
              out("#kswiz-o4", "Überschreibe vorhandene Identität …");
              window.SbkimSpore.importBackup(blob, pw, { force: true }).then(afterRestore).catch(function (e2) { out("#kswiz-o4", "Fehler beim Überschreiben: " + (e2 && e2.message || e2), true); });
            } else { out("#kswiz-o4", "Abgebrochen — vorhandene Identität unverändert.", true); }
          } else { out("#kswiz-o4", "Fehler: " + msg + " (falsches Passwort oder beschädigte Datei?)", true); }
        }).then(function () { input.value = ""; });
      });
    });
    function afterRestore(res) {
      if (res && res.restored) {
        out("#kswiz-o4", "Identität wiederhergestellt — Schlüssel + Spore zurück in der Browser-IndexedDB.");
        dlg.querySelector("#kswiz-s2").disabled = false; dlg.querySelector("#kswiz-s3").disabled = false;
      } else { out("#kswiz-o4", "Nichts wiederhergestellt" + (res && res.reason ? " — " + res.reason : "") + ".", true); }
    }
    dlg.querySelector("#kswiz-close").addEventListener("click", function () { closeWiz(dlg); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) closeWiz(dlg); });
  }
  function openWizard() { var d = document.getElementById("ks-ident-wizard"); if (d && d.showModal) d.showModal(); else if (d) d.setAttribute("open", ""); }
  function closeWiz(d) { if (d.close) d.close(); else d.removeAttribute("open"); }

  // ---- Modal beobachten (Modul 16 mountet es bei init; erscheint per Klick) --
  function watch() {
    var m = document.getElementById("sbkim-siegel-modal");
    if (m) injectIntoSiegel(m);
    if (typeof MutationObserver !== "function" || !document.body) return;
    try {
      var obs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j]; if (!n || n.nodeType !== 1) continue;
            if (n.id === "sbkim-siegel-modal") injectIntoSiegel(n);
            else if (n.querySelector) { var inner = n.querySelector("#sbkim-siegel-modal"); if (inner) injectIntoSiegel(inner); }
          }
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch);
  else watch();
})();
