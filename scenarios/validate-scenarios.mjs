#!/usr/bin/env node
// validate-scenarios.mjs: checks Meridian usage-scenario files against SCENARIO_FORMAT.md, format version 1.2.
// Validator revision 1.3 (2026-09-22, the late illuminate step with its during actions). Revision 1.2 is kept as
// bank-samples/original-v1/validate-scenarios.v1-2.mjs, revision 1.1 as validate-scenarios.v1-1.mjs there.
//
// Usage: node validate-scenarios.mjs <dir> [--forbidden <terms.txt>] [--index <INDEX.json>]
//   <dir>         folder whose *.json files are scenarios. Subfolders are not read. Bank metadata files (a name
//                 in capitals, such as INDEX.json, ASSIGNMENTS.json or ASSIGNMENT_BATCHES.json) are skipped and
//                 listed; every other *.json file is validated as a scenario.
//   --forbidden   optional list, one lowercase term per line (blank lines and lines starting with # are
//                 ignored); any string in a scenario that contains a term fails that scenario
//   --index       write the bank index there when every file passes: [{ id, title, field, level, family,
//                 requires, sha256, eligible }], sha256 of the file bytes, eligible true (authors mark
//                 eligibility only; the runner sets executedWorkflow from observed runs). Nothing is written on
//                 a failure.
//
// Prints one table row per file, then every failure and warning with its rule name and location, then the
// failing rules per file and every semantic duplicate pair. Exit status: 0 every file passes, 1 at least one
// file fails, 2 usage error. No dependencies; Node 18 or later.
//
// Rule names (every failure and warning carries one in brackets):
//   file, top-level, id, early-stop, inputs, need-words      the file and the scenario object
//   step-schema, retrieve, stage-schema, call-numbering, decision-step, expect-schema, work-order
//   outcome-check         every consequential step (retrieve, illuminate, confirm-empty-search, accept-decision,
//                         withdraw-decision, change-source, set-field, mark-complete) carries an expect with at
//                         least one store, stage, issues or error check
//   reload-reopen-expect  every reload and reopen step carries an expect
//   final-export          an export step with expect.export.equalsStore true comes after the last consequential step
//   full-scenario         all 13 stages or a documented earlyStop, a decision step, a reload and a reopen
//   refusal               a level 4 or 5 scenario states at least one refusal
//   G1                    certainty (scan.gradeOverall, certainty text on screen) only after an appraisal over
//                         retrieved records; a discovery step with no retrieved record expects gradeOverall ""
//   G2                    the Scan stage is expected complete only after a retrieved record or confirm-empty-search
//   G7                    change-source follows an accept-decision whose expect states
//                         design.decisions[-1].selectionStatus "accepted" (any negative index), for a decision that
//                         cites the changed record; stale is then checked in the store, on screen, in the export and
//                         after reload
//   G11                   investigator-entered text (typed constraints, the need) is never expected erased or
//                         replaced by a model response; the dropped issue at constraints is never expected absent
//   screen-status         a store check on a status field names status text in the same step's screen.includes
//   duplicate             semantic duplicate of another file in the folder (need text, record titles, trajectory)
//   doi, pmid, trial-number, forbidden, ascii                  text rules over the whole file
//
// Encoded from the repository at 875fe59: the scan discovery keys and every other stage's keys from
// src/lib/ai.ts schemaFor() and DECISION_SCHEMA; the appraisal keys from APPRAISAL_SCHEMA in
// src/lib/evidence/appraise.ts; stableRecordId and its normalisation from src/lib/evidence/records.ts and
// identifiers.ts; the provider body parsers from src/lib/evidence/providers/*.ts; extractJson from src/lib/ai.ts;
// families, stages and issue codes from src/lib/types.ts and src/lib/contracts.ts.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const FORMAT_VERSION = "1.2";
const VALIDATOR_REVISION = "1.3";

const FIELDS = [
  "anesthesia", "pain-medicine", "critical-care", "emergency-medicine", "surgery", "obstetrics", "pediatrics",
  "oncology", "cardiology", "neurology", "psychiatry", "geriatrics", "primary-care", "nursing", "pharmacy",
  "physiotherapy", "public-health", "epidemiology", "health-services", "medical-education",
  "implementation-science", "health-economics", "digital-health", "laboratory-medicine", "radiology",
  "infectious-disease", "palliative-care", "dentistry", "veterinary", "social-work",
];

const FAMILIES = [
  "systematic-review", "scoping-review", "narrative-review", "umbrella-review", "rapid-review", "rct",
  "pragmatic-trial", "cohort", "case-control", "retrospective", "prospective", "cross-sectional", "qualitative",
  "mixed-methods", "diagnostic", "qi-pdsa", "qi-lean", "implementation", "feasibility", "economic",
];

const STAGES = [
  "problem", "scan", "map", "gaps", "hypotheses", "questions", "design", "protocol", "stats", "ethics", "voices",
  "manuscript", "audit",
];

// Top-level keys of each stage's JSON schema (ai.ts schemaFor; the design stage includes "decision").
const STAGE_KEYS = {
  problem: ["title", "subtitle", "family", "statement", "whoAffected", "whatHurts", "currentPractice", "whyNow", "constraints", "patientCenteredGoal", "summary"],
  map: ["contexts", "reading", "nodes", "edges", "summary"],
  gaps: ["items", "errorsFound", "reevaluation", "summary"],
  hypotheses: ["items", "selectedId", "summary"],
  questions: ["items", "finer", "summary"],
  design: ["recommended", "rationale", "alternatives", "guidelines", "whyNotMoreComplex", "decision", "summary"],
  protocol: ["overview", "population", "exposure", "procedures", "outcomes", "feasibility", "biasMitigation", "biasFlags", "parsimony", "theoreticalFramework", "summary"],
  stats: ["designSummary", "sampleSize", "primaryAnalysis", "secondaryAnalysis", "missingData", "multiplicity", "software", "overfittingGuards", "summary"],
  ethics: ["risks", "consent", "data", "equity", "effectiveness", "efficiency", "costs", "grants", "partnerships", "rebPath", "limitations", "summary"],
  voices: ["partnershipPlan", "socialListening", "items", "summary"],
  manuscript: ["title", "abstract", "introduction", "methods", "results", "discussion", "limitations", "conclusion", "reportingChecklist", "summary"],
  audit: ["openFixes", "improvementNotes", "lastReview", "summary"],
};
// The scan call has two shapes (format 1.1): discovery leads (ai.ts) or appraisal of retrieved records (appraise.ts).
const SCAN_SHAPE_KEYS = {
  discovery: ["query", "sourcesConsulted", "gradeOverall", "gradeRationale", "synthesis", "items", "summary"],
  appraisal: ["annotations", "claims", "synthesis", "gradeOverall", "gradeRationale", "summary"],
};
const CLAIM_KINDS = ["source-derived", "local-fact", "assumption", "inference", "scenario"];
const GRADES = ["high", "moderate", "low", "very-low"];

// ai.ts max_tokens per call; a response longer than about 4 characters per token could not have come back.
const STAGE_MAX_TOKENS = { manuscript: 3500 };
const DEFAULT_MAX_TOKENS = 2600;

const ISSUE_CODES_875 = ["invalid-type", "invalid-enum", "out-of-range", "malformed-boolean", "dropped", "resolved", "cleared", "not-an-object"];
const REFUSAL_CODES = ["invalid-type", "invalid-enum", "out-of-range", "malformed-boolean", "dropped", "not-an-object"];

const STUDY_KEYS_875 = [
  "id", "title", "subtitle", "family", "setting", "status", "createdAt", "updatedAt", "currentStage", "completedStages",
  "needsReview", "schemaVersion", "problem", "scan", "map", "gaps", "hypotheses", "questions", "design", "protocol",
  "stats", "ethics", "voices", "manuscript", "audit",
];

