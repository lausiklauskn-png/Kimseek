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
