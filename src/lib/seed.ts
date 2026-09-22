import type {
  EvidenceItem,
  GapItem,
  Hypothesis,
  OutcomeItem,
  ResearchQuestion,
  Study,
  VoiceItem,
} from "./types";
import { emptyDesign, emptyEthics, emptyHypotheses, emptyManuscript, emptyProtocol, emptyQuestions, emptyStats, emptyVoices, migrateStudy } from "./defaults";

let evSeq = 0;
function ev(p: Omit<EvidenceItem, "id" | "provenance"> & { id?: string; provenance?: EvidenceItem["provenance"] }): EvidenceItem {
  evSeq += 1;
  const doi = "doi" in p ? p.doi : undefined;
  return {
    id: p.id ?? `ev-${evSeq}`,
    ...p,
    year: p.year ?? null,
    methodQuality: p.methodQuality ?? null,
    relevance: p.relevance ?? null,
    provenance: p.provenance ?? {
      origin: "model",
      retrievalEventIds: [],
      identifiers: { ...(doi ? { doi } : {}) },
      access: "unknown",
      status: "unverified",
      checks: [],
    },
  };
}

function gap(p: Omit<GapItem, "id"> & { id: string }): GapItem {
  return p;
}

function hyp(p: Hypothesis): Hypothesis {
  return p;
}

function q(p: ResearchQuestion): ResearchQuestion {
  return p;
}

function oc(p: OutcomeItem): OutcomeItem {
  return p;
}

function vo(p: VoiceItem): VoiceItem {
  return p;
}

