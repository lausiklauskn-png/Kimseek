# Kimseek — semantische Bedeutungs-Suche (SBKIM-Endknoten)

**Sucht nach Bedeutung, nicht nach Stichwörtern — und ist ein eigenständiger
SBKIM-Knoten.**

Kimseek ist das SBKIM-Such-Werkzeug (aus `Sage-Protokol/such-tool/`) als
eigenständige, installierbare **PWA** und vollwertiger **SBKIM-Endknoten** — nach
dem bewiesenen Kim-Bell-Muster. Server-los, direkt im Browser; der private
Schlüssel bleibt lokal.

Live: <https://lausiklauskn-png.github.io/Kimseek/>

## Was Kimseek kann

- **Semantische Suche (Modul 22).** Versteht die Absicht hinter deiner Frage und
  ordnet Treffer nach Bedeutungs-Nähe (Embedding-Cosinus) — gratis, ohne Schlüssel.
  Optional Spracheingabe (Modul 21), Bild-/Handschrift-Erkennung (Modul 24) und
  eine KI-Brücke mit Web-Suche.
- **Eigener SBKIM-Knoten.** Eigene, im Browser signierte Identität + Spore
  (Ed25519), Status-Lampen-Leiste + Selbst-Siegel (Bronze/Gold), server-loser
  Handshake mit anderen Knoten über ein geborgtes Nostr-Relais.

## Kim-Brain — Company-Brain-Probeversion (`brain.html`)

Eine schlanke Probe des „Company Brain"-Gedankens auf **einem** Gerät, gebaut aus
demselben Baukasten (Module 03 Embedding · 04 Richter · 24 OCR). Der Fluss:

1. **Einwurf** — Dateien/Ordner reinwerfen. Arbeitet an einer **Kopie** im
   Browser-Speicher (eigene IndexedDB `kimbrain`), fasst Originale nie an.
2. **Signieren** — je Datei: **SHA-256-Fingerabdruck** → Text heraus
   (Text/PDF/E-Mail; Bilder optional via **OCR**, Modul 24) → Steckbrief +
   **Bedeutungs-Vektor** (Modul 03, echtes e5-Modell). Bereits signierte
   (per Hash) werden übersprungen.
3. **Ausgabe** — aufgeräumte Ansicht mit vorgeschlagenen Gruppen (nur Vorschlag,
   nichts wird verschoben).
4. **Suchen** — Umschalter **„🔤 Namenssuche ↔ 🧠 Bedeutungssuche"**: dieselbe
   Frage, links weiß der Dateiname oft nichts, rechts antwortet der Inhalt —
   mit Begründung + Schnipsel. Cosinus-Vorfilter **gratis, lokal**; **KI-Richter**
   (Modul 04) optional (BYOK, EU).

Der **„Demo-Dateien einwerfen"-Knopf** lädt ein paar synthetische Beispiele
(klar als Demo markiert, keine PII), sodass der Aha-Vergleich sofort erlebbar ist
(z. B. „das schwarze Auto … mit Radstand" findet den Inhalt, den die Namenssuche
nicht sieht). Der Beweis der reinen Logik läuft über `npm test`
(`test/brain.test.js`); der Browser-Pfad (echtes Modell, IndexedDB, OCR, KI-Richter)
bleibt **„ungeprüft, wartet auf Klaus' Browser-Lauf"**.

## Saubere Netz-Anmeldung (der Browser als schwarzes Loch)

Alle SBKIM-PWAs liegen unter **einer** Origin (`lausiklauskn-png.github.io`).
IndexedDB, Service-Worker und Caches hängen an der Origin, nicht am Pfad — ohne
Trennung teilen sich alle Apps *eine* Datenbank `sbkim`, *eine* Identität. Kimseek
löst das (Skill `saubere-netz-anmeldung`):

- **Modus A — sanft, automatisch, beim Laden, idempotent, NICHT zerstörend:**
  öffnet die eigene Schublade `sbkim_kimseek` und sichert eine stabile Identität.
- **Modus B — Nutzer-Knopf „🧹 Aufräumen & neu anmelden":** reinigt **nur die
  eigene Origin** (löscht den geteilten Alt-Topf `sbkim`, meldet Service-Worker ab,
  leert Caches — die eigene Schublade bleibt), erzeugt dann eine frische Identität +
  Spore und meldet im Netz an. Danach **hart neu laden** (Strg+Shift+R).

## Aufbau (self-contained)

| Pfad | Zweck |
|---|---|
| `index.html` | Startseite + Such-Widget + voller Endknoten-Stack |
| `manifest.json` · `sbkim-sw.js` | installierbare, offline-fähige PWA-Schale |
| `icon-192.png` · `icon-512.png` · `impressum.html` · `sicherheit.html` | PWA-Grundausstattung (Impressum = Platzhalter, keine PII) |
| `assets/storage-init.js` | Modus A / eigene Schublade `sbkim_kimseek` |
| `assets/rendezvous-init.js` | Modus A fahren + 🌐-Knopf mounten (nodeName Kimseek) |
| `assets/nostr-listen-init.js` | Empfangsmodus: lauscht, damit man erreichbar ist |
| `assets/schutz-init.js` | Status-Widget (17) → Membran (15) → Siegel (16) + Apoptose (07) |
| `assets/siegel-inhalt.js` | Andock-Werkzeug im Siegel (🔑 Identität & Spore · ✍ Semantik · 🛡 Schutz) |
| `modules/*.js` | **byte-1:1-Kopien** der SBKIM-Kern-Module (Drift-Guard im Test) |
| `sbkim/spore.json` | öffentliche Visitenkarte (nach Klaus' Browser-Lauf; kein Schlüssel) |

Kanonische Quelle der `modules/*.js`: `Sage-Protokol/src/modules/*` (bzw.
`such-tool/modules/*` für 03/04/21/22/24). Der Smoke-Test prüft die sha256-Gleichheit.

## Anmelden (Schritt 3, im Browser)

1. Seite öffnen → Siegel-Modal → **🔑 Eigene Identität & Spore erzeugen** →
   Identität erzeugen → Spore signieren + herunterladen.
2. Die heruntergeladene `spore.json` nach `sbkim/spore.json` committen (öffentlich,
   **kein** privater Schlüssel).
3. **🌐 Mit dem Netz verbinden** → im Raum anmelden; ein Gegenknoten (z.B. Sage)
   kann dann andocken (server-loser Handshake).

## Test

```bash
npm test   # node --test: Drift-Guard (sha256) + App-Schale + Modul-23-Oberfläche
           #            + Kim-Brain-Kern (test/brain.test.js)
```

Der **Browser-Sichttest** (echtes IndexedDB, Service-Worker, Live-Relais,
Modell-Laden, semantische Suche) bleibt „ungeprüft, wartet auf Klaus' Browser-Lauf".
