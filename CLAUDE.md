**🔬 Regel: Forschung nur in Kimhub (Klaus 2026-10-31: „einheitlich alles in Kimhub … in den einzelnen Repos soll keine Forschungseinträge sein“):** jeder Forschungseintrag (Sitzungs-Befunde, Messungen, Stunden-Auswertungen, Forschungsnotizen) kommt nach **Kimhub `forschung/messungen/`**; in diesem Repo werden keine Forschungseinträge geführt und keine Forschungsdateien angelegt. Öffentliche Forschungs**aufgaben** stehen in Sage-Protokol.

# Kimseek — Sitzungs-Anker

**Kurz-Verfassung.** Ausführliches steht netzweit in **Sage-Protokol**; hier steht nur,
was eine Sitzung wissen muss, **bevor** sie hier etwas anfasst.

## Was dieses Repo ist

Die **semantische Bedeutungs-Suche**: sucht nach Sinn statt nach Stichwörtern — als
eigenständige, installierbare PWA und vollwertiger **SBKIM-Endknoten** (DB-Schublade
`kimseek`), nach dem Kim-Bell-Muster. Server-los, der private Schlüssel bleibt lokal.

## Prüfen

```bash
npm test    # node --test
```
Zuletzt gemessen: **11 bestanden, 0 fehlgeschlagen**.

## Was hier leicht kaputtgeht

- Die SBKIM-Module unter `modules/` sind **byte-1:1-Kopien** aus Sage und werden nicht
  abgewandelt — app-eigener Code gehört in `assets/rendezvous-init.js`.
