// Kimseek — Smoke-Test (Beweis).
//
// Zwei Teile:
//   1) Drift-Guard: die byte-1:1-Kopien der SBKIM-Kern-Module (modules/*.js)
//      müssen ihren aufgezeichneten sha256 halten. Verändert jemand eine Kopie
//      versehentlich, wird der Test rot — „kopieren, nicht klonen" bleibt
//      nachprüfbar (kanonische Quelle: Sage-Protokol/src/modules/* bzw.
//      such-tool/modules/* für 03/04/21/22/24).
//   2) App-Schale-Vollständigkeit + korrekte Ladeordnung (Storage-Kern VOR der
//      eigenen Schublade, Modul 22 Such-Widget vorhanden).
//
// Ehrlichkeit: der echte Browser-Pfad (Live-Relais, IndexedDB, Service-Worker,
// Modell-Laden, semantische Suche) bleibt „ungeprüft, wartet auf Klaus'
// Browser-Lauf".

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Aufgezeichnete Hashes der kanonischen Modul-Kopien. Beim absichtlichen
// Nachziehen einer neuen Modul-Version wird dieser Block mit den neuen Hashes
// aktualisiert (bewusster Commit).
const EXPECTED_SHA256 = {
  "01_storage.js": "5a5a4bf64dfcc107da7ed70fb755d7db5cce7d80e963b3e2fbc2004537747820",
  "02_spore.js": "0cbf0664e2a79f1301c03e52f7ac0030d4b2961f03b97b38e8634827a52353c5",
  "03_embedding.js": "2e31baa09a2959c95efff8eecd224e8343e75695b4b293aa35209d8f96d1f3b5",
  "04_match.js": "721eecc3c0d6ea4c259259e6071215ec1cd16f1c43c87b42ce9e72e9a0b5e41c",
  "05_anastomose.js": "255ac79aeb3b0203e92f0cebd0a905e47c488b43efe18f41332a7d35520bbf23",
  "05b_nostr_relay.js": "37eee5b196b3efad57131edd1cc3c0ee23acb97b5ca40740d6a0771db4b4a421",
  "07_apoptose.js": "0acdd6ab2d95e131fa6953061cc0e95a2396e05fff091a7dc690b2668a4c035a",
  "15_membran.js": "829a5bc01976b59c5ce428125314b87b314b6212cd5a473634c2d22c02579397",
  "16_siegel.js": "7c12bc487d445f7a284469eb860fcaec7bf93f84e146a00091cc93e5af210fec",
  "20_schluessel_safe.js": "e7e25c9070e93f8267171d2b626109cfd90cb481c2781242f5f7dfc203f031f3",
  "17_floating_widget.js": "e4ee076c1295910d0e83470ebda327e7419f29bc06f6718148369c8369e1a5ce",
  "21_spracheingabe.js": "020ca26ff52f2ed726f6344bd3ac55eb52e3472a7f97bdd41bdd0d54132777ba",
  "22_such_widget.js": "ef4d5eb707ebc12a2a53e060fbb0367df5103ee12b76195b207e6c6b7f2fe8de",
  "23_rendezvous.js": "05a6eb42ec687e74a8617f9941491a4f14bddda2257f84034eefbf3a106a624f",
  "23_rendezvous_ui.js": "efecd89ea80d8fa19c61c61a77b71a6d1b8cc8981c6ec1efd10ee92595a44f40",
  "24_ocr_eingabe.js": "f638f1cf4aaaa22e91186249f91cb1d4ac630f44a374a3de08192ea144948faa",
  "pruefer-mail.js": "cdf3ca7881bfa68763a2c0be7436d35a65bea4dbd03f606e02eaec5c613632d7",   // Prüfliste vor dem KI-Richter, byte-1:1 aus dem Auslieferungsprüfer
  "noble-secp256k1.js": "8f3879ca422c4fdfe7ca0361688636fa7cc550a59bd94d512ed6ec79aa3d55d1",
};

