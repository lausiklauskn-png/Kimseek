// Kim-Brain — Kern-Logik-Test (Beweis für die reine Logik der Probeversion).
//
// Prüft die DOM-freien Transformationen aus assets/brain-core.js: Typ-Erkennung,
// .eml-Parsing, die schwache Namenssuche gegen die starke Bedeutungssuche
// (der Aha-Beweis), das Überspringen bereits signierter Dateien (zweiter Lauf)
// und den Selbst-Sortier-Vorschlag (Cluster).
//
// Ehrlichkeit: der echte Browser-Pfad (crypto.subtle-Hash, IndexedDB, das echte
// e5-Embedding aus Modul 03, OCR aus Modul 24, der KI-Richter aus Modul 04)
// bleibt „ungeprüft, wartet auf Klaus' Browser-Lauf".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// brain-core.js ist ein klassisches Browser-Skript (UMD). Es setzt
// module.exports UND globalThis.KimBrainCore. Wir laden es als CommonJS über
// eine kleine vm-freie Auswertung, damit derselbe Datei-Inhalt getestet wird,
// den der Browser lädt.
const src = readFileSync(join(ROOT, "assets", "brain-core.js"), "utf8");
const factory = new Function("module", "globalThis", src + "\nreturn module.exports;");
const C = factory({ exports: {} }, {});

test("guessType erkennt Text, PDF, E-Mail und Bild", () => {
  assert.equal(C.guessType("notiz.txt"), "text");
  assert.equal(C.guessType("bericht.md"), "text");
  assert.equal(C.guessType("rechnung.pdf"), "pdf");
  assert.equal(C.guessType("angebot.PDF", "application/pdf"), "pdf");
  assert.equal(C.guessType("post.eml"), "email");
  assert.equal(C.guessType("scan.jpg"), "image");
  assert.equal(C.guessType("bild", "image/png"), "image");
  assert.equal(C.guessType("archiv.zip"), "other");
});

test("parseEml zerlegt Kopf und Rumpf; emlToText baut Suchtext", () => {
  const raw =
    "From: kunde@example.com\r\n" +
    "To: werkstatt@example.com\r\n" +
    "Subject: Angebot schwarzer Kombi\r\n" +
    "Date: Mon, 6 Jul 2026 10:00:00 +0200\r\n" +
    "\r\n" +
    "Bitte um ein Angebot fuer die Folierung.\r\n";
  const p = C.parseEml(raw);
  assert.equal(p.subject, "Angebot schwarzer Kombi");
  assert.equal(p.from, "kunde@example.com");
  assert.match(p.body, /Folierung/);
  const text = C.emlToText(p);
  assert.match(text, /Betreff: Angebot schwarzer Kombi/);
  assert.match(text, /Folierung/);
});

test("Namenssuche findet nur wörtliche Datei-/Pfad-Treffer", () => {
  const catalog = [
    { id: "a", name: "IMG_2381.jpg", pfad: "/fotos/IMG_2381.jpg", textSchnipsel: "schwarzer Sportwagen, Radstand 2,80 m, frisch foliert" },
    { id: "b", name: "steuer_2025.pdf", pfad: "/buchhaltung/steuer_2025.pdf", textSchnipsel: "Umsatzsteuervoranmeldung" },
  ];
  // Die Bedeutungs-Frage steht NICHT im Dateinamen → Namenssuche findet nichts.
  assert.equal(C.nameSearch(catalog, "schwarzes Auto Radstand").length, 0);
  // Aber der wörtliche Dateiname wird gefunden.
  assert.equal(C.nameSearch(catalog, "IMG_2381").length, 1);
  assert.equal(C.nameSearch(catalog, "steuer").length, 1);
});

test("Bedeutungssuche (rankByVector) schlägt die Namenssuche über den Inhalt", () => {
  // Simulierte 4-dim „Bedeutungs"-Vektoren (Achsen: Auto, Steuer, Kochen, Reise).
  const catalog = [
    { id: "a", name: "IMG_2381.jpg", vektor: [0.95, 0.05, 0.0, 0.1] }, // schwarzes Auto
    { id: "b", name: "steuer_2025.pdf", vektor: [0.02, 0.98, 0.0, 0.0] }, // Steuer
    { id: "c", name: "rezept.txt", vektor: [0.0, 0.0, 0.99, 0.05] }, // Kochen
  ];
  const frageAuto = [0.9, 0.1, 0.0, 0.2]; // „das schwarze Auto"
  const ranked = C.rankByVector(catalog, frageAuto, { k: 2 });
  assert.equal(ranked[0].entry.id, "a", "Auto-Datei steht oben");
  assert.ok(ranked[0].score > ranked[1].score);
  // Namenssuche mit derselben Frage: nichts, weil kein Dateiname passt.
  assert.equal(C.nameSearch(catalog, "das schwarze Auto").length, 0);
});

test("partitionByHash überspringt bereits signierte Dateien (zweiter Lauf)", () => {
  const existing = ["h1", "h2"];
  const incoming = [
    { hash: "h1", name: "alt.txt" },
    { hash: "h3", name: "neu.txt" },
    { hash: "h3", name: "neu-duplikat.txt" }, // Doppel im selben Wurf
  ];
  const { neu, uebersprungen } = C.partitionByHash(existing, incoming);
  assert.deepEqual(neu.map((x) => x.hash), ["h3"]);
  assert.equal(uebersprungen.length, 2);
});

test("clusterCatalog schlägt Gruppen vor (reiner Vorschlag, gatet nichts)", () => {
  const catalog = [
    { id: "1", name: "kombi_schwarz.jpg", vektor: [1, 0, 0], kiKurzfassung: "schwarzer Kombi foliert" },
    { id: "2", name: "limousine_schwarz.jpg", vektor: [0.98, 0.02, 0], kiKurzfassung: "schwarze Limousine foliert" },
    { id: "3", name: "steuer.pdf", vektor: [0, 1, 0], kiKurzfassung: "Steuererklärung 2025" },
    { id: "4", name: "readme", /* ohne Vektor */ kiKurzfassung: "" },
  ];
  const groups = C.clusterCatalog(catalog, { threshold: 0.8 });
  // Zwei Auto-Bilder in einer Gruppe, Steuer allein, „ohne Vektor" separat.
  const autoGroup = groups.find((g) => g.mitglieder.includes("1"));
  assert.ok(autoGroup.mitglieder.includes("2"), "beide Auto-Bilder in einer Gruppe");
  assert.ok(!autoGroup.mitglieder.includes("3"), "Steuer nicht in der Auto-Gruppe");
  assert.ok(groups.some((g) => g.titel === "Ohne Bedeutungs-Vektor"));
});

test("makeSnippet kürzt sauber an Wortgrenze", () => {
  const long = "Wort ".repeat(400);
  const snip = C.makeSnippet(long, 50);
  assert.ok(snip.length <= 54);
  assert.match(snip, /…$/);
  assert.equal(C.makeSnippet("kurz"), "kurz");
});