const ketamine = {
  id: "seed-ketamine",
  title: "Intravenous ketamine for refractory neuropathic pain",
  subtitle: "Living evidence map and a pragmatic trial protocol",
  family: "pragmatic-trial",
  setting: "Tertiary outpatient pain clinic, academic hospital, Ontario",
  status: "complete",
  createdAt: "2026-03-12T10:00:00.000Z",
  updatedAt: "2026-09-04T14:20:00.000Z",
  currentStage: "manuscript",
  completedStages: [
    "problem",
    "scan",
    "map",
    "gaps",
    "hypotheses",
    "questions",
    "design",
    "protocol",
    "stats",
    "ethics",
    "voices",
    "manuscript",
    "audit",
  ],
  problem: {
    rawNeed:
      "Adults with neuropathic pain who have failed first-line drugs still get offered IV ketamine with wildly different protocols. We don't know who actually benefits, for how long, or whether the chair-time is worth the dissociation and access cost.",
    statement:
      "In adults with refractory neuropathic pain treated in Canadian tertiary pain clinics, short-course intravenous ketamine is used off-label with heterogeneous dosing, monitoring, and follow-up. Evidence for lasting, patient-important benefit is uncertain, while burden, stigma, cost, and inequitable access are not.",
    whoAffected:
      "Adults with peripheral or central neuropathic pain who have not achieved a meaningful response to first-line pharmacotherapy (gabapentinoids, SNRIs, TCAs, topical agents) and selected patients with mixed nociplastic features referred for infusion.",
    whatHurts:
      "Persistent pain interference with sleep, work, and relationships; repeated failed drug trials; long waits for infusion chairs; fear of dissociation; time off work for multi-hour visits; family burden of transport.",
    currentPractice:
      "Clinic-level protocols ranging from 0.1–1.0 mg/kg/h, 1–5 sessions, with or without midazolam, with monitoring intensity borrowed from anesthesia rather than from outpatient pain evidence. Outcomes are often a 0–10 NRS at end of infusion, not function at 12 weeks.",
    whyNow:
      "Demand is rising, Health Canada status remains off-label for chronic pain, consensus statements exist but are not trial protocols, and payers/hospital leadership want a defensible, equitable service or a reason to stop.",
    constraints:
      "Limited infusion chairs, nursing skill-mix, no overnight beds, fee-for-service clinic time, patients travelling from outside the city, pregnancy exclusions, psychiatric comorbidity, driving restrictions after dosing.",
    patientCenteredGoal:
      "A reduction in pain interference (not only intensity) that a person would trade a day in a chair and a week of after-effects to keep, lasting at least 12 weeks, without serious harm.",
    generatedAt: "2026-03-12T10:05:00.000Z",
  },
  scan: {
    query:
      "intravenous ketamine neuropathic pain refractory infusion randomized systematic review GRADE IMMPACT function",
    sourcesConsulted: [
      "PubMed",
      "Cochrane",
      "Google Scholar",
      "OpenEvidence",
      "ClinicalTrials.gov",
      "IASP / NeuPSIG",
      "ASRA consensus 2018",
      "Canada's Drug Agency",
    ],
    gradeOverall: "low",
    gradeRationale:
      "Several small RCTs and one widely cited meta-analysis show short-term pain reduction. Certainty falls for function, duration beyond two weeks, and harms that matter to patients. Indirectness (mixed chronic pain phenotypes), imprecision, and risk of bias are the usual downgrades.",
    synthesis:
      "Ketamine is biologically plausible (NMDA) and clinically familiar. Consensus guidelines (Cohen 2018) support specialist use after failed conventional therapy, at subanesthetic doses, with monitoring. The Orhurhu 2019 meta-analysis of RCTs found short-term analgesia with substantial heterogeneity. Niesters and Dahan mapped benefit–risk, including psychotomimetic effects, hepatic signals with repeated infusion, and cystitis largely at much higher recreational or anesthetic exposures. IMMPACT-aligned functional outcomes are sparse. Grey literature (hospital SOPs, patient forums) shows protocol scatter and a stigma problem the trials barely measure. This is a candidate for a pragmatic trial with a single functional primary outcome — not another explanatory NRS study.",
    items: [
      ev({
        title: "Consensus guidelines on IV ketamine infusions for chronic pain",
        authors: "Cohen SP, Bhatia A, Buvanendran A, et al.",
        year: 2018,
        source: "Reg Anesth Pain Med",
        kind: "guideline",
        grade: "low",
        methodQuality: 72,
        relevance: 96,
        verification: "landmark",
        doi: "10.1097/AAP.0000000000000808",
        contextTags: ["specialist use", "off-label", "monitoring"],
        keyFindings:
          "Weak recommendation for ketamine in refractory chronic pain after conventional treatments; subanesthetic dosing; specialist setting.",
        limitations: "Consensus, not a systematic GRADE evidence-to-decision for every indication.",
        notes: "Sets the practice envelope this trial must live inside.",
      }),
      ev({
        title: "Ketamine infusions for chronic pain: a systematic review and meta-analysis of RCTs",
        authors: "Orhurhu V, Orhurhu MS, Bhatia A, Cohen SP",
        year: 2019,
        source: "Anesth Analg",
        kind: "systematic-review",
        grade: "low",
        methodQuality: 78,
        relevance: 94,
        verification: "landmark",
        doi: "10.1213/ANE.0000000000004187",
        contextTags: ["short-term analgesia", "heterogeneity"],
        keyFindings:
          "IV ketamine reduced pain vs control in mixed chronic pain RCTs; effect wanes; adverse events common but usually not serious in studied doses.",
        limitations: "Phenotype mixing; short follow-up; function rarely primary.",
        notes: "Best quantitative synthesis; do not over-read duration of benefit.",
      }),
      ev({
        title: "Ketamine for chronic pain: risks and benefits",
        authors: "Niesters M, Martini C, Dahan A",
        year: 2014,
        source: "Br J Clin Pharmacol",
        kind: "systematic-review",
        grade: "moderate",
        methodQuality: 80,
        relevance: 88,
        verification: "landmark",
        contextTags: ["harm profile", "mechanism"],
        keyFindings:
          "Analgesia is real and often transient; psychotomimetic effects dose-related; hepatic and urologic harms mainly at high cumulative dose.",
        limitations: "Narrative elements; chronic neuropathic subset not isolated throughout.",
        notes: "Use for informed consent language.",
      }),
      ev({
        title: "Pharmacotherapy for neuropathic pain in adults: systematic review and meta-analysis",
        authors: "Finnerup NB, Attal N, Haroutounian S, et al.",
        year: 2015,
        source: "Lancet Neurol",
        kind: "systematic-review",
        grade: "high",
        methodQuality: 92,
        relevance: 70,
        verification: "landmark",
        contextTags: ["first-line context", "NNTs"],
        keyFindings:
          "First-line remain gabapentinoids, SNRIs, TCAs; ketamine is not first-line.",
        limitations: "Does not settle third-line infusion policy.",
        notes: "Defines 'refractory' as failure of these agents.",
      }),
      ev({
        title: "Core outcome measures for chronic pain clinical trials: IMMPACT recommendations",
        authors: "Dworkin RH, Turk DC, Farrar JT, et al.",
        year: 2005,
        source: "Pain",
        kind: "guideline",
        grade: "high",
        methodQuality: 88,
        relevance: 90,
        verification: "landmark",
        contextTags: ["outcomes", "patient-important"],
        keyFindings:
          "Intensity, function, emotion, global improvement, symptoms, adverse events — not a lone NRS.",
        limitations: "Not ketamine-specific.",
        notes: "Primary outcome must come from this family.",
      }),
      ev({
        title: "Consensus guidelines on IV ketamine for acute pain",
        authors: "Schwenk ES, Viscusi ER, Buvanendran A, et al.",
        year: 2018,
        source: "Reg Anesth Pain Med",
        kind: "guideline",
        grade: "moderate",
        methodQuality: 74,
        relevance: 55,
        verification: "landmark",
        contextTags: ["acute vs chronic", "indirectness"],
        keyFindings: "Stronger evidence base in acute/perioperative than in chronic neuropathic pain.",
        limitations: "Wrong population if copied wholesale into chronic clinic protocols.",
        notes: "Watch for protocol contamination from acute-pain practice.",
      }),
      ev({
        title: "Hospital SOP scatter — tertiary ketamine infusion policies (grey)",
        authors: "Grey literature synthesis",
        year: 2025,
        source: "Institutional protocols / FOI abstracts",
        kind: "grey",
        grade: "very-low",
        methodQuality: 28,
        relevance: 80,
        verification: "verify",
        contextTags: ["practice variation", "access"],
        keyFindings:
          "Dose, duration, number of sessions, and exclusion criteria differ more by institution than by phenotype.",
        limitations: "Not peer-reviewed; selection of available SOPs.",
        notes: "The variation is itself the implementation problem.",
      }),
      ev({
        title: "Lived experience: infusion day as a bargain with function",
        authors: "Patient partners / public narratives",
        year: 2024,
        source: "PPI transcripts and public forums (paraphrase)",
        kind: "patient-voice",
        grade: "low",
        methodQuality: 40,
        relevance: 92,
        verification: "verify",
        contextTags: ["stigma", "function", "access"],
        keyFindings:
          "People will accept dissociation if sleep and walking a grocery aisle improve for weeks. They will not accept a 2-point NRS win that does not change a day.",
        limitations: "Not a representative sample; stigma may silence some voices.",
        notes: "Primary outcome: BPI interference, not NRS.",
      }),
    ],
    generatedAt: "2026-03-14T09:00:00.000Z",
  },
  map: {
    contexts: [
      "Tertiary pain clinic capacity",
      "Off-label Canadian regulation",
      "Fee-for-service time",
      "Rural travel",
      "Stigma of a 'party drug'",
      "Nursing infusion skill",
      "Psychiatric comorbidity",
    ],
    reading:
      "The papers talk to each other about NMDA and NRS. The clinic talks about chairs, driving, and who can take a Thursday off. The public feed talks about miracles and abuse. The true meridian runs through function at 12 weeks in people who have already failed first-line drugs, in a service that can actually be staffed. Re-reading Orhurhu after sitting with patient partners downgrades 'it works' to 'it can reduce intensity briefly, in selected adults, at a cost we have not priced in equity.'",
    nodes: [
      { id: "n-cohen", label: "Cohen 2018 consensus", kind: "guideline" },
      { id: "n-orhurhu", label: "Orhurhu 2019 MA", kind: "systematic-review" },
      { id: "n-niesters", label: "Niesters/Dahan harm", kind: "systematic-review" },
      { id: "n-finnerup", label: "Finnerup first-line", kind: "systematic-review" },
      { id: "n-immpact", label: "IMMPACT outcomes", kind: "guideline", detail: "Function over NRS" },
      { id: "n-sop", label: "Hospital SOP scatter", kind: "grey" },
      { id: "n-ppi", label: "Lived experience", kind: "patient-voice" },
      { id: "n-stigma", label: "Public stigma", kind: "stakeholder" },
      { id: "n-chairs", label: "Infusion capacity", kind: "context" },
      { id: "n-equity", label: "Travel / time off work", kind: "context" },
      { id: "n-offlabel", label: "Off-label CA", kind: "context" },
      { id: "n-bpi", label: "BPI interference 12w", kind: "outcome" },
      { id: "n-gap", label: "No pragmatic functional RCT", kind: "gap" },
      { id: "n-seips", label: "Clinic work system", kind: "framework" },
    ],
    edges: [
      { from: "n-finnerup", to: "n-cohen", relation: "defines refractory" },
      { from: "n-orhurhu", to: "n-cohen", relation: "underpins weak rec" },
      { from: "n-niesters", to: "n-cohen", relation: "bounds dose/harm" },
      { from: "n-immpact", to: "n-bpi", relation: "selects outcome" },
      { from: "n-ppi", to: "n-bpi", relation: "confirms outcome" },
      { from: "n-orhurhu", to: "n-gap", relation: "stops at short NRS" },
      { from: "n-sop", to: "n-chairs", relation: "encodes variation" },
      { from: "n-chairs", to: "n-equity", relation: "rations access" },
      { from: "n-stigma", to: "n-ppi", relation: "shapes consent" },
      { from: "n-offlabel", to: "n-chairs", relation: "constrains service" },
      { from: "n-gap", to: "n-bpi", relation: "trial target" },
      { from: "n-seips", to: "n-chairs", relation: "reads the work" },
    ],
    generatedAt: "2026-03-15T11:00:00.000Z",
  },
  gaps: {
    items: [
      gap({
        id: "g1",
        title: "Function at 12 weeks is almost never primary",
        kind: "outcome",
        severity: "high",
        whyItMatters: "Clinics are deciding chair policy on an outcome patients do not use to judge success.",
        opportunity: "One IMMPACT functional primary — BPI interference — and stop.",
      }),
      gap({
        id: "g2",
        title: "Phenotype mixing in meta-analyses",
        kind: "method",
        severity: "high",
        whyItMatters: "CRPS, mixed chronic pain, and neuropathic pain are not interchangeable.",
        opportunity: "Restrict eligibility to IASP neuropathic criteria with a DN4/LANSS gate.",
      }),
      gap({
        id: "g3",
        title: "Equity of access unmeasured",
        kind: "equity",
        severity: "high",
        whyItMatters: "A Thursday infusion is a different trial for a rural shift worker than for a salaried urban patient.",
        opportunity: "PROGRESS-Plus table; travel support as an implementation extra, not an afterthought.",
      }),
      gap({
        id: "g4",
        title: "SOP scatter treated as clinical judgement",
        kind: "implementation",
        severity: "moderate",
        whyItMatters: "Variation is being read as personalization without a phenotype to personalize on.",
        opportunity: "A single TIDieR-described protocol with allowed tailoring named in advance.",
      }),
      gap({
        id: "g5",
        title: "Opioid-sparing used as a trophy outcome",
        kind: "error",
        severity: "moderate",
        whyItMatters: "It invites p-hacking and does not equal a better life.",
        opportunity: "Morphine-equivalent as a pre-specified secondary, never primary.",
      }),
    ],
    errorsFound: [
      "Several small trials analyse many time points without multiplicity control.",
      "Blinding is fragile once dissociation appears — attention-control design must be explicit.",
      "Hospital SOPs cite acute-pain ketamine literature for chronic clinic policy (indirectness).",
    ],
    reevaluation:
      "After mapping context, the 'need another ketamine RCT' impulse becomes 'need one pragmatic, functional, equity-visible trial in refractory neuropathic pain, or a decision to stop expanding the service.' The meta-analytic mean is the wrong object.",
    generatedAt: "2026-03-16T08:30:00.000Z",
  },
  hypotheses: {
    selectedId: "h1",
    items: [
      hyp({
        id: "h1",
        statement:
          "A three-session subanesthetic IV ketamine protocol reduces BPI pain interference at 12 weeks versus an attention-matched midazolam session in adults with refractory neuropathic pain.",
        novelty: 62,
        need: 90,
        practiceChange: 88,
        feasibility: 70,
        parsimony: 84,
        rationale:
          "Directly answers the chair-policy question with a patient-important endpoint. Novelty is moderate (ketamine is old); need and practice-change are not.",
        risks: "Blinding, recruitment from a small refractory pool, off-label CTA path.",
      }),
      hyp({
        id: "h2",
        statement:
          "A DN4-high, central-sensitization-high phenotype modifies ketamine response (interaction), justifying stratified care.",
        novelty: 80,
        need: 60,
        practiceChange: 55,
        feasibility: 40,
        parsimony: 35,
        rationale: "Scientifically attractive, underpowered unless the main trial is huge. Nested, not primary.",
        risks: "Overfitting phenotype × treatment; exploratory only.",
      }),
      hyp({
        id: "h3",
        statement:
          "Adding a fourth and fifth infusion yields durable benefit beyond three sessions.",
        novelty: 40,
        need: 50,
        practiceChange: 48,
        feasibility: 45,
        parsimony: 30,
        rationale: "Dose-finding that the service cannot staff and the evidence does not yet deserve.",
        risks: "Over-complexity; chair-time; cumulative psychotropic load.",
      }),
    ],
    generatedAt: "2026-03-16T12:00:00.000Z",
  },
  questions: {
    finer:
      "Feasible in two Ontario centres with existing chairs. Interesting to patients and to the people who fund chairs. Novel in primary outcome and pragmatic stance, not in molecule. Ethical if dissociation, driving, and off-label status are explicit. Relevant to a live service decision.",
    items: [
      q({
        id: "q1",
        text: "In adults with refractory neuropathic pain, does a three-session subanesthetic IV ketamine protocol compared with attention-matched midazolam reduce BPI pain interference at 12 weeks?",
        framework: "PICOT",
        population: "Adults, IASP neuropathic pain, failed ≥2 first-line drug classes",
        intervention: "Ketamine 0.5 mg/kg/h × 4 h × 3 sessions over 2 weeks",
        comparator: "Midazolam attention-control, same schedule and monitoring",
        outcome: "BPI pain interference, 12 weeks",
        time: "12 weeks primary; 2 and 26 weeks secondary",
        setting: "Two tertiary outpatient pain clinics, Ontario",
      }),
    ],
    generatedAt: "2026-03-16T13:00:00.000Z",
  },
  design: {
    recommended: "pragmatic-trial",
    rationale:
      "The question is effectiveness in the service that already exists, not explanatory NMDA pharmacology. Randomization is warranted because confounding by indication (who is well enough to sit for four hours) would wreck a cohort. PRECIS-2 should sit toward the pragmatic pole on setting, flexibility of delivery, and follow-up, explanatory on adherence to a TIDieR protocol.",
    alternatives: [
      "Retrospective EMR cohort — faster, hopeless confounding, wrong outcome capture.",
      "Single-arm before–after — regression to the mean dressed as efficacy.",
      "Systematic review update — useful, will not settle chair policy without new primary data.",
    ],
    guidelines: ["SPIRIT", "CONSORT", "PRECIS-2", "TIDieR", "IMMPACT", "TCPS 2"],
    whyNotMoreComplex:
      "No factorial, no adaptive dose-finding, no 12-arm phenotype mosaic. One intervention, one primary, two centres. Phenotype and opioid-sparing live in the SAP as secondary/exploratory.",
    generatedAt: "2026-03-17T09:00:00.000Z",
  },
  protocol: {
    overview:
      "Multi-centre, parallel-group, randomized, attention-controlled pragmatic trial. 1:1 allocation, stratified by centre and baseline BPI interference tertile. SPIRIT protocol; TIDieR intervention description; no overnight stay.",
    population:
      "Adults ≥18 with neuropathic pain per IASP, DN4 ≥4, pain duration ≥6 months, failure of ≥2 first-line classes, BPI interference ≥4. Exclusions: uncontrolled psychosis, pregnancy, uncontrolled hypertension, prior ketamine for pain in 6 months, inability to attend three visits.",
    exposure:
      "Ketamine 0.5 mg/kg/h IV for 4 hours, three sessions in 14 days, with standard ASA-derived monitoring in the clinic. Control: midazolam titrated to light sedation, same chair, same nursing contact time.",
    procedures:
      "Screening visit, baseline questionnaires, three infusion visits, phone check at 48 h after each session, clinic or virtual follow-up at 2, 12, 26 weeks. Driving prohibition 24 h. Emergency unblinding path via pharmacy.",
    outcomes: [
      oc({
        id: "o1",
        role: "primary",
        name: "BPI pain interference",
        measure: "Mean BPI interference subscale",
        timing: "12 weeks",
        why: "The bargain patients actually make.",
        patientCentered: true,
      }),
      oc({
        id: "o2",
        role: "secondary",
        name: "PGIC",
        measure: "Patient Global Impression of Change",
        timing: "12 weeks",
        why: "Anchor for clinical importance.",
        patientCentered: true,
      }),
      oc({
        id: "o3",
        role: "secondary",
        name: "Pain intensity",
        measure: "BPI intensity",
        timing: "2, 12, 26 weeks",
        why: "Comparability with prior trials — not the decision outcome.",
        patientCentered: true,
      }),
      oc({
        id: "o4",
        role: "secondary",
        name: "Opioid morphine equivalent",
        measure: "mg/day",
        timing: "12 weeks",
        why: "Of interest, secondary only.",
        patientCentered: false,
      }),
      oc({
        id: "o5",
        role: "balancing",
        name: "Dissociation and serious adverse events",
        measure: "CADSS; MedDRA SAE",
        timing: "each visit + 48 h",
        why: "Harm is part of the bargain.",
        patientCentered: true,
      }),
    ],
    feasibility:
      "Two centres already infuse ketamine. Estimated 4 eligible patients/month/centre. Travel honorarium. Nursing time is the binding constraint — trial uses existing slots rather than creating a new service.",
    biasMitigation: [
      "Central randomization, opaque allocation",
      "Attention-matched control and identical monitoring",
      "Outcome assessor blinded; participant blinding assessed",
      "Pre-specified SAP; no stepwise covariate hunting",
      "One primary outcome",
    ],
    biasFlags: [
      { id: "b1", label: "Unblinding by dissociation", severity: "watch", note: "Measure blinding success; do not pretend it is perfect." },
      { id: "b2", label: "Selection into chair-time", severity: "ok", note: "Eligibility already requires attendance — report who declines." },
      { id: "b3", label: "Outcome switching", severity: "ok", note: "Primary locked in protocol and trial registry." },
    ],
    parsimony: {
      score: 82,
      primaryOutcomeCount: 1,
      secondaryOutcomeCount: 4,
      covariateCount: 2,
      flags: ["Do not add sleep, mood, QST, and cytokines as co-primaries."],
      simplestPath:
        "If the 12-week BPI difference is not worth the dissociation, the service should not grow. That is the whole decision.",
    },
    theoreticalFramework:
      "IMMPACT for outcomes; PRECIS-2 for stance; GRADE Evidence-to-Decision for the service recommendation that follows the trial; SEIPS for the clinic work system that must deliver the protocol.",
    generatedAt: "2026-03-18T10:00:00.000Z",
  },
  stats: {
    designSummary:
      "Superiority, 1:1, ANCOVA of 12-week BPI interference with baseline BPI and centre as covariates. ITT as primary; per-protocol as sensitivity, not the headline.",
    sampleSize:
      "MCID 1.0 on BPI interference, SD 2.2 from prior clinic data, 90% power, two-sided 5%, 15% attrition → 116 randomized (58 per arm). No interim efficacy look. Safety DSMB after 40.",
    primaryAnalysis:
      "ANCOVA as above. Report adjusted mean difference with 95% CI and the proportion achieving ≥1 point improvement as a descriptive responder analysis (not a second primary).",
    secondaryAnalysis:
      "Mixed model for 2/12/26-week BPI. PGIC ordinal. Opioid MME ANCOVA. Phenotype interaction pre-specified as exploratory, not a claim.",
    missingData:
      "Primary: mixed model under MAR. Sensitivity: multiple imputation, then tipping-point. Do not last-observation-carry-forward.",
    multiplicity:
      "One primary. Secondaries unadjusted, explicitly hierarchical in the SAP (PGIC, intensity, MME, harms). No silent fishing.",
    software: "R (pre-registered script). Independent statistician. Locked dataset.",
    overfittingGuards: [
      "Covariates: baseline outcome + centre only",
      "No automated variable selection",
      "Phenotype work is exploratory",
      "No machine-learning overlay on n≈116",
    ],
    generatedAt: "2026-03-18T15:00:00.000Z",
  },
  ethics: {
    risks:
      "Dissociation, nausea, hypertension, rare emergence phenomena, next-day impairment, possible mood destabilization. Hepatic and urologic harms unlikely at this cumulative dose but disclosed. Therapeutic misconception: this is not 'the ketamine clinic fast lane.'",
    consent:
      "Written, capacity-checked, cooling-off overnight before first infusion. Explicit off-label language. Driving, childcare, and work restrictions in plain language. Partner/family information sheet optional, not a proxy.",
    data:
      "PHIPA + TCPS 2. De-identified analysis files. No training of external models on identifiable notes. Retention per institutional policy.",
    equity:
      "PROGRESS-Plus table at baseline. Travel honorarium. Evening slot attempt at one centre. Sex and gender analysis pre-specified as descriptive. Language access. Do not run a trial only the well-resourced can attend and then call it pragmatic.",
    effectiveness:
      "If negative on function, the honest product is a service contraction, not a 'more research is needed' shrug.",
    efficiency:
      "Uses existing chairs. Statistician time and pharmacy blinding are the incremental costs. Do not build a parallel research infusion unit.",
    costs:
      "Drug cost is modest vs chair + RN time. Include a simple cost-consequence (not a full CHEERS model) as a secondary health-system view.",
    grants:
      "CIHR project, hospital AFP innovation, Pain Canada partnered schemes. Avoid industry primary funding given off-label ketamine optics — disclose any in-kind.",
    partnerships:
      "Two patient partners on the protocol team (GRIPP2). One family advisor. Pharmacy, nursing, psychiatry liaison. Indigenous health lead consulted on recruitment materials even if the sample is not Indigenous-specific — no helicopter design.",
    rebPath:
      "Board of Record at the academic centre, CTO stream if both sites Ontario. Health Canada CTA assessment with pharmacy. Registration on ClinicalTrials.gov before first patient.",
    limitations:
      "Meridian drafts; REB, Health Canada, and a named statistician sign. This document is not approval.",
    generatedAt: "2026-03-19T09:00:00.000Z",
  },
  voices: {
    partnershipPlan:
      "Two paid patient partners from protocol through interpretation. They chose BPI interference over NRS and vetoed a six-session protocol as unlivable. GRIPP2 short form in the manuscript.",
    socialListening:
      "Public posts polarize ketamine as miracle or club drug. Clinical takeaway: consent must name both the hype and the stigma or people will fill the silence themselves. Not a tweet sample — a theme.",
    items: [
      vo({
        id: "v1",
        source: "patient",
        theme: "Function is the bargain",
        quote:
          "I don't care if you knock two points off my number if I still can't stand in the kitchen. Give me three weeks of being a person.",
        implication: "Primary = interference, not intensity.",
        verification: "landmark",
      }),
      vo({
        id: "v2",
        source: "family",
        theme: "The day after",
        quote: "Someone has to drive, cancel work, and watch them that evening. That cost never shows up in the paper.",
        implication: "Report caregiver time; 24 h driving ban in consent.",
        verification: "verify",
      }),
      vo({
        id: "v3",
        source: "clinician",
        theme: "Chair rationing",
        quote: "We are already choosing who gets a Thursday by who can be here at 07:30.",
        implication: "Eligibility and declining logs are equity data.",
        verification: "verify",
      }),
      vo({
        id: "v4",
        source: "social",
        theme: "Stigma vs miracle",
        quote: "Feeds swing between 'this cured my pain' and 'this is horse tranquilizer.'",
        implication: "Education materials must be dull and accurate.",
        verification: "ai-lead",
      }),
    ],
    generatedAt: "2026-03-19T12:00:00.000Z",
  },
  manuscript: {
    title:
      "Subanesthetic intravenous ketamine versus attention control for refractory neuropathic pain: protocol for a pragmatic, two-centre randomized trial",
    abstract:
      "Background. Intravenous ketamine is used off-label for refractory neuropathic pain on the strength of short-term intensity reductions of low certainty. Patient-important function at 12 weeks is largely untested, while access, stigma, and dissociation are not. Methods. We describe a two-centre, parallel-group, randomized, attention-controlled pragmatic trial. Adults with IASP neuropathic pain, DN4 ≥4, and failure of two first-line drug classes are allocated 1:1 to three 4-hour subanesthetic ketamine sessions or matched midazolam. The primary outcome is Brief Pain Inventory interference at 12 weeks. Secondary outcomes are global impression of change, intensity, opioid dose, and harms. Analysis is ANCOVA of the primary outcome with baseline and centre; one primary; no stepwise selection. Ethics. TCPS 2, Board of Record, CTA assessment, patient partners (GRIPP2). Discussion. A negative functional result should shrink the service. A positive one should standardize it. Either is more useful than another NRS.",
    introduction:
      "First-line pharmacotherapy for neuropathic pain remains gabapentinoids, SNRIs, and tricyclics. A minority of patients are refractory and are referred for intravenous ketamine, an NMDA antagonist with a short, heterogeneous, and mostly intensity-based evidence base. Consensus statements permit specialist use. They do not tell a Canadian clinic whether three chair-days are worth the dissociation for the people who can actually attend. This protocol privileges one functional primary outcome, names the work-system constraints, and refuses a kitchen-sink methods section.",
    methods:
      "Design, eligibility, intervention (TIDieR), randomization, blinding, outcomes, sample size, SAP summary, PPI, and ethics as specified in the protocol stage. Reporting: SPIRIT now; CONSORT at completion; PRECIS-2 wheel in the appendix.",
    results:
      "Not applicable — protocol. A schematic PRECIS-2 and participant timeline replace empty 'results.'",
    discussion:
      "The trial is deliberately small in ambition: one service, one bargain, one number that means a life. Limitations include imperfect blinding, a refractory pool that is not the whole neuropathic population, and two centres that already believe in the intervention. Those limitations are reasons for a pragmatic design, not for a bigger, noisier one.",
    limitations:
      "Attention control cannot match the ketamine inner experience. Two centres limit transportability. Twelve weeks is not a year. Off-label status may slow recruitment. Meridian-generated prose was edited by investigators; citations require live verification at submission.",
    conclusion:
      "If function does not move, stop expanding ketamine chairs. If it does, write the SOP the grey literature has been improvising.",
    reportingChecklist: "SPIRIT 2013 (protocol). CONSORT 2010 reserved for results. TIDieR. GRIPP2-SF. PRECIS-2.",
    generatedAt: "2026-03-20T10:00:00.000Z",
  },
  audit: {
    lastReview: "2026-09-04T14:20:00.000Z",
    openFixes: [
      "Verify Orhurhu 2019 effect sizes against the PDF before submission.",
      "Confirm Health Canada CTA trigger with pharmacy, not from memory.",
    ],
    improvementNotes:
      "Patient partners killed a six-session protocol and a cytokine sub-study. Keep that veto power. Next cycle: add a one-page PRECIS-2 earlier in design.",
    entries: [
      {
        id: "a1",
        at: "2026-03-12T10:05:00.000Z",
        kind: "generate",
        stage: "problem",
        summary: "Structured the clinic itch into a problem statement.",
      },
      {
        id: "a2",
        at: "2026-03-16T12:00:00.000Z",
        kind: "fix",
        stage: "hypotheses",
        summary: "Dropped dose-finding as primary — over-complexity.",
      },
      {
        id: "a3",
        at: "2026-03-19T12:00:00.000Z",
        kind: "edit",
        stage: "voices",
        summary: "Partners rewrote the bargain in the primary outcome.",
      },
    ],
  },
};

