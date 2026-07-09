/*
 * Kimseek — Auto-Lauschen am Nostr-Relais (Empfangsmodus mit Antwortrecht).
 *
 * Beim Öffnen initialisiert Kimseek die Anastomose (Modul 05) und beginnt
 * selbsttätig am Relais zu lauschen — damit der Knoten erreichbar ist, wenn ein
 * anderer andockt.
 *
 * EMPFANGSMODUS MIT ANTWORTRECHT: der Knoten lauscht auf eingehende Handshakes
 * und ANTWORTET nur — er initiiert NIE von sich aus (kein Crawler, keine
 * Pulsation, keine Eigenanfrage ins offene Netz). Das aktive Anmelden im Raum
 * bleibt dem Nutzer-Knopf vorbehalten (Modul 23 / rendezvous-init.js).
 *
 * Vollständig fail-soft + nicht-blockierend: ohne Browser (WebCrypto/IndexedDB),
 * ohne Relais-Client (Modul 05b, type=module) oder bei Netz-Fehler passiert
 * schlicht nichts — die Seite bleibt nutzbar.
 */
(function () {
  "use strict";

  function autoListen() {
    var A = window.SbkimAnastomose;
    if (!A || typeof A.init !== "function") return;
    Promise.resolve()
      .then(function () { return A.init(); })
      .then(function () {
        if (typeof A.listenNostr === "function" && window.SbkimNostrRelay) {
          return A.listenNostr()
            .then(function () {
              console.info("[Kimseek] Auto-Lauschen aktiv (Empfangsmodus mit Antwortrecht).");
              try { window.dispatchEvent(new CustomEvent("sbkim:nostr-listening", { detail: { active: true } })); } catch (e) {}
              try {
                var lt = document.getElementById("lamp-traffic");
                if (lt) { lt.classList.add("on"); lt.title = "verkehr — grün: am Relais verbunden, lauscht (Empfangsmodus)."; }
              } catch (e) {}
            })
            .catch(function (e) { console.warn("[Kimseek] Auto-Lauschen übersprungen:", e); });
        }
      })
      .catch(function (e) { console.warn("[Kimseek] Andock-Init übersprungen (braucht Browser):", e); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoListen);
  else autoListen();
})();
