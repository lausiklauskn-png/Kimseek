/*
 * SBKIM — Modul 16b — Andock-Wizard im Siegel (KANON, netzweit byte-gleich)
 *
 * Das Werkzeug IM Siegel: Identität erzeugen · Spore signieren + ⬇ ·
 * verschlüsseltes Backup · Wiederherstellen · Identitäts-Wechsler, dazu die
 * Semantik-Beschreibung und der Schutz-Block. Modul 16 rendert nur das GERÜST
 * (Badge + Modal + Bronze/Gold); den INHALT hängt diese Datei hinein, sobald
 * Modul 16 sein Modal (#sbkim-siegel-modal) ins DOM setzt.
 *
 * ⚠ DIESE DATEI TRÄGT KEINE APP-IDENTITÄT. Sie liest `window.SBKIM_SIEGEL_WIZ`.
 * Die Trennlinie ist verbindlich und steht in docs/INTERFACES.md §11.9:
 *
 *     KANON (hier)      der Ablauf, ALLE Anzeigetexte, die Prüfungen
 *     APP-EIGEN (dort)  domain · endpoint · nodeType · nodeName
 *                       domainDescription · domainKeywords
 *                       stammCategories · guestCategories · backupPrefix
 *
 * Warum die Trennung überhaupt gebaut wurde — gemessen am 2026-09-14 über die
 * 20 Kopien im Netz: ZWÖLF verschiedene Code-Fassungen eines Werkzeugs, das
 * eine einzige sein sollte. Sieben trugen ein eigenes ID-Präfix, zwei hatten
 * den Identitäts-Wechsler gar nicht, neun kannten „der Vorschlag der App
 * gewinnt" nicht, sechs tippten den Backup-Namen von Hand ein. Jede
 * Verbesserung kostete Handarbeit mal zwanzig und unterblieb deshalb meistens.
 *
 * ⚠ DIE KONFIGURATION WIRD SPÄT GELESEN. Gemessen: in Sages index.html steht
 * `assets/siegel-inhalt.js` in Zeile 4974 und `sbkim-init.js` in Zeile 4987 —
 * der Klebstoff kommt DANACH. Wer den Wert beim Laden in eine Variable fängt,
 * fängt dort `undefined`. Gelesen wird erst beim Injizieren.
 *
 * ⚠ OHNE KONFIGURATION WIRD KEIN KNOPF GEBAUT, sondern eine Zeile geschrieben,
 * die sagt, was fehlt. Ein Knopf, hinter dem nichts liegt, ist schlimmer als
 * ein fehlender — und einer mit Erklärung ist die schlimmste Sorte.
 *
 * Nutzt die echten Module 02 (Spore) + 03 (Embedding). Der private Schlüssel
 * verlässt den Browser NIE; nur die öffentliche spore.json wird geladen.
 * Fail-soft, idempotent (Guard über IDs).
 */