const eras = {
  id: "seed-eras",
  title: "Unplanned overnight stays after elective colorectal ERAS",
  subtitle: "A PDSA program aimed at same-calendar-day discharge without harm",
  family: "qi-pdsa",
  setting: "Academic colorectal service, Ontario — 18 elective beds, shared PACU",
  status: "active",
  createdAt: "2026-01-08T09:00:00.000Z",
  updatedAt: "2026-08-22T16:00:00.000Z",
  currentStage: "audit",
  completedStages: [
    "problem",
    "scan",
    "map",
    "gaps",
    "hypotheses",
    "questions",
    "design",
    "protocol",
    "stats",
    "ethics",
    "voices",
    "manuscript",
  ],
  problem: {
    rawNeed:
      "We run ERAS but a third of elective colorectal patients still stay overnight for urinary retention, PONV, late PACU exits, and analgesia that was never planned for the walk to the car.",
    statement:
      "On an established ERAS colorectal pathway, unplanned overnight stays cluster around a short list of recoverable failures — voiding, nausea, PACU flow, and analgesia — rather than true medical unfitness. The overnight stay is being used as a buffer for system unreliability, at a cost to patients, families, and bed flow.",
    whoAffected:
      "Adults booked for elective colorectal resection on an ERAS pathway; families expecting a same-day or 23-hour stay; night nursing; the next day's elective list competing for beds.",
    whatHurts:
      "A night nobody planned, missed stoma teaching in daylight, rural families booking hotels, delayed first oral intake, morale on a pathway that 'already does ERAS.'",
    currentPractice:
      "ERAS elements are ticked. Discharge criteria exist on paper. Urinary catheters come out late. PACU holds for portering. Analgesia is generic rather than procedure-specific (PROSPECT).",
    whyNow:
      "Bed pressure is not theoretical. The service has baseline data. Leadership will fund a QI nurse for two PDSA ramps, not a trial.",
    constraints:
      "Cannot add PACU nurses at night. Fee-for-service lists start at 07:45. Language access for teaching. Stoma therapists are weekday-only.",
    patientCenteredGoal:
      "Go home when medically ready, in daylight, with a named adult, without coming back at 02:00 for urinary retention or vomiting.",
    generatedAt: "2026-01-08T09:30:00.000Z",
  },
  scan: {
    query: "ERAS colorectal same-day discharge urinary retention PONV PROSPECT SQUIRE SPC",
    sourcesConsulted: ["PubMed", "ERAS Society", "PROSPECT", "SQUIRE", "HQO", "Google Scholar", "NICE"],
    gradeOverall: "moderate",
    gradeRationale:
      "ERAS itself has moderate-to-high certainty for reducing length of stay. The overnight-stay drivers (voiding, PONV, flow) have local process evidence plus transferable bundles. This is QI on an evidence-based pathway, not a new molecule.",
    synthesis:
      "Ljungqvist's JAMA Surgery review and ERAS Society colorectal guidelines are the spine. Greco and others show LOS reduction is real. PROSPECT offers procedure-specific analgesia. SQUIRE 2.0 is the reporting frame. IHI Model for Improvement is the method. Local run charts will beat another underpowered 'ERAS vs not' paper. Grey: our own 12-month overnight reasons.",
    items: [
      ev({
        title: "Enhanced Recovery After Surgery: a review",
        authors: "Ljungqvist O, Scott M, Fearon KC",
        year: 2017,
        source: "JAMA Surg",
        kind: "guideline",
        grade: "high",
        methodQuality: 88,
        relevance: 90,
        verification: "landmark",
        contextTags: ["ERAS spine"],
        keyFindings: "Bundled perioperative care reduces LOS and complications when actually implemented.",
        limitations: "Review; local fidelity is the remaining problem.",
        notes: "Do not re-prove ERAS. Prove our overnight drivers.",
      }),
      ev({
        title: "Guidelines for perioperative care in elective colorectal surgery: ERAS Society",
        authors: "Gustafsson UO, Scott MJ, Hubner M, et al.",
        year: 2019,
        source: "World J Surg",
        kind: "guideline",
        grade: "high",
        methodQuality: 90,
        relevance: 94,
        verification: "landmark",
        contextTags: ["colorectal", "elements"],
        keyFindings: "Itemized ERAS elements with evidence grades; urinary drainage and PONV are named.",
        limitations: "Guideline ≠ local run chart.",
        notes: "Use as the standard work checklist.",
      }),
      ev({
        title: "SQUIRE 2.0: revised standards for quality improvement reporting",
        authors: "Ogrinc G, Davies L, Goodman D, et al.",
        year: 2016,
        source: "BMJ Qual Saf",
        kind: "guideline",
        grade: "high",
        methodQuality: 86,
        relevance: 85,
        verification: "landmark",
        contextTags: ["reporting"],
        keyFindings: "Context, study of the intervention, and measures — including balancing.",
        limitations: "Reporting, not a method.",
        notes: "Manuscript skeleton.",
      }),
      ev({
        title: "PROSPECT: procedure-specific postoperative pain management",
        authors: "Joshi GP, Van de Velde M, Kehlet H, et al.",
        year: 2020,
        source: "Anaesthesia / PROSPECT",
        kind: "guideline",
        grade: "moderate",
        methodQuality: 80,
        relevance: 78,
        verification: "landmark",
        contextTags: ["analgesia"],
        keyFindings: "Analgesia should be procedure-specific, not 'everyone gets a PCA.'",
        limitations: "Colorectal subsets vary (open vs MIS, stoma).",
        notes: "PDSA ramp 2 candidate.",
      }),
      ev({
        title: "Local 12-month overnight-stay reasons (unit data)",
        authors: "Unit QI file",
        year: 2025,
        source: "Department grey data",
        kind: "qi-report",
        grade: "low",
        methodQuality: 50,
        relevance: 98,
        verification: "verify",
        contextTags: ["local drivers"],
        keyFindings:
          "32% unplanned overnight. Top reasons: urinary retention 28%, PONV 22%, late PACU 19%, analgesia 15%, medical 16%.",
        limitations: "Single coder, no denominator audit until this project.",
        notes: "The driver diagram starts here.",
      }),
    ],
    generatedAt: "2026-01-10T11:00:00.000Z",
  },
  map: {
    contexts: [
      "PACU portering",
      "Weekday-only stoma therapy",
      "Fee-for-service start times",
      "Rural families",
      "Night RN skill-mix",
      "Catheter culture",
    ],
    reading:
      "ERAS literature assumes a pathway. Our overnight stays are mostly not failures of the pathway's science; they are failures of the afternoon. Catheters, ondansetron timing, and a PACU that cannot empty are the connected tissue. Re-evaluating Greco after looking at the portering log moves the project from 'more ERAS education' to 'voiding bundle + PACU clock.'",
    nodes: [
      { id: "e-eras", label: "ERAS Society colorectal", kind: "guideline" },
      { id: "e-ljung", label: "Ljungqvist review", kind: "guideline" },
      { id: "e-prospect", label: "PROSPECT analgesia", kind: "guideline" },
      { id: "e-squire", label: "SQUIRE 2.0", kind: "guideline" },
      { id: "e-local", label: "Local overnight reasons", kind: "qi-report" },
      { id: "e-void", label: "Urinary retention", kind: "gap" },
      { id: "e-ponv", label: "PONV", kind: "gap" },
      { id: "e-pacu", label: "PACU flow", kind: "context" },
      { id: "e-stoma", label: "Stoma teaching hours", kind: "context" },
      { id: "e-rural", label: "Rural pickup", kind: "context" },
      { id: "e-home", label: "Daylight discharge", kind: "outcome" },
      { id: "e-readmit", label: "Readmission (balancing)", kind: "outcome" },
      { id: "e-ihi", label: "Model for Improvement", kind: "framework" },
    ],
    edges: [
      { from: "e-eras", to: "e-local", relation: "standard vs fidelity" },
      { from: "e-local", to: "e-void", relation: "top driver" },
      { from: "e-local", to: "e-ponv", relation: "second driver" },
      { from: "e-local", to: "e-pacu", relation: "third driver" },
      { from: "e-stoma", to: "e-home", relation: "blocks daylight" },
      { from: "e-rural", to: "e-home", relation: "pickup window" },
      { from: "e-void", to: "e-readmit", relation: "balancing risk" },
      { from: "e-ihi", to: "e-void", relation: "PDSA target" },
      { from: "e-prospect", to: "e-home", relation: "walk-to-car pain" },
    ],
    generatedAt: "2026-01-11T10:00:00.000Z",
  },
  gaps: {
    items: [
      gap({
        id: "eg1",
        title: "Catheter removal time is a habit, not a criterion",
        kind: "implementation",
        severity: "high",
        whyItMatters: "Retention is the leading overnight reason and is largely iatrogenic timing.",
        opportunity: "Standard work: out in PACU unless a named exception.",
      }),
      gap({
        id: "eg2",
        title: "PONV prophylaxis not risk-stratified",
        kind: "method",
        severity: "moderate",
        whyItMatters: "Two agents for high-risk, one for everyone else — currently inverted by list pressure.",
        opportunity: "Apfel score on the booking sheet.",
      }),
      gap({
        id: "eg3",
        title: "Balancing measures missing in the last QI burst",
        kind: "error",
        severity: "high",
        whyItMatters: "A prettier LOS with more 48-hour readmissions is not improvement.",
        opportunity: "Readmission, ED visit, patient-reported readiness as balancing.",
      }),
    ],
    errorsFound: [
      "Previous 'ERAS reboot' used a before–after mean LOS without a run chart — special cause invisible.",
      "Teaching materials only in English.",
    ],
    reevaluation:
      "This is not an RCT of ERAS. It is a reliability project on three drivers, reported with SQUIRE and SPC.",
    generatedAt: "2026-01-12T09:00:00.000Z",
  },
  hypotheses: {
    selectedId: "eh1",
    items: [
      hyp({
        id: "eh1",
        statement:
          "A voiding-and-PONV reliability bundle will reduce unplanned overnight stays from 32% to <18% in 6 months without increasing 7-day readmission.",
        novelty: 30,
        need: 86,
        practiceChange: 80,
        feasibility: 88,
        parsimony: 90,
        rationale: "Targets the two largest local drivers with standard work. Not novel. Worth doing.",
        risks: "Gaming discharge; missed retention at home.",
      }),
    ],
    generatedAt: "2026-01-12T11:00:00.000Z",
  },
  questions: {
    finer: "Feasible with a QI nurse and existing lists. Interesting to the ward. Not novel. Ethical as usual care plus reliability. Relevant this winter.",
    items: [
      q({
        id: "eq1",
        text: "We will reduce unplanned overnight stays after elective colorectal ERAS from 32% to less than 18% by 31 July 2026, without raising 7-day readmission above baseline.",
        framework: "QI-aim",
        population: "Elective colorectal ERAS adults",
        intervention: "Voiding bundle + stratified PONV + PACU clock",
        comparator: "Baseline 12-month performance",
        outcome: "Unplanned overnight stay (primary process/outcome hybrid)",
        time: "Weekly, 6 months",
        setting: "Single academic service",
      }),
    ],
    generatedAt: "2026-01-12T12:00:00.000Z",
  },
  design: {
    recommended: "qi-pdsa",
    rationale:
      "The question is reliability of a known pathway, not efficacy of a new one. PDSA + annotated run chart. SQUIRE for the write-up. A trial would be slower, more expensive, and ethically odd for standard work.",
    alternatives: ["Cluster RCT of the bundle — overkill.", "Retrospective only — cannot improve."],
    guidelines: ["SQUIRE 2.0", "IHI Model for Improvement", "PROSPECT", "ERAS Society"],
    whyNotMoreComplex: "Three ramps, not a hospital-wide transformation office.",
    generatedAt: "2026-01-13T09:00:00.000Z",
  },
  protocol: {
    overview:
      "IHI Model for Improvement. SMART aim. Driver diagram. Three PDSA ramps: (1) catheter standard work, (2) Apfel-stratified PONV, (3) PACU-to-ward clock. Weekly annotated run chart.",
    population: "All elective colorectal ERAS cases for 6 months; exclude emergencies and ICU-planned.",
    exposure: "Reliability bundle as standard work, iterated.",
    procedures:
      "Ramp 1: catheter out in PACU unless surgeon writes a reason. Ramp 2: Apfel ≥3 gets two anti-emetics + TIVA default. Ramp 3: portering pager at wheels-in minus 20 min. Huddle twice weekly.",
    outcomes: [
      oc({
        id: "eo1",
        role: "primary",
        name: "Unplanned overnight stay",
        measure: "% of elective ERAS colorectal",
        timing: "weekly",
        why: "The aim.",
        patientCentered: true,
      }),
      oc({
        id: "eo2",
        role: "balancing",
        name: "7-day readmission or ED",
        measure: "%",
        timing: "weekly",
        why: "Do not send people home to bounce.",
        patientCentered: true,
      }),
      oc({
        id: "eo3",
        role: "process",
        name: "Catheter out in PACU",
        measure: "%",
        timing: "weekly",
        why: "Fidelity of ramp 1.",
        patientCentered: false,
      }),
      oc({
        id: "eo4",
        role: "balancing",
        name: "Patient-reported readiness",
        measure: "single item 0–10",
        timing: "discharge",
        why: "Readiness is not the same as an empty bed.",
        patientCentered: true,
      }),
    ],
    feasibility: "QI nurse 0.3 FTE already funded. No new IT. Paper-to-EMR tick-box is the only build.",
    biasMitigation: [
      "Operational definition of 'unplanned overnight' locked",
      "Annotated run chart, not a two-mean t-test",
      "Balancing measures on the same board",
    ],
    biasFlags: [
      { id: "eb1", label: "Case-mix shift", severity: "watch", note: "Report elective mix monthly." },
      { id: "eb2", label: "Definition drift", severity: "ok", note: "Locked in the aim statement." },
    ],
    parsimony: {
      score: 88,
      primaryOutcomeCount: 1,
      secondaryOutcomeCount: 1,
      covariateCount: 0,
      flags: [],
      simplestPath: "Make afternoon physiology and flow reliable. Do not relaunch ERAS education.",
    },
    theoreticalFramework: "IHI Model for Improvement; Donabedian process; SEIPS for PACU/ward interface.",
    generatedAt: "2026-01-14T10:00:00.000Z",
  },
  stats: {
    designSummary:
      "Statistical process control. P-chart for overnight proportion. Rules: 8 below centreline, or a point beyond 3σ, as signal. No p-value for the aim.",
    sampleSize:
      "Not an RCT. Baseline n≈18/week. Six months is enough for special-cause rules. If volume drops, extend time, do not peek with a t-test.",
    primaryAnalysis: "Annotated p-chart. Present with process measures on a single page.",
    secondaryAnalysis: "Readmission p-chart. Qualitative huddle notes thematically, light touch.",
    missingData: "Missing reason codes audited weekly; >5% missing is itself a finding.",
    multiplicity: "One aim. Do not 'also' test ten ERAS elements.",
    software: "R qicharts2 or Excel p-chart already used by the unit — do not introduce a new stack.",
    overfittingGuards: [
      "No multivariate 'predict overnight' model on 400 rows",
      "No breaking the chart into pretty subgroups after the fact",
    ],
    generatedAt: "2026-01-14T12:00:00.000Z",
  },
  ethics: {
    risks: "Premature discharge, missed retention, family strain. Usual care plus reliability — REB often QI-exempt but we file a determination.",
    consent: "Pathway consent already covers ERAS. Information sheet on the voiding bundle. Opt-out of extra questionnaires only.",
    data: "Unit identifiable for care; analysis on a de-identified weekly file. PHIPA.",
    equity: "Language of teaching materials; rural pickup windows; weekday stoma access is an equity issue, not a nicety.",
    effectiveness: "Aim is patient-important (a night not spent in hospital) with a balancing harm.",
    efficiency: "Bed-days and hotel costs. Do not count 'savings' that are just shifted to families.",
    costs: "0.3 FTE QI nurse, print, ondansetron — trivial vs a bed-night.",
    grants: "Hospital QI fund. Not CIHR.",
    partnerships: "Two recent patients on the driver-diagram workshop. Ward RN lead. Stoma therapist. Anesthesia PONV lead.",
    rebPath: "QI determination letter on file. If publishing, SQUIRE and the determination attached.",
    limitations: "Single service. Not generalisable by rhetoric.",
    generatedAt: "2026-01-15T09:00:00.000Z",
  },
  voices: {
    partnershipPlan: "Workshop with two former patients and a family driver. They added 'daylight' to the aim.",
    socialListening: "Public ERAS talk is mostly marketing. Local Facebook caregiver groups mention hotel nights — treat as a signal to verify, not a sample.",
    items: [
      vo({
        id: "ev1",
        source: "patient",
        theme: "Daylight",
        quote: "I did not fail ERAS. The afternoon failed me. I waited for a ride in the dark.",
        implication: "Aim includes daylight, not just 'not a bed.'",
        verification: "landmark",
      }),
      vo({
        id: "ev2",
        source: "family",
        theme: "Hotel night",
        quote: "We booked a hotel because you never call when you say you will.",
        implication: "Pickup window communication is a process measure.",
        verification: "verify",
      }),
    ],
    generatedAt: "2026-01-15T11:00:00.000Z",
  },
  manuscript: {
    title:
      "Reducing unplanned overnight stays after elective colorectal ERAS: a SQUIRE-guided PDSA program",
    abstract:
      "Local data showed 32% unplanned overnight stays, mostly urinary retention, PONV, and PACU flow — not medical unfitness. We used the Model for Improvement with three PDSA ramps and a p-chart. The aim is <18% overnight stays without an increase in 7-day readmission. This is reliability work on a known pathway, not a new ERAS trial.",
    introduction:
      "ERAS colorectal care is evidence-based. Our problem is afternoon reliability. We report according to SQUIRE 2.0.",
    methods:
      "Setting, driver diagram, ramps, operational definitions, SPC, PPI, QI ethics determination.",
    results:
      "Baseline 32%. After ramp 1 (catheter standard work) a run of eight points below the centreline on the process measure. Overnight stays moved — see unit p-chart in the figure. Readmission stable. (Figures are schematic in the studio until live weekly data are pasted.)",
    discussion:
      "Education was not the intervention. Standard work and a clock were. Limits: one service, elective only, daylight aim is geography-dependent.",
    limitations: "No contemporaneous control ward. Case-mix watched, not adjusted into a pretty model.",
    conclusion: "If the chart stays down, keep the standard work. If not, do not add a fourth teaching module — look at the next special cause.",
    reportingChecklist: "SQUIRE 2.0",
    generatedAt: "2026-08-01T10:00:00.000Z",
  },
  audit: {
    lastReview: "2026-08-22T16:00:00.000Z",
    openFixes: ["Paste live p-chart points each Monday.", "Translate teaching sheet to the unit's second language."],
    improvementNotes: "Do not let the next fellow turn this into an underpowered RCT.",
    entries: [
      {
        id: "ea1",
        at: "2026-01-12T11:00:00.000Z",
        kind: "note",
        stage: "design",
        summary: "Rejected cluster RCT as over-complexity.",
      },
    ],
  },
};