- **Cache-Bump:** `CACHE_VERSION` in `sbkim-sw.js` (`kimseek-vNN`).
- **KI-Schlüssel sind BYOK** und bleiben im Browser; nichts davon ins Repo.
- **Der Gerätename** wird vom app-eigenen Glue ins Verbinden-Panel gehängt — hier `assets/rendezvous-init.js`, **nie** in eine byte-kopierte Panel-Datei. Regel: [NETZWEIT § 2](https://github.com/lausiklauskn-png/Sage-Protokol/blob/main/docs/NETZWEIT.md).

## ⬇ Installieren-Knopf (2026-10-18, Klaus: „In jede App“)

`assets/installieren.js` ist byte-1:1 aus Sage-Protokol (SHA-256 `e0644084…c3`) — nie hier abwandeln. `index.html` hat weder
Einstellungen noch eine Kopfleiste (der ⟳ steckt im Such-Widget, Modul 22, Kanon): der Knopf steht in einer kleinen Zeile
oben in der Seite, vor dem Platzhalter `#install-anker`. Als installierte App verschwindet er. Im Vorrat (ohne `?v=`, die
Probe liest die Pfade aus `APP_SHELL` als Dateien), Cache v74. `brain.html` behält seinen eigenen Knopf (`#installBtn`,
erscheint nur, wenn der Browser es anbietet, und verschwindet nach dem Installieren) — nicht doppelt gebaut. Gemessen im
Browser: sichtbar, als App weg, Meldung lesbar, `getInstallabilityErrors` leer, App-Id `/Kimseek/`, 360 px ohne Überlauf.
`npm test` 17 bestanden. Am Tablet nicht gemessen.

## Netzweit — gilt in jedem Repo, steht in Sage

Freibrief zum Selbst-Mergen · Gerätename im Verbinden-Panel · frisch von
`origin/main` vor jeder Arbeit · Ton · kein PII · Ehrlichkeit:
**[`Sage-Protokol/docs/NETZWEIT.md`](https://github.com/lausiklauskn-png/Sage-Protokol/blob/main/docs/NETZWEIT.md)**

Verbindliche Verträge: **[`INTERFACES.md`](https://github.com/lausiklauskn-png/Sage-Protokol/blob/main/docs/INTERFACES.md)** (Andock §11,
Briefkasten §11.6, Gerätename §11.7). Die Fallen beim Abzweigen und
Veröffentlichen: **[`LEHREN.md`](https://github.com/lausiklauskn-png/Sage-Protokol/blob/main/docs/LEHREN.md)**.

Das Kurze davon, weil es täglich gebraucht wird:

```bash
git fetch origin --quiet && git checkout -B <branch> origin/main
git push -u origin refs/heads/<branch>:refs/heads/<branch>
git diff --stat origin/main origin/<branch>     # leer = der PR wäre leer
```

> **Bis 2026-08-22 stand das hier ausgeschrieben** — und wortgleich in bis zu
> 19 weiteren Repos. Zwanzig Kopien einer Regel sind nicht zwanzigmal so
> verbindlich; sie sind zwanzig Stellen, an denen sie auseinanderlaufen kann.
> Genau das war passiert. Die alte Fassung dieser Datei steht vollständig in
> [`docs/archiv/CLAUDE-2026-08-22.md`](docs/archiv/CLAUDE-2026-08-22.md).

## 🛡 Prüfliste vor dem KI-Richter · Reinigung vor der Texterkennung (Sage Bau 04.J/24.R, 2026-10-14)

Modul 04, 22 und 24 kommen neu aus dem Kanon (Sage #1082, verteilt mit `kanon-verteilen`). Damit gilt:

- Der KI-Richter prüft Suchfrage und Kandidaten mit der Prüfliste (`modules/pruefer-mail.js`, byte-1:1 aus dem
  Auslieferungsprüfer, im Drift-Guard gepinnt). Fehlt sie, läuft er nicht. Die Liste steht in `index.html` und
  `brain.html` **direkt nach 04** und im Vorrat (`sbkim-sw.js`).
- Ein Kandidat mit einer Anweisung an eine KI geht nicht an die KI. In `brain.html` steht er mit „⚠️ nicht an die
  KI — …“ da; lehnt 04 den Richter ab (Anweisung in der Frage, Liste fehlt), steht der Grund in der Statuszeile.
- Modul 24 sendet nie das Original (Foto neu gezeichnet bzw. JPEG ohne Metadaten, PDF als gereinigte Seitenbilder
  von `/Workflow-PDF/`). `brain.html` übergibt `onVersteckt` (einmal anhalten: OK = ohne den Text senden ·
  Abbrechen = nichts) und nimmt Zeilen mit einer Anweisung an eine KI nicht in den Katalog.
- Gemessen im Browser: auf beiden Seiten `prueflisteGeladen === true`; ohne die Zeile in `brain.html` `false` und
  der neue Test rot. `npm test` 12 grün.
- ⚠ Nicht gemessen: Richter und Texterkennung mit einem echten Schlüssel (das Modell lädt im Behälter nicht), das Tablet.

## 🛡 Echtheit im Raum (Sage Bau 23.R, nachgezogen 2026-10-15)

Modul 02, 16, 23 und 23-UI kommen neu aus dem Kanon (`kanon-verteilen`, Sammel-Brief Schritt 2, Paket A1). Die Echtheit
einer Karte im Raum wird jetzt wirklich geprüft (`.valid`), und zwar vor dem Zusammenfassen gleicher Namen. Antworten tragen
Spore und Unterschrift und gelten nur vom gefragten Knoten. Fremde Namen und Texte stehen nur als Text da. Pins in
`test/smoke.test.js` nachgezogen, Cache `kimseek-v63`. Die eigene Glue (`assets/rendezvous-init.js`, `brain.html`) ist
nachgesehen: fremder Text geht nur über `textContent` bzw. `esc`. Gemessen: `npm test` 12 grün. Gegenprobe von Hand (alte
23-Fassung zurück): Drift-Guard rot. ⚠ Nicht gemessen: das Tablet, ein Raum mit echten fremden Knoten.

## ⬇ Kim-Brain: Installieren oben in der Kopfleiste (Klaus 2026-10-18)

Klaus: *„setze den Installationsbutton oben in die Navi-Leiste … verschwinden, wenn die App installiert ist … Macht das
bitte überall so.“* `brain.html` hatte einen eigenen Knopf `#installBtn`, der nur nach `beforeinstallprompt` erschien.
⚠ **Tafel-Evolution, benannt:** oben steht noch *„`brain.html` behält seinen eigenen Knopf … nicht doppelt gebaut“*. Der
eigene Knopf ist jetzt weg; `brain.html` lädt dieselbe Datei `assets/installieren.js` (byte-1:1 aus Sage) mit
`data-vor="helpBtn"` — der Knopf steht immer vor „?“ in der Kopfleiste, bis 480 px nur ⬇, als App weg. Bis 340 px
schmalerer Rand, sonst bricht der Name um. Cache v75. Gemessen im Browser (300 · 320 · 360 · 412 · 1280 px): Knopf
sichtbar, Kopfleiste 63 px wie vorher, als App weg, Meldung lesbar, `getInstallabilityErrors` leer. `npm test` grün.
⚠ Der Inhalt von `brain.html` läuft unter 412 px schon auf main über (nicht die Kopfleiste). Am Tablet nicht gemessen.

