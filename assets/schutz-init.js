/*
 * Kimseek — Voller-Knoten-Init: Status-Widget (17) → Membran (15) → Siegel (16)
 * (+ Apoptose 07). Macht aus dem Such-Werkzeug einen VOLLEN SBKIM-Knoten mit
 * der Status-Lampen-Leiste (LEBT/VERKEHR/FREMD/SIEGEL) und dem Selbst-Siegel.
 *
 * REIHENFOLGE ist Pflicht (Sage Karte 09 § Schritt 12): SbkimWidget.init() MUSS
 * VOR SbkimMembrane.init() / SbkimSiegel.init() laufen — das Widget legt die
 * Proxy-Spans #lamp-fremd + #sbkim-siegel-badge in seinem Inneren an, an die sich
 * Membran (FREMD-Lampe) + Siegel (Badge) hängen.
 *
 * Das SIEGEL erscheint automatisch (Bronze), sobald die 7 Pflicht-Module
 * (01/02/03/04/05/07/15) geladen sind — Selbst-Prüfung beim Start. Es wird GOLD,
 * sobald ein Handshake „established" war (Mycel-Verbindung). Beides ohne Zutun.
 *
 * Vollständig fail-soft: fehlt ein Modul, wird der jeweilige Schritt übersprungen,
 * die Seite bleibt nutzbar.
 *
 * ⤷ VORLAGE: in eine andere App kopiert, nur ALLOWED_ORIGINS + REPO_URL + den
 *   ribbonText (App-Name) anpassen.
 */
(function () {
  "use strict";

  var ALLOWED_ORIGINS = ["https://lausiklauskn-png.github.io"];
  var REPO_URL = "https://github.com/lausiklauskn-png/Kimseek";

  function boot() {
    // 1) Status-Widget (Modul 17) zuerst — mountet die Pille + Proxy-Spans.
    var widgetReady = Promise.resolve();
    if (window.SbkimWidget && typeof window.SbkimWidget.init === "function") {
      try {
        widgetReady = Promise.resolve(window.SbkimWidget.init({
          allowedOrigins: ALLOWED_ORIGINS,
          repoUrl: REPO_URL,
        }));
        console.info("[Kimseek] Status-Widget (Modul 17) gemountet.");
      } catch (e) { console.warn("[Kimseek] Status-Widget übersprungen:", e); }
    }

    // 2) Membran (Modul 15, Wächter/FREMD) + Siegel (Modul 16) NACH dem Widget,
    //    damit die Proxy-Spans im DOM sind.
    widgetReady.then(function () {
      if (window.SbkimMembrane && typeof window.SbkimMembrane.init === "function") {
        try {
          window.SbkimMembrane.init({ allowedOrigins: ALLOWED_ORIGINS });
          console.info("[Kimseek] Membran (Modul 15, Wächter) aktiv.");
        } catch (e) { console.warn("[Kimseek] Membran übersprungen:", e); }
      }
      if (window.SbkimSiegel && typeof window.SbkimSiegel.init === "function") {
        try {
          window.SbkimSiegel.init({
            badgeSelector: "#sbkim-siegel-badge",
            repoUrl: REPO_URL,
            // ribbonText graviert den Namen ins Wappen-Band (SELF-INSCRIBING).
            // OHNE diesen Wert bleibt das Band LEER (Modul 16: kein Auto-Slug).
            ribbonText: "Kimseek",
          });
          console.info("[Kimseek] Siegel (Modul 16) — Selbst-Prüfung läuft (Bronze/Gold).");
        } catch (e) { console.warn("[Kimseek] Siegel übersprungen:", e); }
      }
    });

    // 3) Apoptose (Modul 07) — eines der 7 Pflicht-Module fürs Siegel.
    if (window.SbkimApoptose && typeof window.SbkimApoptose.init === "function") {
      try {
        Promise.resolve(window.SbkimApoptose.init()).catch(function () {});
      } catch (e) { console.warn("[Kimseek] Apoptose übersprungen:", e); }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
