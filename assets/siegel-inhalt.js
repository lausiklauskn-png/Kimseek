/*
 * Siegel-Inhalt — DIE IDENTITÄT DIESES KNOTENS, und sonst nichts.
 *
 * ⚠ HIER STEHT KEIN KANON. Der Andock-Wizard, alle Anzeigetexte und alle
 * Prüfungen liegen seit A18 (2026-09-14) in EINER netzweit byte-gleichen
 * Datei — `assets/sbkim-andock-wizard.js`, Kanon `Sage-Protokol/src/modules/16b_andock_wizard.js`.
 * Diese Datei trägt nur noch, was in jedem Knoten ANDERS sein muss.
 *
 * Warum die Trennung: gemessen über die 20 Kopien im Netz standen am 2026-09-14
 * ZWÖLF verschiedene Code-Fassungen desselben Werkzeugs. Jede Verbesserung
 * kostete Handarbeit mal zwanzig und unterblieb deshalb meistens.
 *
 * ⚠ UND DIESE DATEI WIRD NIE VERTEILT. Sie trägt die BEDEUTUNG des Knotens; ein
 * Überschreiben gäbe dieser App den Namen und den Vektor einer fremden — der
 * Schaden vom 2026-08-16 in Alis Moderaum.
 *
 * Vertrag: Sage-Protokol/docs/INTERFACES.md §11.9.
 */
(function () {
  "use strict";
  window.SBKIM_SIEGEL_WIZ = {
    domain: "Semantische Bedeutungs-Suche",
    endpoint: "https://lausiklauskn-png.github.io/Kimseek/",
    nodeType: "hybrid",
    nodeName: "Kimseek",
    domainDescription: "Kimseek — semantisches Such-Werkzeug, das die Bedeutung und Absicht hinter einer Frage versteht (nicht nur Stichwörter). Ordnet Treffer nach Bedeutungs-Nähe, server-los im Browser; optional Spracheingabe, Bild-/Handschrift-Erkennung (OCR) und eine KI-Brücke mit Web-Suche.",
    domainKeywords: ["Semantische Suche", "Bedeutung", "Absicht", "Embedding", "Sprachsuche", "OCR", "SBKIM", "Mycel"],
    stammCategories: ["Semantische Suche", "Bedeutungs-Sortierung", "Sprach-/Bild-Eingabe"],
    guestCategories: ["Spore-Erzeugung", "Backup", "Handshake"],
    /* ⚠ NACHGETRAGEN BEIM A18-UMBAU (2026-09-14). Vorher stand dieser Name HART
       im Wizard-Code — in einer Datei, die jetzt netzweit byte-gleich ist. Ohne
       den Eintrag hiesse die Sicherung dieser App wie jede andere. */
    backupPrefix: "kimseek-backup",
  };
})();
