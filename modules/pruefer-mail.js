/* Auslieferungsprüfer — der Eingang für E-Mails.
 *
 * Klaus am 2026-09-09: „E-Mail-Adressen werden eingepflegt oder eingeladen,
 * ohne dass irgendetwas passiert. Es werden keine Dateien geöffnet … es wird
 * im Prinzip nur geprüfter Inhalt, inklusive der Links oder irgendwelcher
 * Viren oder sonst irgendetwas, irgendwelche verdächtigen Sachen, auch
 * Befehle, die an eine KI gehen könnten."
 *
 * ══ WAS DIESE DATEI IST — UND WAS SIE NICHT IST ═══════════════════════════
 *
 * ⚠ DAS IST KEINE VIRENPRÜFUNG, und das steht auch auf der Seite. Es gibt
 * hier keine Signaturen, keinen Entpacker, keinen Emulator. Ein Anhang wird
 * NICHT geöffnet: geprüft wird, was er zu SEIN BEHAUPTET — sein Name, seine
 * Endung, sein angegebener Typ. Ein Werkzeug, das „Virenprüfung" verspricht
 * und in Wahrheit einen Dateinamen liest, ist die schlimmste Sorte Knopf: es
 * beruhigt.
 *
 * ⚠ NICHTS WIRD GEÖFFNET, NICHTS WIRD ABGERUFEN. Kein Link wird angeklickt,
 * kein Bild geholt, kein Skript ausgeführt. Genau das ist der Punkt: wer eine
 * verdächtige Mail prüfen will, darf sie dabei nicht anfassen. Der eingefügte
 * Text verlässt das Gerät nicht.
 *
 * ⚠ UND ES GIBT KEINE ZWEITE FASSUNG. `pruefer.js` und `pruefer-formate.js`
 * stehen unter der Zusicherung „zwei Fassungen, ein Ergebnis" — Python in
 * Kimhub, JavaScript hier, und `tests/smoke_pruefer.mjs` vergleicht sie
 * Zeichen für Zeichen. Dieser Eingang hat keinen Zwilling. Das ist eine
 * BENANNTE GRENZE, keine Nachlässigkeit: die anderen beiden brauchen ihn,
 * weil sie in einer Prüfkette über einen ganzen Baum laufen (Rückgabewert
 * 0/1/2). Eine Mail prüft ein Mensch, einzeln, im Browser. Steht der Zwilling
 * eines Tages da, gehört der Vergleich in dieselbe Probe.
 *
 * ⚠ DIESE DATEI FASST DIE ANDEREN NICHT AN. Sie kommt DANEBEN, wie
 * `pruefer-formate.js` am 2026-08-23 danebengekommen ist.
 *
 * ══ WARUM NICHT JEDER LINK EIN BEFUND IST ═════════════════════════════════
 *
 * In einer HTML-Seite ist eine fremde Adresse ein Befund, weil die Seite dort
 * von allein etwas holt. In einer E-Mail ist ein Link das Normale — eine Mail
 * OHNE fremde Adresse ist die Ausnahme. Wer hier jede Adresse meldet, baut
 * genau die Warnung, die man nicht mehr los wird; dieselbe Lehre, die schon
 * `<a href>` aus der HTML-Fundliste gehalten hat (27 von 58 Meldungen an acht
 * echten Seiten).
 *
 * Deshalb: die Wirte, auf die die Mail zeigt, stehen als AUSKUNFT daneben.
 * Ein BEFUND wird daraus erst durch einen Trick — wenn der sichtbare Text
 * einen anderen Rechner nennt als das Ziel, wenn im Namen eine zweite Adresse
 * versteckt ist, wenn ein Kürzel das Ziel verbirgt.
 *
 * Läuft in beiden Welten (Browser und Node), wie die SBKIM-Module — damit die
 * Probe genau den Code prüft, den der Besucher ausführt.
 */