(function () {
  "use strict";
  if (window.__sbkimSiegelInhalt) return;
  window.__sbkimSiegelInhalt = true;

  /* ── Die App-Konfiguration ──────────────────────────────────────────────
   * Lazy, siehe Kopf. Gibt `null` zurück, wenn nichts hinterlegt ist — und
   * genau daran hängt die Fail-soft-Zusicherung weiter unten. */
  function cfg() {
    var w = window.SBKIM_SIEGEL_WIZ;
    return (w && typeof w === "object") ? w : null;
  }

  /* ── Die Sprache ────────────────────────────────────────────────────────
   * SCHLÜSSELLOS: der deutsche Satz IST der Schlüssel. `TEXTE.<sprache>` trägt
   * die Übersetzung, `T()` fällt fail-soft auf Deutsch zurück.
   *
   * ⚠ TRAGENDE ZUSICHERUNG: OHNE EINSTELLUNG ÄNDERT SICH NICHTS. Solange keine
   * Tabelle vorliegt, gibt T() den deutschen Satz Zeichen für Zeichen zurück.
   * Eine Übersetzung, die sich ungefragt einschaltet, wäre ein Sprachwechsel,
   * den niemand bestellt hat.
   *
   * Rangfolge: SBKIM_SIEGEL_WIZ.lang → <html lang> → de. */
  /* ⚠ TAFEL-EVOLUTIONS-KLAUSEL, AUSDRÜCKLICH BENANNT (2026-09-16).
   * Hier stand: „OHNE EINSTELLUNG ÄNDERT SICH NICHTS — solange keine Tabelle
   * vorliegt, gibt T() den deutschen Satz zurück." Der Satz war richtig,
   * solange es keine Tabelle GAB. Jetzt gibt es eine.
   *
   * Die Zusicherung ist ERSETZT, nicht stillschweigend getauscht:
   *   vorher   keine Tabelle   ⇒ überall Deutsch, auch bei <html lang="en">
   *   nachher  lang=de/fehlt   ⇒ Deutsch, Zeichen für Zeichen (unverändert)
   *            lang=en         ⇒ Englisch; ein Satz OHNE Eintrag fällt weiter
   *                              fail-soft auf Deutsch zurück
   *
   * ⚠ EINE HALB ÜBERSETZTE TAFEL IST DIE SCHLIMMERE SORTE — sie sieht aus wie
   * eine englische Oberfläche und streut deutsche Sätze dazwischen. Ein
   * Wächter besteht deshalb darauf, dass JEDER Eintrag aus TEXTE_DE eine
   * englische Fassung hat, und ein zweiter, dass keine davon wortgleich mit
   * der deutschen ist — außer der einen, die es sein MUSS: „nodeId: {0}" ist
   * ein Feldname, kein Satz. */
  var TEXTE = { en: {
    "🔑 Eigene Identität & Spore erzeugen / verwalten →":
      "🔑 Create / manage your own identity & spore →",
    "⚠ Das Andock-Werkzeug fehlt: diese App hat keine SBKIM_SIEGEL_WIZ-Konfiguration hinterlegt. Ohne sie wüsste der Wizard nicht, welchen Knoten er signieren soll.":
      "⚠ The docking tool is missing: this app has no SBKIM_SIEGEL_WIZ configuration. Without it the wizard would not know which node to sign.",
    "✍ Semantische Beschreibung — macht deinen Domain-Vektor treffender":
      "✍ Semantic description — makes your domain vector more accurate",
    "Beschreibe deine App neu oder kopiere die Beschreibung / README hier hinein.":
      "Describe your app afresh, or paste its description / README in here.",
    "Im Feld steht der Vorschlag dieser App — er wird mit der App gepflegt.":
      "The field holds this app's suggestion — it is kept up to date with the app.",
    "Im Feld steht der Vorschlag dieser App. Dein zuletzt signierter Text war ein anderer — er bleibt in deiner Spore, bis du neu signierst.":
      "The field holds this app's suggestion. The text you last signed was a different one — it stays in your spore until you sign again.",
    "Im Feld steht jetzt dein zuletzt signierter Text.":
      "The field now holds the text you last signed.",
    "↺ Meinen zuletzt signierten Text zurückholen":
      "↺ Bring back the text I last signed",
    "Im Feld steht dein zuletzt signierter Text. Die App schlägt inzwischen einen anderen vor.":
      "The field holds the text you last signed. The app now suggests a different one.",
    "↻ Den Vorschlag der App ansehen":
      "↻ Look at the app's suggestion",
    "Im Feld steht jetzt der Vorschlag dieser App.":
      "The field now holds this app's suggestion.",
    "Je konkreter, desto besser findet dich das Mycel. Beschreibe in eigenen Worten: was die App/Seite ist, wofür man sie nutzt, welche Themen/Stichworte sie abdeckt, für wen sie gedacht ist. Ein gut gefüllter Absatz (ca. 3–8 Sätze) ist ideal — gern auch die README hineinkopieren. Vermeide reine Schlagwort-Listen ohne Kontext.":
      "The more concrete you are, the better the mycelium finds you. Describe in your own words: what the app/site is, what people use it for, which topics/keywords it covers, who it is meant for. A well-filled paragraph (about 3–8 sentences) is ideal — pasting the README in is fine too. Avoid bare keyword lists without context.",
    "Beschreibung übernehmen → Vektor & Spore neu signieren":
      "Apply description → re-sign vector & spore",
    "Bitte zuerst eine Beschreibung eintippen.":
      "Please type a description first.",
    "Module 02/03 nicht geladen.":
      "Modules 02/03 are not loaded.",
    "Lade Sprachmodell (einmalig ~30 MB)":
      "Loading language model (~30 MB, once)",
    "Erzeuge / lade Identität …":
      "Creating / loading identity …",
    "Identität: {0} — initialisiere Embedding …":
      "Identity: {0} — initialising embedding …",
    "Berechne semantischen Vektor (384-dim) …":
      "Computing semantic vector (384-dim) …",
    "Erzeuge Satz-Schnipsel (v0.2) …":
      "Creating sentence snippets (v0.2) …",
    "Signiere Spore …":
      "Signing spore …",
    "Spore neu signiert + ⬇  ·  nodeId={0}. Datei nach sbkim/spore.json committen.":
      "Spore re-signed + ⬇  ·  nodeId={0}. Commit the file to sbkim/spore.json.",
    "Berechne den Vektor aus {0} eigenen Inhalten …":
      "Computing the vector from {0} of your own entries …",
    "Spore neu signiert + ⬇  ·  nodeId={0}  ·  Vektor aus {1} eigenen Inhalten. Datei nach sbkim/spore.json committen.":
      "Spore re-signed + ⬇  ·  nodeId={0}  ·  vector from {1} of your own entries. Commit the file to sbkim/spore.json.",
    "Dein Vektor kommt aus deinen eigenen Inhalten ({0} Einträge) — nicht aus dem Text oben. So wirst du nach dem gefunden, was wirklich bei dir steht. Die Satz-Schnipsel für die Feinsuche kommen weiter aus dem Text.":
      "Your vector comes from your own entries ({0} of them) — not from the text above. That way you are found by what is really in there. The sentence snippets used for fine-grained search still come from the text.",
    "Fehler: {0}":
      "Error: {0}",
    "_{0}-Kennungen":
      "_{0}-ids",
    "🛡 Was bedeutet dieses Siegel — und wie bist du geschützt?":
      "🛡 What does this seal mean — and how are you protected?",
    "Das Siegel ist selbst-ausgestellt: der Knoten hat beim Start geprüft, dass seine Schutz-Bausteine geladen sind, und zeigt das offen. Es wandern nur Daten, nie Programme; dein privater Schlüssel verlässt diesen Browser nie. Kein Server in der Mitte, keine Anmeldung.":
      "The seal is self-issued: at start-up the node checked that its protective modules are loaded, and says so openly. Only data travels, never programs; your private key never leaves this browser. No server in between, no sign-up.",
    "Die Membran zeigt, wenn eine fremde KI / ein Browser-Agent auf die App zugreift.":
      "The membrane shows when an outside AI / a browser agent accesses the app.",
    "Ausführlich erklärt → So funktioniert das Mycel & wie du geschützt bist":
      "Explained in full → How the mycelium works & how you are protected",
    "So funktioniert das Mycel & wie du geschützt bist":
      "How the mycelium works & how you are protected",
    "Schließen":
      "Close",
    "Identität & Spore erzeugen":
      "Create identity & spore",
    "🔑 Eigene Identität & Spore":
      "🔑 Your own identity & spore",
    "Erzeugt eine SBKIM-Identität <b>im Browser</b> (Ed25519, IndexedDB) — der private Schlüssel verlässt diesen Browser nie. Notfall-tauglich: jederzeit eine <b>neue</b> Spore/Identität erzeugen und sichern. Erstes Embedding lädt ~30 MB (Modul 03, einmalig).":
      "Creates an SBKIM identity <b>in the browser</b> (Ed25519, IndexedDB) — the private key never leaves this browser. Fit for emergencies: create and back up a <b>new</b> spore/identity at any time. The first embedding downloads ~30 MB (module 03, once).",
    "<b>Identität erzeugen</b> — Ed25519-Schlüsselpaar, nodeId aus dem Public Key.":
      "<b>Create identity</b> — Ed25519 key pair, nodeId derived from the public key.",
    "Identität erzeugen":
      "Create identity",
    "<b>Spore signieren + herunterladen</b> — mit echtem 384-dim domainVector. Dieselbe Spore wie im Verbinden-Fenster: eine Kennung, ein Eintrag im Netz. Du signierst hier ODER dort, nicht in beiden.":
      "<b>Sign + download spore</b> — with a real 384-dim domainVector. The very same spore as in the connect window: one identity, one entry in the network. You sign here OR there, not in both.",
    "Spore erzeugen + ⬇":
      "Create spore + ⬇",
    "<b>Verschlüsseltes Backup</b> — Passwort-Sicherung (AES-256-GCM/PBKDF2 600k) gegen IndexedDB-Verlust. Dieselbe Sicherung wie im Verbinden-Fenster: zweimal drücken ergibt zwei Dateien mit gleichem Inhalt.":
      "<b>Encrypted backup</b> — password-protected copy (AES-256-GCM/PBKDF2 600k) against losing IndexedDB. The very same backup as in the connect window: pressing twice gives you two files with identical contents.",
    "Backup erzeugen + ⬇":
      "Create backup + ⬇",
    "<b>Identität wiederherstellen</b> — Backup-Datei (Schritt 3) + Passwort zurückspielen: Schlüssel <em>und</em> Spore landen wieder in der Browser-IndexedDB. Auch auf neuem Gerät.":
      "<b>Restore identity</b> — play back the backup file (step 3) plus its password: key <em>and</em> spore land back in the browser's IndexedDB. On a new device too.",
    "Backup-Datei wählen + wiederherstellen":
      "Choose backup file + restore",
    "<b>Identitäts-Wechsler</b> — welche Identität ist aktiv? Bei mehreren (z. B. aus altem Browser-Zustand) die kanonische wählen. Es wird nichts gelöscht.":
      "<b>Identity switcher</b> — which identity is active? If there are several (e.g. left over from an older browser state), pick the canonical one. Nothing is deleted.",
    "— wird geladen … —":
      "— loading … —",
    "Die heruntergeladene <code>spore.json</code> nach <code>sbkim/spore.json</code> ins Repo legen. Backup-Datei + Passwort sicher aufbewahren — ohne beides keine Wiederherstellung.":
      "Put the downloaded <code>spore.json</code> into the repository as <code>sbkim/spore.json</code>. Keep the backup file and its password safe — without both there is no way back.",
    "Modul 02 nicht geladen.":
      "Module 02 is not loaded.",
    "Erzeuge Identität …":
      "Creating identity …",
    "nodeId: {0}":
      "nodeId: {0}",
    "Modul 02/03 nicht geladen.":
      "Modules 02/03 are not loaded.",
    "Modell lädt  {0}  {1} %  (~30 MB einmalig)":
      "Model loading  {0}  {1} %  (~30 MB, once)",
    "Modell geladen ✓":
      "Model loaded ✓",
    "Lade Embedding-Modell (~30 MB, einmalig) …":
      "Loading embedding model (~30 MB, once) …",
    "Spore erzeugt + ⬇ (nodeId={0}). Nach sbkim/spore.json committen.":
      "Spore created + ⬇ (nodeId={0}). Commit it to sbkim/spore.json.",
    "Spore erzeugt + ⬇ (nodeId={0})  ·  Vektor aus {1} eigenen Inhalten. Nach sbkim/spore.json committen.":
      "Spore created + ⬇ (nodeId={0})  ·  vector from {1} of your own entries. Commit it to sbkim/spore.json.",
    "Modul 02 exportBackup fehlt.":
      "Module 02 exportBackup is missing.",
    "Backup-Passwort (mind. 8 Zeichen, KEIN Reset möglich):":
      "Backup password (at least 8 characters, NO reset possible):",
    "Abgebrochen — kein Passwort.":
      "Cancelled — no password.",
    "Erzeuge Backup (PBKDF2 600k + AES-GCM-256) …":
      "Creating backup (PBKDF2 600k + AES-GCM-256) …",
    "Backup ⬇ — Datei + Passwort sicher aufbewahren.":
      "Backup ⬇ — keep the file and the password safe.",
    "Modul 02 importBackup fehlt.":
      "Module 02 importBackup is missing.",
    "Keine Datei gewählt.":
      "No file chosen.",
    "Datei ist kein gültiges JSON-Backup.":
      "The file is not a valid JSON backup.",
    "Backup-Passwort eingeben (das beim Sichern vergebene):":
      "Enter the backup password (the one you set when saving):",
    "Entschlüssele Backup + spiele Identität zurück …":
      "Decrypting backup + restoring identity …",
    "Eine Identität existiert bereits im Browser. Mit der Backup-Version überschreiben? (Die jetzige lokale Identität geht verloren.)":
      "An identity already exists in this browser. Overwrite it with the one from the backup? (The current local identity will be lost.)",
    "Überschreibe vorhandene Identität …":
      "Overwriting the existing identity …",
    "Fehler beim Überschreiben: {0}":
      "Error while overwriting: {0}",
    "Abgebrochen — vorhandene Identität unverändert.":
      "Cancelled — the existing identity is unchanged.",
    "Fehler: {0} (falsches Passwort oder beschädigte Datei?)":
      "Error: {0} (wrong password, or a damaged file?)",
    "Identität wiederhergestellt — Schlüssel + Spore zurück in der Browser-IndexedDB.":
      "Identity restored — key and spore are back in the browser's IndexedDB.",
    "Nichts wiederhergestellt{0}.":
      "Nothing was restored{0}.",
    "Identitäts-Liste nicht verfügbar (Modul 02 zu alt).":
      "The identity list is unavailable (module 02 is too old).",
    "— keine geladen —":
      "— none loaded —",
    "Noch keine Identität — oben zuerst eine anlegen.":
      "No identity yet — create one above first.",
    "  (aktiv)":
      "  (active)",
    "Genau eine Identität — sauber.":
      "Exactly one identity — clean.",
    "{0} Identitäten — wähle die kanonische (aktiv markiert).":
      "{0} identities — pick the canonical one (the active one is marked).",
    "{0} · aktive nodeId: {1}":
      "{0} · active nodeId: {1}",
    "Fehler beim Lesen der Identitäten: {0}":
      "Error while reading the identities: {0}",
    "✔ Aktive Identität gewechselt zu {0}. Die nächste Spore-Signatur nutzt diese nodeId.":
      "✔ Active identity switched to {0}. The next spore signature will use this nodeId.",
    "Wechsel fehlgeschlagen: {0}":
      "Switching failed: {0}",
  } };

  /* TEXTE_DE ist die DATEN-TAFEL: jeder Anzeigetext steht hier genau einmal.
   * Drei Wächter halten sie zusammen (INTERFACES §11.9) — und der dritte ist
   * der wichtigste: „geht JEDER Anzeigetext durch T()?" Die ersten beiden
   * prüfen, was da ist; nur der dritte prüft, was fehlt. */
  var TEXTE_DE = [
    /* Siegel-Modal */
    "🔑 Eigene Identität & Spore erzeugen / verwalten →",
    "⚠ Das Andock-Werkzeug fehlt: diese App hat keine SBKIM_SIEGEL_WIZ-Konfiguration hinterlegt. Ohne sie wüsste der Wizard nicht, welchen Knoten er signieren soll.",
    /* Semantik-Block */
    "✍ Semantische Beschreibung — macht deinen Domain-Vektor treffender",
    "Beschreibe deine App neu oder kopiere die Beschreibung / README hier hinein.",
    "Im Feld steht der Vorschlag dieser App — er wird mit der App gepflegt.",
    "Im Feld steht der Vorschlag dieser App. Dein zuletzt signierter Text war ein anderer — er bleibt in deiner Spore, bis du neu signierst.",
    "Im Feld steht jetzt dein zuletzt signierter Text.",
    "↺ Meinen zuletzt signierten Text zurückholen",
    "Im Feld steht dein zuletzt signierter Text. Die App schlägt inzwischen einen anderen vor.",
    "↻ Den Vorschlag der App ansehen",
    "Im Feld steht jetzt der Vorschlag dieser App.",
    "Je konkreter, desto besser findet dich das Mycel. Beschreibe in eigenen Worten: was die App/Seite ist, wofür man sie nutzt, welche Themen/Stichworte sie abdeckt, für wen sie gedacht ist. Ein gut gefüllter Absatz (ca. 3–8 Sätze) ist ideal — gern auch die README hineinkopieren. Vermeide reine Schlagwort-Listen ohne Kontext.",
    "Beschreibung übernehmen → Vektor & Spore neu signieren",
    "Bitte zuerst eine Beschreibung eintippen.",
    "Module 02/03 nicht geladen.",
    "Lade Sprachmodell (einmalig ~30 MB)",
    "Erzeuge / lade Identität …",
    "Identität: {0} — initialisiere Embedding …",
    "Berechne semantischen Vektor (384-dim) …",
    "Erzeuge Satz-Schnipsel (v0.2) …",
    "Signiere Spore …",
    "Spore neu signiert + ⬇  ·  nodeId={0}. Datei nach sbkim/spore.json committen.",
    "Berechne den Vektor aus {0} eigenen Inhalten …",
    "Spore neu signiert + ⬇  ·  nodeId={0}  ·  Vektor aus {1} eigenen Inhalten. Datei nach sbkim/spore.json committen.",
    "Dein Vektor kommt aus deinen eigenen Inhalten ({0} Einträge) — nicht aus dem Text oben. So wirst du nach dem gefunden, was wirklich bei dir steht. Die Satz-Schnipsel für die Feinsuche kommen weiter aus dem Text.",
    "Fehler: {0}",
    /* Dateinamens-Bestandteil, wenn eine Sicherung MEHRERE Kennungen trägt.
       Steht hier, weil der Nutzer ihn liest — an seinem Dateinamen. */
    "_{0}-Kennungen",
    /* Schutz-Block */
    "🛡 Was bedeutet dieses Siegel — und wie bist du geschützt?",
    "Das Siegel ist selbst-ausgestellt: der Knoten hat beim Start geprüft, dass seine Schutz-Bausteine geladen sind, und zeigt das offen. Es wandern nur Daten, nie Programme; dein privater Schlüssel verlässt diesen Browser nie. Kein Server in der Mitte, keine Anmeldung.",
    "Die Membran zeigt, wenn eine fremde KI / ein Browser-Agent auf die App zugreift.",
    "Ausführlich erklärt → So funktioniert das Mycel & wie du geschützt bist",
    "So funktioniert das Mycel & wie du geschützt bist",
    "Schließen",
    /* Wizard-Dialog */
    "Identität & Spore erzeugen",
    "🔑 Eigene Identität & Spore",
    "Erzeugt eine SBKIM-Identität <b>im Browser</b> (Ed25519, IndexedDB) — der private Schlüssel verlässt diesen Browser nie. Notfall-tauglich: jederzeit eine <b>neue</b> Spore/Identität erzeugen und sichern. Erstes Embedding lädt ~30 MB (Modul 03, einmalig).",
    "<b>Identität erzeugen</b> — Ed25519-Schlüsselpaar, nodeId aus dem Public Key.",
    "Identität erzeugen",
    "<b>Spore signieren + herunterladen</b> — mit echtem 384-dim domainVector. Dieselbe Spore wie im Verbinden-Fenster: eine Kennung, ein Eintrag im Netz. Du signierst hier ODER dort, nicht in beiden.",
    "Spore erzeugen + ⬇",
    "<b>Verschlüsseltes Backup</b> — Passwort-Sicherung (AES-256-GCM/PBKDF2 600k) gegen IndexedDB-Verlust. Dieselbe Sicherung wie im Verbinden-Fenster: zweimal drücken ergibt zwei Dateien mit gleichem Inhalt.",
    "Backup erzeugen + ⬇",
    "<b>Identität wiederherstellen</b> — Backup-Datei (Schritt 3) + Passwort zurückspielen: Schlüssel <em>und</em> Spore landen wieder in der Browser-IndexedDB. Auch auf neuem Gerät.",
    "Backup-Datei wählen + wiederherstellen",
    "<b>Identitäts-Wechsler</b> — welche Identität ist aktiv? Bei mehreren (z. B. aus altem Browser-Zustand) die kanonische wählen. Es wird nichts gelöscht.",
    "— wird geladen … —",
    "Die heruntergeladene <code>spore.json</code> nach <code>sbkim/spore.json</code> ins Repo legen. Backup-Datei + Passwort sicher aufbewahren — ohne beides keine Wiederherstellung.",
    /* Schritt 1 */
    "Modul 02 nicht geladen.",
    "Erzeuge Identität …",
    "nodeId: {0}",
    /* Schritt 2 */
    "Modul 02/03 nicht geladen.",
    "Modell lädt  {0}  {1} %  (~30 MB einmalig)",
    "Modell geladen ✓",
    "Lade Embedding-Modell (~30 MB, einmalig) …",
    "Spore erzeugt + ⬇ (nodeId={0}). Nach sbkim/spore.json committen.",
    "Spore erzeugt + ⬇ (nodeId={0})  ·  Vektor aus {1} eigenen Inhalten. Nach sbkim/spore.json committen.",
    /* Schritt 3 */
    "Modul 02 exportBackup fehlt.",
    "Backup-Passwort (mind. 8 Zeichen, KEIN Reset möglich):",
    "Abgebrochen — kein Passwort.",
    "Erzeuge Backup (PBKDF2 600k + AES-GCM-256) …",
    "Backup ⬇ — Datei + Passwort sicher aufbewahren.",
    /* Schritt 4 */
    "Modul 02 importBackup fehlt.",
    "Keine Datei gewählt.",
    "Datei ist kein gültiges JSON-Backup.",
    "Backup-Passwort eingeben (das beim Sichern vergebene):",
    "Entschlüssele Backup + spiele Identität zurück …",
    "Eine Identität existiert bereits im Browser. Mit der Backup-Version überschreiben? (Die jetzige lokale Identität geht verloren.)",
    "Überschreibe vorhandene Identität …",
    "Fehler beim Überschreiben: {0}",
    "Abgebrochen — vorhandene Identität unverändert.",
    "Fehler: {0} (falsches Passwort oder beschädigte Datei?)",
    "Identität wiederhergestellt — Schlüssel + Spore zurück in der Browser-IndexedDB.",
    "Nichts wiederhergestellt{0}.",
    /* Schritt 5 — Identitäts-Wechsler */
    "Identitäts-Liste nicht verfügbar (Modul 02 zu alt).",
    "— keine geladen —",
    "Noch keine Identität — oben zuerst eine anlegen.",
    "  (aktiv)",
    "Genau eine Identität — sauber.",
    "{0} Identitäten — wähle die kanonische (aktiv markiert).",
    "{0} · aktive nodeId: {1}",
    "Fehler beim Lesen der Identitäten: {0}",
    "✔ Aktive Identität gewechselt zu {0}. Die nächste Spore-Signatur nutzt diese nodeId.",
    "Wechsel fehlgeschlagen: {0}"
  ];

  function sprache() {
    var c = cfg();
    var l = (c && c.lang)
      || (document.documentElement && document.documentElement.getAttribute("lang"))
      || "de";
    return String(l).slice(0, 2).toLowerCase();
  }
  function T(de) {
    var tab = TEXTE[sprache()];
    var s = tab && tab[de];
    return (typeof s === "string" && s) ? s : de;
  }
  /* Tf: derselbe Weg, nur mit Platzhaltern. Ein Satz, der in der Mitte
   * auseinandergeschnitten wird, ist keine Übersetzungs-Einheit — in einer
   * anderen Sprache steht das Eingesetzte woanders. */
  function Tf(de) {
    var a = arguments;
    return T(de).replace(/\{(\d+)\}/g, function (_, i) {
      var v = a[Number(i) + 1];
      return v === undefined || v === null ? "" : String(v);
    });
  }
  /* Nach außen sichtbar, damit die Proben messen können statt zu lesen. */
  window.SbkimSiegelTexte = { TEXTE: TEXTE, TEXTE_DE: TEXTE_DE, T: T, Tf: Tf, sprache: sprache };

  var lastSpore = null;

  function downloadJson(filename, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  /* Sprechender Download-Name für die Spore (Klaus 2026-07-23, netzweit): statt
   * immer nur spore.json wird der App-Name + Datum eingesetzt. Ziel im Repo
   * bleibt sbkim/spore.json. */
  /* ⚠ DER NAME NENNT DIE KENNUNG UND EIN SORTIERBARES DATUM (Klaus 2026-09-15:
     „vielleicht über die Dateibezeichnung schon erkennt, welche Spore oder ID
     oder beides"). Vorher stand dort <Name>_spore_TT_MM_JJ.json — zwei Läufe
     DESSELBEN Tages ergaben denselben Namen, und der Browser hängte ein „_1" an.
     Genau so lagen am 2026-09-15 zwei WorkFloh-Sporen nebeneinander; welche die
     neuere war, stand NUR im Inhalt (13:03 gegen 14:04).
     ⚠ Der Name ist ein HINWEIS, kein Beweis — er lässt sich umbenennen. Geprüft
     wird weiter der Inhalt: id == base64url(SHA256(rawPub)). */
  function sporeFileName(nodeId) {
    var c = cfg() || {};
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    var stamp = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    var base = String(c.nodeName || "SBKIM").replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "");
    return base + "_spore_" + stamp + kennungsTeil(nodeId) + ".json";
  }

  /* base64url ist in einem Dateinamen unbedenklich (A–Z a–z 0–9 - _). Fehlt die
     Kennung, bleibt der Name schlicht ohne sie — nie „undefined" im Dateinamen. */
  function kennungsTeil(nodeId) {
    var s = (typeof nodeId === "string") ? nodeId.replace(/[^A-Za-z0-9\-_]/g, "") : "";
    return s ? "_" + s.slice(0, 8) : "";
  }

  /* Wie viele Kennungen in einer Sicherung stecken — und welche, wenn es genau
     eine ist. Bei MEHREREN eine herauszugreifen wäre eine Behauptung darüber,
     welche die wichtige ist; dann steht die Anzahl da. Fail-soft: im Zweifel
     gar kein Zusatz statt einer falschen Angabe. */
  function sicherungsKennung() {
    if (!window.SbkimSpore || typeof window.SbkimSpore.listIdentities !== "function") {
      return Promise.resolve("");
    }
    return window.SbkimSpore.listIdentities().then(function (ids) {
      if (!ids || !ids.length) return "";
      if (ids.length > 1) return Tf("_{0}-Kennungen", ids.length);
      if (typeof window.SbkimSpore.getOrCreateIdentity !== "function") return "";
      return window.SbkimSpore.getOrCreateIdentity(ids[0])
        .then(function (id) { return kennungsTeil(id && id.nodeId); });
    }).catch(function () { return ""; });
  }
  function autoGrow(ta) { if (!ta) return; ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }

  /* ── Hat der Nutzer je EINEN EIGENEN Text signiert? ─────────────────────
   *
   * ⚠ WOZU DAS DA IST (Klaus 2026-09-15): „wenn ich die App aktualisiere und
   * auch das Siegel … dann würde die Sporenbeschreibung des Nutzers
   * überschrieben." Ein App-Update fasst die Spore NICHT an — aber es füllt das
   * Textfeld mit dem neuen Vorschlag vor, und wer danach neu signiert, ohne
   * hinzusehen, überschreibt seinen eigenen Text.
   *
   * Die Regel vom 2026-09-10 („der Vorschlag der App gewinnt") war richtig für
   * Klaus' EIGENE Apps, wo der App-Text der gepflegte ist. Für einen fremden
   * Nutzer mit eigenen Inhalten ist sie genau falsch herum. Statt die Module
   * einzufrieren — dann käme nie wieder ein Sicherheits-Update an — wird die
   * Frage genauer gestellt: wer zuletzt SELBST geschrieben hat, behält sein Wort.
   *
   * ⚠ DER SCHLÜSSEL IST APP-SPEZIFISCH. github.io ist eine GETEILTE Adresse;
   * ein gemeinsamer Schlüssel ließe die Nachbar-App mitentscheiden. */
  function eigenTextSchluessel() {
    var c = cfg() || {};
    var app = String(c.backupPrefix || c.nodeName || "sbkim").replace(/[^\w\-]+/g, "_");
    return "sbkim_eigener_text_" + app;
  }
  function hatEigenenText() {
    try { return window.localStorage.getItem(eigenTextSchluessel()) === "ja"; } catch (e) { return false; }
  }
  /* Beim Signieren gesetzt: war der unterschriebene Text der Vorschlag der App
     (dann „nein"), oder hat der Nutzer ihn angefasst (dann „ja")? */
  function merkeEigenenText(beschreibung) {
    var c = cfg() || {};
    var eigen = String(beschreibung || "").trim() !== String(c.domainDescription || "").trim();
    try { window.localStorage.setItem(eigenTextSchluessel(), eigen ? "ja" : "nein"); } catch (e) { /* fail-soft */ }
  }

  /* Das aktive Identitäts-Fach. Fehlt Modul 02 die Funktion (ältere Generation),
     kommt `undefined` zurück — getOrCreateIdentity fällt dann auf seinen eigenen
     Default zurück, also genau auf das bisherige Verhalten. Fail-soft, kein Wurf. */
  function aktivesFach() {
    if (!window.SbkimSpore || typeof window.SbkimSpore.getActiveIdentityKey !== "function") {
      return Promise.resolve(undefined);
    }
    return window.SbkimSpore.getActiveIdentityKey().catch(function () { return undefined; });
  }

  /* ── Injektion ins Siegel-Modal ─────────────────────────────────────── */
  function injectIntoSiegel(modal) {
    if (!modal || modal.querySelector("#sbkim-si-open")) return;
    if (modal.querySelector("#sbkim-si-ohne-konfig")) return;
    var panel = modal.querySelector('[role="dialog"]') || modal.firstElementChild || modal;
    if (!panel) return;

    /* ⚠ Fail-soft: ohne Konfiguration KEIN Knopf. Siehe Kopf und §11.9. */
    if (!cfg()) {
      var fehlt = document.createElement("p");
      fehlt.id = "sbkim-si-ohne-konfig";
      fehlt.style.cssText = "margin:0 0 0.9rem;padding:0.6rem 0.9rem;border-radius:10px;" +
        "border:1px solid rgba(229,72,77,0.5);background:rgba(229,72,77,0.10);" +
        "color:#ffd9da;font-size:0.84rem;line-height:1.5;";
      fehlt.textContent = T("⚠ Das Andock-Werkzeug fehlt: diese App hat keine SBKIM_SIEGEL_WIZ-Konfiguration hinterlegt. Ohne sie wüsste der Wizard nicht, welchen Knoten er signieren soll.");
      if (panel.firstChild) panel.insertBefore(fehlt, panel.firstChild); else panel.appendChild(fehlt);
      return;
    }

    /* (1) 🔑 Identität & Spore erzeugen/verwalten → öffnet den Wizard. */
    var openBtn = document.createElement("button");
    openBtn.type = "button"; openBtn.id = "sbkim-si-open";
    openBtn.textContent = T("🔑 Eigene Identität & Spore erzeugen / verwalten →");
    openBtn.style.cssText = "display:block;width:100%;margin:0 0 0.9rem;padding:0.6rem 0.9rem;" +
      "font:inherit;cursor:pointer;border-radius:10px;border:1px solid #C9A961;" +
      "background:rgba(201,169,97,0.14);color:#F5E6B8;font-weight:700;text-align:left;";
    openBtn.addEventListener("click", openWizard);
    if (panel.firstChild) panel.insertBefore(openBtn, panel.firstChild);
    else panel.appendChild(openBtn);

    /* (2) ✍ Semantik-Beschreibung direkt darunter. */
    var semantik = buildSemantikBlock();
    if (openBtn.nextSibling) panel.insertBefore(semantik, openBtn.nextSibling);
    else panel.appendChild(semantik);

    /* (3) 🛡 Schutz-/Vertrauens-Block darunter. */
    var schutz = buildSchutzInfoBlock();
    if (semantik.nextSibling) panel.insertBefore(schutz, semantik.nextSibling);
    else panel.appendChild(schutz);

    if (!document.getElementById("sbkim-si-wizard")) buildWizardDialog();
  }

  /* ── (2) Semantik-Block ─────────────────────────────────────────────── */
  function buildSemantikBlock() {
    var c = cfg() || {};
    var wrap = document.createElement("div");
    wrap.id = "sbkim-si-semantik-block";
    wrap.style.cssText = "margin:0 0 1rem;padding:0.75rem 0.9rem;border-radius:10px;" +
      "border:1px solid rgba(201,169,97,0.3);background:rgba(201,169,97,0.06);";
    var label = document.createElement("p");
    label.style.cssText = "margin:0 0 0.5rem;font-weight:700;color:#F5E6B8;";
    label.textContent = T("✍ Semantische Beschreibung — macht deinen Domain-Vektor treffender");
    var ta = document.createElement("textarea");
    ta.id = "sbkim-si-semantik-text"; ta.rows = 4;
    ta.placeholder = T("Beschreibe deine App neu oder kopiere die Beschreibung / README hier hinein.");
    ta.style.cssText = "display:block;width:100%;box-sizing:border-box;resize:none;overflow:hidden;" +
      "min-height:5.5em;padding:0.55rem 0.65rem;font:inherit;font-size:0.88rem;line-height:1.5;" +
      "color:#F5F5FF;background:rgba(0,0,0,0.35);border:1px solid rgba(201,169,97,0.35);border-radius:8px;";
    ta.value = c.domainDescription || "";

    /* ⚠ WELCHER TEXT IM FELD STEHT — und warum der VORSCHLAG DER APP gewinnt.
       Bis zum 2026-09-10 überschrieb die gespeicherte Spore ihn still. Klaus hat
       das in Kim Hub Company zweimal beanstandet: „wolltest du nicht den neuen
       Text automatisch einfügen … der neue Text ist da noch nicht drin." Wer
       „automatisch" bittet und einen Knopf bekommt, hat nicht bekommen, worum er
       gebeten hat.
       Der Vorschlag der App ist der GEPFLEGTE Text — er wird mit dem Depot
       aktualisiert. Nichts geht dabei verloren: der zuletzt signierte bleibt in
       der Spore, bis wirklich neu signiert wird, und ein Knopf holt ihn zurück.

       ⚠ UND DIE ZEILE STEHT ÜBER DEM FELD, nicht darunter — gegen neunzehn von
       zwanzig Fassungen. Das Feld wächst mit seinem Inhalt (autoGrow), und die
       Beschreibungen sind zweieinhalb- bis viertausend Zeichen lang; eine Zeile
       darunter liegt damit unterhalb eines bildschirmhohen Feldes. Eine Auskunft,
       die man nur findet, wenn man ohnehin schon sucht, ist so gut wie nicht da. */
    var herkunft = document.createElement("p");
    herkunft.id = "sbkim-si-semantik-herkunft";
    herkunft.setAttribute("data-woher", "app");
    herkunft.style.cssText = "margin:0 0 0.45rem;font-size:0.78rem;line-height:1.45;color:rgba(245,245,255,0.62);";
    herkunft.textContent = T("Im Feld steht der Vorschlag dieser App — er wird mit der App gepflegt.");

    var zurueck = document.createElement("button");
    zurueck.type = "button"; zurueck.id = "sbkim-si-semantik-eigener-text";
    zurueck.hidden = true;
    zurueck.textContent = T("↺ Meinen zuletzt signierten Text zurückholen");
    zurueck.style.cssText = "display:block;margin:0 0 0.5rem;padding:0.32rem 0.7rem;font:inherit;" +
      "font-size:0.8rem;cursor:pointer;border-radius:8px;border:1px solid rgba(201,169,97,0.45);" +
      "background:rgba(201,169,97,0.08);color:#F5E6B8;";

    try {
      if (window.SbkimSpore && window.SbkimSpore.getOwnSpore) {
        window.SbkimSpore.getOwnSpore().then(function (sp) {
          var eigener = sp && typeof sp.domainDescription === "string" ? sp.domainDescription : "";
          /* Nur bei ABWEICHUNG. Wer zuletzt mit genau diesem Vorschlag signiert
             hat, braucht keinen Knopf — und einer, der immer dasteht, ist bald
             einer, den niemand mehr liest. */
          var abweichend = !!eigener.trim()
            && eigener.trim() !== String(c.domainDescription || "").trim();
          if (!abweichend) return;
          /* ⚠ WER GEWINNT, HÄNGT DARAN, WER ZULETZT GESCHRIEBEN HAT. Hat der
             Nutzer den Text selbst angefasst, steht SEINER im Feld und der neue
             App-Vorschlag hinter dem Knopf — sonst umgekehrt. Beide Richtungen
             sind erreichbar, und die Zeile darüber nennt jedes Mal, welcher
             gerade dasteht; ein stiller Tausch wäre schlimmer als ein falscher. */
          if (hatEigenenText()) {
            ta.value = eigener; autoGrow(ta);
            herkunft.setAttribute("data-woher", "spore");
            herkunft.textContent = T("Im Feld steht dein zuletzt signierter Text. Die App schlägt inzwischen einen anderen vor.");
            zurueck.textContent = T("↻ Den Vorschlag der App ansehen");
            zurueck.hidden = false;
            zurueck.addEventListener("click", function () {
              ta.value = String(c.domainDescription || ""); autoGrow(ta);
              herkunft.setAttribute("data-woher", "app");
              herkunft.textContent = T("Im Feld steht jetzt der Vorschlag dieser App.");
              zurueck.hidden = true;
            });
            return;
          }
          herkunft.textContent = T("Im Feld steht der Vorschlag dieser App. Dein zuletzt signierter Text war ein anderer — er bleibt in deiner Spore, bis du neu signierst.");
          zurueck.hidden = false;
          zurueck.addEventListener("click", function () {
            ta.value = eigener; autoGrow(ta);
            herkunft.setAttribute("data-woher", "spore");
            herkunft.textContent = T("Im Feld steht jetzt dein zuletzt signierter Text.");
            zurueck.hidden = true;
          });
        }).catch(function () {});
      }
    } catch (e) {}

    ta.addEventListener("input", function () { autoGrow(ta); });
    var hint = document.createElement("p");
    hint.style.cssText = "margin:0.55rem 0 0;font-size:0.8rem;line-height:1.5;color:rgba(245,245,255,0.7);";
    hint.textContent = T("Je konkreter, desto besser findet dich das Mycel. Beschreibe in eigenen Worten: was die App/Seite ist, wofür man sie nutzt, welche Themen/Stichworte sie abdeckt, für wen sie gedacht ist. Ein gut gefüllter Absatz (ca. 3–8 Sätze) ist ideal — gern auch die README hineinkopieren. Vermeide reine Schlagwort-Listen ohne Kontext.");
    var btn = document.createElement("button");
    btn.type = "button"; btn.id = "sbkim-si-semantik-resign";
    btn.textContent = T("Beschreibung übernehmen → Vektor & Spore neu signieren");
    btn.style.cssText = "display:block;width:100%;margin:0.7rem 0 0;padding:0.5rem 0.8rem;font:inherit;" +
      "font-weight:700;cursor:pointer;border-radius:8px;border:1px solid #C9A961;" +
      "background:rgba(201,169,97,0.12);color:#F5E6B8;";
    var out = document.createElement("div");
    out.id = "sbkim-si-semantik-out";
    out.style.cssText = "margin:0.6rem 0 0;font-family:monospace;font-size:0.78rem;line-height:1.5;color:#6ee7d3;word-break:break-word;";
    btn.addEventListener("click", function () { reSignWithDescription(ta, btn, out); });

    /* ⚠ WORAUS DER VEKTOR GERECHNET WIRD — steht da, BEVOR gedrückt wird.
       Liefert die App eigene Inhalte, entscheidet der Inhalt und nicht der Text
       im Feld darüber. Das ist gewollt (Rangfolge vom 2026-06-28), aber es wäre
       eine Überraschung, wenn es niemand sagt: derselbe Knopf, dieselbe
       Beschreibung, eine andere Messgrundlage. */
    var proben = inhaltsSchnipsel();
    var vektorzeile = null;
    if (proben.length) {
      vektorzeile = document.createElement("p");
      vektorzeile.id = "sbkim-si-semantik-vektorquelle";
      vektorzeile.setAttribute("data-vektor", "content");
      vektorzeile.style.cssText = "margin:0.5rem 0 0;font-size:0.78rem;line-height:1.45;color:#6ee7d3;";
      vektorzeile.textContent = Tf("Dein Vektor kommt aus deinen eigenen Inhalten ({0} Einträge) — nicht aus dem Text oben. So wirst du nach dem gefunden, was wirklich bei dir steht. Die Satz-Schnipsel für die Feinsuche kommen weiter aus dem Text.", proben.length);
    }

    wrap.appendChild(label);
    wrap.appendChild(herkunft); wrap.appendChild(zurueck);
    wrap.appendChild(ta);
    wrap.appendChild(hint);
    if (vektorzeile) wrap.appendChild(vektorzeile);
    wrap.appendChild(btn); wrap.appendChild(out);
    setTimeout(function () { autoGrow(ta); }, 0);
    return wrap;
  }

  /* ── Der Vektor: INHALT schlägt Selbstbeschreibung ──────────────────────
   *
   * ⚠ DER BEFUND, DER DAS NÖTIG MACHTE (gemessen 2026-09-15): es gibt ZWEI Wege
   * zur Spore, und sie betteten Verschiedenes ein. Die stille Erst-Anmeldung
   * (sbkim-connect.js) rechnete den Vektor aus `sampleContent()` — den ECHTEN
   * Inhalten der App —, dieser Weg hier ausschließlich aus der Beschreibung.
   * Für einen fremden Nutzer, der Mein Rezeptbuch mit SEINEN Rezepten füllt,
   * hieß das: die erste Anmeldung war richtig, und in dem Moment, in dem er im
   * Siegel neu signierte, VERLOR er seinen Inhalts-Vektor und bekam die
   * Beschreibung der fremden App. Sein Knoten kündigte danach ein Thema an, das
   * ihm nicht gehört.
   *
   * Die Rangfolge ist NICHT neu erfunden, sondern die vom 2026-06-28: „wenn
   * echte Inhalte vorhanden sind, entscheidet der INHALT statt der
   * Selbstbeschreibung." Beide Wege fahren sie jetzt.
   *
   * ⚠ WER KEINE `sampleContent` HAT, MERKT NICHTS. Ohne die Funktion bleibt
   * alles wie bisher — deshalb braucht es für Apps, bei denen der Inhalt nichts
   * über den Nutzer sagt (Buchhaltung) oder gar nicht vorliegt, keine Sperre.
   * Eine Sperre, die nichts sperrt, sieht aus wie Schutz. */
  function inhaltsSchnipsel() {
    var c = cfg() || {};
    if (typeof c.sampleContent !== "function") return [];
    try {
      var s = c.sampleContent();
      if (!Array.isArray(s)) return [];
      return s.filter(function (x) { return x && String(x).trim().length; });
    } catch (e) { return []; }   // eine App, die wirft, verliert nur den Inhalts-Weg
  }

  /* Liefert { vec, quelle, anzahl }. `quelle` wandert als embeddingSource in die
     Spore. Der Rückfall auf die Beschreibung ist in BEIDE Richtungen fail-soft:
     keine Schnipsel ODER ein Fehler beim Rechnen → Beschreibung, kein Abbruch. */
  function vektorFuerSpore(beschreibung, say) {
    var proben = inhaltsSchnipsel();
    function ausBeschreibung() {
      say(T("Berechne semantischen Vektor (384-dim) …"));
      return window.SbkimEmbedding.embedPassage(beschreibung)
        .then(function (v) { return { vec: v, quelle: "description", anzahl: 0 }; });
    }
    if (!proben.length || typeof window.SbkimEmbedding.embedContentVector !== "function") {
      return ausBeschreibung();
    }
    say(Tf("Berechne den Vektor aus {0} eigenen Inhalten …", proben.length));
    return window.SbkimEmbedding.embedContentVector(proben)
      .then(function (res) {
        if (!res || !res.vector) return ausBeschreibung();
        return { vec: res.vector, quelle: "content", anzahl: proben.length };
      })
      .catch(function () { return ausBeschreibung(); });
  }

  /* ── embeddingVersion: der Zähler „der wievielte Inhalts-Stand ist das" ──
   *
   * ⚠ DER BEFUND (Klaus 2026-09-16, an seiner ECHTEN Spore gemessen): das Feld
   * FEHLTE. `regenerateOwnSpore` zählt es seit jeher hoch — aber dieser Weg
   * ruft `generateOwnSpore`, und das setzt es nur, wenn der Aufrufer es
   * mitgibt. Der Wizard tat das nicht, also stand es in keiner über das Siegel
   * signierten Spore. Ein Plan-Satz hatte behauptet, der Zähler sei „bereits
   * da"; er war es für den einen Weg, nicht für diesen.
   *
   * Was es leistet: `id` gehört dem SCHLÜSSEL und bleibt, solange der lebt.
   * `embeddingVersion` gehört dem INHALT. Ohne das Feld lässt sich an einer
   * Spore nicht ablesen, ob sich der Vektor seit dem letzten Mal bewegt hat —
   * dieselbe Kennung, derselbe Text, ein anderer Vektor, und nichts sagt es.
   *
   * ⚠ GEZÄHLT WIRD NUR, WENN SICH DER VEKTOR WIRKLICH BEWEGT. Ein Zähler, der
   * bei jedem Signieren hochläuft, misst KLICKS statt Inhalten und ist als
   * Drift-Anzeige wertlos. Das ist dieselbe Regel, die `regenerateOwnSpore` in
   * Modul 02 seit jeher fährt: gleicher Vektor ⇒ gleiche Zahl.
   *
   * Fail-soft in beide Richtungen: ist keine alte Spore lesbar, wird gezählt
   * statt abgebrochen — lieber eine 1 als gar kein Feld. */
  function naechsteEmbeddingVersion(neuerVektor) {
    return Promise.resolve()
      .then(function () { return window.SbkimSpore.getOwnSpore(); })
      .then(function (alt) {
        var prev = (alt && typeof alt.embeddingVersion === "number" && isFinite(alt.embeddingVersion))
          ? alt.embeddingVersion : 0;
        var a = alt && alt.domainVector;
        if (!Array.isArray(a) || !Array.isArray(neuerVektor) || a.length !== neuerVektor.length) {
          return prev + 1;
        }
        for (var i = 0; i < a.length; i++) if (a[i] !== neuerVektor[i]) return prev + 1;
        /* Unverändert: die Zahl bleibt stehen. Eine Alt-Spore ohne das Feld
           bekommt dabei die 1 — sie IST der erste gezählte Stand. */
        return prev || 1;
      })
      .catch(function () { return 1; });
  }

  function reSignWithDescription(ta, btn, out) {
    var c = cfg() || {};
    function say(msg, bad) { out.textContent = msg; out.style.color = bad ? "#e5484d" : "#6ee7d3"; }
    var beschreibung = (ta.value || "").trim();
    var gewaehlteQuelle = "description", gewaehlteAnzahl = 0;
    if (!beschreibung) { say(T("Bitte zuerst eine Beschreibung eintippen."), true); return; }
    if (!window.SbkimSpore || !window.SbkimEmbedding) { say(T("Module 02/03 nicht geladen."), true); return; }
    btn.disabled = true;
    var onProg = function (ev) {
      var d = ev && ev.detail; if (!d) return;
      var pct = (typeof d.progress === "number") ? " " + Math.round(d.progress) + "%" : "";
      say(T("Lade Sprachmodell (einmalig ~30 MB)") + pct + " …");
    };
    window.addEventListener("sbkim:embedding-progress", onProg);
    say(T("Erzeuge / lade Identität …"));
    /* ⚠ Das AKTIVE Fach, nicht hart "main" — dieselbe Falle wie in Schritt 1 des
       Wizards. generateOwnSpore unten signiert mit dem aktiven; ohne diese Zeile
       meldete die Statuszeile eine andere nodeId als die, die danach unterschrieb. */
    aktivesFach().then(function (fach) { return window.SbkimSpore.getOrCreateIdentity(fach); })
      .then(function (id) { say(Tf("Identität: {0} — initialisiere Embedding …", id.nodeId)); return window.SbkimEmbedding.init(); })
      .then(function () { return vektorFuerSpore(beschreibung, say); })
      .then(function (v) {
        var arr = Array.from(v.vec);
        /* A10 „Schnipsel-Mittel" (Spore v0.2): die Beschreibung zusätzlich SATZ-
           weise einbetten → snippetVectors. Fail-soft: schlägt es fehl, wird ohne
           Schnipsel weiter signiert (v0.2 bleibt). Reine Anzeige, gatet nichts.
           Bleibt die BESCHREIBUNG, auch wenn der Haupt-Vektor aus dem Inhalt kommt:
           die Schnipsel beantworten eine andere Frage (welcher SATZ passt zur
           Frage), und ein Rezept-Name ist kein Satz. */
        say(T("Erzeuge Satz-Schnipsel (v0.2) …"));
        if (!window.SbkimEmbedding.embedSnippets) return { arr: arr, snippetVectors: [], quelle: v.quelle, anzahl: v.anzahl };
        return window.SbkimEmbedding.embedSnippets(beschreibung)
          .then(function (snips) { return { arr: arr, snippetVectors: (snips || []).map(function (s) { return { vec: Array.from(s.vec), text: s.text }; }), quelle: v.quelle, anzahl: v.anzahl }; })
          .catch(function () { return { arr: arr, snippetVectors: [], quelle: v.quelle, anzahl: v.anzahl }; });
      })
      .then(function (r) {
        say(T("Signiere Spore …"));
        gewaehlteQuelle = r.quelle; gewaehlteAnzahl = r.anzahl;
        return naechsteEmbeddingVersion(r.arr).then(function (ver) {
        return window.SbkimSpore.generateOwnSpore({
          domain: c.domain, endpoint: c.endpoint, nodeType: c.nodeType, nodeName: c.nodeName,
          domainDescription: beschreibung, domainKeywords: c.domainKeywords,
          domainVector: r.arr, snippetVectors: r.snippetVectors,
          stammCategories: c.stammCategories, guestCategories: c.guestCategories,
          /* Der wievielte Inhalts-Stand das ist — siehe naechsteEmbeddingVersion. */
          embeddingVersion: ver,
          /* Sagt der Spore selbst, WORAUS ihr Vektor gerechnet ist. Ohne das Feld
             sieht eine inhalts-getriebene Spore wie eine beschreibungs-getriebene
             aus, und wer die Zahlen über die Zeit vergleicht, vergleicht zwei
             verschiedene Maßstäbe, ohne es zu merken. */
          embeddingSource: r.quelle,
        });
        });
      })
      .then(function (spore) {
        lastSpore = spore; downloadJson(sporeFileName(spore && spore.id), spore);
        merkeEigenenText(beschreibung);
        /* ⚠ ES STEHT DRAN, WORAUS DER VEKTOR KAM. Ohne diesen Satz wäre der
           Wechsel der Messgrundlage still — und still ist hier schlimmer als
           falsch: dieselbe Kennung, dieselbe Beschreibung, eine andere Zahl. */
        say(gewaehlteQuelle === "content"
          ? Tf("Spore neu signiert + ⬇  ·  nodeId={0}  ·  Vektor aus {1} eigenen Inhalten. Datei nach sbkim/spore.json committen.", spore.id, gewaehlteAnzahl)
          : Tf("Spore neu signiert + ⬇  ·  nodeId={0}. Datei nach sbkim/spore.json committen.", spore.id));
      })
      .catch(function (e) { say(Tf("Fehler: {0}", (e && e.message) || e), true); })
      .then(function () { window.removeEventListener("sbkim:embedding-progress", onProg); btn.disabled = false; });
  }

  /* ── (3) Schutz-Block + Erklär-Overlay ──────────────────────────────── */
  function buildSchutzInfoBlock() {
    var wrap = document.createElement("div");
    wrap.id = "sbkim-si-schutz-block";
    wrap.style.cssText = "margin:0 0 1rem;padding:0.75rem 0.9rem;border-radius:10px;" +
      "border:1px solid rgba(201,169,97,0.3);background:rgba(201,169,97,0.06);";
    var h = document.createElement("p");
    h.style.cssText = "margin:0 0 0.4rem;font-weight:700;color:#F5E6B8;";
    h.textContent = T("🛡 Was bedeutet dieses Siegel — und wie bist du geschützt?");
    var p = document.createElement("p");
    p.style.cssText = "margin:0;font-size:0.84rem;line-height:1.55;color:rgba(245,245,255,0.78);";
    /* ⚠ DER MEMBRAN-SATZ WIRD NICHT ALLEN IN DEN MUND GELEGT. Privat-Brain trug
       ihn seit seinem Gründungs-Commit; er ist wahr — aber nur dort, wo Modul 15
       wirklich geladen ist. Ein Schutz, den man zusichert, ohne ihn zu haben, ist
       schlimmer als keiner: er beruhigt. Deshalb hängt er an der Anwesenheit des
       Moduls und nicht an der Hoffnung. */
    var satz = T("Das Siegel ist selbst-ausgestellt: der Knoten hat beim Start geprüft, dass seine Schutz-Bausteine geladen sind, und zeigt das offen. Es wandern nur Daten, nie Programme; dein privater Schlüssel verlässt diesen Browser nie. Kein Server in der Mitte, keine Anmeldung.");
    if (window.SbkimMembrane) {
      satz += " " + T("Die Membran zeigt, wenn eine fremde KI / ein Browser-Agent auf die App zugreift.");
      p.setAttribute("data-membran", "ja");
    } else {
      p.setAttribute("data-membran", "nein");
    }
    p.textContent = satz;
    var btn = document.createElement("button");
    btn.type = "button"; btn.id = "sbkim-si-schutz-open";
    btn.textContent = T("Ausführlich erklärt → So funktioniert das Mycel & wie du geschützt bist");
    btn.style.cssText = "display:block;width:100%;margin:0.7rem 0 0;padding:0.5rem 0.8rem;font:inherit;" +
      "font-weight:700;cursor:pointer;border-radius:8px;border:1px solid #C9A961;" +
      "background:rgba(201,169,97,0.12);color:#F5E6B8;";
    btn.addEventListener("click", openSchutzModal);
    wrap.appendChild(h); wrap.appendChild(p); wrap.appendChild(btn);
    return wrap;
  }

  var schutzKeyHandler = null;
  function openSchutzModal() {
    var ov = document.getElementById("sbkim-si-schutz-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "sbkim-si-schutz-overlay";
      ov.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);";
      var frame = document.createElement("div");
      frame.style.cssText = "position:relative;width:min(900px,94vw);height:min(88vh,900px);background:#0a0d16;border:1px solid rgba(201,169,97,0.45);border-radius:12px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.7);";
      var closeBtn = document.createElement("button");
      closeBtn.type = "button"; closeBtn.setAttribute("aria-label", T("Schließen")); closeBtn.textContent = "✕";
      closeBtn.style.cssText = "position:absolute;top:0.5rem;right:0.6rem;z-index:1;cursor:pointer;background:rgba(0,0,0,0.5);color:#F5F5FF;border:1px solid rgba(201,169,97,0.45);border-radius:8px;padding:0.25rem 0.6rem;font-size:1rem;";
      closeBtn.addEventListener("click", closeSchutzModal);
      var iframe = document.createElement("iframe");
      iframe.src = "sicherheit.html"; iframe.title = T("So funktioniert das Mycel & wie du geschützt bist");
      iframe.style.cssText = "width:100%;height:100%;border:0;display:block;background:#0a0d16;";
      frame.appendChild(closeBtn); frame.appendChild(iframe); ov.appendChild(frame);
      ov.addEventListener("click", function (e) { if (e.target === ov) closeSchutzModal(); });
      document.body.appendChild(ov);
    }
    ov.style.display = "flex";
    if (!schutzKeyHandler) { schutzKeyHandler = function (e) { if (e && e.key === "Escape") closeSchutzModal(); }; document.addEventListener("keydown", schutzKeyHandler); }
  }
  function closeSchutzModal() {
    var ov = document.getElementById("sbkim-si-schutz-overlay");
    if (ov) ov.style.display = "none";
    if (schutzKeyHandler) { document.removeEventListener("keydown", schutzKeyHandler); schutzKeyHandler = null; }
  }

  /* ── (1) Der Wizard-Dialog (5 Bausteine, natives <dialog> → Top-Layer) ──
   * ⚠ Markup und Anzeigetext stehen GETRENNT: das Markup ist Gerüst, der Text
   * geht durch T(). Inline-Auszeichnung (<b>, <em>, <code>) bleibt IM Satz —
   * ein Satz, der am Fett-Anfang zerschnitten wird, ist keine Übersetzungs-
   * Einheit; in einer anderen Sprache steht das Fette woanders. */
  var KNOPF_CSS = "margin:.4em 0;cursor:pointer;border-radius:8px;border:1px solid #C9A961;background:rgba(201,169,97,0.12);color:#F5E6B8;padding:.3em .7em;font:inherit";
  var AUSGABE_CSS = "font-family:monospace;font-size:.8rem;color:#6ee7d3;word-break:break-all";

  function schritt(nr, titel, knopf, extra) {
    return '<li' + (nr > 1 ? ' style="margin-top:.6em"' : '') + '>' + titel + '<br>' +
      (extra || '') +
      (knopf || '') +
      '<div id="sbwiz-o' + nr + '" style="' + AUSGABE_CSS + '"></div></li>';
  }

  function buildWizardDialog() {
    var dlg = document.createElement("dialog");
    dlg.id = "sbkim-si-wizard";
    dlg.setAttribute("aria-label", T("Identität & Spore erzeugen"));
    dlg.style.cssText = "max-width:min(560px,94vw);border:1px solid rgba(201,169,97,0.5);border-radius:14px;background:#0a0d16;color:#eef2f8;padding:1.2rem 1.3rem;";
    dlg.innerHTML =
      '<h3 style="margin:0 0 .3em;color:#F5E6B8">' + T("🔑 Eigene Identität & Spore") + '</h3>' +
      '<p style="color:#9aa7b6;margin:.2em 0 1em;font-size:.88rem">' +
        T("Erzeugt eine SBKIM-Identität <b>im Browser</b> (Ed25519, IndexedDB) — der private Schlüssel verlässt diesen Browser nie. Notfall-tauglich: jederzeit eine <b>neue</b> Spore/Identität erzeugen und sichern. Erstes Embedding lädt ~30 MB (Modul 03, einmalig).") +
      '</p>' +
      '<ol style="padding-left:1.1rem;line-height:1.5;font-size:.9rem">' +
        schritt(1, T("<b>Identität erzeugen</b> — Ed25519-Schlüsselpaar, nodeId aus dem Public Key."),
          '<button type="button" id="sbwiz-s1" style="' + KNOPF_CSS + '">' + T("Identität erzeugen") + '</button>') +
        schritt(2, T("<b>Spore signieren + herunterladen</b> — mit echtem 384-dim domainVector. Dieselbe Spore wie im Verbinden-Fenster: eine Kennung, ein Eintrag im Netz. Du signierst hier ODER dort, nicht in beiden."),
          '<button type="button" id="sbwiz-s2" disabled style="' + KNOPF_CSS + '">' + T("Spore erzeugen + ⬇") + '</button>') +
        schritt(3, T("<b>Verschlüsseltes Backup</b> — Passwort-Sicherung (AES-256-GCM/PBKDF2 600k) gegen IndexedDB-Verlust. Dieselbe Sicherung wie im Verbinden-Fenster: zweimal drücken ergibt zwei Dateien mit gleichem Inhalt."),
          '<button type="button" id="sbwiz-s3" disabled style="' + KNOPF_CSS + '">' + T("Backup erzeugen + ⬇") + '</button>') +
        schritt(4, T("<b>Identität wiederherstellen</b> — Backup-Datei (Schritt 3) + Passwort zurückspielen: Schlüssel <em>und</em> Spore landen wieder in der Browser-IndexedDB. Auch auf neuem Gerät."),
          '<button type="button" id="sbwiz-s4" style="' + KNOPF_CSS + '">' + T("Backup-Datei wählen + wiederherstellen") + '</button>',
          '<input type="file" id="sbwiz-s4-file" accept=".json,application/json" hidden />') +
        schritt(5, T("<b>Identitäts-Wechsler</b> — welche Identität ist aktiv? Bei mehreren (z. B. aus altem Browser-Zustand) die kanonische wählen. Es wird nichts gelöscht."),
          '<select id="sbwiz-idsel" style="margin:.4em 0;max-width:100%;border-radius:8px;border:1px solid #C9A961;background:rgba(0,0,0,0.35);color:#F5E6B8;padding:.35em .5em;font:inherit"><option value="">' + T("— wird geladen … —") + '</option></select>') +
      '</ol>' +
      '<p style="color:#9aa7b6;font-size:.78rem;margin:.7em 0 0">' +
        T("Die heruntergeladene <code>spore.json</code> nach <code>sbkim/spore.json</code> ins Repo legen. Backup-Datei + Passwort sicher aufbewahren — ohne beides keine Wiederherstellung.") +
      '</p>' +
      '<button type="button" id="sbwiz-close" style="margin-top:1em;cursor:pointer;border-radius:8px;border:1px solid rgba(154,167,182,.4);background:transparent;color:#eef2f8;padding:.4em .9em;font:inherit">' + T("Schließen") + '</button>';
    document.body.appendChild(dlg);

    function out(id, msg, bad) { var e = dlg.querySelector(id); if (!e) return; e.textContent = msg; e.style.color = bad ? "#e5484d" : "#6ee7d3"; }

    dlg.querySelector("#sbwiz-s1").addEventListener("click", function () {
      var b = dlg.querySelector("#sbwiz-s1");
      if (!window.SbkimSpore || !window.SbkimSpore.getOrCreateIdentity) { out("#sbwiz-o1", T("Modul 02 nicht geladen."), true); return; }
      b.disabled = true; out("#sbwiz-o1", T("Erzeuge Identität …"));
      /* ⚠ DAS AKTIVE FACH, NICHT HART "main". getOrCreateIdentity() ohne Argument
         trifft immer DEFAULT_IDENTITY_KEY; Schritt 2 signiert dagegen mit dem
         AKTIVEN Fach (generateOwnSpore → getActiveIdentityKey). Nach einem
         Identitäts-Wechsel bedienten die zwei Knöpfe desselben Fensters damit
         ZWEI VERSCHIEDENE Identitäten: Schritt 1 meldete eine nodeId, Schritt 2
         signierte eine andere. Gemessen am 2026-09-15. */
      aktivesFach().then(function (fach) {
        return window.SbkimSpore.getOrCreateIdentity(fach);
      }).then(function (id) {
        out("#sbwiz-o1", Tf("nodeId: {0}", id.nodeId)); dlg.querySelector("#sbwiz-s2").disabled = false;
        /* Schritt 5 nachziehen. Ohne das behauptet der Wechsler weiter „Noch
           keine Identität", obwohl gerade eine angelegt wurde — er wurde bisher
           NUR beim Öffnen des Fensters gefüllt. Klaus sah das am 2026-08-17 an
           Perfect Skin Beauty: Schritt 1 zeigte eine Kennung, Schritt 5 sagte im
           selben Fenster, es gebe keine. Wer das liest, glaubt eher der
           Fehlermeldung als dem Erfolg. */
        refreshWizardIdentities();
      }).catch(function (e) { out("#sbwiz-o1", Tf("Fehler: {0}", (e && e.message) || e), true); b.disabled = false; });
    });

    dlg.querySelector("#sbwiz-s2").addEventListener("click", function () {
      var c = cfg() || {};
      var b = dlg.querySelector("#sbwiz-s2");
      if (!window.SbkimEmbedding || !window.SbkimSpore) { out("#sbwiz-o2", T("Modul 02/03 nicht geladen."), true); return; }
      b.disabled = true;
      /* PFLICHT (Klaus 2026-07-08): beim ~30-MB-Modell-Laden IMMER Prozent zeigen —
         sonst wirkt es eingefroren und wird zu früh geschlossen. */
      var onProg = function (ev) {
        var d = ev && ev.detail; if (!d) return;
        if (typeof d.progress === "number" && isFinite(d.progress)) {
          var pct = Math.max(0, Math.min(100, Math.round(d.progress)));
          var filled = Math.round(pct / 5);
          out("#sbwiz-o2", Tf("Modell lädt  {0}  {1} %  (~30 MB einmalig)",
            "█".repeat(filled) + "░".repeat(20 - filled), pct));
        } else if (d.status === "done" || d.status === "ready") {
          out("#sbwiz-o2", T("Modell geladen ✓"));
        }
      };
      window.addEventListener("sbkim:embedding-progress", onProg);
      out("#sbwiz-o2", T("Lade Embedding-Modell (~30 MB, einmalig) …"));
      var quelle = String(c.domainDescription || "") + ". " + (c.domainKeywords || []).join(", ");
      /* ⚠ DERSELBE WEG WIE „NEU SIGNIEREN" — DER INHALT SCHLÄGT DIE
         SELBSTBESCHREIBUNG. Bis zum 2026-09-16 stand hier ein nacktes
         `embedPassage(quelle)`. Die ERST-Signatur über das Siegel bettete
         damit immer die App-Beschreibung ein, während die stille Anmeldung
         über das Verbinden-Fenster und der Knopf „neu signieren" längst den
         INHALT nahmen. Beide Wege schreiben aber in dasselbe Fach
         (`generateOwnSpore` ohne Argument → aktives Fach): dieselbe Kennung,
         dieselbe Spore — und je nach gedrücktem Knopf ein anderes Thema, unter
         dem man gefunden wird. Das ist dem Nutzer nicht zu erklären, und es
         war der Grund, warum „du musst nur an EINER Stelle signieren" bis
         heute nicht ganz stimmte.
         ⚠ ES BRAUCHT KEINE SPERRE FÜR APPS OHNE EIGENE INHALTE. Ohne
         `sampleContent` fällt `vektorFuerSpore` von selbst auf die
         Beschreibung zurück — Buchhaltung und Firmen-Seiten bleiben damit
         unberührt, ohne dass sie jemand austragen müsste. Eine Sperre, die
         nichts sperrt, sieht aus wie Schutz. */
      var s2Quelle = "description", s2Anzahl = 0;
      window.SbkimEmbedding.init()
        .then(function () { return vektorFuerSpore(quelle, function (m) { out("#sbwiz-o2", m); }); })
        .then(function (v) {
          var arr = Array.from(v.vec);
          s2Quelle = v.quelle; s2Anzahl = v.anzahl;
          out("#sbwiz-o2", T("Erzeuge Satz-Schnipsel (v0.2) …"));
          if (!window.SbkimEmbedding.embedSnippets) return { arr: arr, snippetVectors: [] };
          return window.SbkimEmbedding.embedSnippets(quelle)
            .then(function (snips) { return { arr: arr, snippetVectors: (snips || []).map(function (s) { return { vec: Array.from(s.vec), text: s.text }; }) }; })
            .catch(function () { return { arr: arr, snippetVectors: [] }; });
        })
        .then(function (r) {
          out("#sbwiz-o2", T("Signiere Spore …"));
          return naechsteEmbeddingVersion(r.arr).then(function (ver) {
          return window.SbkimSpore.generateOwnSpore({
            domain: c.domain, endpoint: c.endpoint, nodeType: c.nodeType, nodeName: c.nodeName,
            domainDescription: c.domainDescription, domainKeywords: c.domainKeywords,
            domainVector: r.arr, snippetVectors: r.snippetVectors,
            stammCategories: c.stammCategories, guestCategories: c.guestCategories,
            /* Der wievielte Inhalts-Stand das ist — wie im Weg „neu signieren". */
            embeddingVersion: ver,
            /* Sagt der Spore selbst, WORAUS ihr Vektor gerechnet ist — wie im
               Weg „neu signieren". Ohne das Feld sieht eine inhalts-getriebene
               Spore wie eine beschreibungs-getriebene aus. */
            embeddingSource: s2Quelle,
          });
          });
        })
        .then(function (spore) {
          lastSpore = spore; downloadJson(sporeFileName(spore && spore.id), spore);
          /* ⚠ ES STEHT DRAN, WORAUS DER VEKTOR KAM. Sonst wäre der Wechsel der
             Messgrundlage still, und still ist hier schlimmer als falsch. */
          out("#sbwiz-o2", s2Quelle === "content"
            ? Tf("Spore erzeugt + ⬇ (nodeId={0})  ·  Vektor aus {1} eigenen Inhalten. Nach sbkim/spore.json committen.", spore.id, s2Anzahl)
            : Tf("Spore erzeugt + ⬇ (nodeId={0}). Nach sbkim/spore.json committen.", spore.id));
          dlg.querySelector("#sbwiz-s3").disabled = false;
          /* Auch hier nachziehen: der Wechsler zeigt je Fach die Kennung, und die
             steht erst nach der Spore fest. */
          refreshWizardIdentities();
          /* Und die alte Meldung aus Schritt 3 wegräumen. Sie stammt aus einem
             Klick VOR der Identität und blieb danach als Fehler stehen — das
             Backup war längst möglich, nur sagte die Zeile weiter das Gegenteil. */
          var o3 = dlg.querySelector("#sbwiz-o3");
          if (o3 && /Keine Identit/.test(o3.textContent || "")) o3.textContent = "";
        })
        .catch(function (e) { out("#sbwiz-o2", Tf("Fehler: {0}", (e && e.message) || e), true); b.disabled = false; })
        .then(function () { window.removeEventListener("sbkim:embedding-progress", onProg); });
    });

    dlg.querySelector("#sbwiz-s3").addEventListener("click", function () {
      var c = cfg() || {};
      if (!window.SbkimSpore || !window.SbkimSpore.exportBackup) { out("#sbwiz-o3", T("Modul 02 exportBackup fehlt."), true); return; }
      var pw = window.prompt(T("Backup-Passwort (mind. 8 Zeichen, KEIN Reset möglich):"));
      if (!pw) { out("#sbwiz-o3", T("Abgebrochen — kein Passwort."), true); return; }
      var b = dlg.querySelector("#sbwiz-s3"); b.disabled = true;
      out("#sbwiz-o3", T("Erzeuge Backup (PBKDF2 600k + AES-GCM-256) …"));
      Promise.all([window.SbkimSpore.exportBackup(pw), sicherungsKennung()]).then(function (r) {
        var blob = r[0], kennung = r[1];
        var praefix = c.backupPrefix || "sbkim-backup";
        downloadJson(praefix + "-" + new Date().toISOString().replace(/[:.]/g, "-") + kennung + ".sbkim.json", blob);
        /* ⚠ DAS VERBINDEN-PANEL ZEIGT „Letzte Sicherung" — und wusste bis zum
           2026-09-16 nichts von einer Sicherung, die HIER entstand. Beide Wege
           rufen dasselbe `SbkimSpore.exportBackup`; nur der Vermerk hing an
           Modul 23 allein, und so sah es aus, als haette der Nutzer nicht
           gesichert, obwohl die Datei liegt.
           ⚠ Der Schluessel wird NICHT nachgebaut (er haengt an `cfg.dbSuffix`,
           den dieses Modul nicht kennt) — gerufen wird die Handlung. Fail-soft:
           ohne Modul 23 bleibt das Backup trotzdem gueltig, es fehlt nur ein
           Vermerk in einem Panel, das es hier gar nicht gibt. */
        try {
          if (window.SbkimRendezvousUI && typeof window.SbkimRendezvousUI.markBackupMade === "function") {
            window.SbkimRendezvousUI.markBackupMade();
          }
        } catch (_e) { /* fail-soft — ein fehlender Vermerk kostet kein Backup */ }
        out("#sbwiz-o3", T("Backup ⬇ — Datei + Passwort sicher aufbewahren."));
      }).catch(function (e) { out("#sbwiz-o3", Tf("Fehler: {0}", (e && e.message) || e), true); b.disabled = false; });
    });

    dlg.querySelector("#sbwiz-s4").addEventListener("click", function () { dlg.querySelector("#sbwiz-s4-file").click(); });
    dlg.querySelector("#sbwiz-s4-file").addEventListener("change", function (ev) {
      var input = ev.target; var file = input.files && input.files[0];
      if (!window.SbkimSpore || !window.SbkimSpore.importBackup) { out("#sbwiz-o4", T("Modul 02 importBackup fehlt."), true); return; }
      if (!file) { out("#sbwiz-o4", T("Keine Datei gewählt."), true); return; }
      file.text().then(function (text) {
        var blob; try { blob = JSON.parse(text); } catch (e) { out("#sbwiz-o4", T("Datei ist kein gültiges JSON-Backup."), true); input.value = ""; return; }
        var pw = window.prompt(T("Backup-Passwort eingeben (das beim Sichern vergebene):"));
        if (!pw) { out("#sbwiz-o4", T("Abgebrochen — kein Passwort."), true); input.value = ""; return; }
        out("#sbwiz-o4", T("Entschlüssele Backup + spiele Identität zurück …"));
        window.SbkimSpore.importBackup(blob, pw).then(afterRestore).catch(function (err) {
          var msg = (err && err.message) ? err.message : String(err);
          var name = (err && err.name) ? err.name : "";
          if (/Overwrite/i.test(name) || /vorhanden|überschreib|overwrite/i.test(msg)) {
            if (window.confirm(T("Eine Identität existiert bereits im Browser. Mit der Backup-Version überschreiben? (Die jetzige lokale Identität geht verloren.)"))) {
              out("#sbwiz-o4", T("Überschreibe vorhandene Identität …"));
              window.SbkimSpore.importBackup(blob, pw, { force: true }).then(afterRestore)
                .catch(function (e2) { out("#sbwiz-o4", Tf("Fehler beim Überschreiben: {0}", (e2 && e2.message) || e2), true); });
            } else { out("#sbwiz-o4", T("Abgebrochen — vorhandene Identität unverändert."), true); }
          } else { out("#sbwiz-o4", Tf("Fehler: {0} (falsches Passwort oder beschädigte Datei?)", msg), true); }
        }).then(function () { input.value = ""; });
      });
    });

    function afterRestore(res) {
      if (res && res.restored) {
        out("#sbwiz-o4", T("Identität wiederhergestellt — Schlüssel + Spore zurück in der Browser-IndexedDB."));
        dlg.querySelector("#sbwiz-s2").disabled = false; dlg.querySelector("#sbwiz-s3").disabled = false;
        refreshWizardIdentities();
      } else {
        out("#sbwiz-o4", Tf("Nichts wiederhergestellt{0}.", (res && res.reason) ? " — " + res.reason : ""), true);
      }
    }

    /* Baustein 5 — Identitäts-Wechsler (aktive Identität wählen; löscht nichts). */
    dlg.querySelector("#sbwiz-idsel").addEventListener("change", function () { switchWizardIdentity(this.value); });
    dlg.querySelector("#sbwiz-close").addEventListener("click", function () { closeWiz(dlg); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) closeWiz(dlg); });
    refreshWizardIdentities();

    /* Wizard-Init-Heilung (Klaus-Befund 2026-07-19: „Backup-Knopf löst nichts
       aus"): existiert bereits eine Identität — z. B. beim ersten Verbinden
       automatisch angelegt —, schalte Schritt 2 und 3 SOFORT frei. listIdentities()
       erzeugt NICHTS (nur Lesen), fail-soft.
       ⚠ Diese Heilung stand vom 2026-07-19 bis 2026-09-09 nur in EINER Kopie und
       nie im Kanon; wer von dort neu kopierte, holte sich den Fehler zurück, und
       niemand hätte es gesehen: der Knopf ist ja da, er tut nur nichts. */
    if (window.SbkimSpore && typeof window.SbkimSpore.listIdentities === "function") {
      window.SbkimSpore.listIdentities().then(function (ids) {
        if (ids && ids.length) {
          var s2 = dlg.querySelector("#sbwiz-s2"); if (s2) s2.disabled = false;
          var s3 = dlg.querySelector("#sbwiz-s3"); if (s3) s3.disabled = false;
        }
      }).catch(function () {});
    }
  }

  /* ── Baustein 5: Identitäts-Wechsler ───────────────────────────────────
   * shortNode: gekürzte nodeId fürs Etikett (die volle bleibt im title). */
  function shortNode(id) {
    if (!id) return "";
    return id.length > 20 ? id.slice(0, 16) + "…" : id;
  }
  function refreshWizardIdentities() {
    var sel = document.getElementById("sbwiz-idsel");
    var o = document.getElementById("sbwiz-o5");
    if (!sel) return;
    if (!window.SbkimSpore || typeof window.SbkimSpore.listIdentities !== "function") {
      if (o) { o.textContent = T("Identitäts-Liste nicht verfügbar (Modul 02 zu alt)."); }
      return;
    }
    window.SbkimSpore.listIdentities().then(function (ids) {
      var activeP = (typeof window.SbkimSpore.getActiveIdentityKey === "function")
        ? window.SbkimSpore.getActiveIdentityKey().catch(function () { return null; })
        : Promise.resolve(null);
      return activeP.then(function (active) {
        sel.innerHTML = "";
        if (!ids || !ids.length) {
          var opt0 = document.createElement("option");
          opt0.value = ""; opt0.textContent = T("— keine geladen —");
          sel.appendChild(opt0);
          if (o) o.textContent = T("Noch keine Identität — oben zuerst eine anlegen.");
          return;
        }
        /* Pro Fach die nodeId auflösen (Point-Muster 2026-07-16):
           getOrCreateIdentity(fach) gibt bei EXISTIERENDEM Fach nur zurück und
           erzeugt nichts — alle Fächer hier existieren (aus listIdentities). So
           sieht man je Fach die nodeId, nicht nur den Speicher-Schlüssel. */
        var canResolve = typeof window.SbkimSpore.getOrCreateIdentity === "function";
        return Promise.all(ids.map(function (k) {
          if (!canResolve) return Promise.resolve({ key: k, nodeId: null });
          return window.SbkimSpore.getOrCreateIdentity(k)
            .then(function (id) { return { key: k, nodeId: (id && id.nodeId) || null }; })
            .catch(function () { return { key: k, nodeId: null }; });
        })).then(function (rows) {
          var activeNode = null;
          rows.forEach(function (row) {
            var opt = document.createElement("option");
            opt.value = row.key;
            var label = row.key + (row.nodeId ? " · " + shortNode(row.nodeId) : "");
            if (row.key === active) { label += T("  (aktiv)"); opt.selected = true; activeNode = row.nodeId; }
            opt.textContent = label;
            if (row.nodeId) opt.title = row.nodeId;
            sel.appendChild(opt);
          });
          var tail = ids.length === 1
            ? T("Genau eine Identität — sauber.")
            : Tf("{0} Identitäten — wähle die kanonische (aktiv markiert).", ids.length);
          if (o) o.textContent = activeNode ? Tf("{0} · aktive nodeId: {1}", tail, activeNode) : tail;
        });
      });
    }).catch(function (e) { if (o) o.textContent = Tf("Fehler beim Lesen der Identitäten: {0}", (e && e.message) || e); });
  }
  function switchWizardIdentity(key) {
    var o = document.getElementById("sbwiz-o5");
    if (!key || !window.SbkimSpore || typeof window.SbkimSpore.setActiveIdentity !== "function") return;
    window.SbkimSpore.setActiveIdentity(key).then(function () {
      if (o) o.textContent = Tf("✔ Aktive Identität gewechselt zu {0}. Die nächste Spore-Signatur nutzt diese nodeId.", key);
      refreshWizardIdentities();
      /* ⚠ DER SEMANTIK-BLOCK ZIEHT SONST NICHT NACH. Er wird EINMAL gebaut und
         liest getOwnSpore() genau einmal dabei — nach einem Wechsel stand dort
         weiter der Vergleich des VORIGEN Fachs, also die Herkunfts-Zeile und der
         „↺ zurückholen"-Knopf einer fremden Identität. Gemessen am 2026-09-15. */
      redrawSemantikBlock();
    }).catch(function (err) { if (o) o.textContent = Tf("Wechsel fehlgeschlagen: {0}", (err && err.message) || err); });
  }

  /* Den Semantik-Block gegen einen frisch gebauten tauschen. Nicht „aktualisieren":
     der Block liest seinen Zustand beim Bauen, also ist Neubauen die eine Stelle,
     an der die Herkunfts-Logik steht. Zwei Fassungen liefen sonst auseinander. */
  function redrawSemantikBlock() {
    var alt = document.getElementById("sbkim-si-semantik-block");
    if (!alt || !alt.parentNode) return;   // fail-soft: kein Siegel offen, nichts zu tun
    alt.parentNode.replaceChild(buildSemantikBlock(), alt);
  }

  function openWizard() {
    var d = document.getElementById("sbkim-si-wizard");
    if (d && d.showModal) d.showModal(); else if (d) d.setAttribute("open", "");
    refreshWizardIdentities();
  }
  function closeWiz(d) { if (d.close) d.close(); else d.removeAttribute("open"); }

  /* ── Modal beobachten (Modul 16 mountet es bei init; erscheint per Klick) ── */
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
