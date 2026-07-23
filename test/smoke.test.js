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
  "01_storage.js": "e507aec18d75bde66b81b9eba9738650000d9686aac90c6817679e7df06d61c1",
  "02_spore.js": "6789fe6e903ad2e53f39b2dee576c640698555ef71ef4e9134eb75573fdb7d68",
  "03_embedding.js": "e4bb8bd6a237914e7841cab5165912daf636adf0ee90c5d4ffd0c74cc5d706e5",
  "04_match.js": "9e2648729758f644fe8e35b0e049ba8d66668a72dc6b7e4b41ebd75d52c0826a",
  "05_anastomose.js": "255ac79aeb3b0203e92f0cebd0a905e47c488b43efe18f41332a7d35520bbf23",
  "05b_nostr_relay.js": "030aa2d260149f5627b84694a0b55e916cc186158009e260117d1e4f60d429bd",
  "07_apoptose.js": "0acdd6ab2d95e131fa6953061cc0e95a2396e05fff091a7dc690b2668a4c035a",
  "15_membran.js": "fbf9f42d8a2720b01d6318b00e84c0eac35a108cb3ee50e87096796e3c72e7cf",
  "16_siegel.js": "a581461a079711162d9c4137a5674f7e6d38d3c4bc95b64b6c8d13b57c75621e",
  "20_schluessel_safe.js": "e7e25c9070e93f8267171d2b626109cfd90cb481c2781242f5f7dfc203f031f3",
  "17_floating_widget.js": "f48a95ac357ae212fe80e04e28426c43ae0ad9ab35de1eff42d19b8a3b0116c9",
  "21_spracheingabe.js": "6be3902c67c3ebfb24a845c59bad9147af903c467b7fb7535bc26cc7943b2a49",
  "22_such_widget.js": "45f42a54e224a2c4d7ef6924aa8ab13d6f624873012680c31c193edf6958d0af",
  "23_rendezvous.js": "9f3a20856c33080989db278a54ee23d723eeec82e169e2c4aee67dbc236f992a",
  "23_rendezvous_ui.js": "09532d7912de682019e43bf630c3d7036f1b9b76a1433b93917be721478327ff",
  "24_ocr_eingabe.js": "79f966d628976e03a7c3006e6ca45dd11d9f71c6bb6b562094a8d5c803138c8b",
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
                   "assets/schutz-init.js", "assets/siegel-inhalt.js"]) {
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