(function (welt) {
  "use strict";

  var BEFUNDE_MAIL = [
    "LINK-TARNUNG", "ADRESS-TRICK", "KURZLINK", "ZAEHLPIXEL",
    "ANHANG-GEFAEHRLICH", "ANHANG-DOPPELENDUNG",
    "VERSTECKTER-TEXT", "UNSICHTBARE-ZEICHEN", "KI-ANWEISUNG", "KI-BEGRIFF",
    "ABSENDER-TARNUNG", "PRUEFUNG-DURCHGEFALLEN",
    "KONTO-WECHSEL", "ZUGANGSDATEN", "DRUCK"
  ];

  /* ⚠ EINE ZAHL, EINE STELLE. Versteckter Text ist in Werbe-Mails ganz normal
     (der „Preheader", der in der Vorschau steht und in der Mail selbst nicht).
     Gemeldet wird er deshalb erst ab einer Länge, bei der er kein Preheader
     mehr ist. Wer die Schwelle dreht, dreht sie hier — nicht an vier Stellen.
     Dieselbe Bauart wie HAENGER_AB in Kimhub. */
  var VERSTECKT_AB = 120;

  /* ══ ZWEITE ADRESSE IM ZIEL ═══════════════════════════════════════════════
   * Kürzel-Dienste sind nicht böse — sie verbergen nur, wohin es geht, und
   * genau das ist in einer Mail von einem Fremden die Angabe, die fehlt. */
  var KUERZEL = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd",
                 "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "tiny.cc",
                 "rb.gy", "s.id", "lnkd.in", "t.ly", "bl.ink", "shorte.st",
                 "adf.ly", "clck.ru", "v.gd", "qr.ae", "1url.com"];

  /* Endungen, die auf dem Rechner des Empfängers etwas TUN, wenn er sie
     doppelt anklickt. Die Liste ist die Windows-Wirklichkeit; `.js` und `.jar`
     laufen auch anderswo. */
  var ENDUNG_FUEHRT_AUS = [
    "exe", "scr", "com", "pif", "bat", "cmd", "vbs", "vbe", "js", "jse",
    "wsf", "wsh", "ps1", "psm1", "msi", "msp", "hta", "cpl", "jar", "lnk",
    "reg", "scf", "chm", "ade", "adp", "mst", "inf", "apk", "dll", "iso",
    "img", "vhd", "diagcab", "appref-ms", "url", "library-ms", "settingcontent-ms"
  ];
  /* Büro-Dateien mit Makro-Fähigkeit. Das `m` am Ende ist der ganze
     Unterschied: `docx` kann keine Makros tragen, `docm` schon. */
  var ENDUNG_MAKRO = ["docm", "xlsm", "pptm", "dotm", "xltm", "xlam", "ppam",
                      "sldm", "potm", "xlsb"];

  /* ⚠ ZWEITEILIGE ENDUNGEN. `bank.co.uk` und `boese.co.uk` haben dieselben
     zwei letzten Teile — ohne diese Liste hielte die Tarnungs-Prüfung sie für
     denselben Rechner. Die Liste ist kurz und deckt nicht alles ab; wo sie
     nicht greift, wird eher NICHTS gemeldet als etwas Falsches. Ein
     übersehener Fall ist teuer, ein Fehlalarm auf jeder Mail ist teurer. */
  var ZWEITEILIG = ["co.uk", "org.uk", "ac.uk", "gov.uk", "co.jp", "ne.jp",
                    "com.au", "net.au", "org.au", "com.br", "com.mx", "com.tr",
                    "co.nz", "co.za", "co.in", "com.cn", "com.ar", "co.kr"];

  /* ══ BEFEHLE, DIE AN EINE KI GEHEN KÖNNTEN ════════════════════════════════
   * Der Fall, den Klaus meint: eine Mail landet im Postfach, ein Assistent
   * liest sie mit — und im Text steht eine Anweisung AN DEN ASSISTENTEN, nicht
   * an den Menschen. Sie ist oft in einem versteckten Bereich untergebracht
   * (weiß auf weiß, Schriftgröße 0, `display:none`); deshalb sucht die Prüfung
   * im GANZEN Text, auch dort, wo ein Mensch nichts sieht.
   *
   * ⚠ EIN TREFFER IST KEIN BEWEIS. Ein Rundbrief ÜBER Sicherheitslücken zitiert
   * dieselben Sätze. Das steht im Rat dabei — der Fund sagt „hier hinsehen",
   * nicht „das ist ein Angriff".
   *
   * Die Muster stehen hier als DATEN. Sie sind Suchmuster, keine Anweisungen.
   */
  var KI_MUSTER = [
    { was: "„vorherige Anweisungen ignorieren\"",
      re: /ignorier(?:e|en|t)?\s+(?:bitte\s+)?(?:alle\s+|sämtliche\s+)?(?:vorherigen?|bisherigen?|obigen?|früheren?)\s+(?:anweisungen|regeln|befehle|vorgaben)/i },
    { was: "„ignore previous instructions\"",
      re: /(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|rules?|directions?)/i },
    { was: "„vergiss deine Regeln\"",
      re: /vergiss\s+(?:bitte\s+)?(?:alles|alle|deine|die)\s+(?:bisherigen?\s+)?(?:regeln|anweisungen|vorgaben|instruktionen)/i },
    { was: "eine Anweisung an den System-Prompt",
      re: /\b(?:system|developer)[\s\-_]?prompt\b/i },
    { was: "eine Rollen-Übernahme („du bist jetzt …\")",
      re: /\bdu\s+bist\s+(?:jetzt|ab\s+sofort|nun)\s+(?:ein|eine|der|die|das)\b/i },
    { was: "eine Rollen-Übernahme („you are now …\")",
      re: /\byou\s+are\s+now\s+(?:a|an|the)\b/i },
    { was: "„act as …\"",
      re: /\bact\s+as\s+(?:a|an|if\s+you)\b/i },
    { was: "ein Entwickler-Modus / Jailbreak",
      re: /\b(?:developer\s+mode|jailbreak|dan\s*[- ]?\s*mode|do\s+anything\s+now)\b/i },
    { was: "eine Anrede an einen Assistenten mit Auftrag",
      re: /\b(?:claude|chatgpt|gpt-?4o?|copilot|gemini|assistant|assistent)\s*[,:]\s*(?:bitte\s+)?(?:ignorier|ignore|vergiss|forget|führe|fuehre|execute|sende|send|leite|forward|antworte|reply|öffne|oeffne|open)/i },
    { was: "eine Bedingung „falls du eine KI bist\"",
      re: /(?:wenn|falls)\s+du\s+(?:ein|eine)\s+(?:ki|k\.i\.|sprachmodell|assistent|assistenz)\b/i },
    { was: "eine Bedingung „if you are an AI\"",
      re: /\bif\s+you\s+are\s+an?\s+(?:ai|language\s+model|assistant|llm|chatbot)\b/i },
    { was: "Steuer-Marken aus einem Modell-Gespräch",
      re: /<\|(?:im_start|im_end|endoftext|system|user|assistant)\|>|\[\/?INST\]|<<SYS>>/ },
    { was: "ein nachgebauter System-Abschnitt",
      re: /<\s*\/?\s*(?:system|instructions?|anweisungen)\s*>|^\s*###\s*(?:instruction|system|anweisung)/im },
    { was: "eine Aufforderung, Inhalte weiterzuschicken",
      re: /\b(?:sende|schicke|leite|übermittle|uebermittle)\b[^.\n]{0,80}\b(?:an|weiter\s+an|nach)\s+[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/i },
    { was: "eine Aufforderung, Inhalte weiterzuschicken (englisch)",
      re: /\b(?:send|forward|email|exfiltrate|post)\b[^.\n]{0,80}\bto\s+[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/i },
    { was: "eine Aufforderung, Schlüssel oder Zugangsdaten herauszugeben",
      re: /\b(?:gib|nenne|zeige|verrate|print|reveal|output|show)\b[^.\n]{0,60}\b(?:api[\s\-_]?key|schlüssel|schluessel|token|zugangsdaten|passwort|credentials|secret)\b/i },
    /* ⚠ EIN FACHBEGRIFF IST KEINE ANWEISUNG (Klaus 2026-10-05). Ein Text, der
       ÜBER Angriffe auf KI-Assistenten schreibt, nennt das Wort — bis hierher
       stand er dann als „Anweisung an eine KI" da, samt „keine Panik". Wer das
       liest, denkt an einen Angriff. Ein Muster mit `begriff: true` meldet
       deshalb KI-BEGRIFF, und nur, wenn in derselben Zeile KEINE Anweisung steht. */
    { was: "das Wort „prompt injection\"", begriff: true,
      re: /\bprompt[\s\-]?injection\b/i }
  ];

  /* ══ MASCHEN — NUR ALS KOMBINATION ════════════════════════════════════════
   * Jede dieser drei braucht ZWEI unabhängige Anzeichen. Einzeln sind die
   * Wörter gewöhnliches Deutsch: „Passwort" steht in jeder zweiten Mail einer
   * Bank, „innerhalb von 14 Tagen" in jeder Rechnung. Eine Warnung, die auf
   * jeder Mail feuert, ist keine Warnung.
   */
  var ZUGANG_WORT  = /\b(?:passwort|kennwort|password|zugangsdaten|anmeldedaten|zugangsdatum|pin|tan|photo-?tan|zwei[\s\-]?faktor|2fa|login[\s\-]?daten|credentials)\b/i;
  var AUFFORDERUNG = /\b(?:bestätig|bestaetig|verifizier|validier|aktualisier|erneuer|eingeben|einzugeben|hinterleg|freischalt|entsperr|confirm|verify|validate|update|re-?enter|unlock|reactivate)/i;

  var WECHSEL_WORT = /(?:\b(?:neue|geänderte|geaenderte|abweichende|aktualisierte|andere)\s+(?:bankverbindung|kontonummer|kontodaten|bankdaten|zahlungsdaten|iban)\b)|(?:\b(?:bankverbindung|kontodaten|bankdaten|iban)\b[^.\n]{0,40}\bgeändert\b)|(?:\b(?:new|updated|changed)\s+(?:bank\s+(?:account|details)|account\s+details|payment\s+details|iban)\b)/i;

  var FRIST_WORT = /(?:\binnerhalb\s+von\s+\d+\s*(?:minuten|stunden|tagen)\b)|(?:\bbinnen\s+\d+\s*(?:minuten|stunden|tagen)\b)|(?:\bwithin\s+\d+\s*(?:minutes?|hours?|days?)\b)|(?:\b(?:24|48|72)\s*stunden\b)|(?:\b(?:sofort|umgehend|unverzüglich|unverzueglich|immediately)\b)|(?:\bletzte\s+(?:mahnung|warnung|aufforderung)\b)|(?:\bfinal\s+(?:notice|warning|reminder)\b)/i;
  var FOLGE_WORT = /\b(?:gesperrt|sperrung|gesperrte|geschlossen|gelöscht|geloescht|löschung|loeschung|deaktiviert|deaktivierung|stillgelegt|eingestellt|kündigung|kuendigung|mahngebühr|mahngebuehr|inkasso|rechtliche\s+schritte|strafanzeige|pfändung|pfaendung|suspended|deactivated|terminated|permanently\s+(?:deleted|closed)|legal\s+action)\b/i;

  /* ══ UNSICHTBARE ZEICHEN ══════════════════════════════════════════════════
   * Zwei Sorten, und beide sind in gewöhnlichem Text ein Fremdkörper:
   * Nullbreiten-Zeichen (sie trennen ein Wort, ohne dass man es sieht — so
   * kommt „p&#8203;asswort" an jedem Wortfilter vorbei) und die
   * Richtungs-Umschalter, mit denen sich ein Dateiname umdrehen lässt:
   * `rechnungfdp.exe` sieht mit U+202E davor aus wie `rechnungexe.pdf`.
   *
   * ⚠ DIE BOM AM DATEIANFANG IST KEINE. Sie steht dort mit gutem Grund und
   * wird ausgenommen — sonst meldete jede aus Windows kopierte Mail einen
   * Fund in Zeile 1. */
  var UNSICHTBAR = /[\u200B-\u200D\u2060\u180E\uFEFF\u202A-\u202E\u2066-\u2069]/;

  function maskiere(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /* Der Teil eines Namens, an dem sich zwei Rechner unterscheiden lassen:
     die letzten zwei Bestandteile, bei zweiteiligen Endungen die letzten drei.
     `www.bank.test` und `bank.test` sind derselbe Betreiber und ergeben
     deshalb KEINEN Fund. */
  function kern(wirt) {
    var teile = String(wirt || "").toLowerCase().replace(/\.$/, "").split(".");
    if (teile.length < 2) return teile.join(".");
    var letzteZwei = teile.slice(-2).join(".");
    if (ZWEITEILIG.indexOf(letzteZwei) !== -1 && teile.length >= 3) {
      return teile.slice(-3).join(".");
    }
    return letzteZwei;
  }

  function wirtAus(adresse) {
    var m = /^(?:[A-Za-z][A-Za-z0-9+.\-]*:)?\/\/([^\/?#]+)/.exec(String(adresse || "").trim());
    if (!m) return null;
    var autoritaet = m[1];
    var at = autoritaet.lastIndexOf("@");
    var wirt = at === -1 ? autoritaet : autoritaet.slice(at + 1);
    return { wirt: wirt.split(":")[0].toLowerCase(), benutzerteil: at === -1 ? "" : autoritaet.slice(0, at) };
  }

  function entitaeten(s) {
    return String(s)
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&");
  }

  /* ══ ENTPACKEN ════════════════════════════════════════════════════════════
   * Eine .eml-Datei trägt ihren Text selten im Klartext. Ohne Entpacken sieht
   * die Prüfung nur Kauderwelsch — und meldet auf einer bösartigen Mail
   * NICHTS, was schlimmer ist als ein Fehlalarm.
   *
   * ⚠ QUOTED-PRINTABLE TRENNT ADRESSEN MITTEN DURCH. Ein `=` am Zeilenende ist
   * ein weicher Umbruch; eine lange Adresse steht dadurch auf zwei Zeilen. Wer
   * nicht entpackt, findet die Tarnung nicht, weil er den halben Wirt liest.
   */
  function ausQP(s) {
    return String(s).replace(/=\r?\n/g, "")
                    .replace(/=([0-9A-Fa-f]{2})/g, function (_, h) {
                      return String.fromCharCode(parseInt(h, 16));
                    });
  }

  function ausBase64(s) {
    var sauber = String(s).replace(/[^A-Za-z0-9+/=]/g, "");
    try {
      if (typeof welt.atob === "function") return welt.atob(sauber);
      if (typeof Buffer !== "undefined") return Buffer.from(sauber, "base64").toString("latin1");
    } catch (e) {}
    return null;
  }

  /* Aus Byte-Zeichen echten Text machen. ⚠ NICHT BLIND: sagt der Kopf
     `iso-8859-1`, wäre eine UTF-8-Deutung Kauderwelsch. Und wo gar nichts
     dasteht, wird UTF-8 versucht und das Ergebnis VERWORFEN, wenn Ersatzzeichen
     darin stehen — geraten wird also nicht, es wird nachgesehen. */
  function alsText(roh, zeichensatz) {
    var z = String(zeichensatz || "").toLowerCase();
    if (z && !/utf-?8/.test(z)) return roh;
    if (typeof welt.TextDecoder !== "function") return roh;
    /* ⚠ NUR WENN WIRKLICH BYTES DASTEHEN. `charCodeAt(i) & 0xff` wirft bei
       jedem Zeichen über 0xFF die oberen Bits weg — aus einem Zeichen ohne
       Breite (U+200B) wird dabei ein Steuerzeichen, und die Prüfung darauf
       findet es nie mehr. Gemessen an der Test-Mail: der Fund blieb aus, und
       die Ursache stand drei Funktionen weiter oben. Steht schon Text da
       (jemand hat die Mail eingefügt statt eine .eml geladen), bleibt er, wie
       er ist. */
    for (var g = 0; g < roh.length; g++) if (roh.charCodeAt(g) > 0xff) return roh;
    try {
      var b = new Uint8Array(roh.length);
      for (var i = 0; i < roh.length; i++) b[i] = roh.charCodeAt(i) & 0xff;
      var aus = new welt.TextDecoder("utf-8").decode(b);
      return aus.indexOf("�") === -1 ? aus : roh;
    } catch (e) { return roh; }
  }

  function kopfWert(kopfText, name) {
    /* Kopfzeilen dürfen umbrechen; die Fortsetzung beginnt mit Leerraum
       (RFC 5322 „folding"). Gelesen wird die erste Zeile PLUS alle Zeilen, die
       mit Leerzeichen oder Tabulator anfangen.

       ⚠ DIE ERSTE FASSUNG ENDETE AUF `$` MIT `m`-FLAG — UND DAS IST DAS ENDE
       JEDER ZEILE, nicht das Ende des Textes. Der genügsame `[\s\S]*?` hörte
       deshalb am ersten Zeilenumbruch auf, und alles nach dem Umbruch fiel weg.
       Bei einer Mail, die ihren `Content-Type` umbricht — Outlook und
       Thunderbird tun das, und Chrome tut es beim Speichern einer Seite als
       `.mhtml` — stand die `boundary` in der zweiten Zeile. Gemessen:

         Content-Type: multipart/related;
                 type="text/html";
                 boundary="----GRENZE----"

       gelesen wurde daraus `multipart/related;` — ohne Grenze. Folge: die Mail
       wurde NICHT in ihre Teile zerlegt, der ganze Rumpf galt als EIN Anhang,
       und dessen Nutzlast rührt der Prüfer absichtlich nicht an. Also meldete
       er auf einer solchen Mail **nichts** — keine Links, kein versteckter
       Text, keine KI-Anweisung. Kein Fehler, kein roter Hinweis: die stillste
       Sorte, gegen die dieses Werkzeug antritt.

       Gefunden nicht durch eine Probe, sondern durch Klaus' Frage, wie man den
       Quelltext einer Seite ausliest — die Antwort führte auf `.mhtml`, und die
       bricht ihren Kopf immer um. */
    var re = new RegExp("^" + maskiere(name) + "[ \\t]*:[ \\t]*([^\\n]*(?:\\n[ \\t]+[^\\n]*)*)", "im");
    var m = re.exec(kopfText);
    return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : "";
  }

  /* Ein einzelner Teil einer mehrteiligen Mail. */
  function entpackeTeil(kopfText, koerper) {
    var kodierung = kopfWert(kopfText, "Content-Transfer-Encoding").toLowerCase();
    var typ = kopfWert(kopfText, "Content-Type");
    var zs = (/charset\s*=\s*"?([A-Za-z0-9_\-]+)"?/i.exec(typ) || [, ""])[1];
    var inhalt = koerper;
    var entpackt = false;
    if (kodierung.indexOf("quoted-printable") === 0) { inhalt = ausQP(koerper); entpackt = true; }
    else if (kodierung.indexOf("base64") === 0) {
      var b = ausBase64(koerper);
      if (b === null) return { inhalt: null, entpackt: true, typ: typ, kodierung: kodierung };
      inhalt = b; entpackt = true;
    }
    if (entpackt) inhalt = alsText(inhalt, zs);
    return { inhalt: inhalt, entpackt: entpackt, typ: typ, kodierung: kodierung };
  }

  function istText(typ) {
    var t = String(typ || "").toLowerCase();
    return !t || t.indexOf("text/") === 0 || t.indexOf("message/") === 0;
  }

  function dateiname(kopfText) {
    var m = /filename\s*\*?=\s*(?:"([^"]*)"|([^;\r\n]+))/i.exec(kopfText) ||
            /\bname\s*=\s*(?:"([^"]*)"|([^;\r\n]+))/i.exec(kopfText);
    if (!m) return "";
    return String(m[1] !== undefined ? m[1] : m[2]).trim();
  }

  /**
   * Zerlegt eine Mail in den Text, über den geprüft wird.
   * Gibt IMMER einen Prüftext zurück — auch wenn nichts zu entpacken war;
   * dann ist er die Eingabe selbst, und die Zeilennummern stimmen mit dem
   * überein, was der Nutzer eingefügt hat.
   */
  function zerlege(roh, tiefe) {
    tiefe = tiefe || 0;
    roh = String(roh == null ? "" : roh).replace(/\r\n/g, "\n");
    var anhaenge = [], geaendert = false, hinweise = [];

    /* Kopf und Rumpf. Ein Kopf liegt nur vor, wenn die erste Zeile wirklich
       wie eine Kopfzeile aussieht — sonst hat jemand nur den Text eingefügt,
       und das ist der häufigere Fall. */
    var trenner = roh.indexOf("\n\n");
    var hatKopf = /^[A-Za-z][A-Za-z0-9\-]*\s*:\s/.test(roh) && trenner !== -1;
    if (!hatKopf) return { text: roh, kopf: "", anhaenge: anhaenge, entpackt: false, hinweise: hinweise };

    var kopfText = roh.slice(0, trenner);
    var rumpf = roh.slice(trenner + 2);
    var typ = kopfWert(kopfText, "Content-Type");
    var grenze = (/boundary\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(typ) || [])
                 .slice(1).filter(Boolean)[0];

    var stuecke = [];
    if (grenze) {
      var teile = rumpf.split("--" + grenze);
      for (var i = 1; i < teile.length; i++) {
        var teil = teile[i];
        if (/^--/.test(teil)) break;                       /* Schluss-Grenze */
        teil = teil.replace(/^\r?\n/, "");
        var tt = teil.indexOf("\n\n");
        var tKopf = tt === -1 ? teil : teil.slice(0, tt);
        var tKoerper = tt === -1 ? "" : teil.slice(tt + 2);
        stuecke.push({ kopf: tKopf, koerper: tKoerper });
      }
    } else {
      stuecke.push({ kopf: kopfText, koerper: rumpf });
    }

    var stuecke_aus = [], innererKopf = "";
    stuecke.forEach(function (s, nr) {
      var name = dateiname(s.kopf);
      var rohTyp = kopfWert(s.kopf, "Content-Type");

      /* ══ DIE BYTES EINES ANHANGS WERDEN NIE ZUSAMMENGESETZT ═══════════════
       * Klaus am 2026-09-09: „auch wenn Schadsoftware oder Spam oder Phishing
       * Inhalt der Mail ist — auch dann darf kein Schaden entstehen."
       *
       * Bis hierher wurde JEDER Teil erst entpackt und der Anhang danach
       * weggeworfen. Das war nicht gefährlich (aus einer Zeichenkette wird kein
       * Programm), aber es war überflüssig — und überflüssige Arbeit an
       * fremden Bytes ist genau die Stelle, an der so etwas später schiefgeht.
       * Ein Schadprogramm von drei Megabyte wurde dabei vollständig
       * zusammengesetzt, um dann verworfen zu werden.
       *
       * Jetzt wird VORHER entschieden. Ein Anhang wird an seinen Kopfzeilen
       * erkannt — Name, Typ, Disposition —, und seine Nutzlast rührt der
       * Prüfer nicht an: nicht entpackt, nicht dekodiert, nicht angesehen.
       * Was gelesen wird, ist der Umschlag; was drinsteckt, bleibt drin. */
      var istMailTeil = /message\/rfc822/i.test(rohTyp) || /\.eml$/i.test(name || "");
      var vorabAnhang = !istMailTeil &&
                        (/attachment/i.test(kopfWert(s.kopf, "Content-Disposition")) ||
                         (!!name && !istText(rohTyp)) || !istText(rohTyp));
      if (vorabAnhang) {
        anhaenge.push({ name: name || "(ohne Namen)",
                        typ: (rohTyp || "(ohne Angabe)").split(";")[0].trim(),
                        groesse: s.koerper.replace(/\s/g, "").length });
        stuecke_aus.push({ kopf: s.kopf, inhalt: null, nr: nr + 1,
                           marke: "Anhang " + (name || "(ohne Namen)") +
                                  " — Nutzlast NICHT angerührt" });
        geaendert = true;
        return;
      }

      var e = entpackeTeil(s.kopf, s.koerper);

      /* ══ „ALS ANHANG WEITERLEITEN" IST KEIN ANHANG ═══════════════════════
       * Klaus am 2026-09-09: „Oder Email sicher als Datei mit Anhang und
       * Adresse und dann einfügen zum Prüfen?"
       *
       * Genau dieser Weg ist der beste, den es gibt — und er wäre beinahe am
       * eigenen Riegel gescheitert. Leitet ein Mail-Programm eine Nachricht
       * „als Anhang" weiter, steckt die ORIGINAL-Mail als `message/rfc822`
       * darin, mitsamt ihren Kopfzeilen. Viele Programme setzen dabei
       * `Content-Disposition: attachment` — und dann hätte der Prüfer sie als
       * Anhang beiseitegelegt und ihren Inhalt gar nicht angesehen.
       *
       * Es IST aber keine Nutzlast, es ist die Mail. Sie wird deshalb ausgepackt
       * und mitgeprüft: eine Ebene tief, damit eine Kette weitergeleiteter
       * Weiterleitungen nicht ins Endlose läuft. Was tiefer liegt, steht als
       * Text da und wird von den Regeln trotzdem gelesen — nur nicht noch
       * einmal entpackt, und das steht dann im Ergebnis. */
      var istMail = istMailTeil;
      if (istMail && e.inhalt !== null && tiefe < 1) {
        var innen = zerlege(e.inhalt, tiefe + 1);
        anhaenge = anhaenge.concat(innen.anhaenge);
        hinweise = hinweise.concat(innen.hinweise);
        /* ⚠ UND IHRE KOPFZEILEN SIND DIE, AUF DIE ES ANKOMMT. Geprüft werden
           soll die eingepackte Mail, nicht der Umschlag, den man selbst
           darumgelegt hat: sonst urteilte der Prüfer über den eigenen
           Absender und meldete brav, dass mit ihm alles in Ordnung ist. */
        if (!innererKopf && innen.kopf) innererKopf = innen.kopf;
        stuecke_aus.push({ kopf: s.kopf, inhalt: innen.text, nr: nr + 1,
                           marke: "weitergeleitete Mail — ausgepackt und mitgeprüft" });
        geaendert = true;
        return;
      }
      if (istMail && tiefe >= 1) {
        hinweise.push("In der Mail steckt noch eine weitergeleitete Mail. Sie " +
                      "steht als Text da und wird gelesen, aber nicht noch " +
                      "einmal ausgepackt — was darin verpackt ist, ist " +
                      "UNGEPRÜFT, nicht sauber.");
      }

      if (e.entpackt) geaendert = true;
      if (e.inhalt === null) {
        hinweise.push("Ein Teil der Mail ließ sich nicht entpacken (" +
                      (e.kodierung || "unbekannte Kodierung") +
                      ") — er ist ungeprüft, nicht sauber.");
        stuecke_aus.push({ kopf: s.kopf, inhalt: null, nr: nr + 1,
                           marke: "Teil nicht lesbar" });
        return;
      }
      stuecke_aus.push({ kopf: s.kopf, inhalt: e.inhalt, nr: nr + 1,
                         marke: (e.typ || "text/plain") + (e.entpackt ? ", entpackt" : "") });
    });

    if (!geaendert && stuecke_aus.length === 1 && !grenze) {
      /* Nichts zu tun — die Zeilennummern bleiben die der Eingabe. Das ist
         der beste Fall, und er ist der häufigste: eine eingefügte Mail. */
      return { text: roh, kopf: kopfText, anhaenge: anhaenge, entpackt: false, hinweise: hinweise };
    }

    var zeilen = [kopfText, ""];
    stuecke_aus.forEach(function (s) {
      zeilen.push("--- Teil " + s.nr + ": " + s.marke + " ---");
      if (grenze) zeilen.push(s.kopf);
      zeilen.push(s.inhalt === null ? "" : s.inhalt);
      zeilen.push("");
    });
    if (innererKopf) {
      hinweise.push("Die Mail trug eine weitergeleitete Mail als Anhang — das " +
        "ist der beste Weg, weil dabei nichts umgeschrieben wird. Geprüft " +
        "wurden die Kopfzeilen der EINGEPACKTEN Mail, nicht die deiner " +
        "Weiterleitung.");
    }
    return { text: zeilen.join("\n"), kopf: innererKopf || kopfText,
             anhaenge: anhaenge, entpackt: true, hinweise: hinweise };
  }

  /**
   * Prüft eine E-Mail.
   * @param {string} roh  die eingefügte Mail (.eml, Quelltext oder blosser Text)
   * @returns {{stellen:object[], hinweise:string[], text:string}}
   *          `text` ist der Text, auf den sich die Zeilennummern beziehen.
   */
  function pruefeMail(roh) {
    var zerlegt = zerlege(roh);
    var text = zerlegt.text;
    var kopfText = zerlegt.kopf;
    var treffer = [], hinweise = zerlegt.hinweise.slice();

    if (!String(roh || "").trim()) {
      return { stellen: [], hinweise: ["Noch nichts zu prüfen."], text: "" };
    }

    var zeilenanfaenge = [0];
    for (var p = 0; p < text.length; p++) if (text.charCodeAt(p) === 10) zeilenanfaenge.push(p + 1);
    function zeileVon(pos) {
      var lo = 0, hi = zeilenanfaenge.length - 1;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (zeilenanfaenge[mid] <= pos) lo = mid; else hi = mid - 1;
      }
      return lo + 1;
    }
    var zeilen = text.split("\n");
    /* ⚠ BEI EINER WEITERGELEITETEN MAIL GIBT ES `From:` ZWEIMAL. Geurteilt
       wird über die eingepackte, angezeigt würde sonst die Zeile der
       Weiterleitung — ein richtiger Befund über der falschen Zeile ist eine
       Fehlauskunft mit Beleg. Darum darf ein zweiter Anker mitgegeben werden,
       der die gemeinte Zeile eindeutig macht. */
    function zeileMit(re, auch) {
      var ersteOhne = 0;
      for (var i = 0; i < zeilen.length; i++) {
        if (!re.test(zeilen[i])) continue;
        if (!auch) return i + 1;
        if (zeilen[i].toLowerCase().indexOf(String(auch).toLowerCase()) !== -1) return i + 1;
        if (!ersteOhne) ersteOhne = i + 1;
      }
      return ersteOhne || 1;
    }
    function melde(zeile, kennung, satz) {
      treffer.push({ zeile: zeile, kennung: kennung, satz: satz });
    }

    /* ── 1 · Links ────────────────────────────────────────────────────────
       Erst die Ziele einsammeln, dann urteilen. Die Wirte selbst sind eine
       AUSKUNFT, kein Befund — in einer Mail ist ein fremder Rechner das
       Normale. */
    /* ⚠ KARTEN OHNE PROTOTYP. Die Schlüssel dieser Karten kommen aus der Mail —
       also von einem Fremden. Auf einem gewöhnlichen `{}` ist `__proto__` kein
       Schlüssel, sondern ein Schalter: `karte["__proto__"] = 0` setzt den
       Prototyp statt einen Eintrag, `++` macht daraus NaN, und der Wirt
       verschwindet aus der Zählung, ohne dass etwas rot wird. Mit
       `Object.create(null)` ist jeder Name nur ein Name. */
    var wirteGesehen = Object.create(null), zaehler = 0;

    function nimmZiel(adresse, zeile) {
      var w = wirtAus(entitaeten(adresse));
      if (!w || !w.wirt) return null;
      if (!wirteGesehen[w.wirt]) { wirteGesehen[w.wirt] = 0; zaehler++; }
      wirteGesehen[w.wirt]++;

      /* ⚠ DER TEIL VOR DEM @ IST DER ÄLTESTE TRICK IM BUCH.
         `https://sparkasse.de@boese.test/` führt zu boese.test — der Browser
         liest alles vor dem @ als Benutzernamen, ein Mensch liest es als
         Adresse. */
      if (w.benutzerteil && /[A-Za-z]/.test(w.benutzerteil)) {
        melde(zeile, "ADRESS-TRICK",
              "Vor dem @ steht „" + w.benutzerteil.slice(0, 60) +
              "\", angesteuert wird aber: " + w.wirt);
      }
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(w.wirt)) {
        melde(zeile, "ADRESS-TRICK",
              "Das Ziel ist eine blosse Zahlenadresse ohne Namen: " + w.wirt);
      }
      if (w.wirt.indexOf("xn--") !== -1) {
        melde(zeile, "ADRESS-TRICK",
              "Der Name enthält umgeschriebene Sonderzeichen (xn--), " +
              "die wie lateinische Buchstaben aussehen können: " + w.wirt);
      }
      if (KUERZEL.indexOf(w.wirt) !== -1) {
        melde(zeile, "KURZLINK",
              "Ein Kürzel-Dienst verbirgt, wohin der Link führt: " + w.wirt);
      }
      return w.wirt;
    }

    /* a) HTML-Links mit sichtbarem Text — hier sitzt die Tarnung. */
    /* ⚠ WAS IM <a> STAND, WIRD UNTEN NICHT NOCH EINMAL GEZÄHLT. Die erste
       Fassung lief zweimal über dieselbe Stelle: das `href` einmal als Ziel des
       Links und einmal als nackte Adresse im Text. Ergebnis waren doppelte
       Befunde und ein Wirt, der „2×" dastand, obwohl er einmal vorkam — eine
       Zahl, die schlimmer aussieht als die Lage. Gemessen an der Test-Mail. */
    var bereiche = [];
    var are = /<a\b([^>]*)>([\s\S]{0,4000}?)<\/a\s*>/gi, am;
    while ((am = are.exec(text)) !== null) {
      bereiche.push([am.index, are.lastIndex]);
      var attr = am[1] || "";
      var hm = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attr);
      if (!hm) continue;
      var ziel = entitaeten(hm[1] !== undefined ? hm[1] : (hm[2] !== undefined ? hm[2] : hm[3]));
      var zeile = zeileVon(am.index);
      var zielWirt = nimmZiel(ziel, zeile);
      if (!zielWirt) continue;

      var sichtbar = entitaeten(String(am[2]).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
      /* Nennt der sichtbare Text selbst einen Rechner? Nur dann kann er
         täuschen. „Hier klicken" täuscht niemanden. */
      var sm = /(?:https?:\/\/)?((?:[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,})/.exec(sichtbar);
      if (!sm) continue;
      var genannt = sm[1].toLowerCase().replace(/^www\./, "");
      if (kern(genannt) === kern(zielWirt)) continue;
      melde(zeile, "LINK-TARNUNG",
            "Sichtbar steht „" + genannt + "\", angeklickt wird: " + zielWirt);
    }

    /* b) Nackte Adressen im Text — für die Wirte-Auskunft und die Tricks. */
    function inLink(pos) {
      for (var b = 0; b < bereiche.length; b++) {
        if (pos >= bereiche[b][0] && pos < bereiche[b][1]) return true;
      }
      return false;
    }
    var ure = /\bhttps?:\/\/[^\s"'<>)\]]+/gi, um;
    while ((um = ure.exec(text)) !== null) {
      if (inLink(um.index)) continue;
      nimmZiel(um[0], zeileVon(um.index));
    }

    /* c) Zählpixel. Ein Bild, das man nicht sehen kann, ist zum Ansehen nicht
       da — es meldet dem Absender, dass die Mail geöffnet wurde. */
    var ire = /<img\b([^>]*)>/gi, im2;
    var pixelWirte = Object.create(null);
    while ((im2 = ire.exec(text)) !== null) {
      var ia = im2[1] || "";
      var breite = (/\bwidth\s*=\s*"?(\d+)/i.exec(ia) || [, null])[1];
      var hoehe  = (/\bheight\s*=\s*"?(\d+)/i.exec(ia) || [, null])[1];
      var istil  = (/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(ia) || []).slice(1).filter(Boolean)[0] || "";
      var winzig = (breite !== null && hoehe !== null && +breite <= 2 && +hoehe <= 2) ||
                   /(?:width|height)\s*:\s*(?:0|1|2)(?:px)?\s*(?:;|$)/i.test(istil) ||
                   /display\s*:\s*none/i.test(istil);
      if (!winzig) continue;
      var qm = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(ia);
      if (!qm) continue;
      var q = entitaeten(qm[1] !== undefined ? qm[1] : (qm[2] !== undefined ? qm[2] : qm[3]));
      var qw = wirtAus(q);
      if (!qw || !qw.wirt || pixelWirte[qw.wirt]) continue;
      pixelWirte[qw.wirt] = 1;
      melde(zeileVon(im2.index), "ZAEHLPIXEL",
            "Ein unsichtbares Bild meldet das Öffnen an: " + qw.wirt);
    }

    /* ── 2 · Anhänge — was sie zu SEIN BEHAUPTEN ───────────────────────── */
    zerlegt.anhaenge.forEach(function (a) {
      var zeile = zeileMit(new RegExp(maskiere(a.name)));
      var name = a.name.toLowerCase();
      /* ⚠ ZUERST DIE UMGEDREHTEN ZEICHEN. Ein U+202E im Namen dreht die
         Anzeige um: aus `rechnungfdp.exe` wird auf dem Schirm
         `rechnungexe.pdf`. Wer nur die Endung liest, sieht `.exe` — der
         Empfänger sieht `.pdf`. */
      if (UNSICHTBAR.test(a.name)) {
        melde(zeile, "ANHANG-DOPPELENDUNG",
              "Im Namen des Anhangs steht ein unsichtbares Steuerzeichen, " +
              "das die Anzeige umdreht: " + a.name);
      }
      var teile = name.split(".");
      var endung = teile.length > 1 ? teile[teile.length - 1] : "";
      var vorletzte = teile.length > 2 ? teile[teile.length - 2] : "";
      var harmlosAussehend = ["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg",
                              "png", "txt", "rtf", "csv", "ppt", "pptx", "odt"];
      if (vorletzte && harmlosAussehend.indexOf(vorletzte) !== -1 &&
          ENDUNG_FUEHRT_AUS.indexOf(endung) !== -1) {
        melde(zeile, "ANHANG-DOPPELENDUNG",
              "Doppelte Endung — sieht aus wie ." + vorletzte + ", ist aber ." +
              endung + ": " + a.name);
      } else if (ENDUNG_FUEHRT_AUS.indexOf(endung) !== -1) {
        melde(zeile, "ANHANG-GEFAEHRLICH",
              "Der Anhang trägt die Endung ." + endung +
              " — damit führt ein Doppelklick ein Programm aus: " + a.name);
      } else if (ENDUNG_MAKRO.indexOf(endung) !== -1) {
        melde(zeile, "ANHANG-GEFAEHRLICH",
              "Der Anhang ist eine Büro-Datei mit Makro-Fähigkeit (." + endung +
              "): " + a.name);
      }
    });

    /* ── 3 · Versteckter Inhalt ─────────────────────────────────────────── */
    var vre = /<([a-z][a-z0-9]*)\b([^>]*style\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*)>([\s\S]{0,20000}?)<\/\1\s*>/gi, vm;
    var versteckt = 0;
    while ((vm = vre.exec(text)) !== null) {
      var stil = (vm[3] !== undefined ? vm[3] : vm[4]) || "";
      var unsichtbar = /display\s*:\s*none/i.test(stil) ||
                       /visibility\s*:\s*hidden/i.test(stil) ||
                       /font-size\s*:\s*0(?:\.0+)?\s*(?:px|pt|em|rem)?\s*(?:;|$)/i.test(stil) ||
                       /opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)/i.test(stil) ||
                       /max-height\s*:\s*0/i.test(stil);
      if (!unsichtbar) continue;
      var innen = entitaeten(String(vm[5]).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
      if (innen.length < VERSTECKT_AB) continue;
      versteckt++;
      melde(zeileVon(vm.index), "VERSTECKTER-TEXT",
            "Ein Bereich ist per CSS unsichtbar gemacht und trägt trotzdem " +
            innen.length + " Zeichen Text: „" + innen.slice(0, 90) + " …\"");
    }

    /* Unsichtbare Zeichen. Die BOM am Dateianfang ist ausgenommen. */
    for (var uz = 0; uz < zeilen.length; uz++) {
      var zl = zeilen[uz];
      if (uz === 0) zl = zl.replace(/^\uFEFF/, "");
      if (UNSICHTBAR.test(zl)) {
        melde(uz + 1, "UNSICHTBARE-ZEICHEN",
              "In dieser Zeile stehen Zeichen ohne Breite oder mit " +
              "Richtungswechsel — sie sind nicht zu sehen und können Wörter " +
              "trennen oder die Anzeige umdrehen.");
      }
    }

    /* ── 4 · Anweisungen an eine KI ─────────────────────────────────────── */
    /* ⚠ EINE ZEILE, EIN BEFUND. Ein versteckter Absatz trifft leicht drei
       Muster auf einmal („ignoriere alle vorherigen Anweisungen. Du bist jetzt
       …"). Drei Karten über dieselbe Zeile lesen sich wie drei Probleme; es ist
       eines. Was gefunden wurde, steht zusammen im Satz — gekürzt wird nichts. */
    var kiProZeile = Object.create(null), kiFolge = [], kiAnweisung = Object.create(null);
    for (var ki = 0; ki < KI_MUSTER.length; ki++) {
      var kre = new RegExp(KI_MUSTER[ki].re.source, KI_MUSTER[ki].re.flags.replace("g", "") + "g");
      var km, gemeldet = 0;
      while ((km = kre.exec(text)) !== null && gemeldet < 3) {
        var kz = zeileVon(km.index);
        if (!kiProZeile[kz]) { kiProZeile[kz] = []; kiFolge.push(kz); }
        if (kiProZeile[kz].indexOf(KI_MUSTER[ki].was) === -1) kiProZeile[kz].push(KI_MUSTER[ki].was);
        if (!KI_MUSTER[ki].begriff) kiAnweisung[kz] = true;
        gemeldet++;
        if (km.index === kre.lastIndex) kre.lastIndex++;
      }
    }
    kiFolge.forEach(function (kz) {
      if (!kiAnweisung[kz]) {
        melde(kz, "KI-BEGRIFF",
              "Im Text steht " + kiProZeile[kz].join(", ") + " — ein Fachbegriff für " +
              "Angriffe auf KI-Assistenten. Gefunden über eine feste Wortliste. Das " +
              "Wort allein ist keine Anweisung: ein Text ÜBER das Thema enthält es " +
              "auch. Eine Anweisung an eine KI wurde in dieser Zeile nicht gefunden.");
        return;
      }
      melde(kz, "KI-ANWEISUNG",
            "Im Text steht " + kiProZeile[kz].join(", ") + " — das richtet sich " +
            "an eine KI, die den Text liest, nicht an einen Menschen. Gefunden " +
            "über eine feste Liste solcher Wendungen; ein Text, der eine solche " +
            "Wendung nur zitiert, wird ebenso gemeldet.");
    });

    /* ── 5 · Kopfzeilen ─────────────────────────────────────────────────── */
    if (kopfText) {
      var von = kopfWert(kopfText, "From");
      /* ⚠ DIE ECHTE ADRESSE STEHT IN DER LETZTEN SPITZEN KLAMMER, nicht in der
         ersten. Genau darauf zielt der Trick: der Anzeigename trägt selbst eine
         Adresse in Klammern, und wer die erste nimmt, liest die gefälschte.
         Die erste Fassung tat das — und meldete deshalb NICHTS, gemessen an der
         Test-Mail. Ein Wächter, der die Fälschung für die Wahrheit hält, ist
         schlimmer als keiner. */
      var letzteKlammer = von.lastIndexOf("<");
      var vonAdr = "", anzeige = von;
      if (letzteKlammer !== -1 && von.indexOf(">", letzteKlammer) !== -1) {
        vonAdr = von.slice(letzteKlammer + 1, von.indexOf(">", letzteKlammer)).trim();
        anzeige = von.slice(0, letzteKlammer);
      } else {
        vonAdr = (/([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/.exec(von) || [, ""])[1];
        anzeige = "";
      }
      var vonWirt = vonAdr ? vonAdr.split("@").pop().toLowerCase() : "";
      anzeige = anzeige.replace(/["']/g, " ").trim();

      /* ⚠ EINE ZWEITE ADRESSE IM ANZEIGENAMEN. Viele Programme zeigen NUR den
         Anzeigenamen. Steht dort `service@bank.test` und die echte Adresse
         lautet anders, liest der Empfänger die falsche. */
      var imNamen = /([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/.exec(anzeige);
      if (imNamen && vonWirt && kern(imNamen[1].split("@").pop()) !== kern(vonWirt)) {
        melde(zeileMit(/^From\s*:/i, vonAdr), "ABSENDER-TARNUNG",
              "Der angezeigte Name enthält „" + imNamen[1] +
              "\", abgeschickt wurde die Mail von: " + vonWirt);
      }
      var antwort = kopfWert(kopfText, "Reply-To");
      var antWirt = antwort ? (/@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/.exec(antwort) || [, ""])[1].toLowerCase() : "";
      if (antWirt && vonWirt && kern(antWirt) !== kern(vonWirt)) {
        melde(zeileMit(/^Reply-To\s*:/i, antWirt), "ABSENDER-TARNUNG",
              "Eine Antwort ginge nicht an den Absender, sondern an: " + antWirt);
      }

      /* ⚠ DAS URTEIL IST NICHT UNSERES. Was hier steht, hat der EMPFANGENDE
         Server geschrieben, als die Mail ankam — nachrechnen lässt es sich
         hier nicht (dafür bräuchte es das Netz und den Zeitpunkt von damals).
         Gelesen wird also eine fremde Auskunft, und das steht im Rat dabei. */
      var auth = kopfWert(kopfText, "Authentication-Results") + " " +
                 kopfWert(kopfText, "ARC-Authentication-Results") + " " +
                 kopfWert(kopfText, "Received-SPF");
      /* ⚠ `none` IST KEIN DURCHFALLEN. `dmarc=none` heisst, dass der Absender
         gar keine Regel hinterlegt hat — das ist eine Auskunft über ihn, kein
         Urteil über diese Mail. Wer es mitmeldet, meldet auf halbem Netz etwas. */
      var durchgefallen = [];
      ["dkim", "spf", "dmarc"].forEach(function (art) {
        var m = new RegExp("\\b" + art + "\\s*=\\s*(fail|softfail|permerror|temperror)\\b", "i").exec(auth);
        if (m) durchgefallen.push(art.toUpperCase() + " = " + m[1].toLowerCase());
      });
      if (durchgefallen.length) {
        melde(zeileMit(/^(?:ARC-)?Authentication-Results\s*:|^Received-SPF\s*:/i),
              "PRUEFUNG-DURCHGEFALLEN",
              "Der empfangende Server hat beim Eintreffen bewertet: " +
              durchgefallen.join(", ") + ".");
      }
    }

    /* ── 6 · Maschen, nur als Kombination ───────────────────────────────── */
    var hatLink = zaehler > 0;

    var wm2 = WECHSEL_WORT.exec(text);
    if (wm2) {
      var ibanDa = false;
      var iform = /\b[A-Z]{2}\d{2}(?:[ \-]?[A-Z0-9]{2,4}){3,8}\b/g, ifm;
      var pruefIban = (welt.PrueferFormate && welt.PrueferFormate.istIban) || null;
      while ((ifm = iform.exec(text)) !== null) {
        if (pruefIban ? pruefIban(ifm[0]) : false) { ibanDa = true; break; }
      }
      if (ibanDa) {
        melde(zeileVon(wm2.index), "KONTO-WECHSEL",
              "Die Mail spricht von einer geänderten Bankverbindung und nennt " +
              "dazu eine Kontonummer, deren Prüfziffer stimmt.");
      } else if (!pruefIban) {
        hinweise.push("Die IBAN-Prüfung stand nicht zur Verfügung " +
                      "(pruefer-formate.js fehlt) — der Bankverbindungs-Wechsel " +
                      "ist ungeprüft, nicht sauber.");
      }
    }

    var zm = ZUGANG_WORT.exec(text);
    if (zm && AUFFORDERUNG.test(text) && hatLink) {
      melde(zeileVon(zm.index), "ZUGANGSDATEN",
            "Die Mail spricht von Zugangsdaten, fordert zu einer Handlung auf " +
            "und enthält einen Link.");
    }

    var fm2 = FRIST_WORT.exec(text);
    if (fm2 && FOLGE_WORT.test(text)) {
      melde(zeileVon(fm2.index), "DRUCK",
            "Die Mail nennt eine Frist und droht zugleich mit einer Folge.");
    }

    /* ── 7 · Schlüssel im Text ──────────────────────────────────────────────
       ⚠ GELIEHEN, NICHT NACHGEBAUT. Die Schlüssel-Muster werden in
       `pruefer-formate.js` gepflegt; eine zweite Liste liefe auseinander, und
       dann meldete der eine Eingang, was der andere übersieht. Übernommen wird
       NUR `SCHLUESSEL`: Mailadressen und Links sind in einer Mail das Normale,
       und wer sie hier meldete, baute die Warnung, die man nicht mehr los wird.

       ⚠ FEHLT DIE DATEI, WIRD DAS GESAGT. Still weniger zu prüfen sähe aus wie
       „nichts gefunden". */
    if (welt.PrueferFormate && welt.PrueferFormate.pruefeText) {
      welt.PrueferFormate.pruefeText(text, "", []).forEach(function (x) {
        if (x.kennung === "SCHLUESSEL") treffer.push(x);
      });
    } else {
      hinweise.push("Die Schlüssel-Suche stand nicht zur Verfügung " +
                    "(pruefer-formate.js fehlt) — dieser Teil ist ungeprüft, " +
                    "nicht sauber.");
    }

    /* ── Auskünfte, keine Befunde ───────────────────────────────────────── */
    /* ⚠ OHNE KOPFZEILEN PRÜFT ER WENIGER — UND SAGT ES. Wer nur den sichtbaren
       Text einfügt, bekommt keine Absender-Prüfung und keine Anhänge zu sehen;
       es gibt sie schlicht nicht in dem, was dasteht. Stillschweigend weniger zu
       prüfen sähe aus wie „nichts gefunden". Das ist die dritte Antwort neben
       grün und rot: nicht geprüft. */
    if (!kopfText) {
      hinweise.push("Es sind keine Kopfzeilen dabei — geprüft wurde nur der Text. " +
        "Absender, Antwortadresse und die Prüfungen des empfangenden Servers " +
        "sind damit UNGEPRÜFT, nicht sauber; Anhänge sieht der Prüfer so gar " +
        "nicht. Vollständig wird es mit der ganzen Mail: im Mail-Programm " +
        "„Original anzeigen\" oder „Quelltext anzeigen\", alles markieren, hier " +
        "einfügen.");
    }
    /* ══ EINE WEITERLEITUNG IST NICHT DAS ORIGINAL ══════════════════════════
     * Wer eine verdächtige Mail an sich selbst weiterleitet und DAS einfügt,
     * bekommt eine ehrliche Prüfung — nur von der falschen Mail. Absender,
     * Antwortadresse und das Urteil des empfangenden Servers gehören dann der
     * WEITERLEITUNG, also einem selbst. Die Kopfzeilen des Originals stehen
     * bestenfalls als Text im Rumpf, und aus Text lässt sich nichts prüfen.
     *
     * Das ist keine Kleinigkeit: die drei Angaben, die dabei verlorengehen,
     * sind genau die, die man nicht selbst nachbauen kann. Also wird es
     * gesagt — ein Ergebnis, das die falsche Mail beurteilt und dabei sicher
     * aussieht, ist schlimmer als keines. */
    if (/^\s*(?:-{2,}\s*(?:weitergeleitete nachricht|forwarded message|original message|urspr(?:ü|ue)ngliche nachricht)|begin forwarded message:)/im.test(text)) {
      hinweise.push("Das sieht nach einer WEITERGELEITETEN Mail aus. Dann " +
        "gehören Absender, Antwortadresse und das Echtheits-Urteil des Servers " +
        "der Weiterleitung — nicht der Mail, um die es geht; deren Kopfzeilen " +
        "stehen nur noch als Text im Rumpf und sind nicht mehr prüfbar. " +
        "Links, Anhänge und versteckter Text werden trotzdem gefunden. " +
        "Vollständig wird es nur mit dem Original: „Original anzeigen\" und " +
        "einfügen, oder die Mail als Datei sichern und oben auswählen.");
    }
    if (zerlegt.entpackt) {
      hinweise.push("Die Mail wurde entpackt (quoted-printable / base64 / " +
                    "mehrteilig). Die Zeilennummern zählen im entpackten Text, " +
                    "nicht in der Datei, die du eingefügt hast.");
    }
    var namen = Object.keys(wirteGesehen).sort();
    if (namen.length) {
      hinweise.push("Die Mail zeigt auf " + namen.length +
        (namen.length === 1 ? " Rechner" : " Rechner") + ": " +
        namen.slice(0, 12).map(function (w) { return w + " (" + wirteGesehen[w] + "×)"; }).join(", ") +
        (namen.length > 12 ? " …" : "") +
        ". Das ist eine Auskunft, kein Befund — in einer Mail sind fremde " +
        "Adressen das Normale.");
    }
    if (zerlegt.anhaenge.length) {
      hinweise.push("Angehängt: " + zerlegt.anhaenge.map(function (a) {
        /* Aus Base64-Zeichen werden drei Viertel so viele Bytes. Unter einem
           Kilobyte steht die Byte-Zahl da statt „rund 0 KB" — eine gerundete
           Null sieht aus wie „nichts dran". */
        var bytes = Math.round(a.groesse * 3 / 4);
        return a.name + " (" + a.typ + ", " +
               (bytes < 1024 ? bytes + " Bytes" : "rund " + Math.round(bytes / 1024) + " KB") + ")";
      }).join(", ") + ". ⚠ Kein Anhang wurde geöffnet. Geprüft ist nur, was er " +
      "zu sein behauptet — das ist KEINE Virenprüfung.");
    }

    treffer.sort(function (x, y) {
      return x.zeile - y.zeile || (x.kennung < y.kennung ? -1 : x.kennung > y.kennung ? 1 : 0);
    });
    return { stellen: treffer, hinweise: hinweise, text: text };
  }

  /* ══ EINE GESPEICHERTE SEITE IST MIME, KEINE HTML-DATEI ══════════════════
   *
   * Klaus am 2026-09-10: „Wie kann ich den Seitenquelltext von einer
   * Internetseite auslesen oder lesen?"
   *
   * Auf einem Android-Tablet gibt es dafür keinen guten Weg: `view-source:`
   * sperrt Chrome dort, und „Adresse abrufen" scheitert bei fremden Servern an
   * der Browser-Sperre. Was IMMER geht, ist der Herunterladen-Pfeil im
   * Chrome-Menü — nur schreibt der keine `.html`, sondern eine `.mhtml`:
   * MIME-Format, mehrteilig, quoted-printable. Also genau das, was dieses
   * Modul ohnehin auspackt.
   *
   * ⚠ ZURÜCK KOMMT NUR DER SEITEN-TEIL, NICHT DER PRÜFTEXT. `zerlege` baut
   * einen Text mit Teil-Markern („--- Teil 1: … ---"), und die sind für den
   * Mail-Eingang richtig. Gäbe man sie dem HTML-Prüfer, meldete er Befunde
   * über Zeilen, die in der Seite nie standen — ein Fund, den niemand beheben
   * kann, weil es die Stelle nicht gibt.
   *
   * ⚠ UND ES WIRD NICHTS GERATEN. Sieht die Datei nicht nach MIME aus oder
   * steckt kein `text/html` darin, kommt `null` zurück und der Aufrufer nimmt
   * sie unverändert. Eine Datei stillschweigend umzudeuten wäre schlimmer als
   * sie abzulehnen.
   */
  function seiteAus(roh) {
    var text = String(roh == null ? "" : roh).replace(/\r\n/g, "\n");
    var trenner = text.indexOf("\n\n");
    if (!/^[A-Za-z][A-Za-z0-9\-]*[ \t]*:[ \t]/.test(text) || trenner === -1) return null;

    var kopfText = text.slice(0, trenner);
    var typ = kopfWert(kopfText, "Content-Type");
    var grenze = (/boundary\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(typ) || [])
                 .slice(1).filter(Boolean)[0];

    /* Einteilig: der Rumpf IST die Seite, wenn der Kopf das sagt. */
    if (!grenze) {
      if (!/text\/html/i.test(typ)) return null;
      var e1 = entpackeTeil(kopfText, text.slice(trenner + 2));
      return e1.inhalt;
    }

    var teile = text.slice(trenner + 2).split("--" + grenze);
    for (var i = 1; i < teile.length; i++) {
      var teil = teile[i];
      if (/^--/.test(teil)) break;
      teil = teil.replace(/^\n/, "");
      var tt = teil.indexOf("\n\n");
      if (tt === -1) continue;
      var tKopf = teil.slice(0, tt);
      if (!/text\/html/i.test(kopfWert(tKopf, "Content-Type"))) continue;
      var e = entpackeTeil(tKopf, teil.slice(tt + 2));
      if (e.inhalt !== null) return e.inhalt;
    }
    return null;
  }

  welt.PrueferMail = {
    pruefeMail: pruefeMail,
    zerlege: zerlege,
    seiteAus: seiteAus,
    kern: kern,
    BEFUNDE_MAIL: BEFUNDE_MAIL,
    KUERZEL: KUERZEL,
    VERSTECKT_AB: VERSTECKT_AB,
    _meta: { herkunft: "PWA Toolpoint 2026-09-09", fassung: "1", zwilling: false }
  };
})(typeof window !== "undefined" ? window : globalThis);
