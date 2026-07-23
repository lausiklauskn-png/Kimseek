/*
 * Kimseek — Service-Worker (Standalone-PWA).
 *
 * Macht die Seite installierbar (Chrome verlangt einen fetch-Handler) und
 * cacht die App-Schale (dieser Ordner), damit das Tool offline startet.
 *
 * Strategie:
 *   - Eigene App-Schale (same-origin, in diesem Scope): NETWORK-FIRST, dann
 *     Cache (frische Version bei jedem Neuladen; Cache nur Offline-Fallback).
 *   - Navigationen offline: Fallback auf ./index.html.
 *   - Alles andere (CDN-Embedding-Modell, WebLLM, KI-API, Nostr-Relais wss://):
 *     DURCHREICHEN, nicht cachen.
 *
 * WICHTIG (Identitäts-Hygiene): der Modus-B-Knopf im Netz-Werkzeug meldet
 * Service-Worker ab und leert Caches. Nach dem Aufräumen bitte HART NEU LADEN
 * (Strg+Shift+R), damit dieser frische Service-Worker greift.
 *
 * Bei einer Änderung der App-Schale CACHE_VERSION erhöhen (Cache-Bust).
 */
"use strict";

var CACHE_VERSION = "kimseek-v30";

var APP_SHELL = [
  "./",
  "./index.html",
  "./brain.html",
  "./manifest.json",
  "./brain-manifest.json",
  "./impressum.html",
  "./sicherheit.html",
  "./icon-192.png",
  "./icon-512.png",
  "./assets/brain-core.js",
  "./assets/storage-init.js",
  "./assets/nostr-listen-init.js",
  "./assets/rendezvous-init.js",
  "./assets/schutz-init.js",
  "./assets/siegel-inhalt.js",
  "./modules/noble-secp256k1.js",
  "./modules/01_storage.js",
  "./modules/02_spore.js",
  "./modules/03_embedding.js",
  "./modules/04_match.js",
  "./modules/05_anastomose.js",
  "./modules/05b_nostr_relay.js",
  "./modules/07_apoptose.js",
  "./modules/15_membran.js",
  "./modules/16_siegel.js",
  "./modules/17_floating_widget.js",
  "./modules/21_spracheingabe.js",
  "./modules/22_such_widget.js",
  "./modules/23_rendezvous.js",
  "./modules/23_rendezvous_ui.js",
  "./modules/24_ocr_eingabe.js",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // addAll bricht hart ab, wenn EINE Datei fehlt — einzeln + fail-soft.
      return Promise.all(APP_SHELL.map(function (url) {
        return cache.add(url).catch(function (err) {
          console.warn("[kimseek-sw] Precache übersprungen:", url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (_e) { return; }

  // Fremd-Origin (CDN-Modell, WebLLM, KI-API, Relais): durchreichen, nicht cachen.
  if (url.origin !== self.location.origin) return;

  // NETWORK-FIRST für die eigene App-Schale: immer erst das Netz versuchen
  // (frische index.html/Module), Cache nur als Offline-Fallback. Erfolgreiche
  // Antworten werden nachgecacht, damit die Seite offline weiter startet.
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504, statusText: "Offline" });
      });
    })
  );
});
