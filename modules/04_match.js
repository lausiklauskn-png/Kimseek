/*
 * SBKIM — Modul 04 — Match
 *
 * Skalarprodukt zweier L2-normalisierter Float32Array(384). Bei korrekt
 * normalisierten Eingaben aus Modul 03 ist das identisch zur Cosinus-
 * Aehnlichkeit. Reine Funktion, kein async, kein Zustand.
 *
 * Public surface (registered on window.SbkimMatch):
 *   match(queryVec, passageVec) -> number   (roher Cosinus; ANDOCK-Boden via PROVIDER_MIN_MATCH)
 *   isAboveProviderThreshold(score) -> boolean
 *   relatedness(aVec, bVec) -> number       (zentrierter Cosinus; echte Verwandtschaft, gatet NICHTS)
 *   isRelated(score) -> boolean             (score >= RELATEDNESS_MIN)
 *   matchDimensions(queryCap, queryNeeds, passageCap, passageNeeds) -> MatchDimensionsResult
 *   explainMatchLLM(matchResult, apiKey, options?) -> Promise<ExplainResult>
 *   queryLocal(text, k?, options?) -> Promise<Array<{label, score, anchorId}>>
 *   setLocalCorpus(corpus | provider) -> void   (Bau 04.C registriert Korpus-Quelle)
 *   hybridMatch(query, candidates, options?) -> Promise<HybridJudgment>  (Bau 04.D Match-Zeit-Richter)
 *   pickJudgeProvider(options?) -> providerId   (Bau 04.D Anbieter-Wahl, EU-Default)
 *   bidirectionalVerdict(passtA, passtB, rule?) -> boolean   (Bau 04.D streng/großzügig)
 *   PROVIDER_MIN_MATCH -> number   (0.80, gespiegelt aus INTERFACES.md §0)
 *   SCHICHT_MIN_MATCH -> number    (0.60, Bau 04.A, gespiegelt aus INTERFACES.md §0)
 *   DimensionsAllNullError -> ErrorFactory
 *   InvalidApiKeyError -> ErrorFactory       (Bau 04.B sync throw)
 *   InvalidMatchResultError -> ErrorFactory  (Bau 04.B sync throw)
 *   EmptyQueryError -> ErrorFactory          (Bau 04.C sync throw)
 *   QueryTooLongError -> ErrorFactory        (Bau 04.C sync throw)
 *   InvalidKError -> ErrorFactory            (Bau 04.C sync throw)
 *   EmbeddingNotAvailableError -> ErrorFactory (Bau 04.C sync throw)
 *   InvalidCorpusError -> ErrorFactory       (Bau 04.C sync throw)
 *   InvalidCandidatesError -> ErrorFactory   (Bau 04.D sync throw)
 *   InvalidProviderError -> ErrorFactory     (Bau 04.D sync throw)
 *
 * Self-check: emits a console.info line on script load (synchronous,
 * before any call). Modul 04 has no async load step. See INTERFACES.md
 * and docs/components/04_match.md for the binding spec.
 *
 * Bau 04.A `matchDimensions` synchron (2026-05-19): drei orthogonale
 * Schichten (fachlich / prozess / skalierung) gemäß Brief 03 / M04-
 * Erweiterung. In Stufe A sind die drei Schichten eine Heuristik über
 * demselben Embedding-Raum: alle drei ergeben denselben Lane-Cosinus
 * (siehe Karte 04 § Drei-Schichten-Modell „Aufteilung in drei
 * Schichten"). Die echte semantische Differenzierung passiert in
 * Stufe B via `explainMatchLLM` — eigene Folge-Sitzung Bau 04.B.
 * `BridgeProposal` (Brief 03 § Brücken-Feld-Spec) wird NUR von
 * Stufe B befüllt; Bau 04.A liefert `bruecke: null`.
 *
 * Bau 04.B `explainMatchLLM` (2026-05-20): Stufe-B-LLM-Pass gegen
 * Anthropic-API (`https://api.anthropic.com/v1/messages`, hartcodiert),
 * JSON-only-Output, strikte Schema-Validierung, fail-soft.
 * `apiKey` als opaque String vom Aufrufer (Identitäts-Container ist
 * Vision-Anker 5, NICHT Bestandteil dieser Bau-Sitzung). Zwei sync
 * Throws (InvalidApiKeyError + InvalidMatchResultError) als Aufrufer-
 * Validierung; danach alle Fehler-Pfade resolved mit
 * `ExplainResult{available:false, reason:"<deutsch>", fallbackScore:
 * matchResult.overall}` — Aufrufer fällt auf Stufe-A-Resultat zurück.
 * `candidateScope:"netz"` wird still auf `"lokal"` korrigiert
 * (Anti-Missbrauch-Klausel § 8; entfällt erst mit Anker 10/11/12).
 * Spec-Quelle Brief 03 (PR #98) + Karte 04 § Stufe-B-Vertrag.
 *
 * Bau 04.C `queryLocal` (2026-05-26): lokales Such-Feld-Backend.
 * Klaus' Such-Feld-Vision (bidirektionales Cross-Knoten-Matching-Anker).
 * Modul 15 Sub (b) `op:"query"` postMessage-Bridge ruft seit Bau 15.B
 * `SbkimMatch.queryLocal()` fail-soft (typeof-Check) — diese Bau-Sitzung
 * schließt die Lücke, KEIN Code-Update in Modul 15 nötig.
 * Signatur: queryLocal(text, k?, options?) → Promise<Array<{label,score,anchorId}>>.
 * Async (Modul 03 lazy), Default k=5, hartcodierte Schwelle PROVIDER_MIN_MATCH=0.80.
 * Korpus zwei Pfade: options.corpus (Vorrang, Test-Brücken) ODER
 * registrierter Provider via setLocalCorpus(corpus|fn). Embedding via
 * SbkimEmbedding.embedQuery (NICHT embedPassage). Top-k-Cut nach Filter
 * (≥0.80) + Sort. Fünf Fehler-Pfade benannt (EmptyQueryError /
 * QueryTooLongError / InvalidKError / EmbeddingNotAvailableError /
 * InvalidCorpusError); leerer Korpus + alle-unter-Schwelle resolved
 * mit [] ohne Throw. KEIN Netz-Aufruf, KEINE Korpus-Persistierung in
 * Modul 04 (Endknoten-Pflicht). Spec-Quelle Karte 04 § Sub (c) +
 * Tafel-Spec-Pflege Mycel-Vision 2026-05-26.
 *
 * Bau 04.D `hybridMatch` (2026-06-20): Match-Zeit-LLM-Richter, additiv.
 * Hebt den explainMatchLLM-Keim vom Erklärer zum RICHTER über
 * Vorfilter-Kandidaten hoch (docs/HYBRID-MATCH-KONZEPT.md). Drei
 * Eigenschaften: (1) VORFILTER bleibt lokal/server-los (match/queryLocal
 * liefern Kandidaten; deren Default ist UNVERÄNDERT — kein Whitening-Flip,
 * kein Schwellen-Eingriff, das ist der separate Anisotropie-Hebel). (2)
 * RICHTER opt-in: provider-abstrahierter LLM-Pass urteilt pro Kandidat
 * (passt/passt-nicht + Begründung + Score). Anbieter Claude/Mistral/OpenAI/
 * lokal (HYBRID_PROVIDERS), EU-Default "mistral" für DSGVO-Knoten
 * (options.euOnly), BYOK (kein Key im Code). (3) FAIL-SOFT: leerer apiKey
 * (kein opt-in) ODER LLM nicht erreichbar/HTTP-/Schema-Fehler → kein Throw,
 * `available:false` + `fallbackCandidates` (Vorfilter gilt weiter). Zwei
 * sync Throws (InvalidCandidatesError / InvalidProviderError = Aufrufer-
 * Konfig); query.text-Vor-Checks reusen EmptyQueryError / QueryTooLongError.
 * BEZEUGUNG: Erfolg liefert ein signierbares `attestation`-Objekt
 * (kind/judgedAt/provider/region/model + verdicts), das der Aufrufer via
 * Modul 02 signiert in die Inbox legt — Modul 04 signiert NICHT selbst.
 * Bidirektional-Default STRENG ("both", Klaus 2026-06-20) via
 * bidirectionalVerdict-Helfer. KEIN PROTOCOL_VERSION-/DB_VERSION-Bump,
 * KEIN Netz-Default-Aufruf (Empfangsmodus — nur der bewusst konfigurierte
 * Richter-Call).
 */