// Paths that exist only after work order 2 entries; a scenario that checks them must name the entry in "requires".
const WORK_ORDER_PATHS = [
  [/(^|\.)selectionStatus$/, "DecisionRecord.selectionStatus (S11)"],
  [/(^|\.)actionStatus$/, "DecisionRecord.actionStatus (S11)"],
  [/(^|\.)recommendedFamily$/, "DecisionRecord.recommendedFamily (S11)"],
  [/(^|\.)priorFamily$/, "DecisionRecord.priorFamily (S11)"],
  [/^design\.routing(\.|$)/, "design.routing (S11)"],
  [/(^|\.)quarantine(\.|\[|$)/, "quarantine (S1; A2 item 6)"],
  [/^claims(\[|\.|$)/, "top-level claims (work order)"],
  [/^scan\.claims\[-?\d+\]\.origin$/, "Claim.origin (F1, S5)"],
  [/(^|\.)resourcesAssumed(\[|\.|$)/, "resourcesAssumed (D10)"],
  [/^scan\.items\[-?\d+\]\.abstract(\.|$)/, "EvidenceItem.abstract (D1)"],
  [/^documents(\[|\.|$)/, "study.documents (S3)"],
  [/^meta(\.|$)/, "export meta (R1)"],
  [/(^|\.)sourcesConsultedByEvent(\[|\.|$)/, "scan.sourcesConsultedByEvent (D18)"],
  [/(^|\.)legacyScores(\.|$)/, "legacyScores (M6)"],
  [/(^|\.)idAliases(\[|\.|$)/, "idAliases (M1, S10)"],
  [/^scan\.coverage(\.|$)/, "scan.coverage (S4)"],
  [/^scan\.comparisons(\[|\.|$)/, "scan.comparisons (S9)"],
  [/^replayKey$/, "study.replayKey (R1)"],
];

// screen-status: a store check on one of these fields states a status, so the same step's screen.includes must
// name status text (format 1.1: "a title alone never proves a status"). "status" covers provenance.status,
// decision, gate and retrieval-event status. A needsReview check counts only when it asserts at least one stage
// (an empty needsReview asserts that no status applies, so there is no status text to name).
const STATUS_FIELDS = ["status", "selectionStatus", "actionStatus", "gradeOverall", "grade", "needsReview"];
const CERTAINTY_LABELS = ["high certainty", "moderate certainty", "low certainty", "very low certainty"];
const STATUS_WORDS = [
  "stale", "accepted", "review required", "unrated", "not assessed", "unverified", "leads only", "blocked", "ready",
  "withdrawn", "proposed", "verified", "retrieved", "quarantined", "mismatch", "check failed", "access blocked",
  ...CERTAINTY_LABELS,
];

const PROVIDERS = ["fixture", "openalex", "crossref", "pubmed", "consensus"];
const RAW_RECORD_KEYS = ["title", "authors", "year", "venue", "doi", "providerType", "abstract", "url"];
const FIXTURE_DOI_PREFIX = "10.5555/";

const STEP_SPECS = {
  create: { required: [], optional: [] },
  retrieve: { required: ["provider", "query", "response"], optional: [] },
  illuminate: { required: ["stage"], optional: ["shape", "response", "responseText", "call", "omitKeys", "late", "during"] },
  "confirm-empty-search": { required: [], optional: [] },
  "set-field": { required: ["path", "value"], optional: [] },
  "accept-decision": { required: ["which"], optional: [] },
  "withdraw-decision": { required: ["which"], optional: [] },
  "mark-complete": { required: ["stage"], optional: [] },
  "change-source": { required: ["record", "field", "value"], optional: [] },
  reload: { required: [], optional: [] },
  reopen: { required: [], optional: [] },
  export: { required: [], optional: [] },
  wait: { required: ["ms"], optional: [] },
};
// Steps that change the study or depend on a model or provider response; each must state its outcome.
const CONSEQUENTIAL = ["retrieve", "illuminate", "confirm-empty-search", "accept-decision", "withdraw-decision", "change-source", "set-field", "mark-complete"];
const OUTCOME_KEYS = ["store", "stage", "issues", "error"];
const COMMON_STEP_KEYS = ["do", "expect", "stopOnFail", "note"];
// Format 1.2: investigator actions a late illuminate step holds its reply across (SCENARIO_FORMAT.md, "Late replies").
const DURING_KINDS = ["set-field", "confirm-empty-search", "accept-decision", "withdraw-decision", "change-source", "mark-complete"];
const DURING_MAX = 3;
const EXPECT_KEYS = ["store", "screen", "issues", "export", "stage", "error", "downloads"];
const STAGE_STATES = ["complete", "incomplete", "needs-review"];
const PREDICATE_KEYS = ["oneOf", "includes", "length", "min", "max", "isNull", "absent", "notEquals", "matches"];
const SOURCE_FIELDS = ["abstract", "keyFindings", "year", "status"];
const SOURCE_STATUSES = ["unverified", "retrieved", "verified", "mismatch", "check-failed", "access-blocked"];

const TOP_REQUIRED = ["id", "version", "title", "field", "level", "family", "arm", "synthetic", "requires", "notes", "inputs", "steps"];
const TOP_OPTIONAL = ["earlyStop", "supersedes"];

const LIMITS = {
  fileBytes: 400 * 1024,
  titleChars: [10, 160],
  notesChars: [40, 3000],
  supersedesChars: [20, 1000],
  needWords: [20, 700],
  constraintsChars: 1500,
  localFacts: 12,
  localFactChars: [10, 400],
  earlyStopChars: [20, 600],
  stepNoteChars: 1200,
  responseStringChars: 6000,
  responseTextChars: [1, 20000],
  responseJsonChars: 16000,
  screenTextChars: [1, 300],
  discoveryItemsMax: 12,
  fixtureRecordsMax: 60,
};

// Semantic duplicates: need texts equal after normalisation or with word-set Jaccard above this; record titles
// shared by at least this many; or an identical step trajectory signature.
const DUP_NEED_JACCARD = 0.8;
const DUP_SHARED_TITLES = 2;

const STUDY_PATH = /^[A-Za-z_$][\w$]*(\[-?\d+\])*(\.[A-Za-z_$][\w$]*(\[-?\d+\])*)*$/;
const REQUIRES_ENTRY = /^[A-Z]{1,2}\d{1,2}$/;
const SCENARIO_ID = /^sc-\d{3}(-[a-z0-9]+)*$/;
const REPLAY_KEY = /^[A-Za-z0-9._-]{1,64}$/;
const METADATA_FILE = /^[A-Z][A-Z0-9_]*\.json$/;
const ACCEPTED_PATH = /^design\.decisions\[-\d+\]\.selectionStatus$/;
const CONSTRAINTS_ISSUE_PATH = /^(problem\.)?constraints$/;
const DOI_LIKE = /(?<![\d.])10\.(\d{4,9})(?:\.\d+)*\/[^\s"'<>]*/g;
const PMID_TEXT = /\bPMID\b\s*[:#]?\s*\d{4,9}/i;
const PUBMED_URL = /pubmed\.ncbi\.nlm\.nih\.gov\/\d{4,9}/i;
const TRIAL_NUMBER = /\b(?:NCT\d{8}|ISRCTN\d{8})\b/;
const NON_ASCII = /[^\x00-\x7F]/g;
const UNICODE_HYPHENS = new RegExp(`[${String.fromCharCode(0x2010)}-${String.fromCharCode(0x2015)}]`, "g"); // as in identifiers.ts

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const isPredicate = (v) => isObj(v) && Object.keys(v).length === 1 && PREDICATE_KEYS.includes(Object.keys(v)[0]);
const lastSegment = (p) => p.split(".").pop().replace(/\[-?\d+\]/g, "");
const is2xx = (n) => Number.isInteger(n) && n >= 200 && n < 300;
const show = (v) => {
  const s = v === undefined ? "undefined" : JSON.stringify(v);
  return s.length > 90 ? `${s.slice(0, 87)}...` : s;
};
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const collapse = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObj(a)) {
    if (!isObj(b)) return false;
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => has(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

// Evaluates an expectation (a literal or a predicate, as the runner does) against a value the validator knows.
function evalPredicate(pred, value) {
  if (!isPredicate(pred)) return deepEqual(pred, value);
  const [k, a] = Object.entries(pred)[0];
  switch (k) {
    case "oneOf":
      return Array.isArray(a) && a.some((x) => deepEqual(x, value));
    case "includes":
      if (typeof value === "string") return typeof a === "string" && value.includes(a);
      if (Array.isArray(value)) return value.some((x) => deepEqual(x, a));
      return false;
    case "length":
      return (typeof value === "string" || Array.isArray(value)) && value.length === a;
    case "min":
      if (typeof value === "number") return value >= a;
      return Array.isArray(value) && value.length >= a;
    case "max":
      if (typeof value === "number") return value <= a;
      return Array.isArray(value) && value.length <= a;
    case "isNull":
      return value === null;
    case "absent":
      return value === undefined;
    case "notEquals":
      return !deepEqual(a, value);
    case "matches":
      try {
        return typeof value === "string" && new RegExp(a).test(value);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

// True when text contains the phrase as whole words, in any case ("ready" is not found in "already").
function containsWord(text, phrase) {
  const body = phrase.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp(`(^|[^a-z0-9])${body}($|[^a-z0-9])`, "i").test(text);
}

// ---- stableRecordId, copied from src/lib/evidence/records.ts and identifiers.ts at 875fe59 ----
const TITLE_STOP = new Set(["a", "an", "and", "the", "of", "in", "for", "on", "with", "to", "at", "by", "from", "versus", "vs", "or", "as", "is", "are", "be", "study", "trial", "randomized", "randomised", "controlled"]);
function normalizeDoi(input) {
  if (!input) return undefined;
  const m = String(input).match(/\b(10\.\d{4,9}\/[^\s"'<>)\]]+)/i);
  return m ? m[1].replace(/[.,;:]+$/, "").toLowerCase() : undefined;
}
function titleYearKey(title, year) {
  const tokens = String(title).toLowerCase().replace(UNICODE_HYPHENS, "-").replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((t) => t && !TITLE_STOP.has(t));
  return `${tokens.slice(0, 12).join(" ")}|${year ?? "?"}`;
}
function stableRecordId(r) {
  const key = normalizeDoi(r.doi) ?? titleYearKey(r.title, r.year);
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `ev-${h.toString(36).padStart(7, "0")}`;
}

// ---- provider body parsers, mirrored from src/lib/evidence/providers/*.ts at 875fe59 ----
// Returns the records the adapter would ingest ({ title, year, doi }); [] when the adapter would throw (the
// application then records a failed retrieval) or when the body holds no record (a PubMed esearch body lists
// ids only; its records arrive with the esummary call).
const CONSENSUS_LINE = /^\[(\d+)\]\s+\[(.+?)\]\((https?:\/\/[^)\s]+)\)\s+\((.+)\)\s*$/;
const CONSENSUS_META = /^(?<authors>.+?),\s+(?<year>\d{4}),\s+(?<cites>\d+)\s+citations?(?:,\s+(?<rest>.+))?$/;
function recordsFromBody(provider, body) {
  try {
    if (provider === "openalex") {
      const json = JSON.parse(body);
      if (!Array.isArray(json.results)) return [];
      return json.results.flatMap((w) => {
        const title = w.title?.trim();
        if (!title) return [];
        return [{ title, year: typeof w.publication_year === "number" ? w.publication_year : null, doi: w.doi ?? w.ids?.doi ?? undefined }];
      });
    }
    if (provider === "crossref") {
      const json = JSON.parse(body);
      if (json.status !== "ok" || !json.message) return [];
      return (json.message.items ?? []).flatMap((w) => {
        const title = w.title?.[0]?.trim();
        if (!title) return [];
        const year = w.issued?.["date-parts"]?.[0]?.[0];
        return [{ title, year: typeof year === "number" ? year : null, doi: w.DOI }];
      });
    }
    if (provider === "pubmed") {
      const json = JSON.parse(body);
      const result = json.result;
      if (!result || !Array.isArray(result.uids)) return [];
      return result.uids.flatMap((uid) => {
        const d = result[uid];
        const title = d?.title?.trim();
        if (!d || !title) return [];
        const yearMatch = d.pubdate?.match(/\b(1[89]\d{2}|20\d{2})\b/);
        return [{ title: title.replace(/\.$/, ""), year: yearMatch ? Number(yearMatch[1]) : null, doi: d.articleids?.find((a) => a.idtype === "doi")?.value }];
      });
    }
    if (provider === "consensus") {
      const out = [];
      for (const line of body.split(/\r?\n/)) {
        const m = line.match(CONSENSUS_LINE);
        if (!m) continue;
        const mm = m[4].match(CONSENSUS_META);
        const rest = mm?.groups?.rest ?? "";
        const doiIdx = rest.indexOf("DOI:");
        out.push({ title: m[2].replace(/\.$/, "").trim(), year: mm?.groups ? Number(mm.groups.year) : null, doi: doiIdx >= 0 ? rest.slice(doiIdx + 4) : undefined });
      }
      return out;
    }
  } catch {
    return [];
  }
  return [];
}

// ---- extractJson, mirrored from src/lib/ai.ts: the object the application would parse from a responseText ----
function parseModelText(text) {
  if (typeof text !== "string") return null;
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = (fenced?.[1] ?? text).trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const v = JSON.parse(raw.slice(start, end + 1));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

// Canonical form for the trajectory signature: sorted keys, strings lowercased with whitespace collapsed.
function canonical(v) {
  if (typeof v === "string") return collapse(v);
  if (Array.isArray(v)) return v.map(canonical);
  if (isObj(v)) return Object.keys(v).sort().map((k) => [k, canonical(v[k])]);
  return v;
}

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error("usage: node validate-scenarios.mjs <dir> [--forbidden <terms.txt>] [--index <INDEX.json>]");
  process.exit(2);
}

function parseArgs(argv) {
  const out = { dir: null, forbidden: null, index: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--forbidden" || a === "--index") {
      if (!argv[i + 1]) usage(`${a} needs a path`);
      out[a.slice(2)] = argv[++i];
    } else if (a === "-h" || a === "--help") usage();
    else if (a.startsWith("--")) usage(`unknown option ${a}`);
    else if (out.dir) usage(`unexpected argument ${a}`);
    else out.dir = a;
  }
  if (!out.dir) usage("a scenario folder is required");
  return out;
}

function loadForbidden(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    usage(`cannot read --forbidden file ${file} (${e.code ?? e.message})`);
  }
  return [...new Set(text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")))];
}

// Calls fn(string, path) for every string value and fk(key, path, value) for every object key, depth first.
function walk(v, p, fn, fk) {
  if (typeof v === "string") fn(v, p);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`, fn, fk));
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      const kp = p ? `${p}.${k}` : k;
      fk(k, kp, x);
      walk(x, kp, fn, fk);
    }
  }
}

// True when an expectation states that the Scan stage is complete.
function expectsScanComplete(ex) {
  if (!isObj(ex)) return false;
  if (isObj(ex.stage) && ex.stage.scan === "complete") return true;
  const statesScan = (v) => (Array.isArray(v) && v.includes("scan")) || (isPredicate(v) && v.includes === "scan");
  if (isObj(ex.store) && statesScan(ex.store.completedStages)) return true;
  if (isObj(ex.export) && isObj(ex.export.path) && statesScan(ex.export.path.completedStages)) return true;
  return false;
}

// True when any status field in the object of path predicates is expected to be "stale".
function statesStale(paths) {
  if (!isObj(paths)) return false;
  return Object.entries(paths).some(([p, v]) => ["status", "selectionStatus"].includes(lastSegment(p)) && (v === "stale" || (isPredicate(v) && Array.isArray(v.oneOf) && v.oneOf.length === 1 && v.oneOf[0] === "stale")));
}

// True when a needsReview expectation asserts at least one stage under review.
function assertsNonEmpty(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (!isPredicate(v)) return false;
  if (has(v, "includes")) return true;
  if (has(v, "length")) return v.length > 0;
  if (has(v, "min")) return v.min >= 1;
  if (has(v, "oneOf")) return Array.isArray(v.oneOf) && v.oneOf.length > 0 && v.oneOf.every((x) => Array.isArray(x) && x.length > 0);
  return false;
}

function screenIncludes(ex) {
  // An entry is a string, or { "anyOf": [strings] } (2026-09-22: a semantic check that any listed wording satisfies,
  // for example the G11 refusal shown as "kept", "refused" or "not applied"). For status detection the anyOf
  // words are joined so that any of them can name the status.
  if (!(isObj(ex) && isObj(ex.screen) && Array.isArray(ex.screen.includes))) return [];
  return ex.screen.includes.map((s) => (typeof s === "string" ? s : isObj(s) && Array.isArray(s.anyOf) ? s.anyOf.filter((x) => typeof x === "string").join(" | ") : null)).filter((s) => typeof s === "string");
}

function validateFile(file, forbidden) {
  const r = { file: path.basename(file), id: "", version: "", level: "", field: "", family: "", steps: 0, stages: 0, calls: 0, fails: [], warns: [], sc: null, sha256: "", fp: null };
  const fail = (rule, where, msg) => r.fails.push({ rule, where, msg });
  const warn = (rule, where, msg) => r.warns.push({ rule, where, msg });

  const bytes = fs.readFileSync(file);
  r.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (bytes.length > LIMITS.fileBytes) fail("file", "file", `${bytes.length} bytes exceeds ${LIMITS.fileBytes}`);
  let sc;
  try {
    sc = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    fail("file", "file", `not valid JSON (${e.message})`);
    return r;
  }
  if (!isObj(sc)) {
    fail("file", "file", "the top level must be an object");
    return r;
  }
  r.sc = sc;

  // ---- top level ----
  for (const k of TOP_REQUIRED) if (!has(sc, k)) fail("top-level", k, "required field missing");
  for (const k of Object.keys(sc)) if (!TOP_REQUIRED.includes(k) && !TOP_OPTIONAL.includes(k)) fail("top-level", k, `unknown top-level field (allowed: ${[...TOP_REQUIRED, ...TOP_OPTIONAL].join(", ")})`);
  const base = path.basename(file, ".json");
  if (typeof sc.id !== "string" || !SCENARIO_ID.test(sc.id) || !REPLAY_KEY.test(sc.id)) fail("id", "id", `${show(sc.id)} must match sc-NNN or sc-NNN-suffix (lowercase) and be a valid replay key`);
  else if (sc.id !== base) fail("id", "id", `"${sc.id}" does not match the file name "${base}"`);
  r.id = typeof sc.id === "string" ? sc.id : "";
  if (!Number.isInteger(sc.version) || sc.version < 1) fail("top-level", "version", "the scenario version must be a positive integer (1 for a new scenario)");
  r.version = sc.version ?? "";
  if (Number.isInteger(sc.version) && sc.version > 1) {
    if (typeof sc.supersedes !== "string" || sc.supersedes.trim().length < LIMITS.supersedesChars[0] || sc.supersedes.length > LIMITS.supersedesChars[1]) fail("top-level", "supersedes", `version ${sc.version} must name the file it supersedes and the reason (${LIMITS.supersedesChars[0]} to ${LIMITS.supersedesChars[1]} characters)`);
  } else if (has(sc, "supersedes")) warn("top-level", "supersedes", "present on a version 1 scenario");
  if (typeof sc.title !== "string" || sc.title.length < LIMITS.titleChars[0] || sc.title.length > LIMITS.titleChars[1]) fail("top-level", "title", `must be a string of ${LIMITS.titleChars[0]} to ${LIMITS.titleChars[1]} characters`);
  if (!FIELDS.includes(sc.field)) fail("top-level", "field", `${show(sc.field)} is not in FIELDS`);
  r.field = typeof sc.field === "string" ? sc.field : "";
  if (!Number.isInteger(sc.level) || sc.level < 1 || sc.level > 5) fail("top-level", "level", "must be an integer from 1 to 5");
  r.level = sc.level ?? "";
  if (!FAMILIES.includes(sc.family) && sc.family !== "unresolved") fail("top-level", "family", `${show(sc.family)} is neither one of the 20 study families nor "unresolved"`);
  r.family = typeof sc.family === "string" ? sc.family : "";
  if (sc.arm !== "deterministic") fail("top-level", "arm", 'must be "deterministic"');
  if (sc.synthetic !== true) fail("top-level", "synthetic", "must be true");
  const requires = Array.isArray(sc.requires) ? sc.requires : [];
  if (!Array.isArray(sc.requires)) fail("top-level", "requires", "must be an array (empty when no entry is needed)");
  else {
    sc.requires.forEach((e, i) => {
      if (typeof e !== "string" || !REQUIRES_ENTRY.test(e)) fail("top-level", `requires[${i}]`, `${show(e)} is not a work-order entry name such as D2, S11 or R1`);
    });
    if (new Set(sc.requires).size !== sc.requires.length) fail("top-level", "requires", "duplicate entries");
  }
  if (typeof sc.notes !== "string" || sc.notes.length < LIMITS.notesChars[0] || sc.notes.length > LIMITS.notesChars[1]) fail("top-level", "notes", `must be a string of ${LIMITS.notesChars[0]} to ${LIMITS.notesChars[1]} characters`);
  if (has(sc, "earlyStop") && (typeof sc.earlyStop !== "string" || sc.earlyStop.trim().length < LIMITS.earlyStopChars[0] || sc.earlyStop.length > LIMITS.earlyStopChars[1])) {
    fail("early-stop", "earlyStop", `must be a string of ${LIMITS.earlyStopChars[0]} to ${LIMITS.earlyStopChars[1]} characters that documents why the scenario stops early`);
  }

  // ---- inputs ----
  const inp = isObj(sc.inputs) ? sc.inputs : {};
  if (!isObj(sc.inputs)) fail("inputs", "inputs", "must be an object with need, constraints and localFacts");
  else {
    for (const k of Object.keys(inp)) if (!["need", "constraints", "localFacts"].includes(k)) fail("inputs", `inputs.${k}`, "unknown field");
    if (typeof inp.need !== "string") fail("inputs", "inputs.need", "required string");
    else {
      const w = words(inp.need);
      if (w < LIMITS.needWords[0] || w > LIMITS.needWords[1]) fail("need-words", "inputs.need", `${w} words; the bank accepts ${LIMITS.needWords[0]} to ${LIMITS.needWords[1]}`);
      if (inp.need !== inp.need.trim()) warn("inputs", "inputs.need", "leading or trailing whitespace (the create form trims it)");
    }
    if (typeof inp.constraints !== "string") fail("inputs", "inputs.constraints", "required string (may be empty)");
    else if (inp.constraints.length > LIMITS.constraintsChars) fail("inputs", "inputs.constraints", `${inp.constraints.length} characters exceeds ${LIMITS.constraintsChars}`);
    if (!Array.isArray(inp.localFacts)) fail("inputs", "inputs.localFacts", "required array (may be empty)");
    else {
      if (inp.localFacts.length > LIMITS.localFacts) fail("inputs", "inputs.localFacts", `${inp.localFacts.length} entries exceeds ${LIMITS.localFacts}`);
      inp.localFacts.forEach((f, i) => {
        if (typeof f !== "string" || f.length < LIMITS.localFactChars[0] || f.length > LIMITS.localFactChars[1]) fail("inputs", `inputs.localFacts[${i}]`, `must be a string of ${LIMITS.localFactChars[0]} to ${LIMITS.localFactChars[1]} characters`);
        else if (/[\r\n]/.test(f)) fail("inputs", `inputs.localFacts[${i}]`, "one line each; contains a line break");
      });
    }
  }

  // ---- steps ----
  const steps = Array.isArray(sc.steps) ? sc.steps : [];
  if (!Array.isArray(sc.steps) || sc.steps.length === 0) fail("step-schema", "steps", "must be a non-empty array");
  r.steps = steps.length;
  const callCount = {};
  const stagesRun = new Set();
  const scanTitles = new Set(); // retrieved record titles and model lead titles (change-source may name either)
  const titleToId = new Map(); // retrieved record title to its stableRecordId
  const retrievedIds = new Set();
  const dupTitles = new Map(); // normalised retrieved record title to the title as written, for the duplicate check
  const claimsById = new Map(); // appraisal claim id to its sourceIds
  const decisionsOffered = []; // decision objects of design responses, in order (decision indexes)
  const trajectory = [];
  let recordsRetrieved = 0; // records the application would ingest from 2xx retrieve steps so far
  let lastRetrieveRecords = null; // records returned by the most recent retrieve (null before any)
  let appraisalOverRecords = false; // an appraisal response came after at least one retrieved record
  let confirmSeen = false;
  let createSeen = false;
  let createMissingReported = false;
  let decisionSteps = 0;
  let lastDecision = null; // { do, i, acceptedStated, decision } of the latest accept-decision or withdraw-decision
  let lastConsequential = -1;
  let lateIndex = -1;
  const exportEqual = [];
  const changeSources = [];
  const g2Steps = [];
  let reloads = 0;
  let reopens = 0;
  let refusalStated = false;
  // G11 state: the investigator's current text and the values model responses tried to write over it.
  let typedConstraints = typeof inp.constraints === "string" ? inp.constraints : "";
  let constraintsSource = "as typed at create (inputs.constraints)";
  let constraintDefects = [];
  let typedNeed = typeof inp.need === "string" ? inp.need : null;
  let needSource = "as typed at create (inputs.need)";

  const checkStorePath = (p, where) => {
    if (!STUDY_PATH.test(p)) {
      fail("expect-schema", where, `"${p}" is not a study path (dot-separated keys with optional [n] indexes)`);
      return;
    }
    const wo = WORK_ORDER_PATHS.find(([re]) => re.test(p));
    if (wo && requires.length === 0) fail("work-order", where, `"${p}" is introduced by work order 2 (${wo[1]}); name the entry in requires`);
    const first = p.split(/[.[]/)[0];
    if (!wo && !STUDY_KEYS_875.includes(first)) warn("expect-schema", where, `"${first}" is not a field of the 875fe59 Study object`);
  };

  const checkPredicate = (v, where) => {
    if (v === undefined) {
      fail("expect-schema", where, "missing predicate");
      return;
    }
    if (!isPredicate(v)) return; // a literal, compared by deep equality
    const [k, a] = Object.entries(v)[0];
    const bad = (m) => fail("expect-schema", where, `predicate ${k}: ${m}`);
    if (k === "oneOf" && (!Array.isArray(a) || a.length === 0)) bad("needs a non-empty array");
    if (k === "includes" && (a === undefined || a === null || Array.isArray(a))) bad("needs a string or a single value");
    if (k === "length" && (!Number.isInteger(a) || a < 0)) bad("needs a non-negative integer");
    if ((k === "min" || k === "max") && (typeof a !== "number" || !Number.isFinite(a))) bad("needs a number");
    if ((k === "isNull" || k === "absent") && a !== true) bad("must be true");
    if (k === "matches") {
      if (typeof a !== "string") bad("needs a regular expression string");
      else {
        try {
          new RegExp(a);
        } catch (e) {
          bad(`invalid regular expression (${e.message})`);
        }
      }
    }
  };

  const noteRefusal = (v) => {
    if (v === "stale" || v === "blocked") refusalStated = true;
    if (isPredicate(v) && Array.isArray(v.oneOf) && v.oneOf.some((x) => x === "stale" || x === "blocked")) refusalStated = true;
  };

  const checkExpect = (ex, step, where) => {
    if (!isObj(ex)) {
      fail("expect-schema", where, "expect must be an object");
      return;
    }
    for (const k of Object.keys(ex)) if (!EXPECT_KEYS.includes(k)) fail("expect-schema", `${where}.${k}`, "unknown expectation key");
    if (has(ex, "store")) {
      if (!isObj(ex.store) || Object.keys(ex.store).length === 0) fail("expect-schema", `${where}.store`, "must be a non-empty object of study path to predicate");
      else {
        for (const [p, v] of Object.entries(ex.store)) {
          checkStorePath(p, `${where}.store`);
          checkPredicate(v, `${where}.store["${p}"]`);
          noteRefusal(v);
          if (/quarantine/.test(p)) refusalStated = true;
        }
        // screen-status: a store check that states a status needs status text in the same step's screen check.
        const statusPaths = Object.entries(ex.store)
          .filter(([p, v]) => STUDY_PATH.test(p) && STATUS_FIELDS.includes(lastSegment(p)) && (lastSegment(p) !== "needsReview" || assertsNonEmpty(v)))
          .map(([p]) => p);
        if (statusPaths.length) {
          const named = screenIncludes(ex).some((s) => STATUS_WORDS.some((w) => containsWord(s, w)));
          if (!named) fail("screen-status", `${where}.screen`, `the store check names a status (${statusPaths.slice(0, 3).join(", ")}${statusPaths.length > 3 ? ", ..." : ""}) but screen.includes names no status word (any case: ${STATUS_WORDS.slice(0, 11).join(", ")}, or a certainty label such as "low certainty"); a title alone never proves a status`);
        }
      }
    }
    if (has(ex, "screen")) {
      if (!isObj(ex.screen)) fail("expect-schema", `${where}.screen`, "must be an object with includes and/or excludes");
      else {
        for (const k of Object.keys(ex.screen)) if (!["includes", "excludes"].includes(k)) fail("expect-schema", `${where}.screen.${k}`, "unknown key");
        for (const k of ["includes", "excludes"]) {
          if (!has(ex.screen, k)) continue;
          const a = ex.screen[k];
          if (!Array.isArray(a) || a.length === 0) fail("expect-schema", `${where}.screen.${k}`, "must be a non-empty array of strings");
          else a.forEach((s, i) => {
            const okStr = (x) => typeof x === "string" && x.length >= LIMITS.screenTextChars[0] && x.length <= LIMITS.screenTextChars[1];
            if (okStr(s)) return;
            // { "anyOf": [strings] }: satisfied when any listed wording is on screen (includes only)
            if (k === "includes" && isObj(s) && Array.isArray(s.anyOf) && s.anyOf.length >= 2 && s.anyOf.every(okStr) && Object.keys(s).length === 1) return;
            fail("expect-schema", `${where}.screen.${k}[${i}]`, `must be a string of ${LIMITS.screenTextChars[0]} to ${LIMITS.screenTextChars[1]} characters, or for includes { "anyOf": [two or more such strings] }`);
          });
        }
      }
    }
    if (has(ex, "issues")) {
      if (step.do !== "illuminate") fail("expect-schema", `${where}.issues`, "issues are produced by an illuminate step only");
      if (!isObj(ex.issues)) fail("expect-schema", `${where}.issues`, "must be an object with includes and/or count");
      else {
        for (const k of Object.keys(ex.issues)) if (!["includes", "count"].includes(k)) fail("expect-schema", `${where}.issues.${k}`, "unknown key");
        if (!has(ex.issues, "includes") && !has(ex.issues, "count")) fail("expect-schema", `${where}.issues`, "needs includes and/or count");
        if (has(ex.issues, "includes")) {
          if (!Array.isArray(ex.issues.includes) || ex.issues.includes.length === 0) fail("expect-schema", `${where}.issues.includes`, "must be a non-empty array of { path, code }");
          else ex.issues.includes.forEach((it, i) => {
            const w = `${where}.issues.includes[${i}]`;
            if (!isObj(it) || typeof it.path !== "string" || typeof it.code !== "string") fail("expect-schema", w, "needs string path and string code");
            else {
              for (const k of Object.keys(it)) if (!["path", "code"].includes(k)) fail("expect-schema", `${w}.${k}`, "unknown key");
              if (!/^[a-z][a-z0-9-]*$/.test(it.code)) fail("expect-schema", `${w}.code`, `"${it.code}" is not a kebab-case issue code`);
              else if (!ISSUE_CODES_875.includes(it.code) && requires.length === 0) warn("work-order", `${w}.code`, `"${it.code}" is not an 875fe59 IssueCode; name the work-order entry that adds it in requires`);
              // The scan mapper drops the model's sourcesConsulted text in every discovery reply; that alone states no refusal.
              const routine = it.code === "dropped" && it.path === "sourcesConsulted";
              if (!routine && (REFUSAL_CODES.includes(it.code) || !ISSUE_CODES_875.includes(it.code))) refusalStated = true;
            }
          });
        }
        if (has(ex.issues, "count")) {
          const c = ex.issues.count;
          if (!(Number.isInteger(c) && c >= 0) && !isPredicate(c)) fail("expect-schema", `${where}.issues.count`, "must be a non-negative integer or a predicate");
          else if (isPredicate(c)) checkPredicate(c, `${where}.issues.count`);
        }
      }
    }
    if (has(ex, "export")) {
      if (step.do !== "export") fail("expect-schema", `${where}.export`, "export checks belong to an export step");
      if (!isObj(ex.export)) fail("expect-schema", `${where}.export`, "must be an object");
      else {
        for (const k of Object.keys(ex.export)) if (!["equalsStore", "path"].includes(k)) fail("expect-schema", `${where}.export.${k}`, "unknown key");
        if (has(ex.export, "equalsStore") && typeof ex.export.equalsStore !== "boolean") fail("expect-schema", `${where}.export.equalsStore`, "must be a boolean");
        if (has(ex.export, "path")) {
          if (!isObj(ex.export.path)) fail("expect-schema", `${where}.export.path`, "must be an object of study path to predicate");
          else for (const [p, v] of Object.entries(ex.export.path)) {
            checkStorePath(p, `${where}.export.path`);
            checkPredicate(v, `${where}.export.path["${p}"]`);
            noteRefusal(v);
          }
        }
      }
    }
    if (has(ex, "stage")) {
      if (!isObj(ex.stage) || Object.keys(ex.stage).length === 0) fail("expect-schema", `${where}.stage`, "must be a non-empty object of stage to state");
      else for (const [st, state] of Object.entries(ex.stage)) {
        if (!STAGES.includes(st)) fail("expect-schema", `${where}.stage`, `"${st}" is not a stage id`);
        if (!STAGE_STATES.includes(state)) fail("expect-schema", `${where}.stage.${st}`, `${show(state)} must be one of ${STAGE_STATES.join(", ")}`);
      }
    }
    if (has(ex, "error")) {
      if (!isObj(ex.error) || typeof ex.error.shown !== "boolean") fail("expect-schema", `${where}.error`, "needs a boolean shown");
      else {
        for (const k of Object.keys(ex.error)) if (!["shown", "includes"].includes(k)) fail("expect-schema", `${where}.error.${k}`, "unknown key");
        if (has(ex.error, "includes") && (typeof ex.error.includes !== "string" || !ex.error.includes)) fail("expect-schema", `${where}.error.includes`, "must be a non-empty string");
        if (ex.error.shown) refusalStated = true;
      }
    }
    if (has(ex, "downloads")) {
      if (step.do !== "export") fail("expect-schema", `${where}.downloads`, "downloads checks belong to an export step");
      if (!isObj(ex.downloads) || !Number.isInteger(ex.downloads.count) || ex.downloads.count < 0) fail("expect-schema", `${where}.downloads`, "needs a non-negative integer count");
      else for (const k of Object.keys(ex.downloads)) if (k !== "count") fail("expect-schema", `${where}.downloads.${k}`, "unknown key");
    }
  };

  // Returns the records the application would ingest from this retrieve step.
  const checkRetrieve = (step, where) => {
    if (!PROVIDERS.includes(step.provider)) fail("retrieve", `${where}.provider`, `${show(step.provider)} must be one of ${PROVIDERS.join(", ")}`);
    if (typeof step.query !== "string" || !step.query.trim()) fail("retrieve", `${where}.query`, "must be a non-empty string");
    const res = step.response;
    if (!isObj(res)) {
      fail("retrieve", `${where}.response`, "must be an object: { status, total, records } for fixture, { status, body } for a provider format");
      return [];
    }
    if (typeof res.status !== "number" || !Number.isInteger(res.status) || res.status < 0 || res.status > 599) fail("retrieve", `${where}.response.status`, "must be an HTTP status number (0 for a request that never reached the host)");
    if (has(res, "note") && typeof res.note !== "string") fail("retrieve", `${where}.response.note`, "must be a string");
    if (step.provider === "fixture") {
      for (const k of Object.keys(res)) if (!["status", "total", "records", "note"].includes(k)) fail("retrieve", `${where}.response.${k}`, "unknown key for a fixture response (status, total, records, note)");
      const ok = is2xx(res.status);
      if ((ok || has(res, "records")) && !Array.isArray(res.records)) fail("retrieve", `${where}.response.records`, ok ? "a 2xx fixture response needs a records array (empty for an empty search)" : "must be an array when present");
      if (ok || has(res, "total")) {
        if (typeof res.total !== "number" || !Number.isInteger(res.total) || res.total < 0) fail("retrieve", `${where}.response.total`, `must be a non-negative integer, the provider's hit count (got ${show(res.total)})`);
        else if (Array.isArray(res.records) && res.total < res.records.length) fail("retrieve", `${where}.response.total`, `${res.total} is less than the ${res.records.length} records returned`);
      }
      if (!Array.isArray(res.records)) return [];
      if (res.records.length > LIMITS.fixtureRecordsMax) fail("retrieve", `${where}.response.records`, `${res.records.length} records exceeds ${LIMITS.fixtureRecordsMax}`);
      const idsHere = new Set();
      res.records.forEach((rec, k) => {
        const w = `${where}.response.records[${k}]`;
        if (!isObj(rec)) {
          fail("retrieve", w, "must be a RawRecord object");
          return;
        }
        for (const key of Object.keys(rec)) if (!RAW_RECORD_KEYS.includes(key)) fail("retrieve", `${w}.${key}`, `not a RawRecord field for the fixture provider (${RAW_RECORD_KEYS.join(", ")})`);
        if (typeof rec.title !== "string" || !rec.title.trim()) fail("retrieve", `${w}.title`, "must be a non-empty string");
        if (typeof rec.authors !== "string") fail("retrieve", `${w}.authors`, "must be a string");
        if (!(rec.year === null || (typeof rec.year === "number" && Number.isInteger(rec.year)))) fail("retrieve", `${w}.year`, `must be an integer year or null (got ${show(rec.year)})`);
        if (typeof rec.venue !== "string") fail("retrieve", `${w}.venue`, "must be a string");
        if (has(rec, "doi") && (typeof rec.doi !== "string" || !rec.doi.startsWith(FIXTURE_DOI_PREFIX) || rec.doi.length <= FIXTURE_DOI_PREFIX.length)) fail("retrieve", `${w}.doi`, `must be a string starting with the reserved prefix ${FIXTURE_DOI_PREFIX} (got ${show(rec.doi)})`);
        for (const key of ["providerType", "abstract", "url"]) if (has(rec, key) && typeof rec[key] !== "string") fail("retrieve", `${w}.${key}`, "must be a string when present");
        if (!has(rec, "abstract")) warn("retrieve", `${w}.abstract`, "no abstract; realistic fixture records carry one");
        if (typeof rec.title === "string" && rec.title.trim()) {
          const id = stableRecordId(rec);
          if (idsHere.has(id)) warn("retrieve", w, `stableRecordId ${id} repeats a record in the same response`);
          idsHere.add(id);
        }
      });
      if (!ok) {
        if (res.records.length) warn("retrieve", `${where}.response.records`, `records on a status ${res.status} response are never parsed`);
        return [];
      }
      return res.records.filter((rec) => isObj(rec) && typeof rec.title === "string" && rec.title.trim());
    }
    if (!PROVIDERS.includes(step.provider)) return [];
    for (const k of Object.keys(res)) if (!["status", "body", "note"].includes(k)) fail("retrieve", `${where}.response.${k}`, `unknown key for a provider-format response from ${step.provider} (status, body, note)`);
    if (typeof res.body !== "string") {
      fail("retrieve", `${where}.response.body`, "must be the provider's raw body text (a string, empty for a failed call)");
      return [];
    }
    if (!is2xx(res.status) || !res.body.trim()) return [];
    const recs = recordsFromBody(step.provider, res.body);
    if (!recs.length) warn("retrieve", `${where}.response.body`, `the ${step.provider} adapter would ingest no record from this body (empty, or not the provider's shape); the step counts as a search with no record`);
    return recs;
  };

  // G11 on one expectation of problem.constraints or problem.rawNeed (store or export.path).
  const checkInvestigatorText = (p, v, where) => {
    if (p === "problem.constraints" && typedConstraints.trim()) {
      const typed = typedConstraints;
      if (!evalPredicate(v, typed) && !evalPredicate(v, typed.trim())) {
        fail("G11", where, `expects ${show(v)}, which the investigator's constraints ${constraintsSource}, ${show(typed)}, do not satisfy; a model response never erases or replaces investigator-entered text, so expect that text unchanged (or omit the check)`);
        return;
      }
      const named = constraintDefects.filter((d) => isPredicate(v) && Array.isArray(v.oneOf) && v.oneOf.some((x) => deepEqual(x, d)));
      if (named.length) fail("G11", where, `also accepts ${named.map(show).join(" or ")}, a value a model response tried to write over the typed constraints; expect the typed text only`);
      else if (constraintDefects.some((d) => evalPredicate(v, d))) warn("G11", where, `${show(v)} also passes if the model's value ${show(constraintDefects.find((d) => evalPredicate(v, d)))} replaced the typed constraints; expect the typed text exactly to test G11`);
    }
    if (p === "problem.rawNeed" && typeof typedNeed === "string") {
      if (!evalPredicate(v, typedNeed) && !evalPredicate(v, typedNeed.trim())) fail("G11", where, `expects ${show(v)}, which the investigator's need ${needSource} does not satisfy; investigator-entered text is never replaced by a model response`);
    }
  };

  steps.forEach((step, i) => {
    const where = `steps[${i}]`;
    if (!isObj(step)) {
      fail("step-schema", where, "must be an object");
      return;
    }
    const spec = STEP_SPECS[step.do];
    if (!spec) {
      fail("step-schema", `${where}.do`, `unknown do value ${show(step.do)} (a scenario error, never a skip)`);
      return;
    }
    const allowed = [...COMMON_STEP_KEYS, ...spec.required, ...spec.optional];
    for (const k of Object.keys(step)) if (!allowed.includes(k)) fail("step-schema", `${where}.${k}`, `unknown field for do "${step.do}"`);
    for (const k of spec.required) if (!has(step, k)) fail("step-schema", where, `do "${step.do}" requires "${k}"`);
    if (has(step, "stopOnFail") && typeof step.stopOnFail !== "boolean") fail("step-schema", `${where}.stopOnFail`, "must be a boolean");
    if (has(step, "note") && (typeof step.note !== "string" || !step.note.trim() || step.note.length > LIMITS.stepNoteChars)) fail("step-schema", `${where}.note`, `must be a non-empty string of at most ${LIMITS.stepNoteChars} characters`);
    // Format 1.2, late replies: an illuminate step may hold its recorded reply while the investigator acts.
    let duringSteps = [];
    if (step.do === "illuminate") {
      if (has(step, "late") && typeof step.late !== "boolean") fail("step-schema", `${where}.late`, "must be a boolean");
      if (step.late === true && (!Array.isArray(step.during) || step.during.length === 0)) fail("step-schema", `${where}.late`, "late: true needs a non-empty during array: the investigator actions the runner applies through the screen after the request is dispatched and before the recorded reply is released");
      if (has(step, "during") && step.late !== true) fail("step-schema", `${where}.during`, "during needs late: true on the same illuminate step");
      if (Array.isArray(step.during)) {
        if (step.during.length > DURING_MAX) fail("step-schema", `${where}.during`, `at most ${DURING_MAX} actions are applied while a reply is held (got ${step.during.length})`);
        step.during.forEach((d, k) => {
          const w = `${where}.during[${k}]`;
          if (!isObj(d)) { fail("step-schema", w, "must be an object"); return; }
          if (!DURING_KINDS.includes(d.do)) { fail("step-schema", `${w}.do`, `${show(d.do)} is not an investigator action a held reply can span (one of ${DURING_KINDS.join(", ")}); model calls, retrieval, reload, reopen, export and wait are never nested`); return; }
          const dspec = STEP_SPECS[d.do];
          const dallowed = ["do", "expect", "note", ...dspec.required, ...dspec.optional];
          for (const kk of Object.keys(d)) if (!dallowed.includes(kk)) fail("step-schema", `${w}.${kk}`, `unknown field for a during action "${d.do}"`);
          for (const kk of dspec.required) if (!has(d, kk)) fail("step-schema", w, `during action "${d.do}" requires "${kk}"`);
          if (has(d, "note") && (typeof d.note !== "string" || !d.note.trim() || d.note.length > LIMITS.stepNoteChars)) fail("step-schema", `${w}.note`, `must be a non-empty string of at most ${LIMITS.stepNoteChars} characters`);
          const dex = has(d, "expect") ? d.expect : undefined;
          const outcome = isObj(dex) && OUTCOME_KEYS.some((kk) => isObj(dex[kk]) && Object.keys(dex[kk]).length > 0);
          if (!outcome) fail("outcome-check", w, `a during action (do "${d.do}") needs an expect with at least one store, stage, issues or error check that states the study after the edit, before the held reply is released`);
          if (d.do === "set-field") {
            if (typeof d.path !== "string") fail("step-schema", `${w}.path`, "must be a string");
            else {
              checkStorePath(d.path, `${w}.path`);
              if (d.path === "problem.constraints") { typedConstraints = typeof d.value === "string" ? d.value : ""; constraintsSource = `as set on screen at ${w}`; constraintDefects = []; }
              if (d.path === "problem.rawNeed") { typedNeed = typeof d.value === "string" ? d.value : null; needSource = `as set on screen at ${w}`; }
            }
          }
          if (d.do === "change-source") {
            if (!SOURCE_FIELDS.includes(d.field)) fail("step-schema", `${w}.field`, `must be one of ${SOURCE_FIELDS.join(", ")}`);
            if (d.field === "status" && !SOURCE_STATUSES.includes(d.value)) fail("step-schema", `${w}.value`, `must be one of ${SOURCE_STATUSES.join(", ")}`);
          }
          if (dex !== undefined) checkExpect(dex, d, `${w}.expect`);
          duringSteps.push(d);
        });
        if (step.late === true && isObj(has(step, "expect") ? step.expect : undefined) && !isObj(step.expect.error)) warn("step-schema", `${where}.expect`, "a late reply is produced against the revision before the during actions; if any of them changed the study the reply is refused (G6): expect.error.shown true and the refusal text, and the store checks state that nothing of the reply was applied");
        lateIndex = i;
      }
    }
    if (step.do === "wait" && lateIndex === i - 1) warn("step-schema", where, "a wait step does not release a held reply; the runner releases it after the during actions and evaluates the illuminate step's expect then (format 1.2)");
    if (step.do !== "create" && !createSeen && !createMissingReported) {
      fail("step-schema", where, "the first step must be create");
      createMissingReported = true;
    }
    const ex = has(step, "expect") ? step.expect : undefined;

    // outcome-check and reload-reopen-expect (counterexample 1)
    if (CONSEQUENTIAL.includes(step.do)) {
      lastConsequential = i;
      const outcome = isObj(ex) && OUTCOME_KEYS.some((k) => isObj(ex[k]) && Object.keys(ex[k]).length > 0);
      if (!outcome) fail("outcome-check", where, `a consequential step (do "${step.do}") needs an expect with at least one store, stage, issues or error check that states the correct outcome${isObj(ex) ? ` (it has only ${Object.keys(ex).join(", ") || "an empty expect"})` : ""}`);
    }
    if ((step.do === "reload" || step.do === "reopen") && !(isObj(ex) && Object.keys(ex).some((k) => EXPECT_KEYS.includes(k)))) {
      fail("reload-reopen-expect", where, `a ${step.do} step needs an expect (what survives the ${step.do})`);
    }

    // trajectory signature entry: do, stage, shape, provider and the model response text hashed
    const t = [step.do, step.stage ?? "", step.shape ?? "", step.provider ?? ""];
    if (step.do === "illuminate") t.push(has(step, "responseText") ? sha(`text:${collapse(step.responseText)}`) : has(step, "response") ? sha(`json:${JSON.stringify(canonical(step.response))}`) : "");
    if (duringSteps.length) t.push(`during:${duringSteps.map((d) => d.do).join(",")}`);
    trajectory.push(t);

    let isDiscovery = false;
    switch (step.do) {
      case "create":
        if (createSeen) fail("step-schema", where, "only one create step");
        if (i !== 0) fail("step-schema", where, "create must be the first step");
        createSeen = true;
        break;
      case "retrieve": {
        const recs = checkRetrieve(step, where);
        for (const rec of recs) {
          const id = stableRecordId(rec);
          retrievedIds.add(id);
          titleToId.set(rec.title, id);
          scanTitles.add(rec.title);
          dupTitles.set(collapse(rec.title).replace(/[^a-z0-9]+/g, " ").trim(), rec.title);
        }
        recordsRetrieved += recs.length;
        lastRetrieveRecords = recs.length;
        break;
      }
      case "confirm-empty-search":
        if (lastRetrieveRecords === null) warn("step-schema", where, "no retrieve step before the confirmation that the search was run");
        else if (lastRetrieveRecords > 0) warn("step-schema", where, "the latest retrieve returned records; confirming an empty search should then be refused");
        confirmSeen = true;
        break;
      case "illuminate": {
        if (!STAGES.includes(step.stage)) {
          fail("stage-schema", `${where}.stage`, `${show(step.stage)} is not one of the 13 stage ids`);
          break;
        }
        const n = (callCount[step.stage] = (callCount[step.stage] ?? 0) + 1);
        r.calls++;
        stagesRun.add(step.stage);
        if (has(step, "call")) {
          if (!Number.isInteger(step.call) || step.call < 1) fail("call-numbering", `${where}.call`, "must be a positive integer");
          else if (step.call !== n) fail("call-numbering", `${where}.call`, `is ${step.call} but this is illuminate call ${n} for "${step.stage}" (replay file ${step.stage}.${n}.json)`);
        } else if (n > 1) fail("call-numbering", `${where}.call`, `required for a repeated stage; this is call ${n} for "${step.stage}"`);
        if (step.stage === "scan") {
          if (!["discovery", "appraisal"].includes(step.shape)) fail("stage-schema", `${where}.shape`, 'a scan call needs shape "discovery" or "appraisal"');
          isDiscovery = step.shape === "discovery";
        } else if (has(step, "shape")) fail("stage-schema", `${where}.shape`, "shape applies to scan calls only");
        const hasResp = has(step, "response");
        const hasText = has(step, "responseText");
        if (hasResp === hasText) {
          fail("stage-schema", where, "needs exactly one of response (object) or responseText (string)");
          break;
        }
        // The object the application would apply: the response, or the JSON it would extract from responseText.
        const applied = hasResp ? (isObj(step.response) ? step.response : null) : parseModelText(step.responseText);
        if (step.stage === "scan" && step.shape === "appraisal" && applied && recordsRetrieved > 0) appraisalOverRecords = true;
        if (step.stage === "design" && applied && isObj(applied.decision)) decisionsOffered.push(applied.decision);
        if (step.stage === "problem" && applied && has(applied, "constraints") && typedConstraints.trim()) {
          const mv = applied.constraints;
          const norm = (s) => String(s).trim().replace(/\s+/g, " ");
          if (typeof mv !== "string" || norm(mv) !== norm(typedConstraints)) {
            constraintDefects = mv === null ? [null, ""] : typeof mv === "string" && !mv.trim() ? [mv, ""] : [mv];
            // The step's own issues: G11 records a `dropped` issue at constraints, so the issue is never expected absent.
            if (isObj(ex) && isObj(ex.issues)) {
              const inc = Array.isArray(ex.issues.includes) ? ex.issues.includes.filter((it) => isObj(it) && typeof it.path === "string") : [];
              inc.forEach((it) => {
                if (CONSTRAINTS_ISSUE_PATH.test(it.path) && it.code !== "dropped") fail("G11", `${where}.expect.issues.includes`, `{ path "${it.path}", code "${it.code}" } states that the model's ${show(mv)} changed the typed constraints; G11 keeps the typed text and records the existing code "dropped" at that path (aligned with the owner's implementation 2026-09-22; "rejected-change" is not an issue code)`);
              });
              if (has(ex.issues, "count")) {
                const others = new Set(inc.filter((it) => !CONSTRAINTS_ISSUE_PATH.test(it.path)).map((it) => `${it.path}|${it.code}`)).size;
                const least = others + 1;
                let room = false;
                for (let k = least; k <= least + 64 && !room; k++) room = evalPredicate(ex.issues.count, k);
                if (!room) fail("G11", `${where}.expect.issues.count`, `${show(ex.issues.count)} leaves no room for the dropped issue G11 records at constraints (the model sent constraints ${show(mv)}, not the typed text${others ? `; ${others} other issue(s) are listed besides` : ""}); expect at least ${least}, or list { path "constraints", code "dropped" }`);
              }
            }
          }
        }
        if (hasText) {
          if (typeof step.responseText !== "string" || step.responseText.length < LIMITS.responseTextChars[0] || step.responseText.length > LIMITS.responseTextChars[1]) fail("stage-schema", `${where}.responseText`, `must be a string of ${LIMITS.responseTextChars[0]} to ${LIMITS.responseTextChars[1]} characters`);
          if (has(step, "omitKeys")) fail("stage-schema", `${where}.omitKeys`, "applies to a response object only");
          break;
        }
        const resp = step.response;
        if (!isObj(resp)) {
          fail("stage-schema", `${where}.response`, "must be a JSON object (use responseText for anything else)");
          break;
        }
        const shape = step.stage === "scan" ? (["discovery", "appraisal"].includes(step.shape) ? step.shape : null) : null;
        if (step.stage === "scan" && !shape) break;
        const keys = step.stage === "scan" ? SCAN_SHAPE_KEYS[shape] : STAGE_KEYS[step.stage];
        const label = step.stage === "scan" ? `scan ${shape}` : step.stage;
        let omit = [];
        if (has(step, "omitKeys")) {
          if (!Array.isArray(step.omitKeys) || step.omitKeys.some((k) => typeof k !== "string")) fail("stage-schema", `${where}.omitKeys`, "must be an array of strings");
          else {
            omit = step.omitKeys;
            for (const k of omit) {
              if (!keys.includes(k)) fail("stage-schema", `${where}.omitKeys`, `"${k}" is not a top-level key of the ${label} schema`);
              else if (has(resp, k)) fail("stage-schema", `${where}.omitKeys`, `"${k}" is listed as omitted but present in the response`);
            }
          }
        }
        const missing = keys.filter((k) => !has(resp, k) && !omit.includes(k));
        if (missing.length) fail("stage-schema", `${where}.response`, `missing top-level key(s) of the ${label} schema: ${missing.join(", ")} (list deliberate omissions in omitKeys)`);
        const extra = Object.keys(resp).filter((k) => !keys.includes(k));
        if (extra.length) warn("stage-schema", `${where}.response`, `key(s) outside the ${label} schema: ${extra.join(", ")}`);
        const size = JSON.stringify(resp).length;
        const budget = (STAGE_MAX_TOKENS[step.stage] ?? DEFAULT_MAX_TOKENS) * 4;
        if (size > LIMITS.responseJsonChars) fail("stage-schema", `${where}.response`, `${size} characters exceeds ${LIMITS.responseJsonChars}`);
        else if (size > budget) warn("stage-schema", `${where}.response`, `${size} characters is more than the ${step.stage} call's max_tokens allows (about ${budget})`);
        walk(resp, `${where}.response`, (s, p) => {
          if (s.length > LIMITS.responseStringChars) fail("stage-schema", p, `${s.length} characters exceeds ${LIMITS.responseStringChars}`);
        }, () => {});
        if (shape === "discovery") {
          // An empty items array is a valid discovery reply (format 1.1).
          if (Array.isArray(resp.items)) {
            if (resp.items.length > LIMITS.discoveryItemsMax) warn("stage-schema", `${where}.response.items`, `${resp.items.length} leads; a realistic discovery reply lists at most ${LIMITS.discoveryItemsMax}`);
            resp.items.forEach((it, k) => {
              if (!isObj(it)) return;
              if (typeof it.title === "string" && it.title.trim()) scanTitles.add(it.title);
              for (const f of ["title", "authors", "source", "keyFindings"]) {
                if (typeof it[f] !== "string" || !it[f].trim()) warn("stage-schema", `${where}.response.items[${k}].${f}`, "empty or not a string; realistic leads name title, authors, journal and findings");
              }
            });
          } else if (has(resp, "items")) warn("stage-schema", `${where}.response.items`, "not an array");
        }
        if (shape === "appraisal") {
          if (recordsRetrieved === 0) warn("stage-schema", where, "an appraisal call with no retrieved record before it");
          if (!Array.isArray(resp.annotations)) fail("stage-schema", `${where}.response.annotations`, "must be an array");
          else resp.annotations.forEach((a, k) => {
            const w = `${where}.response.annotations[${k}]`;
            if (!isObj(a) || typeof a.id !== "string" || !a.id) fail("stage-schema", w, "needs a string id (an existing record id)");
            else if (!retrievedIds.has(a.id)) warn("stage-schema", `${w}.id`, `${a.id} matches no record retrieved earlier (stableRecordId of the DOI, or of title and year)`);
          });
          if (!Array.isArray(resp.claims)) fail("stage-schema", `${where}.response.claims`, "must be an array");
          else resp.claims.forEach((c, k) => {
            const w = `${where}.response.claims[${k}]`;
            if (!isObj(c) || typeof c.text !== "string" || typeof c.kind !== "string" || !Array.isArray(c.sourceIds)) {
              fail("stage-schema", w, "needs text, kind and a sourceIds array");
              return;
            }
            if (!CLAIM_KINDS.includes(c.kind)) warn("stage-schema", `${w}.kind`, `"${c.kind}" is not a ClaimKind`);
            c.sourceIds.forEach((sid, q) => {
              if (typeof sid !== "string") fail("stage-schema", `${w}.sourceIds[${q}]`, "must be a string");
              else if (!retrievedIds.has(sid)) warn("stage-schema", `${w}.sourceIds[${q}]`, `${sid} matches no record retrieved earlier`);
            });
            if (c.kind === "source-derived" && c.sourceIds.length === 0) warn("stage-schema", w, "a source-derived claim with no source");
            if (typeof c.id === "string" && c.id) claimsById.set(c.id, c.sourceIds.filter((s) => typeof s === "string"));
          });
        }
        break;
      }
      case "set-field":
        if (typeof step.path !== "string") fail("step-schema", `${where}.path`, "must be a string");
        else {
          checkStorePath(step.path, `${where}.path`);
          // The investigator edits through the screen; that is how typed text legitimately changes (G11).
          if (step.path === "problem.constraints") {
            typedConstraints = typeof step.value === "string" ? step.value : "";
            constraintsSource = `as set on screen at ${where}`;
            constraintDefects = [];
          }
          if (step.path === "problem.rawNeed") {
            typedNeed = typeof step.value === "string" ? step.value : null;
            needSource = `as set on screen at ${where}`;
          }
        }
        break;
      case "accept-decision":
      case "withdraw-decision": {
        decisionSteps++;
        if (!(step.which === "latest" || Number.isInteger(step.which))) fail("step-schema", `${where}.which`, 'must be "latest" or a decision index');
        if (!decisionsOffered.length) fail("decision-step", where, "no earlier design response carries a decision object");
        const k = step.which === "latest" ? decisionsOffered.length - 1 : Number.isInteger(step.which) ? (step.which < 0 ? decisionsOffered.length + step.which : step.which) : -1;
        const store = isObj(ex) && isObj(ex.store) ? ex.store : {};
        const statesAccepted = (v) => v === "accepted" || (isPredicate(v) && Array.isArray(v.oneOf) && v.oneOf.length === 1 && v.oneOf[0] === "accepted");
        const acceptedStated = step.do === "accept-decision" && Object.entries(store).some(([p, v]) => ACCEPTED_PATH.test(p) && statesAccepted(v));
        const positivePath = Object.entries(store).find(([p, v]) => /^design\.decisions\[\d+\]\.selectionStatus$/.test(p) && statesAccepted(v))?.[0];
        lastDecision = { do: step.do, i, acceptedStated, positivePath, decision: decisionsOffered[k] ?? null };
        break;
      }
      case "mark-complete":
        if (!STAGES.includes(step.stage)) fail("step-schema", `${where}.stage`, `${show(step.stage)} is not one of the 13 stage ids`);
        break;
      case "change-source": {
        if (typeof step.record !== "string" || !step.record.trim()) fail("step-schema", `${where}.record`, "must be a record title");
        else if (!scanTitles.has(step.record)) fail("step-schema", `${where}.record`, "matches no retrieved record title or lead title earlier in the scenario");
        if (!SOURCE_FIELDS.includes(step.field)) fail("step-schema", `${where}.field`, `must be one of ${SOURCE_FIELDS.join(", ")}`);
        if (step.field === "status" && !SOURCE_STATUSES.includes(step.value)) fail("step-schema", `${where}.value`, `must be a SourceStatus (${SOURCE_STATUSES.join(", ")})`);
        if (step.field === "year" && !(step.value === null || Number.isInteger(step.value))) warn("step-schema", `${where}.value`, "a year is normally an integer or null");
        if (step.field === "abstract" && !requires.includes("D1")) warn("work-order", `${where}.field`, "EvidenceItem.abstract is added by D1; name D1 in requires");
        if ((step.field === "keyFindings" || step.field === "abstract") && typeof step.value !== "string") fail("step-schema", `${where}.value`, "must be a string");
        // G7: a supported positive predecessor, and a changed record that the accepted decision cites.
        if (!lastDecision) fail("G7", where, 'no accept-decision before it; a change-source step must follow an accept-decision whose expect states design.decisions[-1].selectionStatus "accepted"');
        else if (lastDecision.do !== "accept-decision") fail("G7", where, `the latest decision step (steps[${lastDecision.i}]) is a withdraw-decision; a change-source step must follow an accepted decision`);
        else if (!lastDecision.acceptedStated) {
          fail("G7", where, lastDecision.positivePath
            ? `the latest accept-decision (steps[${lastDecision.i}]) states acceptance only at ${lastDecision.positivePath}, a positive index; the rule asks for design.decisions[-1].selectionStatus "accepted" (or another negative index), which names the decision just accepted however many came before`
            : `the latest accept-decision (steps[${lastDecision.i}]) does not expect design.decisions[-1].selectionStatus "accepted" (a path with a negative index), so it is not a supported positive predecessor`);
        }
        else if (typeof step.record === "string" && scanTitles.has(step.record)) {
          const recId = titleToId.get(step.record);
          const d = lastDecision.decision;
          const claimIds = d && Array.isArray(d.claimIds) ? d.claimIds.filter((c) => typeof c === "string") : [];
          if (recId === undefined) fail("G7", `${where}.record`, "names a model lead, not a retrieved record; an accepted decision rests on retrieved records, so changing a lead cannot make it stale");
          else if (!d) warn("G7", where, `cannot tell which decision steps[${lastDecision.i}] accepted, so the validator cannot confirm it cites the changed record`);
          else if (!claimIds.length) fail("G7", where, `the decision accepted at steps[${lastDecision.i}] cites no claim, so no source change can make it stale; change a record that a claim of the accepted decision rests on`);
          else {
            const known = claimIds.filter((c) => claimsById.has(c));
            if (!known.length) warn("G7", where, `none of the accepted decision's claim ids (${claimIds.join(", ")}) appears in an earlier appraisal response, so the validator cannot confirm it cites the changed record`);
            else if (!known.some((c) => claimsById.get(c).includes(recId))) fail("G7", `${where}.record`, `record ${recId} is not a source of any claim the accepted decision rests on (${known.map((c) => `${c}: ${claimsById.get(c).join(", ") || "no source"}`).join("; ")}); only a change to a cited record makes the decision stale`);
          }
        }
        changeSources.push(i);
        break;
      }
      case "reload":
        reloads++;
        break;
      case "reopen":
        reopens++;
        break;
      case "export":
        if (isObj(ex) && isObj(ex.export) && ex.export.equalsStore === true) exportEqual.push(i);
        break;
      case "wait":
        if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > 5000) fail("step-schema", `${where}.ms`, "must be an integer from 0 to 5000");
        break;
    }

    if (ex === undefined) return;
    checkExpect(ex, step, `${where}.expect`);
    if (!isObj(ex)) return;

    // G2: a completed Scan needs a retrieved record or the investigator's confirmation of an empty search.
    if (expectsScanComplete(ex) && recordsRetrieved === 0 && !confirmSeen) g2Steps.push(i);

    // G1: certainty only over records that were retrieved and then appraised.
    const gradeChecks = [];
    if (isObj(ex.store) && has(ex.store, "scan.gradeOverall")) gradeChecks.push([`${where}.expect.store["scan.gradeOverall"]`, ex.store["scan.gradeOverall"]]);
    if (isObj(ex.export) && isObj(ex.export.path) && has(ex.export.path, "scan.gradeOverall")) gradeChecks.push([`${where}.expect.export.path["scan.gradeOverall"]`, ex.export.path["scan.gradeOverall"]]);
    for (const [w, v] of gradeChecks) {
      const acceptsGrade = GRADES.filter((g) => evalPredicate(v, g));
      if (isDiscovery && recordsRetrieved === 0) {
        if (!evalPredicate(v, "") || acceptsGrade.length) fail("G1", w, `${show(v)} on a discovery step with no retrieved record before it; model leads never assign certainty, so expect "" (unassessed)`);
      } else if (acceptsGrade.length && !appraisalOverRecords) {
        fail("G1", w, `${show(v)} accepts certainty ${acceptsGrade.map((g) => `"${g}"`).join(", ")}, but no appraisal call over retrieved records comes before or at this step (a retrieve with at least one record, then an illuminate scan with shape "appraisal"); expect "" (unassessed)`);
      }
    }
    if (!appraisalOverRecords) {
      const labels = screenIncludes(ex).filter((s) => CERTAINTY_LABELS.some((l) => containsWord(s, l)));
      if (labels.length) fail("G1", `${where}.expect.screen.includes`, `${show(labels[0])} shows a certainty label, but no appraisal over retrieved records comes before or at this step; an unassessed scan shows no certainty`);
    }

    // G11: investigator-entered text, in every store and export expectation.
    for (const [kind, obj] of [["store", ex.store], ["export.path", isObj(ex.export) ? ex.export.path : undefined]]) {
      if (!isObj(obj)) continue;
      for (const p of ["problem.constraints", "problem.rawNeed"]) if (has(obj, p)) checkInvestigatorText(p, obj[p], `${where}.expect.${kind}["${p}"]`);
    }
  });
  r.stages = stagesRun.size;
  r.fp = { trajectory, titles: dupTitles };

  if (g2Steps.length) {
    fail("G2", `steps[${g2Steps[0]}].expect`, `expects the Scan stage complete, but no earlier retrieve returned a record and no confirm-empty-search came first; a model field never completes the Scan${g2Steps.length > 1 ? ` (also expected at steps[${g2Steps.slice(1).join("], steps[")}])` : ""}`);
  }

  // ---- G7 follow-up: stale in the store, on screen, in the export and after reload ----
  for (const i of changeSources) {
    const later = steps.slice(i).map((s, k) => ({ s, k: i + k })).filter(({ s }) => isObj(s));
    const own = steps[i];
    if (!(isObj(own.expect) && statesStale(own.expect.store))) fail("G7", `steps[${i}]`, 'the change-source step must expect a decision status field "stale" in the store');
    const onScreen = later.some(({ s }) => screenIncludes(s.expect).some((t) => containsWord(t, "stale")));
    if (!onScreen) fail("G7", `steps[${i}]`, 'no screen check names "stale" at or after the change-source step');
    const inExport = later.some(({ s }) => s.do === "export" && isObj(s.expect) && isObj(s.expect.export) && statesStale(s.expect.export.path));
    if (!inExport) fail("G7", `steps[${i}]`, 'no later export step checks a status field "stale" in export.path');
    const afterReload = later.some(({ s }) => s.do === "reload" && isObj(s.expect) && statesStale(s.expect.store));
    if (!afterReload) fail("G7", `steps[${i}]`, 'no later reload step checks a status field "stale" in the store');
  }

  // ---- full-scenario rule and final export ----
  const earlyStop = typeof sc.earlyStop === "string" && sc.earlyStop.trim().length > 0;
  const missingStages = STAGES.filter((s) => !stagesRun.has(s));
  if (missingStages.length && !earlyStop) fail("full-scenario", "steps", `a full scenario runs all 13 stages or documents an earlyStop; not run: ${missingStages.join(", ")}`);
  if (decisionSteps === 0) {
    if (earlyStop && !stagesRun.has("design")) warn("full-scenario", "steps", "no decision step (accepted because earlyStop is documented and design never runs)");
    else fail("full-scenario", "steps", "at least one decision step (accept-decision or withdraw-decision) is required");
  }
  if (reloads === 0) fail("full-scenario", "steps", "at least one reload step is required");
  if (reopens === 0) fail("full-scenario", "steps", "at least one reopen step is required");
  if (!exportEqual.some((j) => j > lastConsequential)) {
    const lc = lastConsequential >= 0 ? `steps[${lastConsequential}] (${steps[lastConsequential].do})` : "";
    fail("final-export", "steps", exportEqual.length ? `the export step(s) with expect.export.equalsStore true (steps[${exportEqual.join("], steps[")}]) come before the last consequential step ${lc}; the final export must follow it` : "no export step with expect.export.equalsStore true after the last consequential step");
  }
  if (recordsRetrieved === 0 && !confirmSeen && stagesRun.has("scan") && !g2Steps.length) warn("G2", "steps", "no retrieve with a record and no confirm-empty-search: the Scan stage can never complete (G2); state that in the expectations if intended");
  if ((sc.level === 4 || sc.level === 5) && !refusalStated) fail("refusal", "steps", "a level 4 or 5 scenario must state at least one refusal (error shown, refusal issue code, quarantine entry, stale status or blocked action)");

  // ---- text rules over the whole scenario ----
  const forbiddenHits = new Map();
  const nonAscii = [];
  walk(sc, "", (s, p) => {
    const low = s.toLowerCase();
    for (const term of forbidden) {
      if (low.includes(term)) {
        const hits = forbiddenHits.get(term) ?? [];
        hits.push(p);
        forbiddenHits.set(term, hits);
      }
    }
    for (const m of s.matchAll(DOI_LIKE)) if (m[1] !== "5555") fail("doi", p, `real-looking DOI "${m[0]}"; invented DOIs use the reserved prefix 10.5555/`);
    if (PMID_TEXT.test(s)) fail("pmid", p, "contains a PMID; invented PMIDs are omitted");
    if (PUBMED_URL.test(s)) fail("pmid", p, `contains a PubMed article URL (${s.match(PUBMED_URL)[0]}); invented PMIDs are omitted`);
    if (TRIAL_NUMBER.test(s)) fail("trial-number", p, `contains a trial registration number (${s.match(TRIAL_NUMBER)[0]})`);
    for (const m of s.matchAll(NON_ASCII)) nonAscii.push([p, m[0]]);
  }, (k, p, v) => {
    if (k.toLowerCase() === "pmid") fail("pmid", p, 'a "pmid" key is not allowed');
    if (k.toLowerCase() === "doi" && typeof v === "string" && v.startsWith("10.") && !v.startsWith("10.5555/")) fail("doi", p, `doi "${v}" does not use the reserved prefix 10.5555/`);
    for (const m of k.matchAll(NON_ASCII)) nonAscii.push([`${p} (key)`, m[0]]);
  });
  for (const [term, hits] of forbiddenHits) fail("forbidden", hits.length > 3 ? `${hits.slice(0, 3).join(", ")} and ${hits.length - 3} more` : hits.join(", "), `contains the forbidden term "${term}"`);
  if (nonAscii.length) {
    const code = (c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
    const shown = nonAscii.slice(0, 5).map(([p, c]) => `${code(c)} at ${p}`).join("; ");
    fail("ascii", nonAscii[0][0], `${nonAscii.length} non-ASCII character(s); the bank is plain ASCII (no en or em dashes): ${shown}${nonAscii.length > 5 ? "; ..." : ""}`);
  }
  return r;
}

// ---- semantic duplicates across the folder ----
function needWordSet(norm) {
  return new Set(norm.match(/[a-z0-9]+/g) ?? []);
}
function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}
function findDuplicates(rows) {
  const items = rows
    .filter((r) => r.sc && r.fp)
    .map((r) => {
      const need = isObj(r.sc.inputs) && typeof r.sc.inputs.need === "string" ? collapse(r.sc.inputs.need) : null;
      return { r, need, needWords: need === null ? null : needWordSet(need), titles: r.fp.titles, signature: sha(JSON.stringify(r.fp.trajectory)).slice(0, 16), steps: r.fp.trajectory.length };
    });
  const pairs = [];
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const x = items[a];
      const y = items[b];
      const why = [];
      if (x.need !== null && y.need !== null) {
        if (x.need === y.need) why.push("need text equal after normalisation");
        else {
          const j = jaccard(x.needWords, y.needWords);
          if (j > DUP_NEED_JACCARD) why.push(`need text word-set Jaccard ${j.toFixed(2)} (above ${DUP_NEED_JACCARD})`);
        }
      }
      const shared = [...x.titles.keys()].filter((t) => y.titles.has(t)).map((t) => x.titles.get(t));
      if (shared.length >= DUP_SHARED_TITLES) why.push(`${shared.length} shared retrieved record titles ("${shared.slice(0, 2).join('", "')}"${shared.length > 2 ? ", ..." : ""})`);
      if (x.steps > 0 && x.signature === y.signature) why.push(`identical step trajectory signature ${x.signature}`);
      if (why.length) pairs.push({ a: x.r, b: y.r, why });
    }
  }
  for (const { a, b, why } of pairs) {
    a.fails.push({ rule: "duplicate", where: "scenario", msg: `semantic duplicate of ${b.file} (id ${b.id || "?"}): ${why.join("; ")}; renaming is not a new scenario` });
    b.fails.push({ rule: "duplicate", where: "scenario", msg: `semantic duplicate of ${a.file} (id ${a.id || "?"}): ${why.join("; ")}; renaming is not a new scenario` });
  }
  return pairs;
}

function table(rows) {
  const head = ["FILE", "ID", "VER", "LVL", "FIELD", "FAMILY", "STEPS", "STAGES", "CALLS", "RESULT", "FAIL", "WARN"];
  const data = rows.map((r) => [r.file, r.id, String(r.version), String(r.level), r.field, r.family, String(r.steps), String(r.stages), String(r.calls), r.fails.length ? "FAIL" : "PASS", String(r.fails.length), String(r.warns.length)]);
  const widths = head.map((h, i) => Math.max(h.length, ...data.map((d) => d[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...data.map(line)].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let entries;
  try {
    entries = fs.readdirSync(args.dir, { withFileTypes: true });
  } catch (e) {
    usage(`cannot read folder ${args.dir} (${e.code ?? e.message})`);
  }
  const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => e.name).sort();
  const skipped = jsonFiles.filter((n) => METADATA_FILE.test(n));
  const files = jsonFiles.filter((n) => !METADATA_FILE.test(n)).map((n) => path.join(args.dir, n));
  const forbidden = args.forbidden ? loadForbidden(args.forbidden) : [];
  console.log(`Meridian scenario validator, format version ${FORMAT_VERSION} (validator ${VALIDATOR_REVISION})`);
  console.log(`folder: ${path.resolve(args.dir)}  files: ${files.length}  forbidden terms: ${args.forbidden ? `${forbidden.length} from ${args.forbidden}` : "none (no --forbidden file)"}`);
  if (skipped.length) console.log(`skipped (bank metadata, not scenarios): ${skipped.join(", ")}`);
  if (files.length === 0) {
    console.log("no scenario files found");
    process.exit(1);
  }
  const rows = files.map((f) => validateFile(f, forbidden));
  const byId = new Map();
  for (const r of rows) if (r.id) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  for (const [id, rs] of byId) if (rs.length > 1) for (const r of rs) r.fails.push({ rule: "id", where: "id", msg: `"${id}" is used by ${rs.map((x) => x.file).join(" and ")}` });
  const pairs = findDuplicates(rows);

  console.log("");
  console.log(table(rows));
  for (const r of rows) {
    if (!r.fails.length && !r.warns.length) continue;
    console.log(`\n${r.file}`);
    for (const f of r.fails) console.log(`  FAIL  [${f.rule}] ${f.where}: ${f.msg}`);
    for (const w of r.warns) console.log(`  warn  [${w.rule}] ${w.where}: ${w.msg}`);
  }
  const failed = rows.filter((r) => r.fails.length);
  const warnings = rows.reduce((n, r) => n + r.warns.length, 0);
  console.log(`\n${rows.length} files: ${rows.length - failed.length} passed, ${failed.length} failed, ${warnings} warnings`);

  console.log(`\nFailing checks per file:${failed.length ? "" : " none"}`);
  const nameWidth = Math.max(0, ...failed.map((r) => r.file.length));
  for (const r of failed) {
    const counts = new Map();
    for (const f of r.fails) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
    console.log(`  ${r.file.padEnd(nameWidth)}  ${[...counts].map(([rule, n]) => `${rule} x${n}`).join(", ")}`);
  }
  if (pairs.length) {
    console.log("\nSemantic duplicate pairs:");
    for (const { a, b, why } of pairs) console.log(`  ${a.file} and ${b.file}: ${why.join("; ")}`);
  }

  if (args.index) {
    if (failed.length) console.log(`\nINDEX not written (${args.index}): ${failed.length} file(s) failed`);
    else {
      const index = rows
        .map((r) => ({ id: r.sc.id, title: r.sc.title, field: r.sc.field, level: r.sc.level, family: r.sc.family, requires: r.sc.requires, sha256: r.sha256, eligible: true }))
        .sort((a, b) => a.id.localeCompare(b.id));
      fs.mkdirSync(path.dirname(path.resolve(args.index)), { recursive: true });
      fs.writeFileSync(args.index, `${JSON.stringify(index, null, 2)}\n`);
      console.log(`\nINDEX written: ${args.index} (${index.length} entries, each eligible: true; the runner sets executedWorkflow from observed runs)`);
    }
  }
  process.exit(failed.length ? 1 : 0);
}

main();
