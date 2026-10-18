// Manifest-ID-Wächter (Klaus 2026-10-18, gemessen am Tablet über chrome://webapks).
//
// Chrome löst die Manifest-`id` gegen den URSPRUNG auf, nicht gegen den
// App-Ordner. Alle Apps liegen auf https://lausiklauskn-png.github.io/<Repo>/ —
// `"id": "./"` wird damit für JEDE App zu `https://lausiklauskn-png.github.io/`.
// Chrome hält dann verschiedene Apps für EINE: das Menü sagt „Diese App wurde
// bereits installiert", das Öffnen scheitert mit „App konnte nicht geöffnet
// werden". Gemessen: 10 installierte Apps mit derselben Manifest-Id.
//
// Dieser Wächter rechnet die id so wie Chrome und besteht darauf, dass sie im
// eigenen Geltungsbereich (`scope`) der App liegt und je Manifest einmalig ist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "Kimseek";
const BASIS = `https://lausiklauskn-png.github.io/${REPO}/`;

// So rechnet Chrome (W3C Manifest „process the id member"): start_url gegen die
// Manifest-Adresse, die id gegen den URSPRUNG der start_url. Ohne id gilt start_url.
function chromeIds(m, manifestUrl) {
  const start = new URL(m.start_url || "./", manifestUrl);
  const scope = new URL(m.scope || "./", start);
  const idRoh = m.id === undefined ? start.href : new URL(m.id, start.origin).href;
  const id = idRoh.split("#")[0];
  return { start: start.href, scope: scope.href, id };
}

const manifeste = readdirSync(ROOT).filter((f) => /manifest\.json$/.test(f)).sort();

test("Rechnung selbst: \"./\" landet an der Wurzel des Ursprungs (die alte Falle)", () => {
  const u = `${BASIS}manifest.json`;
  assert.equal(chromeIds({ start_url: "./", id: "./" }, u).id, "https://lausiklauskn-png.github.io/");
  assert.equal(chromeIds({ start_url: "./", id: "./index.html" }, u).id, "https://lausiklauskn-png.github.io/index.html");
  assert.equal(chromeIds({ start_url: "./", id: `/${REPO}/` }, u).id, BASIS);
  assert.equal(chromeIds({ start_url: "./x.html" }, u).id, `${BASIS}x.html`);
});

test("es gibt mindestens ein Manifest", () => {
  assert.ok(manifeste.length >= 1, `keine *manifest.json in ${ROOT}`);
});

for (const f of manifeste) {
  test(`${f}: id liegt im eigenen Geltungsbereich (wie Chrome sie rechnet)`, () => {
    const m = JSON.parse(readFileSync(join(ROOT, f), "utf8"));
    assert.ok(typeof m.id === "string" && m.id.length > 0, `${f} trägt keine id`);
    const r = chromeIds(m, `${BASIS}${f}`);
    assert.ok(r.scope.startsWith(BASIS), `${f}: scope ${r.scope} liegt nicht unter ${BASIS}`);
    assert.ok(r.id.startsWith(r.scope), `${f}: id ${JSON.stringify(m.id)} → ${r.id} liegt nicht im scope ${r.scope}`);
  });
}

test("jede Manifest-id ist einmalig", () => {
  const ids = manifeste.map((f) => chromeIds(JSON.parse(readFileSync(join(ROOT, f), "utf8")), `${BASIS}${f}`).id);
  assert.equal(new Set(ids).size, ids.length, `doppelte ids: ${ids.join(", ")}`);
});