(function (global) {
  "use strict";

  var EMBEDDING_DIM = 384;
  var PROVIDER_MIN_MATCH = 0.80;
  // Bau 04.A (2026-05-19): pro-Dimension-Schwelle aus § 0 (Brief 03).
  // Eine Schicht unter SCHICHT_MIN_MATCH ist erlaubt (typischer
  // Brücken-Anlass); 2+ Schichten unter SCHICHT_MIN_MATCH triggern
  // Apoptose im Aufrufer (siehe Karte 04 § Schwellen-Vertrag).
  var SCHICHT_MIN_MATCH = 0.60;
  // Bau 04.A: Read-Anker für Tests + Doku-Kommentar im _meta-Block.
  var MATCH_DIMENSIONS_LANES = ["fachlich", "prozess", "skalierung"];

  function makeError(name, message, cause) {
    var e = new Error(message);
    e.name = name;
    if (cause !== undefined) e.cause = cause;
    return e;
  }

  // Bau 04.A: Factory für den synchronen Wurf, wenn alle vier
  // Vektoren null sind. Aufrufer hätte vor dem Aufruf prüfen müssen
  // (siehe Karte 04 § Fehlerverhalten).
  function DimensionsAllNullError(message) {
    return makeError("DimensionsAllNullError", message);
  }

  // Bau 04.B: sync Throws aus explainMatchLLM-Vor-Check.
  function InvalidApiKeyError(message) {
    return makeError("InvalidApiKeyError", message);
  }
  function InvalidMatchResultError(message) {
    return makeError("InvalidMatchResultError", message);
  }

  // Bau 04.C: sync Throws aus queryLocal-Vor-Check. Factory-Stil
  // analog DimensionsAllNullError, deutsch-sprachige Messages.
  function EmptyQueryError(message) {
    return makeError("EmptyQueryError", message);
  }
  function QueryTooLongError(message) {
    return makeError("QueryTooLongError", message);
  }
  function InvalidKError(message) {
    return makeError("InvalidKError", message);
  }
  function EmbeddingNotAvailableError(message) {
    return makeError("EmbeddingNotAvailableError", message);
  }
  function InvalidCorpusError(message) {
    return makeError("InvalidCorpusError", message);
  }

  // Bau 04.B: modul-lokale Konstanten gespiegelt aus § 0 + Karte 04
  // § Stufe-B-Vertrag. Anthropic-API ist hartcodiert (kein Aufrufer-
  // Override; Endpoint-Wechsel wäre eigene Spec-Sitzung).
  var STUFE_B_DEFAULT_MODEL = "claude-sonnet-4";
  var STUFE_B_MAX_TOKENS = 1024;
  var ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
  var ANTHROPIC_API_VERSION = "2023-06-01";
  // Defensiv: Begrenzt LLM-Text-Output vor JSON-Parse (Memory-Schutz
  // bei API-Bugs / pathologischen Outputs).
  var LLM_MAX_OUTPUT_CHARS = 4096;
  var ALLOWED_CANDIDATE_SCOPES = ["lokal", "mailbox", "netz"];
  var ALLOWED_OVERRIDE_RECOMMENDATIONS = ["established", "established-with-bridge", "rejected"];
  var MAX_BEGRUENDUNG_LEN = 200;
  var MAX_ERKLAERUNG_LEN = 600;

  function describe(vec) {
    if (vec === null) return "null";
    if (vec === undefined) return "undefined";
    var ctor = vec && vec.constructor && vec.constructor.name;
    return ctor || typeof vec;
  }

  function assertVector(vec, paramName) {
    if (!(vec instanceof Float32Array)) {
      throw makeError(
        "InvalidVectorError",
        "Parameter '" + paramName + "' muss Float32Array sein, war: " + describe(vec) + ". " +
          "Modul 04 erwartet Vektoren von Modul 03 (Float32Array, Laenge " + EMBEDDING_DIM + ", L2-normalisiert).",
      );
    }
    if (vec.length !== EMBEDDING_DIM) {
      throw makeError(
        "ShapeMismatchError",
        "Parameter '" + paramName + "' hat Laenge " + vec.length + ", erwartet " + EMBEDDING_DIM + ". " +
          "Wahrscheinliche Ursache: Vektor aus anderer Modell-Version. Siehe INTERFACES.md §0 EMBEDDING_DIM.",
      );
    }
  }

  function match(queryVec, passageVec) {
    assertVector(queryVec, "queryVec");
    assertVector(passageVec, "passageVec");
    // Length equality is implied by both being EMBEDDING_DIM. We still
    // guard explicitly in case the constant ever drifts between modules.
    if (queryVec.length !== passageVec.length) {
      throw makeError(
        "ShapeMismatchError",
        "Vektor-Laengen unterscheiden sich: queryVec=" + queryVec.length + ", passageVec=" + passageVec.length + ".",
      );
    }
    var sum = 0;
    for (var i = 0; i < queryVec.length; i++) {
      sum += queryVec[i] * passageVec[i];
    }
    return sum;
  }

  function isAboveProviderThreshold(score) {
    return score >= PROVIDER_MIN_MATCH;
  }

  // --- Zentrierter (whitened-light) Cosinus — Verwandtschafts-Score (2026-06-28) -----
  // LEHRE docs/LEHRE-EMBEDDING-MATCH-KALIBRIERUNG.md: der ROHE e5-Cosinus hat einen
  // hohen Anisotropie-Boden (~0.82) — zwei UNVERWANDTE Domänen liegen schon nahe der
  // Andock-Schwelle 0.80. match()/PROVIDER_MIN_MATCH bleiben davon UNBERÜHRT: 0.80 ist
  // der ANDOCK-Boden (Identitäts-/Peer-Tor, Modul 05 isAboveProviderThreshold) und MUSS
  // niedrig bleiben, sonst bräche jeder Hub↔Endknoten-Handshake (Messung 2026-06-28:
  // alle Hub↔Endknoten roh 0.79–0.85, also über 0.80).
  //
  // relatedness() ist ADDITIV + DIAGNOSTISCH: es zieht den Mittelwert-Vektor (die
  // gemeinsame Anisotropie-Richtung) ab und re-normalisiert, dann Cosinus. ERST dann
  // heißt 0 "unverwandt": echte Verwandtschaft bleibt hoch (Schwestern ~1.0,
  // Essen/Trinken ~0.70), fremde Domänen fallen auf ~0/negativ. NUR Anzeige/Ranking —
  // es GATET NICHTS (kein Aufrufer im Handshake/Provider-Pfad).
  //
  // RELATEDNESS_CENTER (MEAN_VECTOR): einmal vorab gemittelter, L2-normierter e5-Vektor
  // über das Referenz-Korpus (7 Knoten-Domänen-Vektoren, 2026-06-28). v1, illustrativ —
  // sauberes Whitening braucht ein größeres Korpus (LEHRE-Caveat). Additiv ersetzbar,
  // ohne Vertrag/PROTOCOL_VERSION zu brechen.
  var RELATEDNESS_CENTER = new Float32Array([
    0.072849, -0.012892, -0.039543, -0.081636, 0.054174, -0.051481, 0.044509, 0.054632,
    0.020353, -0.012345, 0.036567, 0.028845, 0.063881, -0.035261, -0.035739, 0.043703,
    0.031231, -0.043608, -0.02488, -0.043558, 0.057558, -0.023875, -0.047727, -0.009844,
    0.067867, 0.055715, -0.052105, 0.015301, 0.043903, -0.062814, -0.072505, -0.02895,
    0.054828, -0.095637, 0.070388, 0.018328, -0.04905, -0.056507, 0.062878, -0.081007,
    0.000057, 0.026106, 0.054144, 0.067578, 0.023585, 0.076127, -0.022871, 0.031206,
    -0.034654, -0.04787, -0.043435, 0.072748, 0.016011, 0.02264, 0.027207, -0.058184,
    -0.064092, -0.052798, -0.06719, 0.008657, 0.053638, -0.025978, 0.038749, 0.021846,
    0.080548, 0.080472, 0.045793, 0.043234, -0.081523, -0.040388, -0.047951, 0.052269,
    0.004947, -0.036636, 0.006293, 0.026241, 0.019788, -0.053102, 0.021077, -0.028727,
    -0.079603, -0.048187, -0.05293, 0.04123, -0.043611, 0.060918, 0.059286, -0.041559,
    0.058735, -0.016282, 0.043083, 0.055459, -0.054073, -0.069448, -0.117343, -0.094852,
    -0.048264, 0.072785, 0.01705, -0.043272, 0.060332, -0.053966, 0.013333, -0.066647,
    -0.024604, 0.067778, 0.020262, -0.029783, 0.044672, -0.067088, -0.079189, 0.020705,
    0.093594, 0.05703, -0.069997, -0.057747, -0.019709, -0.0358, 0.050675, -0.078948,
    0.050898, -0.016881, -0.056561, -0.066327, -0.06222, -0.042978, 0.049824, 0.058311,
    -0.003419, 0.016235, 0.027214, 0.038062, 0.014969, 0.070877, 0.049555, 0.091244,
    -0.095579, 0.011485, 0.00583, -0.018634, -0.035399, 0.063875, -0.018628, 0.02873,
    0.054464, 0.053093, 0.081461, -0.022948, 0.039368, -0.038853, 0.04297, 0.000353,
    0.073839, 0.033601, 0.062314, -0.066126, -0.025088, -0.042459, 0.057128, 0.044785,
    -0.058858, -0.079299, -0.073565, -0.018761, -0.04378, -0.012193, 0.05483, 0.062567,
    -0.052515, -0.037688, -0.037511, 0.077538, -0.017955, 0.055511, -0.011111, 0.066638,
    -0.065233, 0.021416, 0.074515, 0.064143, -0.029699, -0.0428, -0.075233, -0.069012,
    -0.060089, -0.029225, -0.026447, 0.020839, 0.017684, -0.012196, -0.004805, 0.025714,
    -0.043651, -0.105895, -0.06195, 0.031401, -0.025594, 0.045441, 0.047552, 0.07498,
    -0.001347, -0.03711, 0.043219, 0.04583, 0.061667, 0.03075, -0.083391, 0.058037,
    -0.057771, 0.055301, 0.08062, -0.078809, -0.040182, 0.052638, -0.061573, -0.032796,
    0.020186, 0.060251, -0.057845, 0.035826, 0.023479, -0.037095, 0.051308, -0.097761,
    -0.060549, 0.065302, 0.03882, -0.058015, -0.043009, 0.047748, -0.078017, -0.041192,
    -0.054518, -0.071464, -0.063712, -0.073038, -0.028292, 0.037332, 0.022069, -0.040821,
    -0.018661, -0.001792, 0.04989, -0.067535, 0.052569, -0.043729, -0.047084, 0.046774,
    -0.062755, 0.062095, 0.031343, -0.049343, -0.070053, -0.040427, -0.023502, 0.0424,
    0.05178, 0.089305, -0.067341, 0.027265, 0.011272, -0.02918, 0.078241, 0.058312,
    0.038544, 0.040039, -0.024449, -0.01627, -0.05531, -0.034875, -0.03116, 0.024896,
    0.037855, -0.042199, -0.054072, -0.013583, 0.039508, 0.084721, -0.019442, -0.046265,
    0.015945, 0.043729, 0.062357, 0.018071, 0.061816, -0.011538, -0.04805, 0.067388,
    -0.023622, -0.047508, -0.054851, -0.060533, 0.03697, -0.044871, 0.101787, 0.048231,
    -0.009851, 0.063793, -0.030704, 0.047061, 0.012712, -0.092098, 0.025606, 0.036172,
    -0.05885, 0.026019, -0.000048, 0.003122, 0.010827, 0.042024, 0.041648, 0.08151,
    -0.050076, -0.024539, 0.076283, 0.042423, 0.00563, 0.04405, -0.085145, -0.041592,
    -0.069708, -0.053447, 0.005615, -0.058475, 0.054413, 0.060588, -0.051479, -0.024852,
    0.057925, 0.008081, 0.054944, -0.040432, -0.003496, 0.049985, -0.059906, -0.016247,
    -0.053834, 0.05571, -0.073306, -0.046085, 0.010823, 0.052388, -0.073711, 0.067009,
    -0.043092, -0.078313, 0.081544, -0.043436, -0.016913, 0.031273, 0.043937, -0.100875,
    0.045753, 0.057051, -0.037883, 0.044493, -0.040335, -0.023951, 0.074565, 0.04768,
    -0.042407, -0.023928, 0.03948, 0.072449, 0.062676, 0.020118, -0.027013, -0.016562,
    0.007436, -0.028368, 0.064212, 0.071613, -0.066955, 0.014177, -0.039106, -0.068354,
    -0.036767, 0.061028, -0.039993, -0.065251, 0.040611, 0.028804, 0.04467, 0.077607,
  ]);
  // Empirisch (Messung 2026-06-28, tools/match_baseline.mjs zentriert): echte Paare
  // ≥0.70, höchstes unverwandtes Paar ~ -0.04. 0.30 trennt mit großem Sicherheits-Rand.
  var RELATEDNESS_MIN = 0.30;

  // Zentrierter Cosinus zweier Domänen-Vektoren. Additiv, gatet nichts.
  function relatedness(aVec, bVec) {
    assertVector(aVec, "aVec");
    assertVector(bVec, "bVec");
    var a = new Float32Array(EMBEDDING_DIM);
    var b = new Float32Array(EMBEDDING_DIM);
    var na = 0, nb = 0;
    for (var i = 0; i < EMBEDDING_DIM; i++) {
      a[i] = aVec[i] - RELATEDNESS_CENTER[i];
      b[i] = bVec[i] - RELATEDNESS_CENTER[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    na = Math.sqrt(na);
    nb = Math.sqrt(nb);
    if (na === 0 || nb === 0) return 0; // entartet → unverwandt
    var dot = 0;
    for (var j = 0; j < EMBEDDING_DIM; j++) dot += (a[j] / na) * (b[j] / nb);
    return dot;
  }

  // Schwelle für "echt verwandt" auf dem zentrierten Score. Reine Anzeige-Hilfe.
  function isRelated(score) {
    return typeof score === "number" && isFinite(score) && score >= RELATEDNESS_MIN;
  }

  // Bau 04.A: null-safe wrapper um match(). Returns null, wenn eine
  // Seite null ist; sonst delegiert an match() mit voller Validierung
  // (InvalidVectorError / ShapeMismatchError werden hochgereicht).
  function cosineSafe(a, b) {
    if (a === null || b === null) return null;
    return match(a, b);
  }

  // Bau 04.A: matchDimensions — drei orthogonale Schichten + overall.
  // Berechnung gemäß Karte 04 § Drei-Schichten-Modell:
  //
  //   Lane 1 (queryCap × passageNeeds): A bietet → B sucht.
  //     Berechenbar wenn queryCap != null UND passageNeeds != null.
  //   Lane 2 (queryNeeds × passageCap): A sucht ← B bietet.
  //     Berechenbar wenn queryNeeds != null UND passageCap != null.
  //
  //   availableLanes = Anzahl berechenbarer Lanes ∈ {0, 1, 2}.
  //   Schicht-Score:
  //     beide Lanes berechenbar → Mittelwert der zwei Lane-Cosinus
  //     genau eine Lane → Single-Lane-Wert
  //     keine Lane → null
  //   In Stufe A sind alle drei Schichten (fachlich/prozess/
  //   skalierung) identisch dem Schicht-Score (Heuristik — die echte
  //   Differenzierung kommt in Stufe B / Bau 04.B via explainMatchLLM).
  //   overall = Mittelwert der nicht-null Schichten; in Stufe A also
  //   gleich dem Schicht-Score, weil alle drei identisch sind.
  //
  // Vor-Checks:
  //   alle vier null → DimensionsAllNullError SYNCHRON.
  //   eine Seite vollständig null (queryCap UND queryNeeds null ODER
  //     passageCap UND passageNeeds null) → Nur-Anbieter-Modus:
  //     alle Schichten null, availableLanes:0, kein Throw.
  function matchDimensions(queryCap, queryNeeds, passageCap, passageNeeds) {
    var qCapNull = queryCap === null;
    var qNeedsNull = queryNeeds === null;
    var pCapNull = passageCap === null;
    var pNeedsNull = passageNeeds === null;

    if (qCapNull && qNeedsNull && pCapNull && pNeedsNull) {
      throw DimensionsAllNullError(
        "matchDimensions: alle vier Vektoren null. Aufrufer haette vor dem Aufruf pruefen muessen " +
          "(siehe Karte 04 § Fehlerverhalten + § Drei-Schichten-Modell § Nur-Anbieter-Modus).",
      );
    }

    var qFullNull = qCapNull && qNeedsNull;
    var pFullNull = pCapNull && pNeedsNull;
    if (qFullNull || pFullNull) {
      // Nur-Anbieter-Modus: eine Seite hat gar keine Vektoren.
      // Aufrufer faellt auf match(domainVectorA, domainVectorB) zurueck.
      return {
        fachlich: null,
        prozess: null,
        skalierung: null,
        overall: null,
        availableLanes: 0,
        bruecke: null,
      };
    }

    // Lane-Berechnung. cosineSafe gibt null zurueck, wenn eine Seite null.
    var lane1 = cosineSafe(queryCap, passageNeeds);   // A bietet → B sucht
    var lane2 = cosineSafe(queryNeeds, passageCap);   // A sucht ← B bietet

    var lanes = [];
    if (lane1 !== null) lanes.push(lane1);
    if (lane2 !== null) lanes.push(lane2);
    var availableLanes = lanes.length;

    var schichtScore;
    if (availableLanes === 0) {
      schichtScore = null;
    } else if (availableLanes === 1) {
      schichtScore = lanes[0];
    } else {
      schichtScore = (lanes[0] + lanes[1]) / 2;
    }

    // Stufe-A-Heuristik: alle drei Schichten ergeben denselben
    // Lane-Cosinus (Karte 04 § Drei-Schichten-Modell § „Aufteilung in
    // drei Schichten"). Stufe B (Bau 04.B) liefert die echte
    // Differenzierung via LLM.
    var fachlich = schichtScore;
    var prozess = schichtScore;
    var skalierung = schichtScore;

    // overall = Mittelwert der nicht-null Schichten. Da in Stufe A alle
    // drei Schichten identisch sind, ist overall gleich dem
    // Schicht-Score (oder null, wenn keine Lane berechenbar war).
    var overall = schichtScore;

    return {
      fachlich: fachlich,
      prozess: prozess,
      skalierung: skalierung,
      overall: overall,
      availableLanes: availableLanes,
      bruecke: null,  // Stufe B (Bau 04.B) befüllt das via explainMatchLLM
    };
  }

  // ---- Bau 04.B: explainMatchLLM-Helper ----

  // Sync-Validierung des matchResult (MatchDimensionsResult-Form aus
  // Bau 04.A). Wirft InvalidMatchResultError mit konkreten Hinweis,
  // welches Feld fehlt/falsch ist. Aufrufer-Pflicht: matchResult aus
  // SbkimMatch.matchDimensions(...) ohne Veränderung durchreichen.
  function isNumberOrNull(v) {
    return v === null || (typeof v === "number" && isFinite(v));
  }
  function validateMatchResultShape(matchResult) {
    if (!matchResult || typeof matchResult !== "object" || Array.isArray(matchResult)) {
      throw InvalidMatchResultError(
        "matchResult muss ein Objekt sein (MatchDimensionsResult aus matchDimensions).",
      );
    }
    if (typeof matchResult.availableLanes !== "number" ||
        ![0, 1, 2].includes(matchResult.availableLanes)) {
      throw InvalidMatchResultError(
        "matchResult.availableLanes muss eine Zahl ∈ {0, 1, 2} sein.",
      );
    }
    var laneFields = ["fachlich", "prozess", "skalierung", "overall"];
    for (var i = 0; i < laneFields.length; i++) {
      var f = laneFields[i];
      if (!isNumberOrNull(matchResult[f])) {
        throw InvalidMatchResultError(
          "matchResult." + f + " muss Number oder null sein.",
        );
      }
    }
    // bruecke darf null sein oder ein BridgeProposal-Objekt
    // (Bau 04.A liefert immer null; Bau 04.B's eigener Output ist
    // kein matchResult-Input, sondern ExplainResult — daher hier
    // strikt: bruecke aus matchResult darf nur null sein).
    if (matchResult.bruecke !== null && (typeof matchResult.bruecke !== "object" || Array.isArray(matchResult.bruecke))) {
      throw InvalidMatchResultError(
        "matchResult.bruecke muss null oder ein BridgeProposal-Objekt sein.",
      );
    }
  }

  // Baut die User-Message für die Anthropic-API. Deutscher Prompt mit
  // den vier Schicht-Werten + overall, plus die strikten Anweisungen.
  // Schema-Block aus Karte 04 § Stufe-B-Vertrag wörtlich.
  function buildLlmPrompt(matchResult) {
    function fmt(v) { return v === null ? "null" : v.toFixed(4); }
    var lines = [];
    lines.push("Du bist Stufe B im SBKIM-Protokoll und sollst ein bidirektionales Match zwischen zwei Knoten erklären.");
    lines.push("");
    lines.push("Stufe-A-Resultat:");
    lines.push("- fachlich:   " + fmt(matchResult.fachlich));
    lines.push("- prozess:    " + fmt(matchResult.prozess));
    lines.push("- skalierung: " + fmt(matchResult.skalierung));
    lines.push("- overall:    " + fmt(matchResult.overall));
    lines.push("- availableLanes: " + matchResult.availableLanes);
    lines.push("");
    lines.push("Aufgabe: Differenziere die drei Schichten (fachlich/prozess/skalierung) inhaltlich. Stufe A");
    lines.push("liefert in jeder Schicht denselben Cosinus, weil Stufe A nur über demselben Embedding-Raum");
    lines.push("arbeitet. Du kannst die Schichten semantisch trennen.");
    lines.push("");
    lines.push("Wenn die Schichten zu unterschiedlich sind (z.B. fachlich hoch, prozess niedrig), schlage");
    lines.push("eine Brücke vor: was muss eine Persona zusätzlich bieten oder suchen, damit der Match passt?");
    lines.push("");
    lines.push("Antworte AUSSCHLIESSLICH mit JSON nach folgendem Schema. Kein Prosa-Text drumherum:");
    lines.push("{");
    lines.push("  \"schichten\": {");
    lines.push("    \"fachlich\":   { \"score\": <number in [-1,1]>, \"begruendung\": <string, max " + MAX_BEGRUENDUNG_LEN + " Zeichen> },");
    lines.push("    \"prozess\":    { \"score\": <number in [-1,1]>, \"begruendung\": <string, max " + MAX_BEGRUENDUNG_LEN + " Zeichen> },");
    lines.push("    \"skalierung\": { \"score\": <number in [-1,1]>, \"begruendung\": <string, max " + MAX_BEGRUENDUNG_LEN + " Zeichen> }");
    lines.push("  },");
    lines.push("  \"bruecke\": null | { \"needed\": <string>, \"lookingFor\": <string|null>, \"candidateScope\": \"lokal\"|\"mailbox\"|\"netz\" },");
    lines.push("  \"erklaerung\": <string, max " + MAX_ERKLAERUNG_LEN + " Zeichen>,");
    lines.push("  \"overrideRecommendation\": null | \"established\" | \"established-with-bridge\" | \"rejected\"");
    lines.push("}");
    return lines.join("\n");
  }

  // Sync-Validierung der LLM-Antwort gegen das Karte-04-Schema. Bei
  // Erfolg gibt {result: ExplainResult, reason: null} zurück; bei
  // Mismatch {result: null, reason: "konkreter Hinweis"}.
  // Korrigiert candidateScope:"netz" STILL auf "lokal" (Anti-
  // Missbrauch § 8; KEIN Throw, KEIN Logging — bewusst defensiv).
  function validateLlmResponseSchema(parsedJson, matchResult) {
    if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
      return { result: null, reason: "Antwort ist kein Objekt" };
    }
    var sch = parsedJson.schichten;
    if (!sch || typeof sch !== "object" || Array.isArray(sch)) {
      return { result: null, reason: "Feld 'schichten' fehlt oder ist kein Objekt" };
    }
    var lanes = ["fachlich", "prozess", "skalierung"];
    var normalizedSchichten = {};
    for (var i = 0; i < lanes.length; i++) {
      var lane = lanes[i];
      var laneObj = sch[lane];
      if (!laneObj || typeof laneObj !== "object" || Array.isArray(laneObj)) {
        return { result: null, reason: "schichten." + lane + " fehlt oder ist kein Objekt" };
      }
      var score = laneObj.score;
      if (typeof score !== "number" || !isFinite(score) || score < -1 || score > 1) {
        return { result: null, reason: "schichten." + lane + ".score nicht im Bereich [-1, 1]" };
      }
      var begruendung = laneObj.begruendung;
      if (typeof begruendung !== "string") {
        return { result: null, reason: "schichten." + lane + ".begruendung ist kein String" };
      }
      if (begruendung.length > MAX_BEGRUENDUNG_LEN) {
        return { result: null, reason: "schichten." + lane + ".begruendung > " + MAX_BEGRUENDUNG_LEN + " Zeichen" };
      }
      normalizedSchichten[lane] = { score: score, begruendung: begruendung };
    }

    // bruecke
    var bruecke = null;
    if (parsedJson.bruecke !== null && parsedJson.bruecke !== undefined) {
      var b = parsedJson.bruecke;
      if (typeof b !== "object" || Array.isArray(b)) {
        return { result: null, reason: "bruecke ist kein Objekt oder null" };
      }
      if (typeof b.needed !== "string" || b.needed.length === 0) {
        return { result: null, reason: "bruecke.needed muss nicht-leerer String sein" };
      }
      var lookingFor = b.lookingFor;
      if (lookingFor !== null && lookingFor !== undefined && typeof lookingFor !== "string") {
        return { result: null, reason: "bruecke.lookingFor muss null oder String sein" };
      }
      var candidateScope = b.candidateScope;
      if (typeof candidateScope !== "string" || ALLOWED_CANDIDATE_SCOPES.indexOf(candidateScope) === -1) {
        return { result: null, reason: "bruecke.candidateScope muss 'lokal'|'mailbox'|'netz' sein" };
      }
      // Anti-Missbrauch-Klausel § 8: 'netz' wird still auf 'lokal'
      // korrigiert. Entfällt erst mit Anker 10/11/12.
      if (candidateScope === "netz") {
        candidateScope = "lokal";
      }
      bruecke = {
        needed: b.needed,
        lookingFor: lookingFor === undefined ? null : lookingFor,
        candidateScope: candidateScope,
      };
    }

    // erklaerung
    if (typeof parsedJson.erklaerung !== "string") {
      return { result: null, reason: "erklaerung ist kein String" };
    }
    if (parsedJson.erklaerung.length > MAX_ERKLAERUNG_LEN) {
      return { result: null, reason: "erklaerung > " + MAX_ERKLAERUNG_LEN + " Zeichen" };
    }

    // overrideRecommendation
    var override = parsedJson.overrideRecommendation;
    if (override !== null && override !== undefined) {
      if (typeof override !== "string" || ALLOWED_OVERRIDE_RECOMMENDATIONS.indexOf(override) === -1) {
        return { result: null, reason: "overrideRecommendation muss null oder 'established'|'established-with-bridge'|'rejected' sein" };
      }
    } else {
      override = null;
    }

    return {
      result: {
        schichten: normalizedSchichten,
        bruecke: bruecke,
        erklaerung: parsedJson.erklaerung,
        overrideRecommendation: override,
      },
      reason: null,
    };
  }

  // Bau 04.B: explainMatchLLM — Stufe-B-LLM-Pass gegen Anthropic-API.
  // Fail-soft: nur zwei sync Throws (InvalidApiKeyError +
  // InvalidMatchResultError). Alle anderen Fehlerpfade resolved mit
  // ExplainResult{available:false, reason, fallbackScore}.
  async function explainMatchLLM(matchResult, apiKey, options) {
    // 1. Sync-Vor-Checks. KEIN Promise-Aufbau, vor Netz-Aufruf.
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw InvalidApiKeyError(
        "apiKey muss ein nicht-leerer String sein (Anthropic API-Key, opaque).",
      );
    }
    validateMatchResultShape(matchResult);

    // 2. Options-Defaults.
    var opts = options || {};
    var model = (typeof opts.model === "string" && opts.model.length > 0)
      ? opts.model
      : STUFE_B_DEFAULT_MODEL;
    var maxTokens = (typeof opts.maxTokens === "number" && opts.maxTokens > 0)
      ? opts.maxTokens
      : STUFE_B_MAX_TOKENS;
    var abortSignal = opts.abortSignal || null;

    var fallbackScore = matchResult.overall;

    function failSoft(reason) {
      return {
        available: false,
        reason: reason,
        fallbackScore: fallbackScore,
        model: model,
        tokensUsed: null,
      };
    }

    // 3. Prompt bauen.
    var prompt = buildLlmPrompt(matchResult);

    // 4. fetch() an Anthropic-API. AbortError NICHT abfangen, alle
    //    anderen Fehler fail-soft.
    var fetchOptions = {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    };
    if (abortSignal) fetchOptions.signal = abortSignal;

    var response;
    try {
      response = await fetch(ANTHROPIC_API_URL, fetchOptions);
    } catch (err) {
      // AbortError durchreichen (Standard-DOM-Verhalten).
      if (err && err.name === "AbortError") throw err;
      return failSoft("Netz nicht erreichbar (" + (err && err.message ? err.message : String(err)) + ")");
    }

    // 5. HTTP-Status. 429 sonder-getaggt für Rate-Limit-Hinweis.
    if (!response.ok) {
      if (response.status === 429) {
        return failSoft("API HTTP 429 (Rate-Limit) — Aufrufer-Drossel-Pflicht");
      }
      return failSoft("API HTTP " + response.status + " (" + (response.statusText || "?") + ")");
    }

    // 6. Body JSON parsen.
    var body;
    try {
      body = await response.json();
    } catch (err) {
      return failSoft("Antwort war kein valides JSON");
    }

    // 7. Anthropic-API-Form prüfen.
    if (!body || typeof body !== "object" ||
        !Array.isArray(body.content) || body.content.length === 0 ||
        typeof body.content[0].text !== "string") {
      return failSoft("Antwort entsprach nicht der Anthropic-API-Form");
    }

    // 8. LLM-Text auf LLM_MAX_OUTPUT_CHARS kürzen (Memory-Schutz).
    var llmText = body.content[0].text;
    if (llmText.length > LLM_MAX_OUTPUT_CHARS) {
      llmText = llmText.slice(0, LLM_MAX_OUTPUT_CHARS);
    }

    // 9. LLM-JSON parsen.
    var llmJson;
    try {
      llmJson = JSON.parse(llmText);
    } catch (err) {
      return failSoft("LLM-Output war kein valides JSON");
    }

    // 10. Schema-Validierung + Normalisierung (inkl. netz→lokal-Korrektur).
    var schemaCheck = validateLlmResponseSchema(llmJson, matchResult);
    if (schemaCheck.result === null) {
      return failSoft("Antwort entsprach nicht dem Schema: " + schemaCheck.reason);
    }

    // 11. tokensUsed aus response.usage.input_tokens + output_tokens.
    //     Fail-soft: null wenn API es nicht liefert.
    var tokensUsed = null;
    if (body.usage && typeof body.usage === "object") {
      var inT = body.usage.input_tokens;
      var outT = body.usage.output_tokens;
      if (typeof inT === "number" && typeof outT === "number" && isFinite(inT) && isFinite(outT)) {
        tokensUsed = inT + outT;
      }
    }

    // 12. Erfolg.
    return {
      available: true,
      schichten: schemaCheck.result.schichten,
      bruecke: schemaCheck.result.bruecke,
      erklaerung: schemaCheck.result.erklaerung,
      overrideRecommendation: schemaCheck.result.overrideRecommendation,
      fallbackScore: fallbackScore,
      model: model,
      tokensUsed: tokensUsed,
    };
  }

  // ---- Bau 04.C: queryLocal + Korpus-Provider ----
  //
  // Korpus-Quelle hat zwei Pfade (Karte 04 § Sub (c) § Datenquelle):
  //   1. options.corpus (Vorrang — typisch Test-Brücken, einmaliger Aufruf)
  //   2. registrierter Provider via setLocalCorpus(corpus|fn) (Endknoten-
  //      Andocker ruft das einmal in init() auf)
  // Wer keinen Korpus anbietet, kriegt `[]` zurück (kein Throw — leerer
  // Korpus ist legitim, Endknoten ohne Daten).
  var _localCorpusProvider = null;

  // Validiert ein Korpus-Array gegen das Schema { label, anchorId?,
  // passageVec:Float32Array(384) }. Sync, wirft InvalidCorpusError mit
  // konkretem Hinweis. Wird vor jedem queryLocal-Score-Loop gerufen.
  function validateCorpus(corpus) {
    if (!Array.isArray(corpus)) {
      throw InvalidCorpusError(
        "Korpus muss ein Array sein, war: " + describe(corpus) + ".",
      );
    }
    for (var i = 0; i < corpus.length; i++) {
      var item = corpus[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw InvalidCorpusError(
          "Korpus[" + i + "] muss ein Objekt sein, war: " + describe(item) + ".",
        );
      }
      if (typeof item.label !== "string" || item.label.length === 0) {
        throw InvalidCorpusError(
          "Korpus[" + i + "].label muss nicht-leerer String sein.",
        );
      }
      if (!(item.passageVec instanceof Float32Array)) {
        throw InvalidCorpusError(
          "Korpus[" + i + "].passageVec muss Float32Array sein, war: " + describe(item.passageVec) + ".",
        );
      }
      if (item.passageVec.length !== EMBEDDING_DIM) {
        throw InvalidCorpusError(
          "Korpus[" + i + "].passageVec hat Laenge " + item.passageVec.length +
            ", erwartet " + EMBEDDING_DIM + " (siehe INTERFACES.md §0 EMBEDDING_DIM).",
        );
      }
      // Bau 04.F: optionales `text`-Feld (roher Passage-Text für BM25). Nur
      // validiert, wenn vorhanden — Bestands-Korpora ohne `text` bleiben gültig
      // (BM25 fällt dann auf `label` zurück). Rein additiv, kein Vertrags-Bruch.
      if (item.text !== undefined && item.text !== null && typeof item.text !== "string") {
        throw InvalidCorpusError(
          "Korpus[" + i + "].text muss String sein (oder fehlen), war: " + describe(item.text) + ".",
        );
      }
    }
  }

  // setLocalCorpus akzeptiert ein Array (defensiv kopiert) ODER eine
  // Provider-Funktion (lazy lookup zur queryLocal-Zeit). null/undefined
  // entfernen den Provider. Idempotent — wer mehrmals ruft, überschreibt.
  function setLocalCorpus(corpusOrProvider) {
    if (corpusOrProvider === null || corpusOrProvider === undefined) {
      _localCorpusProvider = null;
      return;
    }
    if (typeof corpusOrProvider === "function") {
      _localCorpusProvider = corpusOrProvider;
      return;
    }
    if (Array.isArray(corpusOrProvider)) {
      // Defensive Kopie auf Array-Ebene (Items selbst bleiben Referenzen —
      // Float32Array kopieren wäre teuer und semantisch unnötig).
      var snapshot = Array.from(corpusOrProvider);
      _localCorpusProvider = function () { return snapshot; };
      return;
    }
    throw InvalidCorpusError(
      "setLocalCorpus erwartet Array, Funktion oder null, war: " + describe(corpusOrProvider) + ".",
    );
  }

  // ---- Bau 04.F: BM25 lexikalischer Vorfilter + Hybrid-Fusion (additiv) ----
  //
  // STRANG A1 (Brief 2026-07-01): Der rohe e5-Cosinus trennt Bedeutung nicht
  // zuverlässig (LEHRE-EMBEDDING-MATCH-KALIBRIERUNG: Anisotropie-Boden ~0.82).
  // BM25 ist ein lokaler, offline, deterministischer LEXIKALISCHER Score, der
  // exakte Wort-Treffer belohnt — komplementär zum Vektor-Score. Die Hybrid-
  // Fusion (Reciprocal Rank Fusion, RRF) hebt Treffer, die EIN Verfahren allein
  // verfehlt. Rein additiv:
  //   - `queryLocal` bleibt ohne `options.hybrid:true` BYTE-GLEICH (nur Cosinus).
  //   - PROVIDER_MIN_MATCH (0.80) bleibt Vektor-Pfad-Boden UND Andock-Riegel
  //     (Modul 05) — unberührt. Der Hybrid-Modus fügt einen zweiten, lexikalischen
  //     Kandidaten-Pfad hinzu (opt-in), er senkt keine Schwelle.
  //   - Kein Netz, kein LLM, kein Schlüssel — reine lokale Rechnung.

  var BM25_K1 = 1.5;   // Term-Frequenz-Sättigung (Standard-Literaturwert).
  var BM25_B = 0.75;   // Längen-Normalisierung (Standard-Literaturwert).
  var RRF_K = 60;      // Reciprocal-Rank-Fusion-Konstante (Cormack et al. 2009).

  // Tokenizer: unicode-bewusst, lowercase, Wort-/Zahl-Läufe. Server-los,
  // sprach-agnostisch (DE/EN/… ohne Stemming — bewusst simpel + deterministisch).
  function tokenizeBM25(text) {
    if (typeof text !== "string" || text.length === 0) return [];
    var m = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
    return m || [];
  }

  // bm25Scores(queryText, docTexts, options?) -> Array<number>
  // Reiner BM25-Score je Dokument (0 = kein gemeinsamer Term). Exportiert
  // für Panel-04-Messung (VERFAHREN-VERGLEICH) + Testbarkeit. Deterministisch.
  function bm25Scores(queryText, docTexts, options) {
    var opts = options || {};
    var k1 = (typeof opts.k1 === "number" && isFinite(opts.k1)) ? opts.k1 : BM25_K1;
    var b = (typeof opts.b === "number" && isFinite(opts.b)) ? opts.b : BM25_B;
    if (!Array.isArray(docTexts)) {
      throw InvalidCorpusError(
        "bm25Scores: 'docTexts' muss ein Array sein, war: " + describe(docTexts) + ".",
      );
    }
    var N = docTexts.length;
    if (N === 0) return [];
    // Dokument-Tokens + Längen + Dokument-Frequenzen (df).
    var docTokens = new Array(N);
    var docLen = new Array(N);
    var totalLen = 0;
    var df = Object.create(null); // document frequency je Term.
    for (var i = 0; i < N; i++) {
      var toks = tokenizeBM25(docTexts[i]);
      docTokens[i] = toks;
      docLen[i] = toks.length;
      totalLen += toks.length;
      var seen = Object.create(null);
      for (var t = 0; t < toks.length; t++) {
        var tok = toks[t];
        if (!seen[tok]) { seen[tok] = true; df[tok] = (df[tok] || 0) + 1; }
      }
    }
    var avgdl = totalLen / N || 1;
    var qTokens = tokenizeBM25(queryText);
    // Eindeutige Query-Terme (Wiederholung im Query zählt für BM25 nicht).
    var qUnique = [];
    var qSeen = Object.create(null);
    for (var qi = 0; qi < qTokens.length; qi++) {
      if (!qSeen[qTokens[qi]]) { qSeen[qTokens[qi]] = true; qUnique.push(qTokens[qi]); }
    }
    var scores = new Array(N);
    for (var d = 0; d < N; d++) {
      // Term-Frequenz im Dokument d.
      var tf = Object.create(null);
      var dt = docTokens[d];
      for (var j = 0; j < dt.length; j++) tf[dt[j]] = (tf[dt[j]] || 0) + 1;
      var score = 0;
      for (var u = 0; u < qUnique.length; u++) {
        var term = qUnique[u];
        var f = tf[term] || 0;
        if (f === 0) continue;
        var n = df[term] || 0;
        // Robertson-Sparck-Jones-IDF (mit +1 unter dem Log → nie negativ).
        var idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        var denom = f + k1 * (1 - b + b * (docLen[d] / avgdl));
        score += idf * (f * (k1 + 1)) / denom;
      }
      scores[d] = score;
    }
    return scores;
  }

  // Reciprocal Rank Fusion: verschmilzt zwei Rang-Listen ohne Score-
  // Normalisierung. Fehlt ein Rang (kein lexikalischer Treffer) → nur der
  // vorhandene Beitrag zählt. Rang ist 1-basiert (bester = 1).
  function rrfScore(vektorRank, lexRank) {
    var s = 0;
    if (vektorRank !== null && vektorRank !== undefined) s += 1 / (RRF_K + vektorRank);
    if (lexRank !== null && lexRank !== undefined) s += 1 / (RRF_K + lexRank);
    return s;
  }

  // queryLocal — lokale semantische Such-Funktion. Karte 04 § Sub (c).
  // Async, weil Modul 03 (Embedding) lazy ist (~5–15 s beim ersten
  // Aufruf, danach Cache-Hit). Reihenfolge:
  //   1. Sync-Vor-Checks (Empty/TooLong/InvalidK/EmbeddingNotAvailable).
  //   2. Korpus-Quelle ermitteln (options.corpus | _localCorpusProvider).
  //      InvalidCorpusError sync vor Embedding (Performance + klare
  //      Fehlerquelle).
  //   3. Embedding via SbkimEmbedding.embedQuery (NICHT embedPassage —
  //      Such-Texte sind Anfragen).
  //   4. match() pro Korpus-Eintrag, filter >= PROVIDER_MIN_MATCH, sort
  //      descending, slice(0, k).
  // Returns: leere Liste bei leerem Korpus oder allen Treffern unter
  // Schwelle (kein Throw — Aufrufer interpretiert leere Liste als
  // „keine lokalen Treffer").
  async function queryLocal(text, k, options) {
    // 1. Sync-Vor-Checks.
    if (typeof text !== "string" || text.length === 0) {
      throw EmptyQueryError(
        "queryLocal: 'text' muss nicht-leerer String sein, war: " + describe(text) + ".",
      );
    }
    if (text.length > LLM_MAX_OUTPUT_CHARS) {
      throw QueryTooLongError(
        "queryLocal: 'text' ist " + text.length + " Zeichen lang, max " + LLM_MAX_OUTPUT_CHARS +
          " (defensiv-Schutz gegen pathologische Inputs).",
      );
    }
    var effectiveK = (k === undefined || k === null) ? 5 : k;
    if (typeof effectiveK !== "number" || !isFinite(effectiveK) ||
        effectiveK < 1 || Math.floor(effectiveK) !== effectiveK) {
      throw InvalidKError(
        "queryLocal: 'k' muss Integer >= 1 sein, war: " + describe(k) + ".",
      );
    }
    var embedding = global.SbkimEmbedding;
    if (!embedding || typeof embedding.embedQuery !== "function") {
      throw EmbeddingNotAvailableError(
        "queryLocal: window.SbkimEmbedding.embedQuery fehlt — Modul 03 ist nicht geladen.",
      );
    }

    // 2. Korpus ermitteln (options.corpus hat Vorrang, dann Provider).
    var opts = options || {};
    var corpus;
    if (Object.prototype.hasOwnProperty.call(opts, "corpus") && opts.corpus !== undefined) {
      corpus = opts.corpus;
    } else if (typeof _localCorpusProvider === "function") {
      try {
        // `await`: Endknoten-Provider bauen den Korpus faul (async — Embeddings
        // via Modul 03). Ohne await landet ein Promise in validateCorpus →
        // "Korpus muss ein Array sein, war: Promise" (Live-Befund 2026-07-02).
        // Ein sync-Provider (Array-Snapshot) bleibt unberührt: `await array`
        // gibt das Array zurück.
        corpus = await _localCorpusProvider();
      } catch (err) {
        throw InvalidCorpusError(
          "queryLocal: _localCorpusProvider hat geworfen: " + (err && err.message ? err.message : String(err)),
        );
      }
    } else {
      corpus = [];
    }
    validateCorpus(corpus);

    // 3. Leerer Korpus → leere Liste, KEIN Embedding-Call, kein Throw.
    if (corpus.length === 0) return [];

    // 3b. Ausschluss-/Negations-Filter (Bau 04.I, OPT-IN). Ohne opts.exclude
    //     byte-gleich. opts.exclude===true → aus der Frage parsen; ein Objekt →
    //     als fertige Ausschluss-Menge nehmen. Filtert VOR dem Ranking über den
    //     Kandidaten-Inhalt (`text`). Riegel/Schwellen unberührt (nur Entfernen).
    if (opts.exclude) {
      var _ex = (opts.exclude === true) ? parseExclusions(text) : opts.exclude;
      if (_ex && (_ex.alcoholFree || (_ex.terms && _ex.terms.length))) {
        corpus = corpus.filter(function (it) {
          return !contentExcluded(
            (typeof it.text === "string" && it.text) ? it.text : it.label, _ex,
          );
        });
        if (corpus.length === 0) return [];
      }
    }

    // 4. Embedding. Modul-03-Fehler werden mit `cause` rethrown.
    var queryVec;
    try {
      queryVec = await embedding.embedQuery(text);
    } catch (err) {
      var failed = makeError(
        "EmbeddingFailedError",
        "queryLocal: SbkimEmbedding.embedQuery hat geworfen: " + (err && err.message ? err.message : String(err)),
        err,
      );
      throw failed;
    }
    if (!(queryVec instanceof Float32Array) || queryVec.length !== EMBEDDING_DIM) {
      throw makeError(
        "EmbeddingFailedError",
        "queryLocal: SbkimEmbedding.embedQuery lieferte unerwartete Form: " + describe(queryVec) +
          " (Laenge " + (queryVec && queryVec.length) + ", erwartet Float32Array(" + EMBEDDING_DIM + ")).",
      );
    }

    // 5a. Vektor-Score für JEDEN Korpus-Eintrag (Cosinus).
    var cos = new Array(corpus.length);
    for (var i = 0; i < corpus.length; i++) {
      cos[i] = match(queryVec, corpus[i].passageVec);
    }

    // 5b. DEFAULT-Pfad (kein opts.hybrid): byte-gleiches Verhalten wie Bau 04.C —
    //     Cosinus-Filter >= PROVIDER_MIN_MATCH, absteigend, Top-k.
    if (!opts.hybrid) {
      var scored = [];
      for (var s = 0; s < corpus.length; s++) {
        if (cos[s] >= PROVIDER_MIN_MATCH) {
          scored.push({
            label: corpus[s].label,
            score: cos[s],
            anchorId: (typeof corpus[s].anchorId === "string") ? corpus[s].anchorId : null,
          });
        }
      }
      scored.sort(function (a, b) { return b.score - a.score; });
      return scored.slice(0, effectiveK);
    }

    // 5c. HYBRID-Pfad (opt-in): BM25 (lexikalisch, lokal) + Vektor via RRF.
    //     Additiv — der Vektor-Pfad-Boden (PROVIDER_MIN_MATCH) bleibt eine
    //     Aufnahme-Bedingung, der lexikalische Treffer (bm25 > 0) ist die
    //     zweite. Kein Riegel wird gesenkt, keine Andock-Schwelle berührt.
    var docTexts = corpus.map(function (it) {
      return (typeof it.text === "string" && it.text.length > 0) ? it.text : it.label;
    });
    var bm = bm25Scores(text, docTexts);

    // Aufnahme-Menge: Vektor-Pfad (cos >= Boden) ODER lexikalischer Treffer.
    var included = [];
    for (var c = 0; c < corpus.length; c++) {
      if (cos[c] >= PROVIDER_MIN_MATCH || bm[c] > 0) {
        included.push({ idx: c, cos: cos[c], bm25: bm[c] });
      }
    }

    // Vektor-Rang (1-basiert, höchster Cosinus = Rang 1) über die Aufnahme-Menge.
    var byVec = included.slice().sort(function (a, b) { return b.cos - a.cos; });
    var vecRank = Object.create(null);
    for (var vr = 0; vr < byVec.length; vr++) vecRank[byVec[vr].idx] = vr + 1;

    // Lexikalischer Rang (nur Einträge mit bm25 > 0).
    var byLex = included.filter(function (e) { return e.bm25 > 0; })
      .sort(function (a, b) { return b.bm25 - a.bm25; });
    var lexRank = Object.create(null);
    for (var lr = 0; lr < byLex.length; lr++) lexRank[byLex[lr].idx] = lr + 1;

    // Fusion + Sortierung. `score` bleibt der Cosinus (unveränderte Semantik
    // für Bestands-Aufrufer); `bm25` + `fused` sind additive Felder.
    var hybridResult = included.map(function (e) {
      var lx = (lexRank[e.idx] !== undefined) ? lexRank[e.idx] : null;
      return {
        label: corpus[e.idx].label,
        score: e.cos,
        anchorId: (typeof corpus[e.idx].anchorId === "string") ? corpus[e.idx].anchorId : null,
        bm25: e.bm25,
        fused: rrfScore(vecRank[e.idx], lx),
      };
    });
    hybridResult.sort(function (a, b) {
      if (b.fused !== a.fused) return b.fused - a.fused;
      return b.score - a.score; // Tie-Break: höherer Cosinus zuerst.
    });
    return hybridResult.slice(0, effectiveK);
  }

  // ---- Bau 04.H: Query-Expansion / Multi-Query (Strang A4, additiv) --------
  //
  // STRANG A4 (Brief 2026-07-01): Eine Nutzer-Frage trifft oft nur EINE
  // Formulierung. Wer anders formuliert (Synonyme, Umschreibungen), verpasst
  // Treffer, die dieselbe BEDEUTUNG anders benennen. A4 erzeugt aus der Frage
  // mehrere Varianten, sucht mit JEDER und verschmilzt die Trefferlisten via
  // Reciprocal Rank Fusion (RRF) — dieselbe gratis/offline Fusion wie Bau 04.F,
  // nur über VARIANTEN statt über BM25/Vektor. Rein additiv:
  //   - Bestehende queryLocal/hybrid-Pfade UNVERÄNDERT (byte-gleich).
  //   - Kein Netz, kein LLM nötig (freie Synonym-Karte). Ein LLM-Generator wäre
  //     ein späterer opt-in-Aufsatz (BYOK) — die Fusion bliebe gleich.
  //   - PROVIDER_MIN_MATCH (0.80) + Andock-Riegel (Modul 05) unberührt: jede
  //     Teil-Suche nutzt denselben Boden; A4 senkt keine Schwelle.

  var MULTI_MAX_VARIANTS = 8;    // Deckel gegen Varianten-Explosion.

  // expandQuerySimple(text, options?) -> string[]  (Original zuerst, dedupe)
  // Freie, deterministische Varianten-Erzeugung über eine optionale Synonym-
  // Karte options.synonyms = { term(lowercase): [alt, ...] }. Ohne Karte:
  // nur [text] (kein Netz, kein LLM). Jede Ersetzung tauscht EIN Token gegen
  // EINE Alternative (kombinatorisch auf maxVariants gedeckelt).
  function expandQuerySimple(text, options) {
    var opts = options || {};
    if (typeof text !== "string" || text.trim().length === 0) {
      throw EmptyQueryError(
        "expandQuerySimple: 'text' muss nicht-leerer String sein, war: " + describe(text) + ".",
      );
    }
    var base = text.trim();
    var cap = (typeof opts.maxVariants === "number" && opts.maxVariants >= 1)
      ? Math.floor(opts.maxVariants) : MULTI_MAX_VARIANTS;
    var out = [base];
    var seen = Object.create(null);
    seen[base.toLowerCase()] = true;
    var syn = (opts.synonyms && typeof opts.synonyms === "object") ? opts.synonyms : null;
    if (syn) {
      var tokens = base.split(/\s+/);
      for (var i = 0; i < tokens.length && out.length < cap; i++) {
        var key = tokens[i].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
        var alts = syn[key];
        if (!Array.isArray(alts)) continue;
        for (var a = 0; a < alts.length && out.length < cap; a++) {
          if (typeof alts[a] !== "string" || alts[a].trim().length === 0) continue;
          var repl = tokens.slice();
          repl[i] = alts[a].trim();
          var variant = repl.join(" ");
          var low = variant.toLowerCase();
          if (!seen[low]) { seen[low] = true; out.push(variant); }
        }
      }
    }
    return out;
  }

  // queryLocalMulti(queries, k, options?)
  //   -> Promise<Array<{label, score, anchorId, fused, matchedQueries}>>
  // Sucht mit JEDER Query-Variante (queryLocal, options durchgereicht — inkl.
  // hybrid) und verschmilzt die Rang-Listen via RRF. `score` = bester Cosinus
  // des Treffers über alle Varianten; `matchedQueries` = wie viele Varianten
  // ihn fanden. Deterministisch, fail-soft (eine werfende Variante wird
  // übersprungen, die Suche bricht nicht ab).
  async function queryLocalMulti(queries, k, options) {
    if (!Array.isArray(queries) || queries.length === 0) {
      throw EmptyQueryError(
        "queryLocalMulti: 'queries' muss ein nicht-leeres Array sein, war: " + describe(queries) + ".",
      );
    }
    var vars = [];
    var seenQ = Object.create(null);
    for (var i = 0; i < queries.length; i++) {
      var q = queries[i];
      if (typeof q !== "string" || q.trim().length === 0) continue;
      var qn = q.trim();
      if (!seenQ[qn.toLowerCase()]) { seenQ[qn.toLowerCase()] = true; vars.push(qn); }
    }
    if (vars.length === 0) {
      throw EmptyQueryError("queryLocalMulti: keine nicht-leere Query-Variante.");
    }
    var effectiveK = (k === undefined || k === null) ? 5 : k;
    if (typeof effectiveK !== "number" || !isFinite(effectiveK) ||
        effectiveK < 1 || Math.floor(effectiveK) !== effectiveK) {
      throw InvalidKError(
        "queryLocalMulti: 'k' muss Integer >= 1 sein, war: " + describe(k) + ".",
      );
    }
    var opts = options || {};
    var perK = (typeof opts.perQueryK === "number" && opts.perQueryK >= 1)
      ? Math.floor(opts.perQueryK) : Math.max(effectiveK * 3, 10);

    var fused = Object.create(null); // key -> Treffer mit akkumuliertem RRF
    for (var v = 0; v < vars.length; v++) {
      var list;
      try {
        list = await queryLocal(vars[v], perK, opts);
      } catch (_e) {
        continue; // Variante übersprungen, Suche läuft weiter.
      }
      for (var r = 0; r < list.length; r++) {
        var it = list[r];
        var idKey = (typeof it.anchorId === "string" && it.anchorId)
          ? ("id:" + it.anchorId) : ("lbl:" + it.label);
        var contrib = 1 / (RRF_K + (r + 1));
        if (!fused[idKey]) {
          fused[idKey] = {
            label: it.label,
            score: it.score,
            anchorId: (typeof it.anchorId === "string") ? it.anchorId : null,
            fused: contrib,
            matchedQueries: 1,
          };
        } else {
          fused[idKey].fused += contrib;
          fused[idKey].matchedQueries += 1;
          if (it.score > fused[idKey].score) fused[idKey].score = it.score;
        }
      }
    }
    var merged = Object.keys(fused).map(function (kk) { return fused[kk]; });
    merged.sort(function (a, b) {
      if (b.fused !== a.fused) return b.fused - a.fused;
      return b.score - a.score;
    });
    return merged.slice(0, effectiveK);
  }

  // ---- Bau 04.I: Ausschluss-/Negations-Filter (Strang A4, deterministisch, additiv) ----
  //
  // PROBLEM (Klaus 2026-07-10, Live-Befund): Semantische Ähnlichkeit rankt einen
  // Erdbeer-Drink NAH an „Erdbeere" — auch wenn der Nutzer Erdbeeren AUSSCHLIESSEN
  // will („ohne Erdbeeren", Allergie). Und „alkoholfrei" nennt keine konkrete Zutat,
  // sondern eine KLASSE — der Cosinus sieht den Wodka in der Zutatenliste nicht als
  // Ausschlussgrund. Ähnlichkeit ist kein Constraint. Dieser Filter IST der
  // Constraint: er liest Verneinungen aus der Frage und wirft Kandidaten raus, deren
  // INHALT (Titel + Zutaten + Schritte, im Korpus-Feld `text`) den verbotenen
  // Begriff trägt.
  //
  // EIGENSCHAFTEN:
  //   - Rein deterministisch, offline, KEIN LLM, KEIN Netz.
  //   - OPT-IN: queryLocal(text,k,{exclude:true}) parst die Frage selbst;
  //     {exclude:<parseExclusions-Ergebnis>} nimmt eine fertige Ausschluss-Menge.
  //     OHNE opts.exclude bleibt queryLocal BYTE-GLEICH (kein Verhaltenswechsel).
  //   - Filtert VOR dem Ranking → gilt für Default- UND Hybrid-Pfad gleichermaßen.
  //   - PROVIDER_MIN_MATCH + Andock-Riegel (Modul 05) UNBERÜHRT: der Filter ENTFERNT
  //     nur Kandidaten, er senkt keine Schwelle und hebt keine an.

  // Alkohol-Lexikon (normalisiert, ae/oe/ue/ss): „alkoholfrei" nennt die Klasse,
  // nicht die Zutat — deshalb schlägt der Filter bei JEDEM dieser Begriffe im Inhalt an.
  var ALCOHOL_TERMS = [
    "alkohol", "wodka", "vodka", "rum", "gin", "whisky", "whiskey", "tequila",
    "brandy", "cognac", "likoer", "liqueur", "wein", "rotwein", "weisswein",
    "sekt", "prosecco", "champagner", "aperol", "campari", "schnaps", "bier",
    "cointreau", "amaretto", "baileys", "kahlua", "malibu", "bacardi",
    "jaegermeister", "absinth", "portwein", "sherry", "wermut", "vermouth",
    "curacao", "ouzo", "sambuca", "limoncello", "cachaca", "pastis",
  ];

  function _exclEscapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  // Wort-Grenzen fürs Alkohol-Lexikon (kurze Wörter wie „gin"/„rum" sonst falsch-
  // positiv in „ginger"/„krume"); triviale Plural-Endung -s/-e erlaubt.
  var ALCOHOL_RE = new RegExp(
    "\\b(" + ALCOHOL_TERMS.map(_exclEscapeRe).join("|") + ")(e|s)?\\b",
  );

  // Verbinder halten den Ausschluss-Modus offen für den nächsten Begriff
  // („ohne Erdbeeren UND Himbeeren").
  var EXCL_CONNECT = { "und": 1, "oder": 1, "and": 1, "or": 1 };
  // Artikel/Füllwörter werden übersprungen, beenden aber den Modus nicht.
  var EXCL_SKIP = {
    "die": 1, "der": 1, "das": 1, "den": 1, "dem": 1, "ein": 1, "eine": 1,
    "einen": 1, "einem": 1, "einer": 1, "viel": 1, "jegliche": 1,
    "jeglichen": 1, "jeglicher": 1, "any": 1, "the": 1, "a": 1, "of": 1,
    "added": 1, "bitte": 1, "gerne": 1, "gern": 1,
  };
  // Positive Kontext-Wörter beenden den Ausschluss-Modus („ohne X, aber MIT Y").
  var EXCL_STOP = {
    "mit": 1, "aber": 1, "sondern": 1, "jedoch": 1, "dafuer": 1, "dazu": 1,
    "with": 1, "but": 1, "plus": 1,
  };

  function _normDe(s) {
    return String(s == null ? "" : s).toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
  }
  // Grobes Stemming (Plural/Flexion) — nur wenn der Rest lang genug bleibt, sonst
  // ganzes Wort. So trifft „erdbeeren" (Frage) den Inhalt „Erdbeere".
  function _exclStem(w) {
    // Englisch -ies -> Stamm (strawberries -> strawberr); dann simple Plural-/
    // Flexions-Endung. KEIN -er strippen (dt. Nomen: Zucker/Wasser/Butter).
    var s = w.replace(/ies$/, "").replace(/(en|e|n|s)$/, "");
    return (s.length >= 4) ? s : w;
  }

  // parseExclusions(text) -> { terms: string[](Stämme), alcoholFree: boolean }
  // Liest Verneinungen aus der Frage. Erkennt: „ohne X", „kein(e) X", „frei von X",
  // „allergisch gegen X", „X-frei" (zuckerfrei/laktosefrei/…), „without X", „no X",
  // und die Alkohol-Klasse („alkoholfrei", „ohne Alkohol", „alcohol-free",
  // „non-alcoholic", „virgin"). Mehrere Begriffe („ohne Erdbeeren und Himbeeren")
  // werden alle erfasst.
  function parseExclusions(text) {
    var res = { terms: [], alcoholFree: false };
    if (typeof text !== "string" || text.trim().length === 0) return res;
    var t = _normDe(text);
    if (/alkoholfrei|alkohol[\s-]?frei|ohne\s+alkohol|alcohol[\s-]?free|non[\s-]?alcoholic|\bvirgin\b/.test(t)) {
      res.alcoholFree = true;
    }
    var toks = t.split(/[^a-z0-9]+/).filter(Boolean);
    var KEIN = /^kein(e|en|em|er|es)?$/;
    var TRIG = { "ohne": 1, "without": 1, "no": 1 };
    var seen = Object.create(null);
    function add(w) {
      if (w === "alkohol") { res.alcoholFree = true; return; }
      var s = _exclStem(w);
      if (s.length >= 3 && !seen[s]) { seen[s] = 1; res.terms.push(s); }
    }
    // mode: false | "open" (nächstes Inhalts-Wort ausschließen) | "chain"
    // (gerade eins genommen; nur ein Verbinder öffnet den nächsten Begriff).
    var mode = false, pendingAllerg = false, pendingFrei = false;
    for (var i = 0; i < toks.length; i++) {
      var w = toks[i];
      var mf = /^(.{4,})frei$/.exec(w); // zuckerfrei / laktosefrei / alkoholfrei …
      if (mf) {
        if (mf[1] === "alkohol" || mf[1] === "alko") res.alcoholFree = true;
        else add(mf[1]);
        mode = false; continue;
      }
      if (pendingAllerg) { pendingAllerg = false; if (w === "gegen") { mode = "open"; continue; } }
      if (/^allerg/.test(w)) { pendingAllerg = true; continue; }
      if (pendingFrei) { pendingFrei = false; if (w === "von") { mode = "open"; continue; } }
      if (w === "frei") { pendingFrei = true; continue; }
      if (TRIG[w] || KEIN.test(w)) { mode = "open"; continue; }
      if (!mode) continue;
      if (EXCL_STOP[w]) { mode = false; continue; }
      if (EXCL_CONNECT[w]) { mode = "open"; continue; }
      if (EXCL_SKIP[w]) continue;            // Artikel überspringen, Modus bleibt
      if (mode === "chain") { mode = false; continue; } // Verb/Folge-Wort → Ende
      add(w);
      mode = "chain";
    }
    return res;
  }

  // contentExcluded(contentText, exclusions) -> boolean
  // true, wenn der Inhalt einen ausgeschlossenen Begriff trägt (Alkohol-Klasse per
  // Wort-Grenze, freie Begriffe per Teilstring auf dem Stamm).
  function contentExcluded(content, ex) {
    if (!ex) return false;
    var c = _normDe(content);
    if (ex.alcoholFree && ALCOHOL_RE.test(c)) return true;
    var terms = ex.terms || [];
    for (var i = 0; i < terms.length; i++) {
      if (terms[i] && c.indexOf(terms[i]) >= 0) return true;
    }
    return false;
  }

  // applyExclusions(candidates, exclusions, getText?) -> gefilterte Kopie
  // Allgemeiner Nachfilter für beliebige Kandidaten-Listen (Widget-Treffer,
  // Antwort-Kandidaten). getText(cand,i) liefert den prüfbaren Inhalt; Default:
  // cand.text || cand.label. Fail-soft: ohne Ausschlüsse unveränderte Kopie.
  function applyExclusions(candidates, exclusions, getText) {
    if (!Array.isArray(candidates)) return candidates;
    if (!exclusions || (!exclusions.alcoholFree &&
        (!exclusions.terms || exclusions.terms.length === 0))) {
      return candidates.slice();
    }
    var out = [];
    for (var i = 0; i < candidates.length; i++) {
      var content = "";
      try {
        content = getText ? getText(candidates[i], i)
          : (candidates[i] && (candidates[i].text || candidates[i].label)) || "";
      } catch (_e) { content = ""; }
      if (!contentExcluded(content, exclusions)) out.push(candidates[i]);
    }
    return out;
  }

  // ---- Bau 04.D: Hybrid-Match — Match-Zeit-LLM-Richter (additiv) ----
  //
  // Hebt den vorhandenen Stufe-B-Keim (explainMatchLLM, Erklärer) zum
  // RICHTER über Vorfilter-Kandidaten hoch. Drei Eigenschaften aus
  // docs/HYBRID-MATCH-KONZEPT.md:
  //   1. VORFILTER bleibt lokal + server-los (match() / queryLocal) und
  //      liefert die Kandidaten. Hybrid ändert deren Default NICHT.
  //   2. RICHTER (neu, opt-in): ein provider-abstrahierter LLM-Pass
  //      urteilt über jeden Kandidaten (passt / passt-nicht + Begründung
  //      + Score). Anbieter wählbar (Claude / Mistral / OpenAI / lokal);
  //      EU-Default für DSGVO-Knoten; BYOK (kein hartcodierter Key).
  //   3. FAIL-SOFT: LLM nicht erreichbar ODER kein opt-in (leerer apiKey)
  //      → Vorfilter-Ergebnis gilt weiter, KEIN Throw.
  // Plus BEZEUGUNG: ein signierbares `attestation`-Objekt (Score +
  // Begründung + Anbieter-Marker + Datum), das der Aufrufer in die Inbox
  // legen kann.

  var HYBRID_DEFAULT_MAX_TOKENS = 1024;
  // EU-Default für DSGVO-Knoten (Konzept § Bidirektional / EU-Anbieter).
  var HYBRID_EU_DEFAULT_PROVIDER = "mistral";
  var HYBRID_US_DEFAULT_PROVIDER = "claude";
  // Defensiv: Begrenzt die Kandidaten-Liste pro Richter-Call (Prompt-
  // Größe + Token-Schutz). Aufrufer schneidet die Vorfilter-Finalisten
  // vorher zu — der Richter urteilt über eine kleine Spitzenmenge.
  var HYBRID_MAX_CANDIDATES = 20;
  var MAX_VERDICT_BEGRUENDUNG_LEN = 200;
  // Klaus-Festlegung 2026-06-20 (Bau 04.D): Default-Bidirektional-Regel
  // ist STRENG — ein Paar-Match gilt erst als etabliert, wenn BEIDE
  // Seiten zustimmen. Per Parameter auf "one" (großzügig) stellbar.
  var HYBRID_BIDIRECTIONAL_DEFAULT = "both";

  // Bau 04.D: sync Throws aus hybridMatch-Vor-Check (Aufrufer-Konfig).
  function InvalidCandidatesError(message) {
    return makeError("InvalidCandidatesError", message);
  }
  function InvalidProviderError(message) {
    return makeError("InvalidProviderError", message);
  }

  // Anbieter-Abstraktion. Jeder Adapter weiß, wie er (a) den fetch-Request
  // baut, (b) den Antwort-Text extrahiert, (c) die Token-Zahl liest.
  // Anthropic spricht /v1/messages; Mistral / OpenAI / lokal sprechen das
  // OpenAI-kompatible /chat/completions. KEIN Key hartcodiert — der Key
  // kommt pro Call vom Aufrufer (BYOK).
  function openAiCompatBuild(o) {
    return {
      url: o.url,
      init: {
        method: "POST",
        headers: {
          "authorization": "Bearer " + o.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: o.model,
          max_tokens: o.maxTokens,
          messages: [{ role: "user", content: o.prompt }],
        }),
      },
    };
  }
  function openAiCompatExtractText(body) {
    if (body && Array.isArray(body.choices) && body.choices[0] &&
        body.choices[0].message && typeof body.choices[0].message.content === "string") {
      return body.choices[0].message.content;
    }
    return null;
  }
  function openAiCompatExtractTokens(body) {
    if (body && body.usage && typeof body.usage === "object") {
      var p = body.usage.prompt_tokens, c = body.usage.completion_tokens;
      if (typeof p === "number" && typeof c === "number" && isFinite(p) && isFinite(c)) return p + c;
      if (typeof body.usage.total_tokens === "number" && isFinite(body.usage.total_tokens)) return body.usage.total_tokens;
    }
    return null;
  }

  // Gemini (Google generativelanguage). Eigenes Request-Format (x-goog-api-key,
  // contents/parts, generateContent — Modell steckt im URL-Pfad). Modellnamen
  // ändern sich (alte Namen -> HTTP 404), darum dynamische Auflösung aus dem Konto.
  function geminiBuild(o) {
    var base = String(o.url).replace(/\/+$/, "");
    return {
      url: base + "/" + o.model + ":generateContent",
      init: {
        method: "POST",
        headers: {
          "x-goog-api-key": o.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: o.prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: o.maxTokens },
        }),
      },
    };
  }
  function geminiExtractText(body) {
    if (body && Array.isArray(body.candidates) && body.candidates[0] &&
        body.candidates[0].content && Array.isArray(body.candidates[0].content.parts) &&
        body.candidates[0].content.parts[0] &&
        typeof body.candidates[0].content.parts[0].text === "string") {
      return body.candidates[0].content.parts[0].text;
    }
    return null;
  }
  function geminiExtractTokens(body) {
    if (body && body.usageMetadata &&
        typeof body.usageMetadata.totalTokenCount === "number" &&
        isFinite(body.usageMetadata.totalTokenCount)) {
      return body.usageMetadata.totalTokenCount;
    }
    return null;
  }
  // Fragt EINMAL die Modell-Liste des Kontos ab und nimmt ein verfügbares
  // "flash"-Modell mit generateContent. Überlebt Modell-Wechsel; fester Fallback.
  var _geminiModelCache = null;
  async function geminiResolveModel(apiKey, baseUrl) {
    if (_geminiModelCache) return _geminiModelCache;
    try {
      var r = await fetch(String(baseUrl).replace(/\/+$/, ""), {
        headers: { "x-goog-api-key": apiKey },
      });
      if (r.ok) {
        var d = await r.json();
        var ms = (d && Array.isArray(d.models) ? d.models : []).filter(function (m) {
          return m && Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.indexOf("generateContent") !== -1;
        });
        var nm = function (m) { return String(m.name).replace(/^models\//, ""); };
        var pick = null, i;
        for (i = 0; i < ms.length; i++) {
          if (/flash/i.test(ms[i].name) && !/(thinking|exp|vision|image|tts|live|embedding)/i.test(ms[i].name)) { pick = ms[i]; break; }
        }
        if (!pick) for (i = 0; i < ms.length; i++) { if (/flash/i.test(ms[i].name)) { pick = ms[i]; break; } }
        if (!pick && ms.length) pick = ms[0];
        if (pick) { _geminiModelCache = nm(pick); return _geminiModelCache; }
      }
    } catch (e) { /* offline/CORS -> Fallback */ }
    _geminiModelCache = "gemini-flash-latest";
    return _geminiModelCache;
  }

  var HYBRID_PROVIDERS = {
    claude: {
      label: "Claude (Anthropic)",
      region: "us",
      defaultModel: STUFE_B_DEFAULT_MODEL,
      defaultUrl: ANTHROPIC_API_URL,
      buildRequest: function (o) {
        return {
          url: o.url,
          init: {
            method: "POST",
            headers: {
              "x-api-key": o.apiKey,
              "anthropic-dangerous-direct-browser-access": "true",
              "anthropic-version": ANTHROPIC_API_VERSION,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: o.model,
              max_tokens: o.maxTokens,
              messages: [{ role: "user", content: o.prompt }],
            }),
          },
        };
      },
      extractText: function (body) {
        if (body && Array.isArray(body.content) && body.content[0] &&
            typeof body.content[0].text === "string") {
          return body.content[0].text;
        }
        return null;
      },
      extractTokens: function (body) {
        if (body && body.usage && typeof body.usage === "object") {
          var inT = body.usage.input_tokens, outT = body.usage.output_tokens;
          if (typeof inT === "number" && typeof outT === "number" && isFinite(inT) && isFinite(outT)) {
            return inT + outT;
          }
        }
        return null;
      },
    },
    mistral: {
      label: "Mistral (EU)",
      region: "eu",
      defaultModel: "mistral-small-latest",
      defaultUrl: "https://api.mistral.ai/v1/chat/completions",
      buildRequest: openAiCompatBuild,
      extractText: openAiCompatExtractText,
      extractTokens: openAiCompatExtractTokens,
    },
    openai: {
      label: "OpenAI",
      region: "us",
      defaultModel: "gpt-4o-mini",
      defaultUrl: "https://api.openai.com/v1/chat/completions",
      buildRequest: openAiCompatBuild,
      extractText: openAiCompatExtractText,
      extractTokens: openAiCompatExtractTokens,
    },
    gemini: {
      label: "Gemini (Google, Gratis-Stufe)",
      region: "us",
      defaultModel: "gemini-flash-latest",
      defaultUrl: "https://generativelanguage.googleapis.com/v1beta/models",
      resolveModel: geminiResolveModel,
      buildRequest: geminiBuild,
      extractText: geminiExtractText,
      extractTokens: geminiExtractTokens,
    },
    openrouter: {
      label: "OpenRouter (viele Modelle, auch gratis)",
      region: "us",
      defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
      defaultUrl: "https://openrouter.ai/api/v1/chat/completions",
      buildRequest: openAiCompatBuild,
      extractText: openAiCompatExtractText,
      extractTokens: openAiCompatExtractTokens,
    },
    local: {
      label: "Lokal / selbst-gehostet (OpenAI-kompatibel)",
      region: "local",
      defaultModel: "local-model",
      defaultUrl: null,   // Aufrufer MUSS options.endpoint setzen
      buildRequest: openAiCompatBuild,
      extractText: openAiCompatExtractText,
      extractTokens: openAiCompatExtractTokens,
    },
  };

  // Wählt den Default-Anbieter. DSGVO-Knoten (options.euOnly === true,
  // typisch für europäische Knoten wie BLP) bekommen den EU-Anbieter;
  // sonst Claude. Aufrufer überschreibt jederzeit via options.provider.
  function pickJudgeProvider(options) {
    var opts = options || {};
    if (typeof opts.provider === "string" && opts.provider.length > 0) {
      if (!HYBRID_PROVIDERS[opts.provider]) {
        throw InvalidProviderError(
          "Unbekannter Anbieter '" + opts.provider + "'. Erlaubt: " +
            Object.keys(HYBRID_PROVIDERS).join(" / ") + ".",
        );
      }
      return opts.provider;
    }
    return opts.euOnly === true ? HYBRID_EU_DEFAULT_PROVIDER : HYBRID_US_DEFAULT_PROVIDER;
  }

  // Sync-Validierung der Kandidaten-Liste (Vorfilter-Finalisten). Jeder
  // Kandidat braucht label (anzeigbar) + text (was der Richter inhaltlich
  // beurteilt). cosine/anchorId optional.
  function validateCandidates(candidates) {
    if (!Array.isArray(candidates)) {
      throw InvalidCandidatesError(
        "candidates muss ein Array sein, war: " + describe(candidates) + ".",
      );
    }
    if (candidates.length === 0) {
      throw InvalidCandidatesError(
        "candidates ist leer — der Vorfilter muss mindestens einen Kandidaten liefern, " +
          "bevor der Richter urteilt (sonst gibt es nichts zu beurteilen).",
      );
    }
    if (candidates.length > HYBRID_MAX_CANDIDATES) {
      throw InvalidCandidatesError(
        "candidates hat " + candidates.length + " Einträge, max " + HYBRID_MAX_CANDIDATES +
          ". Aufrufer schneidet die Vorfilter-Finalisten vorher zu (Top-k).",
      );
    }
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!c || typeof c !== "object" || Array.isArray(c)) {
        throw InvalidCandidatesError(
          "candidates[" + i + "] muss ein Objekt sein, war: " + describe(c) + ".",
        );
      }
      if (typeof c.label !== "string" || c.label.length === 0) {
        throw InvalidCandidatesError(
          "candidates[" + i + "].label muss nicht-leerer String sein.",
        );
      }
      if (typeof c.text !== "string" || c.text.length === 0) {
        throw InvalidCandidatesError(
          "candidates[" + i + "].text muss nicht-leerer String sein (der Richter " +
            "beurteilt den Bedeutungs-Text, nicht nur das Label).",
        );
      }
    }
  }

  // Baut den Richter-Prompt. Deutscher Prompt, nummerierte Kandidaten,
  // JSON-only-Output mit verdicts-Array in derselben Reihenfolge.
  function buildJudgePrompt(queryText, queryLabel, candidates) {
    var lines = [];
    lines.push("Du bist der Match-Richter im SBKIM-Protokoll. Ein Knoten sucht semantische");
    lines.push("Partner. Ein lokaler Vorfilter (Embedding-Cosinus) hat bereits grob gefiltert;");
    lines.push("deine Aufgabe ist das ECHTE Bedeutungs-Urteil über jeden Kandidaten — auch aus");
    lines.push("unsauberem Text. Urteile streng nach inhaltlicher Passung, nicht nach Sprach-");
    lines.push("Oberfläche.");
    lines.push("");
    lines.push("Suchender Knoten" + (queryLabel ? " (" + queryLabel + ")" : "") + " sucht:");
    lines.push(queryText);
    lines.push("");
    lines.push("Kandidaten:");
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var cosNote = (typeof c.cosine === "number" && isFinite(c.cosine))
        ? " [Vorfilter-Cosinus " + c.cosine.toFixed(3) + "]"
        : "";
      lines.push((i + 1) + ". " + c.label + cosNote + ": " + c.text);
    }
    lines.push("");
    lines.push("Antworte AUSSCHLIESSLICH mit JSON nach diesem Schema, kein Prosa-Text drumherum.");
    lines.push("Das verdicts-Array hat genau " + candidates.length + " Einträge in DERSELBEN");
    lines.push("Reihenfolge wie die Kandidaten oben:");
    lines.push("{");
    lines.push("  \"verdicts\": [");
    lines.push("    { \"passt\": true|false, \"score\": <number in [0,1]>, \"begruendung\": <string, max " + MAX_VERDICT_BEGRUENDUNG_LEN + " Zeichen> }");
    lines.push("  ]");
    lines.push("}");
    return lines.join("\n");
  }

  // Strikte Validierung + Normalisierung der Richter-Antwort. Mappt das
  // verdicts-Array per Index auf die Kandidaten zurück. Bei Mismatch
  // {result:null, reason:"<deutsch>"}.
  function validateJudgeResponseSchema(parsedJson, candidates) {
    if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
      return { result: null, reason: "Antwort ist kein Objekt" };
    }
    var verdicts = parsedJson.verdicts;
    if (!Array.isArray(verdicts)) {
      return { result: null, reason: "Feld 'verdicts' fehlt oder ist kein Array" };
    }
    if (verdicts.length !== candidates.length) {
      return {
        result: null,
        reason: "verdicts-Länge " + verdicts.length + " != Kandidaten-Anzahl " + candidates.length,
      };
    }
    var out = [];
    for (var i = 0; i < verdicts.length; i++) {
      var v = verdicts[i];
      if (!v || typeof v !== "object" || Array.isArray(v)) {
        return { result: null, reason: "verdicts[" + i + "] ist kein Objekt" };
      }
      if (typeof v.passt !== "boolean") {
        return { result: null, reason: "verdicts[" + i + "].passt ist kein Boolean" };
      }
      var score = v.score;
      if (typeof score !== "number" || !isFinite(score) || score < 0 || score > 1) {
        return { result: null, reason: "verdicts[" + i + "].score nicht im Bereich [0, 1]" };
      }
      var begruendung = v.begruendung;
      if (typeof begruendung !== "string") {
        return { result: null, reason: "verdicts[" + i + "].begruendung ist kein String" };
      }
      if (begruendung.length > MAX_VERDICT_BEGRUENDUNG_LEN) {
        return { result: null, reason: "verdicts[" + i + "].begruendung > " + MAX_VERDICT_BEGRUENDUNG_LEN + " Zeichen" };
      }
      var c = candidates[i];
      out.push({
        label: c.label,
        anchorId: (typeof c.anchorId === "string") ? c.anchorId : null,
        passt: v.passt,
        score: score,
        begruendung: begruendung,
        cosine: (typeof c.cosine === "number" && isFinite(c.cosine)) ? c.cosine : null,
      });
    }
    return { result: out, reason: null };
  }

  // hybridMatch — der Match-Zeit-LLM-Richter. Vorfilter-Kandidaten rein,
  // ein bezeugtes Urteil raus. Fail-soft auf allen Pfaden:
  //   - kein/leerer apiKey  → opt-in aus → available:false (Vorfilter gilt)
  //   - LLM nicht erreichbar/HTTP-/Schema-Fehler → available:false
  // KEIN Throw außer Aufrufer-Konfig-Fehlern (Kandidaten-Form / Provider).
  async function hybridMatch(query, candidates, options) {
    // 1. Sync-Vor-Checks (Aufrufer-Konfig — diese werfen bewusst).
    var queryText, queryLabel = null;
    if (typeof query === "string") {
      queryText = query;
    } else if (query && typeof query === "object" && !Array.isArray(query)) {
      queryText = query.text;
      if (typeof query.label === "string" && query.label.length > 0) queryLabel = query.label;
    } else {
      throw EmptyQueryError(
        "hybridMatch: 'query' muss String oder { text, label? } sein, war: " + describe(query) + ".",
      );
    }
    if (typeof queryText !== "string" || queryText.length === 0) {
      throw EmptyQueryError(
        "hybridMatch: query.text muss nicht-leerer String sein.",
      );
    }
    if (queryText.length > LLM_MAX_OUTPUT_CHARS) {
      throw QueryTooLongError(
        "hybridMatch: query.text ist " + queryText.length + " Zeichen, max " + LLM_MAX_OUTPUT_CHARS + ".",
      );
    }
    validateCandidates(candidates);

    var opts = options || {};
    var providerId = pickJudgeProvider(opts);   // wirft InvalidProviderError bei Unfug
    var provider = HYBRID_PROVIDERS[providerId];
    var model = (typeof opts.model === "string" && opts.model.length > 0)
      ? opts.model : provider.defaultModel;
    var maxTokens = (typeof opts.maxTokens === "number" && opts.maxTokens > 0)
      ? opts.maxTokens : HYBRID_DEFAULT_MAX_TOKENS;
    var url = (typeof opts.endpoint === "string" && opts.endpoint.length > 0)
      ? opts.endpoint : provider.defaultUrl;
    var abortSignal = opts.abortSignal || null;
    var apiKey = opts.apiKey;

    // Defensive Kopie der Vorfilter-Kandidaten für den Fail-soft-Pfad
    // (Aufrufer fällt auf die rohe Cosinus-Reihenfolge zurück).
    var fallbackCandidates = candidates.map(function (c) {
      return {
        label: c.label,
        anchorId: (typeof c.anchorId === "string") ? c.anchorId : null,
        cosine: (typeof c.cosine === "number" && isFinite(c.cosine)) ? c.cosine : null,
      };
    });

    function failSoft(reason) {
      return {
        available: false,
        reason: reason,
        provider: providerId,
        model: model,
        region: provider.region,
        judgedAt: null,
        verdicts: null,
        fallbackCandidates: fallbackCandidates,
        tokensUsed: null,
        attestation: null,
      };
    }

    // 2. Opt-in-Gate: kein/leerer Key → Richter ist aus, Vorfilter gilt.
    //    KEIN Throw (Unterschied zu explainMatchLLM) — das IST der
    //    fail-soft-„kein opt-in"-Pfad aus dem Konzept.
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      return failSoft("Richter nicht opt-in (kein apiKey) — Vorfilter-Ergebnis gilt");
    }
    // 3. Lokaler Anbieter ohne Endpoint kann nicht aufgerufen werden.
    if (!url) {
      return failSoft("Anbieter '" + providerId + "' ohne Endpoint (options.endpoint setzen) — Vorfilter-Ergebnis gilt");
    }

    // 3b. Dynamische Modell-Auflösung (z.B. Gemini: Modellnamen ändern sich ->
    //     HTTP 404). Nur wenn der Anbieter einen resolveModel-Hook hat und der
    //     Aufrufer KEIN festes Modell vorgegeben hat. Fail-soft: bei Fehler bleibt
    //     defaultModel.
    if (typeof provider.resolveModel === "function" &&
        !(typeof opts.model === "string" && opts.model.length > 0)) {
      try {
        var resolved = await provider.resolveModel(apiKey, url);
        if (typeof resolved === "string" && resolved.length > 0) model = resolved;
      } catch (e) { /* defaultModel bleibt */ }
    }

    // 4. Prompt + Request bauen.
    var prompt = buildJudgePrompt(queryText, queryLabel, candidates);
    var req = provider.buildRequest({
      url: url, apiKey: apiKey, model: model, maxTokens: maxTokens, prompt: prompt,
    });
    if (abortSignal) req.init.signal = abortSignal;

    // 5. fetch. AbortError durchreichen, alle anderen Fehler fail-soft.
    var response;
    try {
      response = await fetch(req.url, req.init);
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      return failSoft("Netz nicht erreichbar (" + (err && err.message ? err.message : String(err)) + ")");
    }
    if (!response.ok) {
      if (response.status === 429) {
        return failSoft("API HTTP 429 (Rate-Limit) — Aufrufer-Drossel-Pflicht");
      }
      return failSoft("API HTTP " + response.status + " (" + (response.statusText || "?") + ")");
    }

    // 6. Body parsen + Anbieter-spezifischen Text extrahieren.
    var body;
    try {
      body = await response.json();
    } catch (err) {
      return failSoft("Antwort war kein valides JSON");
    }
    var llmText = provider.extractText(body);
    if (typeof llmText !== "string") {
      return failSoft("Antwort entsprach nicht der Anbieter-API-Form (" + providerId + ")");
    }
    if (llmText.length > LLM_MAX_OUTPUT_CHARS) {
      llmText = llmText.slice(0, LLM_MAX_OUTPUT_CHARS);
    }

    // 7. Richter-JSON parsen + strikt validieren.
    var llmJson;
    try {
      // Manche Anbieter (z.B. Gemini) verpacken JSON in ```-Code-Fences —
      // vor dem Parsen entfernen. Reine-JSON-Antworten bleiben unberührt.
      var cleaned = llmText.replace(/```json/gi, "").replace(/```/g, "").trim();
      llmJson = JSON.parse(cleaned);
    } catch (err) {
      return failSoft("Richter-Output war kein valides JSON");
    }
    var schemaCheck = validateJudgeResponseSchema(llmJson, candidates);
    if (schemaCheck.result === null) {
      return failSoft("Antwort entsprach nicht dem Schema: " + schemaCheck.reason);
    }

    var tokensUsed = provider.extractTokens(body);
    var judgedAt = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD (Bezeugung)

    // 8. BEZEUGUNG: signierbares attestation-Objekt (Anbieter-Marker +
    //    Datum + Urteil-Kern). Der Aufrufer signiert das via Modul 02 und
    //    legt es in die Inbox — Modul 04 signiert NICHT selbst (kein
    //    Identitäts-Zugriff im Match-Modul).
    var attestation = {
      kind: "sbkim-hybrid-match-judgment",
      version: 1,
      judgedAt: judgedAt,
      provider: providerId,
      model: model,
      region: provider.region,
      queryLabel: queryLabel,
      verdicts: schemaCheck.result.map(function (v) {
        return {
          label: v.label,
          anchorId: v.anchorId,
          passt: v.passt,
          score: Number(v.score.toFixed(4)),
          begruendung: v.begruendung,
        };
      }),
    };

    // 9. Erfolg.
    return {
      available: true,
      reason: null,
      provider: providerId,
      model: model,
      region: provider.region,
      judgedAt: judgedAt,
      verdicts: schemaCheck.result,
      fallbackCandidates: fallbackCandidates,
      tokensUsed: tokensUsed,
      attestation: attestation,
    };
  }

  // Bidirektional-Kombinator (Konzept § Bidirektional). Jede Seite urteilt
  // mit ihrer eigenen KI; dieser Helfer kombiniert die zwei booleschen
  // Urteile. Default „both" (streng — beide nötig, Klaus 2026-06-20);
  // „one" = großzügig (eine Seite genügt). Reine Funktion, kein Netz.
  function bidirectionalVerdict(passtA, passtB, rule) {
    var r = (rule === "one" || rule === "both") ? rule : HYBRID_BIDIRECTIONAL_DEFAULT;
    if (typeof passtA !== "boolean" || typeof passtB !== "boolean") {
      throw InvalidCandidatesError(
        "bidirectionalVerdict: passtA und passtB müssen Boolean sein.",
      );
    }
    return r === "both" ? (passtA && passtB) : (passtA || passtB);
  }

  // ---- Bau 04.G: queryLocalJudged — Vorfilter + Richter, komponiert (additiv) ----
  //
  // STRANG A2 (Brief 2026-07-01): verankert den KI-Richter (`hybridMatch`) fest
  // im ANTWORT-Pfad, als EINE komponierte, opt-in Funktion — ohne ein anderes
  // Modul anzufassen. Ablauf:
  //   1. VORFILTER: queryLocal(text, k, {hybrid?}) liefert lokale Top-k
  //      (server-los; A1-Hybrid wird durchgereicht, wenn options.hybrid).
  //   2. RICHTER (opt-in/BYOK): nur wenn options.apiKey gesetzt ist, urteilt
  //      hybridMatch über die Finalisten (Bedeutungs-Urteil je Kandidat) und
  //      sortiert sie um (passt zuerst, dann nach Richter-Score).
  //   3. FAIL-SOFT: kein Schlüssel / leerer Vorfilter / Richter nicht erreichbar
  //      → das rohe Vorfilter-Ergebnis gilt weiter, KEIN Throw.
  // Rein additiv: queryLocal / hybridMatch / PROVIDER_MIN_MATCH / der 0.80-
  // Andock-Riegel (Modul 05) bleiben unberührt. Der Richter beurteilt den
  // Passage-TEXT — dafür braucht er den Korpus-Text; queryLocalJudged löst den
  // Korpus GENAU wie queryLocal auf (options.corpus | registrierter Provider)
  // und reicht ihn identisch an queryLocal weiter.
  //
  // Rückgabe: {
  //   judged:  boolean,                 // true = Richter lief + lieferte Urteil
  //   candidates: Array<{ label, score, anchorId, bm25?, fused?,
  //                       passt?, judgeScore?, begruendung? }>,  // umsortiert wenn judged
  //   judgment: HybridJudgment | null,  // rohes hybridMatch-Resultat (inkl. attestation)
  // }
  async function queryLocalJudged(text, k, options) {
    var opts = options || {};

    // Korpus identisch zu queryLocal auflösen (damit wir den Passage-Text
    // für den Richter kennen). Kein eigener Embedding-/Score-Pfad.
    var corpus;
    if (Object.prototype.hasOwnProperty.call(opts, "corpus") && opts.corpus !== undefined) {
      corpus = opts.corpus;
    } else if (typeof _localCorpusProvider === "function") {
      try {
        // `await`: Endknoten-Provider bauen den Korpus faul (async — Embeddings
        // via Modul 03). Ohne await landet ein Promise in queryLocal/validateCorpus
        // → "Korpus muss ein Array sein, war: Promise". Gleicher Bug wie queryLocal
        // (PR #533), hier für Bau 04.G nachgezogen. Sync-Array-Provider bleiben
        // unberührt: `await array` gibt das Array zurück.
        corpus = await _localCorpusProvider();
      } catch (err) {
        throw InvalidCorpusError(
          "queryLocalJudged: _localCorpusProvider hat geworfen: " + (err && err.message ? err.message : String(err)),
        );
      }
    } else {
      corpus = [];
    }

    // 1. VORFILTER — queryLocal mit exakt demselben Korpus (Hybrid durchgereicht).
    var vorfilter = await queryLocal(text, k, {
      corpus: corpus,
      hybrid: opts.hybrid === true,
    });

    // Kein Schlüssel ODER keine Finalisten → reiner Vorfilter, Richter aus.
    var apiKey = opts.apiKey;
    if (typeof apiKey !== "string" || apiKey.length === 0 || vorfilter.length === 0) {
      return { judged: false, candidates: vorfilter, judgment: null };
    }

    // Text-Karte (anchorId bevorzugt, sonst label) → Passage-Text für den Richter.
    function keyOf(item) {
      return (typeof item.anchorId === "string" && item.anchorId.length > 0) ? "a:" + item.anchorId : "l:" + item.label;
    }
    var textByKey = Object.create(null);
    for (var ci = 0; ci < corpus.length; ci++) {
      var it = corpus[ci];
      if (!it || typeof it !== "object") continue;
      var t = (typeof it.text === "string" && it.text.length > 0) ? it.text : it.label;
      if (typeof t === "string" && t.length > 0) textByKey[keyOf(it)] = t;
    }

    // Richter-Kandidaten in Vorfilter-Reihenfolge (max HYBRID_MAX_CANDIDATES).
    var judgeSlice = vorfilter.slice(0, HYBRID_MAX_CANDIDATES);
    var judgeCandidates = judgeSlice.map(function (r) {
      var txt = textByKey[keyOf(r)];
      return {
        label: r.label,
        text: (typeof txt === "string" && txt.length > 0) ? txt : r.label,
        cosine: r.score,
        anchorId: r.anchorId,
      };
    });

    // 2. RICHTER — hybridMatch (opt-in via apiKey). Fail-soft integriert.
    var judgment = await hybridMatch(
      { text: text, label: (typeof opts.queryLabel === "string" ? opts.queryLabel : null) },
      judgeCandidates,
      opts,
    );

    if (!judgment || judgment.available !== true || !Array.isArray(judgment.verdicts)) {
      // 3. FAIL-SOFT — Vorfilter gilt, Grund steckt in judgment.reason.
      return { judged: false, candidates: vorfilter, judgment: judgment || null };
    }

    // Urteil index-gleich auf die Finalisten heften.
    var judged = judgeSlice.map(function (r, i) {
      var v = judgment.verdicts[i] || {};
      var merged = {
        label: r.label,
        score: r.score,
        anchorId: r.anchorId,
        passt: (typeof v.passt === "boolean") ? v.passt : null,
        judgeScore: (typeof v.score === "number") ? v.score : null,
        begruendung: (typeof v.begruendung === "string") ? v.begruendung : null,
      };
      if (typeof r.bm25 === "number") merged.bm25 = r.bm25;
      if (typeof r.fused === "number") merged.fused = r.fused;
      return merged;
    });
    // Umsortieren: passt=true zuerst, dann nach Richter-Score absteigend,
    // Tie-Break Vorfilter-Cosinus. REINE Anzeige-Sortierung, gatet nichts.
    judged.sort(function (a, b) {
      var pa = a.passt === true ? 1 : 0, pb = b.passt === true ? 1 : 0;
      if (pb !== pa) return pb - pa;
      var ja = (typeof a.judgeScore === "number") ? a.judgeScore : -1;
      var jb = (typeof b.judgeScore === "number") ? b.judgeScore : -1;
      if (jb !== ja) return jb - ja;
      return b.score - a.score;
    });
    // Etwaigen ungerichteten Rest (falls Vorfilter > HYBRID_MAX_CANDIDATES)
    // unverändert hinten anhängen.
    var tail = vorfilter.slice(HYBRID_MAX_CANDIDATES);
    return { judged: true, candidates: judged.concat(tail), judgment: judgment };
  }

  var SbkimMatch = {
    match: match,
    isAboveProviderThreshold: isAboveProviderThreshold,
    relatedness: relatedness,
    isRelated: isRelated,
    RELATEDNESS_MIN: RELATEDNESS_MIN,
    matchDimensions: matchDimensions,
    explainMatchLLM: explainMatchLLM,
    queryLocal: queryLocal,
    queryLocalJudged: queryLocalJudged,
    queryLocalMulti: queryLocalMulti,
    expandQuerySimple: expandQuerySimple,
    parseExclusions: parseExclusions,
    applyExclusions: applyExclusions,
    contentExcluded: contentExcluded,
    setLocalCorpus: setLocalCorpus,
    bm25Scores: bm25Scores,
    tokenizeBM25: tokenizeBM25,
    hybridMatch: hybridMatch,
    pickJudgeProvider: pickJudgeProvider,
    bidirectionalVerdict: bidirectionalVerdict,
    PROVIDER_MIN_MATCH: PROVIDER_MIN_MATCH,
    SCHICHT_MIN_MATCH: SCHICHT_MIN_MATCH,
    DimensionsAllNullError: DimensionsAllNullError,
    InvalidApiKeyError: InvalidApiKeyError,
    InvalidMatchResultError: InvalidMatchResultError,
    EmptyQueryError: EmptyQueryError,
    QueryTooLongError: QueryTooLongError,
    InvalidKError: InvalidKError,
    EmbeddingNotAvailableError: EmbeddingNotAvailableError,
    InvalidCorpusError: InvalidCorpusError,
    InvalidCandidatesError: InvalidCandidatesError,
    InvalidProviderError: InvalidProviderError,
    _meta: {
      embeddingDim: EMBEDDING_DIM,
      providerMinMatch: PROVIDER_MIN_MATCH,
      schichtMinMatch: SCHICHT_MIN_MATCH,
      relatednessMin: RELATEDNESS_MIN,
      relatednessCentered: true, // zentrierter (whitened-light) Score; gatet nichts
      schichtMinMatchNote: "0.80 = ANDOCK-Boden (gatet Handshake), relatednessMin = echte Verwandtschaft (nur Anzeige)",
      matchDimensionsLanes: MATCH_DIMENSIONS_LANES.slice(),
      stufeBDefaultModel: STUFE_B_DEFAULT_MODEL,
      stufeBMaxTokens: STUFE_B_MAX_TOKENS,
      anthropicApiUrl: ANTHROPIC_API_URL,
      anthropicApiVersion: ANTHROPIC_API_VERSION,
      queryLocalDefaultK: 5,
      queryLocalMaxTextLen: LLM_MAX_OUTPUT_CHARS,
      get localCorpusRegistered() { return typeof _localCorpusProvider === "function"; },
      // Bau 04.F Hybrid BM25+Vektor (Strang A1) Read-Anker.
      bm25K1: BM25_K1,
      bm25B: BM25_B,
      rrfK: RRF_K,
      hybridQueryLocalNote: "queryLocal(text,k,{hybrid:true}) fusioniert BM25+Vektor via RRF; Default (ohne hybrid) unverändert Cosinus. PROVIDER_MIN_MATCH + Andock-Riegel unberührt.",
      // Bau 04.G queryLocalJudged (Strang A2) Read-Anker.
      queryLocalJudgedNote: "queryLocalJudged(text,k,{hybrid?,apiKey?,provider?,euOnly?}) = Vorfilter (queryLocal) + Richter (hybridMatch, opt-in/BYOK, fail-soft). Sortiert Finalisten um (passt zuerst), gatet nichts, Modul 05 unberührt.",
      // Bau 04.H Query-Expansion / Multi-Query (Strang A4) Read-Anker.
      multiMaxVariants: MULTI_MAX_VARIANTS,
      queryLocalMultiNote: "expandQuerySimple(text,{synonyms?,maxVariants?}) erzeugt gratis/offline Varianten (Original zuerst); queryLocalMulti(queries,k,{hybrid?,...}) sucht mit jeder + verschmilzt via RRF. Rein additiv, PROVIDER_MIN_MATCH + Andock-Riegel unberührt; LLM-Varianten-Generator wäre späterer opt-in-Aufsatz.",
      // Bau 04.I Ausschluss-/Negations-Filter (Strang A4) Read-Anker.
      alcoholTermCount: ALCOHOL_TERMS.length,
      exclusionNote: "parseExclusions(text) liest Verneinungen ('ohne X', 'kein(e) X', 'X-frei', 'allergisch gegen X', 'alkoholfrei'->Alkohol-Klasse, EN 'without/no X'); applyExclusions(cands,ex,getText?) filtert Kandidaten deterministisch/offline; queryLocal(text,k,{exclude:true|<ex>}) filtert VOR dem Ranking. Ohne exclude byte-gleich; PROVIDER_MIN_MATCH + Andock-Riegel unberührt (nur Entfernen).",
      // Bau 04.D Hybrid-Match (Richter) Read-Anker.
      hybridProviders: Object.keys(HYBRID_PROVIDERS).map(function (id) {
        return { id: id, label: HYBRID_PROVIDERS[id].label, region: HYBRID_PROVIDERS[id].region };
      }),
      hybridEuDefaultProvider: HYBRID_EU_DEFAULT_PROVIDER,
      hybridUsDefaultProvider: HYBRID_US_DEFAULT_PROVIDER,
      hybridMaxCandidates: HYBRID_MAX_CANDIDATES,
      hybridBidirectionalDefault: HYBRID_BIDIRECTIONAL_DEFAULT,
    },
  };

  global.SbkimMatch = SbkimMatch;

  // Self-check: emitted on script load (synchronous, no async load step).
  // Format is uniform across all SBKIM modules — see INTERFACES.md.
  // Bau 04.A erweitert die Funktions-Liste um matchDimensions; Schwellen-
  // Block nennt PROVIDER_MIN_MATCH und SCHICHT_MIN_MATCH.
  if (typeof console !== "undefined" && console.info) {
    console.info(
      "MODUL 04 MATCH bereit, Funktionen: match/isAboveProviderThreshold/relatedness/isRelated/matchDimensions/explainMatchLLM/queryLocal/bm25Scores/hybridMatch/queryLocalJudged/queryLocalMulti/expandQuerySimple, " +
        "Schwellen: PROVIDER_MIN_MATCH=" + PROVIDER_MIN_MATCH +
        ", SCHICHT_MIN_MATCH=" + SCHICHT_MIN_MATCH,
    );
  }
})(typeof window !== "undefined" ? window : globalThis);
