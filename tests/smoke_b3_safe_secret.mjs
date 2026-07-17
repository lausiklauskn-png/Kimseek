#!/usr/bin/env node
/*
 * Smoke B3 — Modul 20 Schlüssel-Safe in Kimseek (Bau 2026-07-17).
 *
 * Beweist headless (echtes WebCrypto), dass die AUSGELIEFERTE Datei
 * `modules/20_schluessel_safe.js` die verschlüsselte Geheimnis-Ablage korrekt
 * leistet — die Grundlage für „🔒 im Tresor merken / 🔓 entsperren" beim
 * BYOK-KI-Schlüssel (Modul 23 UI, byte-1:1 Kanon).
 *
 *  - Round-trip: putSecret -> getSecret == Klartext.
 *  - Falsches Passwort -> null (kein Leck).
 *  - Kein Klartext im Storage-Blob (nur salt/iv/ct).
 *  - Frisches Salt/IV pro Ablage.
 *  - hasSecret / removeSecret / fehlend -> null.
 *  - Merkhilfe (hint) OHNE Passwort lesbar.
 *  - Heal-Beweis: die Datei trägt die B1-Härtung (NoSporeError) = Kanon, nicht stale.
 *
 * Aufruf:  node tests/smoke_b3_safe_secret.mjs   ·   Exit 0 = grün.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const modPath = resolve(repoRoot, "modules/20_schluessel_safe.js");

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name); } }

// In-Memory-Storage-Mock (Modul-01-Form) inkl. del.
const mem = {};
globalThis.SbkimStorage = {
  ensureStore: async () => {},
  get: async (store, key) => (mem[store] && key in mem[store]) ? mem[store][key] : undefined,
  put: async (store, key, value) => { (mem[store] = mem[store] || {})[key] = value; },
  del: async (store, key) => { if (mem[store]) delete mem[store][key]; },
  clear: async (store) => { mem[store] = {}; },
};

const require = createRequire(import.meta.url);
require(modPath);
const V = globalThis.SbkimSafe;

async function main() {
  // Heal-Beweis: die ausgelieferte Datei ist die aktuelle, getestete Kanon-Fassung.
  const src = readFileSync(modPath, "utf8");
  ok(src.indexOf("NoSporeError") >= 0, "Heal-Beweis: Datei trägt die B1-Härtung (NoSporeError) = Kanon");

  ok(V && typeof V.putSecret === "function" && typeof V.getSecret === "function",
    "SbkimSafe geladen mit putSecret/getSecret");

  const KEY = "ki_richter_key:mistral";
  const SECRET = "sk-abc123-geheim";
  const PW = "mein-tresor-pw";

  await V.putSecret(KEY, SECRET, PW);
  ok((await V.getSecret(KEY, PW)) === SECRET, "Round-trip: putSecret -> getSecret == Klartext");
  ok((await V.hasSecret(KEY)) === true, "hasSecret true nach putSecret");
  ok((await V.getSecret(KEY, "falsch")) === null, "falsches Passwort -> null (kein Leck)");

  const blob = mem["sbkim_safe"]["secret:" + KEY];
  const raw = JSON.stringify(blob);
  ok(raw.indexOf(SECRET) < 0 && !!blob.salt && !!blob.iv && !!blob.ct,
    "Blob enthält KEINEN Klartext (nur salt/iv/ct)");

  await V.putSecret("k2", SECRET, PW);
  const b2 = mem["sbkim_safe"]["secret:k2"];
  ok(b2.salt !== blob.salt && b2.iv !== blob.iv && b2.ct !== blob.ct,
    "frisches Salt/IV -> unterschiedliche Blobs für denselben Wert");

  await V.putSecret("mitHint", SECRET, PW, { hint: "erstes Haustier" });
  ok((await V.getSecretHint("mitHint")) === "erstes Haustier",
    "getSecretHint gibt Merkhilfe OHNE Passwort zurück");

  await V.removeSecret(KEY);
  ok((await V.hasSecret(KEY)) === false && (await V.getSecret(KEY, PW)) === null,
    "removeSecret entfernt das Geheimnis");
  ok((await V.getSecret("nie-abgelegt", PW)) === null, "fehlendes Geheimnis -> null");

  let threw = false;
  try { await V.putSecret("x", SECRET, "kurz"); } catch (e) { threw = e.name === "WeakPasswordError"; }
  ok(threw, "zu kurzes Passwort -> WeakPasswordError");

  console.log(`\n${pass}/${pass + fail} Proben grün`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