test("Drift-Guard: jede Modul-Kopie hält ihren aufgezeichneten sha256", () => {
  const onDisk = readdirSync(join(ROOT, "modules")).filter((f) => f.endsWith(".js")).sort();
  assert.deepEqual(onDisk, Object.keys(EXPECTED_SHA256).sort(),
    "modules/ enthält genau die erwarteten Kopien (keine fehlt, keine zusätzlich)");
  for (const f of onDisk) {
    const sum = createHash("sha256").update(readFileSync(join(ROOT, "modules", f))).digest("hex");
    assert.equal(sum, EXPECTED_SHA256[f], `Modul-Kopie unverändert: ${f}`);
  }
});

test("App-Schale ist vollständig (self-contained PWA)", () => {
  for (const f of ["index.html", "manifest.json", "sbkim-sw.js", "impressum.html", "sicherheit.html",
                   "icon-192.png", "icon-512.png",
                   "assets/storage-init.js", "assets/rendezvous-init.js", "assets/nostr-listen-init.js",
                   "assets/schutz-init.js", "assets/siegel-inhalt.js",
                   "assets/sbkim-andock-wizard.js"]) {
    assert.ok(readFileSync(join(ROOT, f)).length > 0, `${f} vorhanden + nicht leer`);
  }
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  assert.match(html.slice(0, 200).toLowerCase(), /<!doctype html/, "index.html ist HTML");
  // Ladeordnung: Storage-Kern VOR der eigenen Schublade (Modus A).
  assert.ok(html.indexOf('"./modules/01_storage.js"') < html.indexOf('"./assets/storage-init.js"'),
    "Storage-Kern wird vor storage-init (dbSuffix) geladen");
  // Status-Widget (17) vor Membran (15) + Siegel (16).
  assert.ok(html.indexOf('"./modules/17_floating_widget.js"') < html.indexOf('"./modules/15_membran.js"'),
    "Status-Widget (17) wird vor Membran (15) geladen");
  assert.ok(html.indexOf('"./modules/17_floating_widget.js"') < html.indexOf('"./modules/16_siegel.js"'),
    "Status-Widget (17) wird vor Siegel (16) geladen");
  assert.match(html, /sbkim_kimseek|kimseek/, "Kimseek nutzt eine eigene Schublade");
  assert.match(html, /22_such_widget\.js/, "Such-Widget (Modul 22) bleibt eingebunden");
});

test("SW-APP_SHELL nennt genau die vorhandenen Dateien", () => {
  const sw = readFileSync(join(ROOT, "sbkim-sw.js"), "utf8");
  const shell = sw.match(/var APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(shell, "APP_SHELL-Liste gefunden");
  for (const m of shell[1].matchAll(/"\.\/([^"]*)"/g)) {
    if (m[1] === "") continue; // "./" = Verzeichnis
    assert.ok(readFileSync(join(ROOT, m[1])).length >= 0, `APP_SHELL-Datei existiert: ${m[1]}`);
  }
});

test("Modul 23 (Rendezvous-Kopie) lädt + zeigt die Hygiene-Oberfläche", async () => {
  globalThis.window = globalThis;
  await import("../modules/23_rendezvous.js");
  const R = globalThis.SbkimRendezvous;
  for (const fn of ["init", "ensureIdentity", "cleanupSharedOrigin", "repairAndReconnect",
                    "connectAndAnnounce", "discover", "handshakeCard"]) {
    assert.equal(typeof R[fn], "function", `Rendezvous.${fn}`);
  }
});

// Sage Bau 04.J (2026-10-14): Modul 04 lässt den KI-Richter ohne window.PrueferMail
// nicht laufen. Die Liste steht deshalb in JEDER Seite, die 04 lädt, direkt danach.
test("Prüfliste vor dem KI-Richter: direkt nach 04 geladen (index.html, brain.html)", () => {
  for (const seite of ["index.html", "brain.html"]) {
    const html = readFileSync(join(ROOT, seite), "utf8");
    const srcs = [...html.matchAll(/<script src="\.\/modules\/([^"]+)"/g)].map((m) => m[1]);
    const i = srcs.indexOf("04_match.js");
    assert.ok(i >= 0, seite + ": 04 wird geladen");
    assert.equal(srcs[i + 1], "pruefer-mail.js", seite + ": die Prüfliste steht direkt nach 04");
  }
});