const night = {
  id: "seed-night",
  title: "Opioid infusion programming errors on night shift",
  subtitle: "A mixed-methods safety study using SEIPS, not blame",
  family: "mixed-methods",
  setting: "Anesthesia / PACU / ward interface, 650-bed hospital, night coverage",
  status: "draft",
  createdAt: "2026-06-02T22:00:00.000Z",
  updatedAt: "2026-07-18T07:40:00.000Z",
  currentStage: "hypotheses",
  completedStages: ["problem", "scan", "map", "gaps"],
  problem: {
    rawNeed:
      "PCA and opioid infusion programming errors cluster after 23:00. People look tired and the incident form looks like a person. I think the work system is the patient.",
    statement:
      "Programming errors on opioid infusions and PCAs concentrate on night shift at the anesthesia–PACU–ward interface. Treating them as individual slips misses handover load, pump UI, fatigue, and verbal-order culture. A SEIPS-informed mixed-methods study can describe the work as done and propose a parsimonious change.",
    whoAffected:
      "Patients on opioid infusions at night; night anesthesiologists, PACU and ward nurses; the person who inherits a wrong program at 07:00.",
    whatHurts:
      "Overdose and under-treatment, both; second-victim load; a reporting system that still reads as blame.",
    currentPractice:
      "Incident reports, annual pump training, fatigue left to professionalism. Double-check policy exists on paper at change of shift and is skipped when the board is full.",
    whyNow:
      "Three serious events in 14 months, all after 23:00, all involving a programming or handover step. The next response must not be another memo.",
    constraints:
      "Cannot add a second night anesthesiologist this year. Pump fleet replacement is a 3-year capital item. Unioned breaks. Fear of reporting.",
    patientCenteredGoal:
      "The right opioid, at the right program, on the right person, through the night — without asking exhausted people to try harder.",
    generatedAt: "2026-06-02T22:30:00.000Z",
  },
  scan: {
    query: "PCA programming error night shift fatigue SEIPS anesthesia medication ISMP handover",
    sourcesConsulted: ["PubMed", "ISMP", "CMPA", "Google Scholar", "HFES", "local incident database"],
    gradeOverall: "moderate",
    gradeRationale:
      "Strong human-factors and fatigue literature (Landrigan and others) of high certainty for error under extended hours. Direct evidence on night PCA programming in Canadian anesthesia is thin and local. Mix of high-certainty mechanism and low-certainty local epidemiology.",
    synthesis:
      "Landrigan 2004 linked extended intern hours to serious errors. Reason's model and Carayon's SEIPS prevent person-blame designs. ISMP has repeatedly warned on PCA and smart-pump programming. Local incidents are a convenience sample with under-reporting. Grey: pump vendor UI, night staffing templates. Do not run a trial of 'mindfulness.' Describe the work, then pick one constraint to lift.",
    items: [
      ev({
        title: "Effect of reducing interns' work hours on serious medical errors",
        authors: "Landrigan CP, Rothschild JM, Cronin JW, et al.",
        year: 2004,
        source: "N Engl J Med",
        kind: "rct",
        grade: "high",
        methodQuality: 90,
        relevance: 70,
        verification: "landmark",
        contextTags: ["fatigue", "hours"],
        keyFindings: "Reducing extended shifts reduced serious medical errors in ICU.",
        limitations: "Interns, not staff anesthesiologists; US; old rostering.",
        notes: "Mechanism is live; rostering is not copy-paste.",
      }),
      ev({
        title: "SEIPS 2.0: a human factors framework for studying health care",
        authors: "Holden RJ, Carayon P, Gurses AP, et al.",
        year: 2013,
        source: "Ergonomics / related SEIPS corpus",
        kind: "guideline",
        grade: "high",
        methodQuality: 86,
        relevance: 95,
        verification: "landmark",
        contextTags: ["work system"],
        keyFindings: "Person, tasks, tools, environment, organization — and the patient as part of the system.",
        limitations: "Framework, not an effect size.",
        notes: "Interview and observation guide.",
      }),
      ev({
        title: "ISMP guidance on PCA and smart-pump programming",
        authors: "ISMP",
        year: 2022,
        source: "ISMP safety alerts",
        kind: "grey",
        grade: "moderate",
        methodQuality: 70,
        relevance: 92,
        verification: "verify",
        contextTags: ["pump UI", "independent double-check"],
        keyFindings: "Programming and default libraries drive events more than 'inattention.'",
        limitations: "Alert-based, not a prevalence study.",
        notes: "Tool dimension of SEIPS.",
      }),
    ],
    generatedAt: "2026-06-10T08:00:00.000Z",
  },
  map: {
    contexts: ["Night roster", "Pump UI", "Verbal orders", "Handover at 23:00 and 07:00", "Fear of reporting", "PACU overflow to ward"],
    reading:
      "The incidents are not three bad nights. They sit at the intersection of a pump that permits 10× errors, a handover that is a conversation in a doorway, and a fatigue state nobody measures. Re-evaluating Landrigan in this context: hours matter, but a shorter shift with the same pump library and the same verbal order will still program the wrong patient.",
    nodes: [
      { id: "n-land", label: "Landrigan hours", kind: "rct" },
      { id: "n-seips", label: "SEIPS", kind: "framework" },
      { id: "n-ismp", label: "ISMP pumps", kind: "grey" },
      { id: "n-local", label: "Three serious events", kind: "qi-report" },
      { id: "n-ui", label: "Pump library / UI", kind: "context" },
      { id: "n-hand", label: "Doorway handover", kind: "context" },
      { id: "n-fear", label: "Reporting climate", kind: "context" },
      { id: "n-fat", label: "Night fatigue", kind: "context" },
      { id: "n-gap", label: "Work-as-done unknown", kind: "gap" },
    ],
    edges: [
      { from: "n-seips", to: "n-ui", relation: "tools" },
      { from: "n-seips", to: "n-hand", relation: "tasks" },
      { from: "n-seips", to: "n-fat", relation: "person/org" },
      { from: "n-ismp", to: "n-ui", relation: "known failure" },
      { from: "n-land", to: "n-fat", relation: "hours→error" },
      { from: "n-local", to: "n-gap", relation: "thin investigation" },
      { from: "n-fear", to: "n-local", relation: "under-reporting" },
    ],
    generatedAt: "2026-06-12T07:00:00.000Z",
  },
  gaps: {
    items: [
      gap({
        id: "ng1",
        title: "Work-as-done at night has not been observed",
        kind: "evidence",
        severity: "high",
        whyItMatters: "Incident forms capture work-as-imagined after the fact.",
        opportunity: "Night observation + interviews before any 'solution.'",
      }),
      gap({
        id: "ng2",
        title: "Independent double-check is a policy, not a behaviour",
        kind: "implementation",
        severity: "high",
        whyItMatters: "The next memo will bounce off a full board.",
        opportunity: "Measure the check as done, or replace it with a forcing function in the pump.",
      }),
    ],
    errorsFound: [
      "Root-cause analyses named 'failure to follow policy' — a person-label, not a cause.",
    ],
    reevaluation:
      "Need mixed methods first. A trial of a new double-check would be over-optimization on an unobserved system.",
    generatedAt: "2026-06-14T06:30:00.000Z",
  },
  hypotheses: emptyHypotheses(),
  questions: emptyQuestions(),
  design: emptyDesign(),
  protocol: emptyProtocol(),
  stats: emptyStats(),
  ethics: emptyEthics(),
  voices: emptyVoices(),
  manuscript: emptyManuscript(),
  audit: {
    entries: [
      {
        id: "na1",
        at: "2026-06-14T06:30:00.000Z",
        kind: "note",
        stage: "gaps",
        summary: "Stopped before hypothesising a training intervention.",
      },
    ],
    openFixes: ["Need REB path before night observation.", "Invite a patient partner who has been on a PCA."],
    improvementNotes: "",
  },
};

export const SEED_STUDIES: Study[] = [ketamine, eras, night].map((s) => migrateStudy(s));

export const SEED_IDS = SEED_STUDIES.map((s) => s.id);
