#!/usr/bin/env node
// validate-scenarios.mjs: checks Meridian usage-scenario files against SCENARIO_FORMAT.md, format version 1.1.
//
// Usage: node validate-scenarios.mjs <dir> [--forbidden <terms.txt>] [--index <INDEX.json>]
//   <dir>         folder whose *.json files are scenarios (a file named INDEX.json is skipped; subfolders are
//                 not read)
//   --forbidden   optional list, one lowercase term per line (blank lines and lines starting with # are
//                 ignored); any string in a scenario that contains a term fails that scenario
//   --index       write the bank index there when every file passes: [{ id, title, field, level, family,
//                 requires, sha256, executedWorkflow }], sha256 of the file bytes, executedWorkflow true when
//                 requires is empty (no checkpoint can end as capability absent); nothing is written on a failure
//
// Prints one table row per file, then every failure and warning with its location.
// Exit status: 0 every file passes, 1 at least one file fails, 2 usage error.
// No dependencies; Node 18 or later.
//
// Encoded from the repository at 875fe59: the scan discovery keys and every other stage's keys from
// src/lib/ai.ts schemaFor() and DECISION_SCHEMA; the appraisal keys from APPRAISAL_SCHEMA in
// src/lib/evidence/appraise.ts; stableRecordId and its normalisation from src/lib/evidence/records.ts and
// identifiers.ts; families, stages and issue codes from src/lib/types.ts and src/lib/contracts.ts.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const FORMAT_VERSION = "1.1";

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

// A store check on one of these fields states a status, so the same step's screen check must name status text
// (format 1.1: "a title alone never proves a status").
const STATUS_FIELDS = ["status", "selectionStatus", "actionStatus", "gradeOverall", "grade"];
const STATUS_WORDS = [
  "stale", "review required", "unrated", "not assessed", "accepted", "proposed", "withdrawn", "blocked", "ready",
  "verified", "unverified", "retrieved", "quarantined", "mismatch", "check failed", "access blocked",
  "high certainty", "moderate certainty", "low certainty", "very low certainty",
];

const PROVIDERS = ["fixture", "openalex", "crossref", "pubmed", "consensus"];
const RAW_RECORD_KEYS = ["title", "authors", "year", "venue", "doi", "providerType", "abstract", "url"];

const STEP_SPECS = {
  create: { required: [], optional: [] },
  retrieve: { required: ["provider", "query", "response"], optional: [] },
  illuminate: { required: ["stage"], optional: ["shape", "response", "responseText", "call", "omitKeys"] },
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
const COMMON_STEP_KEYS = ["do", "expect", "stopOnFail", "note"];
const EXPECT_KEYS = ["store", "screen", "issues", "export", "stage", "error", "downloads"];
const STAGE_STATES = ["complete", "incomplete", "needs-review"];
const PREDICATE_KEYS = ["oneOf", "includes", "length", "min", "max", "isNull", "absent", "notEquals", "matches"];
const SOURCE_FIELDS = ["abstract", "keyFindings", "year", "status"];
const SOURCE_STATUSES = ["unverified", "retrieved", "verified", "mismatch", "check-failed", "access-blocked"];

const TOP_REQUIRED = ["id", "version", "title", "field", "level", "family", "arm", "synthetic", "requires", "notes", "inputs", "steps"];
const TOP_OPTIONAL = ["earlyStop", "retrieval", "supersedes"];

const LIMITS = {
  fileBytes: 400 * 1024,
  titleChars: [10, 160],
  notesChars: [40, 3000],
  supersedesChars: [20, 1000],
  needWords: [120, 600],
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

const STUDY_PATH = /^[A-Za-z_$][\w$]*(\[-?\d+\])*(\.[A-Za-z_$][\w$]*(\[-?\d+\])*)*$/;
const REQUIRES_ENTRY = /^[A-Z]{1,2}\d{1,2}$/;
const SCENARIO_ID = /^sc-\d{3}(-[a-z0-9]+)*$/;
const REPLAY_KEY = /^[A-Za-z0-9._-]{1,64}$/;
const DOI_LIKE = /(?<![\d.])10\.(\d{4,9})(?:\.\d+)*\/[^\s"'<>]*/g;
const PMID_TEXT = /\bPMID\b\s*[:#]?\s*\d{4,9}/i;
const TRIAL_NUMBER = /\b(?:NCT\d{8}|ISRCTN\d{8})\b/;
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`); // en dash, em dash
const UNICODE_HYPHENS = new RegExp(`[${String.fromCharCode(0x2010)}-${String.fromCharCode(0x2015)}]`, "g"); // as in identifiers.ts

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const isPredicate = (v) => isObj(v) && Object.keys(v).length === 1 && PREDICATE_KEYS.includes(Object.keys(v)[0]);
const lastSegment = (p) => p.split(".").pop().replace(/\[-?\d+\]/g, "");
const is2xx = (n) => Number.isInteger(n) && n >= 200 && n < 300;

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

function validateFile(file, forbidden) {
  const r = { file: path.basename(file), id: "", version: "", level: "", field: "", family: "", steps: 0, stages: 0, calls: 0, fails: [], warns: [], sc: null, sha256: "" };
  const fail = (where, msg) => r.fails.push(`${where}: ${msg}`);
  const warn = (where, msg) => r.warns.push(`${where}: ${msg}`);

  const bytes = fs.readFileSync(file);
  r.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (bytes.length > LIMITS.fileBytes) fail("file", `${bytes.length} bytes exceeds ${LIMITS.fileBytes}`);
  let sc;
  try {
    sc = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    fail("file", `not valid JSON (${e.message})`);
    return r;
  }
  if (!isObj(sc)) {
    fail("file", "the top level must be an object");
    return r;
  }
  r.sc = sc;

  // ---- top level ----
  for (const k of TOP_REQUIRED) if (!has(sc, k)) fail(k, "required field missing");
  for (const k of Object.keys(sc)) if (!TOP_REQUIRED.includes(k) && !TOP_OPTIONAL.includes(k)) fail(k, "unknown top-level field");
  const base = path.basename(file, ".json");
  if (typeof sc.id !== "string" || !SCENARIO_ID.test(sc.id) || !REPLAY_KEY.test(sc.id)) fail("id", `"${sc.id}" must match sc-NNN or sc-NNN-suffix (lowercase) and be a valid replay key`);
  else if (sc.id !== base) fail("id", `"${sc.id}" does not match the file name "${base}"`);
  r.id = typeof sc.id === "string" ? sc.id : "";
  if (!Number.isInteger(sc.version) || sc.version < 1) fail("version", "the scenario version must be a positive integer (1 for a new scenario)");
  r.version = sc.version ?? "";
  if (Number.isInteger(sc.version) && sc.version > 1) {
    if (typeof sc.supersedes !== "string" || sc.supersedes.trim().length < LIMITS.supersedesChars[0] || sc.supersedes.length > LIMITS.supersedesChars[1]) fail("supersedes", `version ${sc.version} must name the file it supersedes and the reason (${LIMITS.supersedesChars[0]} to ${LIMITS.supersedesChars[1]} characters)`);
  } else if (has(sc, "supersedes")) warn("supersedes", "present on a version 1 scenario");
  if (typeof sc.title !== "string" || sc.title.length < LIMITS.titleChars[0] || sc.title.length > LIMITS.titleChars[1]) fail("title", `must be a string of ${LIMITS.titleChars[0]} to ${LIMITS.titleChars[1]} characters`);
  if (!FIELDS.includes(sc.field)) fail("field", `"${sc.field}" is not in FIELDS`);
  r.field = typeof sc.field === "string" ? sc.field : "";
  if (!Number.isInteger(sc.level) || sc.level < 1 || sc.level > 5) fail("level", "must be an integer from 1 to 5");
  r.level = sc.level ?? "";
  if (!FAMILIES.includes(sc.family) && sc.family !== "unresolved") fail("family", `"${sc.family}" is neither one of the 20 study families nor "unresolved"`);
  r.family = typeof sc.family === "string" ? sc.family : "";
  if (sc.arm !== "deterministic") fail("arm", 'must be "deterministic"');
  if (sc.synthetic !== true) fail("synthetic", "must be true");
  const requires = Array.isArray(sc.requires) ? sc.requires : [];
  if (!Array.isArray(sc.requires)) fail("requires", "must be an array (empty when no entry is needed)");
  else {
    sc.requires.forEach((e, i) => {
      if (typeof e !== "string" || !REQUIRES_ENTRY.test(e)) fail(`requires[${i}]`, `"${e}" is not a work-order entry name such as D2, S11 or R1`);
    });
    if (new Set(sc.requires).size !== sc.requires.length) fail("requires", "duplicate entries");
  }
  if (typeof sc.notes !== "string" || sc.notes.length < LIMITS.notesChars[0] || sc.notes.length > LIMITS.notesChars[1]) fail("notes", `must be a string of ${LIMITS.notesChars[0]} to ${LIMITS.notesChars[1]} characters`);
  if (has(sc, "earlyStop") && (typeof sc.earlyStop !== "string" || sc.earlyStop.trim().length < LIMITS.earlyStopChars[0] || sc.earlyStop.length > LIMITS.earlyStopChars[1])) {
    fail("earlyStop", `must be a string of ${LIMITS.earlyStopChars[0]} to ${LIMITS.earlyStopChars[1]} characters that documents why the scenario stops early`);
  }

  // ---- inputs ----
  if (!isObj(sc.inputs)) fail("inputs", "must be an object with need, constraints and localFacts");
  else {
    const inp = sc.inputs;
    for (const k of Object.keys(inp)) if (!["need", "constraints", "localFacts"].includes(k)) fail(`inputs.${k}`, "unknown field");
    if (typeof inp.need !== "string") fail("inputs.need", "required string");
    else {
      const w = words(inp.need);
      if (w < LIMITS.needWords[0] || w > LIMITS.needWords[1]) fail("inputs.need", `${w} words; the format asks for ${LIMITS.needWords[0]} to ${LIMITS.needWords[1]}`);
      if (inp.need !== inp.need.trim()) warn("inputs.need", "leading or trailing whitespace (the create form trims it)");
    }
    if (typeof inp.constraints !== "string") fail("inputs.constraints", "required string (may be empty)");
    else if (inp.constraints.length > LIMITS.constraintsChars) fail("inputs.constraints", `${inp.constraints.length} characters exceeds ${LIMITS.constraintsChars}`);
    if (!Array.isArray(inp.localFacts)) fail("inputs.localFacts", "required array (may be empty)");
    else {
      if (inp.localFacts.length > LIMITS.localFacts) fail("inputs.localFacts", `${inp.localFacts.length} entries exceeds ${LIMITS.localFacts}`);
      inp.localFacts.forEach((f, i) => {
        if (typeof f !== "string" || f.length < LIMITS.localFactChars[0] || f.length > LIMITS.localFactChars[1]) fail(`inputs.localFacts[${i}]`, `must be a string of ${LIMITS.localFactChars[0]} to ${LIMITS.localFactChars[1]} characters`);
        else if (/[\r\n]/.test(f)) fail(`inputs.localFacts[${i}]`, "one line each; contains a line break");
      });
    }
  }

  // ---- steps ----
  const steps = Array.isArray(sc.steps) ? sc.steps : [];
  if (!Array.isArray(sc.steps) || sc.steps.length === 0) fail("steps", "must be a non-empty array");
  r.steps = steps.length;
  const callCount = {};
  const stagesRun = new Set();
  const scanTitles = new Set();
  const retrievedIds = new Set();
  let recordsRetrieved = 0; // records from 2xx fixture retrieve steps so far
  let unknownCountRetrieve = false; // a 2xx real-provider body was served; its record count is not parsed here
  let lastRetrieveRecords = null; // records returned by the most recent retrieve: null before any, -1 when not countable
  let confirmSeen = false;
  let scanCompletionChecked = false;
  let createSeen = false;
  let createMissingReported = false;
  let decisionOffered = false;
  let decisionSteps = 0;
  let acceptedStatedAt = -1; // index of the latest accept-decision whose expectation states selectionStatus accepted
  const changeSources = [];
  let reloads = 0;
  let reopens = 0;
  let exportsEqual = 0;
  let refusalStated = false;

  const checkStorePath = (p, where) => {
    if (!STUDY_PATH.test(p)) {
      fail(where, `"${p}" is not a study path (dot-separated keys with optional [n] indexes)`);
      return;
    }
    const wo = WORK_ORDER_PATHS.find(([re]) => re.test(p));
    if (wo && requires.length === 0) fail(where, `"${p}" is introduced by work order 2 (${wo[1]}); name the entry in requires`);
    const first = p.split(/[.[]/)[0];
    if (!wo && !STUDY_KEYS_875.includes(first)) warn(where, `"${first}" is not a field of the 875fe59 Study object`);
  };

  const checkPredicate = (v, where) => {
    if (v === undefined) {
      fail(where, "missing predicate");
      return;
    }
    if (!isPredicate(v)) return; // a literal, compared by deep equality
    const [k, a] = Object.entries(v)[0];
    const bad = (m) => fail(where, `predicate ${k}: ${m}`);
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
      fail(where, "expect must be an object");
      return;
    }
    for (const k of Object.keys(ex)) if (!EXPECT_KEYS.includes(k)) fail(`${where}.${k}`, "unknown expectation key");
    if (has(ex, "store")) {
      if (!isObj(ex.store) || Object.keys(ex.store).length === 0) fail(`${where}.store`, "must be a non-empty object of study path to predicate");
      else {
        for (const [p, v] of Object.entries(ex.store)) {
          checkStorePath(p, `${where}.store`);
          checkPredicate(v, `${where}.store["${p}"]`);
          noteRefusal(v);
          if (/quarantine/.test(p)) refusalStated = true;
        }
        // Status text rule: a store check on a status field needs status text in the same step's screen check.
        const statusPaths = Object.keys(ex.store).filter((p) => STUDY_PATH.test(p) && STATUS_FIELDS.includes(lastSegment(p)));
        if (statusPaths.length) {
          const inc = isObj(ex.screen) && Array.isArray(ex.screen.includes) ? ex.screen.includes : [];
          const named = inc.some((s) => typeof s === "string" && STATUS_WORDS.some((w) => s.toLowerCase().includes(w)));
          if (!named) fail(`${where}.screen`, `the store check names a status field (${statusPaths.slice(0, 3).join(", ")}${statusPaths.length > 3 ? ", ..." : ""}); screen.includes must name the status text (one of: ${STATUS_WORDS.slice(0, 6).join(", ")}, ...)`);
        }
      }
    }
    if (has(ex, "screen")) {
      if (!isObj(ex.screen)) fail(`${where}.screen`, "must be an object with includes and/or excludes");
      else {
        for (const k of Object.keys(ex.screen)) if (!["includes", "excludes"].includes(k)) fail(`${where}.screen.${k}`, "unknown key");
        for (const k of ["includes", "excludes"]) {
          if (!has(ex.screen, k)) continue;
          const a = ex.screen[k];
          if (!Array.isArray(a) || a.length === 0) fail(`${where}.screen.${k}`, "must be a non-empty array of strings");
          else a.forEach((s, i) => {
            if (typeof s !== "string" || s.length < LIMITS.screenTextChars[0] || s.length > LIMITS.screenTextChars[1]) fail(`${where}.screen.${k}[${i}]`, `must be a string of ${LIMITS.screenTextChars[0]} to ${LIMITS.screenTextChars[1]} characters`);
          });
        }
      }
    }
    if (has(ex, "issues")) {
      if (step.do !== "illuminate") fail(`${where}.issues`, "issues are produced by an illuminate step only");
      if (!isObj(ex.issues)) fail(`${where}.issues`, "must be an object with includes and/or count");
      else {
        for (const k of Object.keys(ex.issues)) if (!["includes", "count"].includes(k)) fail(`${where}.issues.${k}`, "unknown key");
        if (has(ex.issues, "includes")) {
          if (!Array.isArray(ex.issues.includes) || ex.issues.includes.length === 0) fail(`${where}.issues.includes`, "must be a non-empty array of { path, code }");
          else ex.issues.includes.forEach((it, i) => {
            const w = `${where}.issues.includes[${i}]`;
            if (!isObj(it) || typeof it.path !== "string" || typeof it.code !== "string") fail(w, "needs string path and string code");
            else {
              for (const k of Object.keys(it)) if (!["path", "code"].includes(k)) fail(`${w}.${k}`, "unknown key");
              if (!/^[a-z][a-z0-9-]*$/.test(it.code)) fail(`${w}.code`, `"${it.code}" is not a kebab-case issue code`);
              else if (!ISSUE_CODES_875.includes(it.code) && requires.length === 0) warn(`${w}.code`, `"${it.code}" is not an 875fe59 IssueCode; name the work-order entry that adds it in requires`);
              // The scan mapper drops the model's sourcesConsulted text in every discovery reply; that alone states no refusal.
              const routine = it.code === "dropped" && it.path === "sourcesConsulted";
              if (!routine && (REFUSAL_CODES.includes(it.code) || !ISSUE_CODES_875.includes(it.code))) refusalStated = true;
            }
          });
        }
        if (has(ex.issues, "count")) {
          const c = ex.issues.count;
          if (!(Number.isInteger(c) && c >= 0) && !isPredicate(c)) fail(`${where}.issues.count`, "must be a non-negative integer or a predicate");
          else if (isPredicate(c)) checkPredicate(c, `${where}.issues.count`);
        }
      }
    }
    if (has(ex, "export")) {
      if (step.do !== "export") fail(`${where}.export`, "export checks belong to an export step");
      if (!isObj(ex.export)) fail(`${where}.export`, "must be an object");
      else {
        for (const k of Object.keys(ex.export)) if (!["equalsStore", "path"].includes(k)) fail(`${where}.export.${k}`, "unknown key");
        if (has(ex.export, "equalsStore") && typeof ex.export.equalsStore !== "boolean") fail(`${where}.export.equalsStore`, "must be a boolean");
        if (has(ex.export, "path")) {
          if (!isObj(ex.export.path)) fail(`${where}.export.path`, "must be an object of study path to predicate");
          else for (const [p, v] of Object.entries(ex.export.path)) {
            checkStorePath(p, `${where}.export.path`);
            checkPredicate(v, `${where}.export.path["${p}"]`);
            noteRefusal(v);
          }
        }
      }
    }
    if (has(ex, "stage")) {
      if (!isObj(ex.stage) || Object.keys(ex.stage).length === 0) fail(`${where}.stage`, "must be a non-empty object of stage to state");
      else for (const [st, state] of Object.entries(ex.stage)) {
        if (!STAGES.includes(st)) fail(`${where}.stage`, `"${st}" is not a stage id`);
        if (!STAGE_STATES.includes(state)) fail(`${where}.stage.${st}`, `"${state}" must be one of ${STAGE_STATES.join(", ")}`);
      }
    }
    if (has(ex, "error")) {
      if (!isObj(ex.error) || typeof ex.error.shown !== "boolean") fail(`${where}.error`, "needs a boolean shown");
      else {
        for (const k of Object.keys(ex.error)) if (!["shown", "includes"].includes(k)) fail(`${where}.error.${k}`, "unknown key");
        if (has(ex.error, "includes") && (typeof ex.error.includes !== "string" || !ex.error.includes)) fail(`${where}.error.includes`, "must be a non-empty string");
        if (ex.error.shown) refusalStated = true;
      }
    }
    if (has(ex, "downloads")) {
      if (step.do !== "export") fail(`${where}.downloads`, "downloads checks belong to an export step");
      if (!isObj(ex.downloads) || !Number.isInteger(ex.downloads.count) || ex.downloads.count < 0) fail(`${where}.downloads`, "needs a non-negative integer count");
      else for (const k of Object.keys(ex.downloads)) if (k !== "count") fail(`${where}.downloads.${k}`, "unknown key");
    }
  };

  const checkRetrieve = (step, where) => {
    if (!PROVIDERS.includes(step.provider)) fail(`${where}.provider`, `"${step.provider}" must be one of ${PROVIDERS.join(", ")}`);
    if (typeof step.query !== "string" || !step.query.trim()) fail(`${where}.query`, "must be a non-empty string");
    const res = step.response;
    if (!isObj(res)) {
      fail(`${where}.response`, "must be an object");
      return;
    }
    if (!Number.isInteger(res.status) || res.status < 0 || res.status > 599) fail(`${where}.response.status`, "must be an HTTP status number (0 for a request that never reached the host)");
    if (has(res, "note") && typeof res.note !== "string") fail(`${where}.response.note`, "must be a string");
    if (step.provider === "fixture") {
      for (const k of Object.keys(res)) if (!["status", "total", "records", "note"].includes(k)) fail(`${where}.response.${k}`, "unknown key for a fixture response (status, total, records, note)");
      if (is2xx(res.status)) {
        if (!Array.isArray(res.records)) {
          fail(`${where}.response.records`, "a 2xx fixture response needs a records array (empty for an empty search)");
          lastRetrieveRecords = 0;
          return;
        }
        if (!(res.total === null || (Number.isInteger(res.total) && res.total >= 0))) fail(`${where}.response.total`, "must be a non-negative integer or null");
        else if (Number.isInteger(res.total) && res.total < res.records.length) fail(`${where}.response.total`, `${res.total} is less than the ${res.records.length} records returned`);
        if (res.records.length > LIMITS.fixtureRecordsMax) fail(`${where}.response.records`, `${res.records.length} records exceeds ${LIMITS.fixtureRecordsMax}`);
        const idsHere = new Set();
        res.records.forEach((rec, k) => {
          const w = `${where}.response.records[${k}]`;
          if (!isObj(rec)) {
            fail(w, "must be a RawRecord object");
            return;
          }
          for (const key of Object.keys(rec)) if (!RAW_RECORD_KEYS.includes(key)) fail(`${w}.${key}`, `not a RawRecord field for the fixture provider (${RAW_RECORD_KEYS.join(", ")})`);
          if (typeof rec.title !== "string" || !rec.title.trim()) fail(`${w}.title`, "must be a non-empty string");
          if (typeof rec.authors !== "string") fail(`${w}.authors`, "must be a string");
          if (!(rec.year === null || Number.isInteger(rec.year))) fail(`${w}.year`, "must be an integer or null");
          if (typeof rec.venue !== "string") fail(`${w}.venue`, "must be a string");
          for (const key of ["doi", "providerType", "abstract", "url"]) if (has(rec, key) && typeof rec[key] !== "string") fail(`${w}.${key}`, "must be a string when present");
          if (!has(rec, "abstract")) warn(`${w}.abstract`, "no abstract; realistic fixture records carry one");
          if (typeof rec.title === "string") {
            const id = stableRecordId(rec);
            if (idsHere.has(id)) warn(w, `stableRecordId ${id} repeats a record in the same response`);
            idsHere.add(id);
            retrievedIds.add(id);
          }
        });
        recordsRetrieved += res.records.length;
        lastRetrieveRecords = res.records.length;
      } else {
        if (Array.isArray(res.records) && res.records.length) warn(`${where}.response.records`, `records on a status ${res.status} response are never parsed`);
        lastRetrieveRecords = 0;
      }
    } else {
      for (const k of Object.keys(res)) if (!["status", "body", "note"].includes(k)) fail(`${where}.response.${k}`, `unknown key for a ${step.provider} response (status, body, note)`);
      if (typeof res.body !== "string") fail(`${where}.response.body`, "must be the provider's raw body text (a string, empty for a failed call)");
      if (is2xx(res.status) && typeof res.body === "string" && res.body.trim()) {
        unknownCountRetrieve = true; // the records inside a provider-format body are not counted here
        lastRetrieveRecords = -1;
      } else lastRetrieveRecords = 0;
    }
  };

  steps.forEach((step, i) => {
    const where = `steps[${i}]`;
    if (!isObj(step)) {
      fail(where, "must be an object");
      return;
    }
    const spec = STEP_SPECS[step.do];
    if (!spec) {
      fail(`${where}.do`, `unknown do value "${step.do}" (a scenario error, never a skip)`);
      return;
    }
    const allowed = [...COMMON_STEP_KEYS, ...spec.required, ...spec.optional];
    for (const k of Object.keys(step)) if (!allowed.includes(k)) fail(`${where}.${k}`, `unknown field for do "${step.do}"`);
    for (const k of spec.required) if (!has(step, k)) fail(where, `do "${step.do}" requires "${k}"`);
    if (has(step, "stopOnFail") && typeof step.stopOnFail !== "boolean") fail(`${where}.stopOnFail`, "must be a boolean");
    if (has(step, "note") && (typeof step.note !== "string" || !step.note.trim() || step.note.length > LIMITS.stepNoteChars)) fail(`${where}.note`, `must be a non-empty string of at most ${LIMITS.stepNoteChars} characters`);
    if (step.do !== "create" && !createSeen && !createMissingReported) {
      fail(where, "the first step must be create");
      createMissingReported = true;
    }

    switch (step.do) {
      case "create":
        if (createSeen) fail(where, "only one create step");
        if (i !== 0) fail(where, "create must be the first step");
        createSeen = true;
        break;
      case "retrieve":
        checkRetrieve(step, where);
        break;
      case "confirm-empty-search":
        if (lastRetrieveRecords === null) warn(where, "no retrieve step before the confirmation that the search was run");
        else if (lastRetrieveRecords > 0) warn(where, "the latest retrieve returned records; confirming an empty search should then be refused");
        confirmSeen = true;
        break;
      case "illuminate": {
        if (!STAGES.includes(step.stage)) {
          fail(`${where}.stage`, `"${step.stage}" is not one of the 13 stage ids`);
          break;
        }
        const n = (callCount[step.stage] = (callCount[step.stage] ?? 0) + 1);
        r.calls++;
        stagesRun.add(step.stage);
        if (has(step, "call")) {
          if (!Number.isInteger(step.call) || step.call < 1) fail(`${where}.call`, "must be a positive integer");
          else if (step.call !== n) fail(`${where}.call`, `is ${step.call} but this is illuminate call ${n} for "${step.stage}" (replay file ${step.stage}.${n}.json)`);
        } else if (n > 1) fail(`${where}.call`, `required for a repeated stage; this is call ${n} for "${step.stage}"`);
        if (step.stage === "scan") {
          if (!["discovery", "appraisal"].includes(step.shape)) fail(`${where}.shape`, 'a scan call needs shape "discovery" or "appraisal"');
        } else if (has(step, "shape")) fail(`${where}.shape`, "shape applies to scan calls only");
        const hasResp = has(step, "response");
        const hasText = has(step, "responseText");
        if (hasResp === hasText) {
          fail(where, "needs exactly one of response (object) or responseText (string)");
          break;
        }
        if (hasText) {
          if (typeof step.responseText !== "string" || step.responseText.length < LIMITS.responseTextChars[0] || step.responseText.length > LIMITS.responseTextChars[1]) fail(`${where}.responseText`, `must be a string of ${LIMITS.responseTextChars[0]} to ${LIMITS.responseTextChars[1]} characters`);
          if (has(step, "omitKeys")) fail(`${where}.omitKeys`, "applies to a response object only");
          break;
        }
        const resp = step.response;
        if (!isObj(resp)) {
          fail(`${where}.response`, "must be a JSON object (use responseText for anything else)");
          break;
        }
        const shape = step.stage === "scan" ? (["discovery", "appraisal"].includes(step.shape) ? step.shape : null) : null;
        if (step.stage === "scan" && !shape) break;
        const keys = step.stage === "scan" ? SCAN_SHAPE_KEYS[shape] : STAGE_KEYS[step.stage];
        const label = step.stage === "scan" ? `scan ${shape}` : step.stage;
        let omit = [];
        if (has(step, "omitKeys")) {
          if (!Array.isArray(step.omitKeys) || step.omitKeys.some((k) => typeof k !== "string")) fail(`${where}.omitKeys`, "must be an array of strings");
          else {
            omit = step.omitKeys;
            for (const k of omit) {
              if (!keys.includes(k)) fail(`${where}.omitKeys`, `"${k}" is not a top-level key of the ${label} schema`);
              else if (has(resp, k)) fail(`${where}.omitKeys`, `"${k}" is listed as omitted but present in the response`);
            }
          }
        }
        const missing = keys.filter((k) => !has(resp, k) && !omit.includes(k));
        if (missing.length) fail(`${where}.response`, `missing top-level key(s) of the ${label} schema: ${missing.join(", ")} (list deliberate omissions in omitKeys)`);
        const extra = Object.keys(resp).filter((k) => !keys.includes(k));
        if (extra.length) warn(`${where}.response`, `key(s) outside the ${label} schema: ${extra.join(", ")}`);
        const size = JSON.stringify(resp).length;
        const budget = (STAGE_MAX_TOKENS[step.stage] ?? DEFAULT_MAX_TOKENS) * 4;
        if (size > LIMITS.responseJsonChars) fail(`${where}.response`, `${size} characters exceeds ${LIMITS.responseJsonChars}`);
        else if (size > budget) warn(`${where}.response`, `${size} characters is more than the ${step.stage} call's max_tokens allows (about ${budget})`);
        walk(resp, `${where}.response`, (s, p) => {
          if (s.length > LIMITS.responseStringChars) fail(p, `${s.length} characters exceeds ${LIMITS.responseStringChars}`);
        }, () => {});
        if (shape === "discovery") {
          if (Array.isArray(resp.items)) {
            if (resp.items.length > LIMITS.discoveryItemsMax) warn(`${where}.response.items`, `${resp.items.length} leads; a realistic discovery reply lists at most ${LIMITS.discoveryItemsMax}`);
            resp.items.forEach((it, k) => {
              if (!isObj(it)) return;
              if (typeof it.title === "string" && it.title.trim()) scanTitles.add(it.title);
              for (const f of ["title", "authors", "source", "keyFindings"]) {
                if (typeof it[f] !== "string" || !it[f].trim()) warn(`${where}.response.items[${k}].${f}`, "empty or not a string; realistic leads name title, authors, journal and findings");
              }
            });
          } else if (has(resp, "items")) warn(`${where}.response.items`, "not an array");
        }
        if (shape === "appraisal") {
          if (recordsRetrieved === 0 && !unknownCountRetrieve) warn(where, "an appraisal call with no retrieved record before it");
          if (!Array.isArray(resp.annotations)) fail(`${where}.response.annotations`, "must be an array");
          else resp.annotations.forEach((a, k) => {
            const w = `${where}.response.annotations[${k}]`;
            if (!isObj(a) || typeof a.id !== "string" || !a.id) fail(w, "needs a string id (an existing record id)");
            else if (!retrievedIds.has(a.id)) warn(`${w}.id`, `${a.id} matches no record retrieved earlier (stableRecordId of the DOI, or of title and year)`);
          });
          if (!Array.isArray(resp.claims)) fail(`${where}.response.claims`, "must be an array");
          else resp.claims.forEach((c, k) => {
            const w = `${where}.response.claims[${k}]`;
            if (!isObj(c) || typeof c.text !== "string" || typeof c.kind !== "string" || !Array.isArray(c.sourceIds)) {
              fail(w, "needs text, kind and a sourceIds array");
              return;
            }
            if (!CLAIM_KINDS.includes(c.kind)) warn(`${w}.kind`, `"${c.kind}" is not a ClaimKind`);
            c.sourceIds.forEach((sid, q) => {
              if (typeof sid !== "string") fail(`${w}.sourceIds[${q}]`, "must be a string");
              else if (!retrievedIds.has(sid)) warn(`${w}.sourceIds[${q}]`, `${sid} matches no record retrieved earlier`);
            });
            if (c.kind === "source-derived" && c.sourceIds.length === 0) warn(w, "a source-derived claim with no source");
          });
        }
        if (step.stage === "design" && isObj(resp.decision)) decisionOffered = true;
        break;
      }
      case "set-field":
        if (typeof step.path !== "string") fail(`${where}.path`, "must be a string");
        else checkStorePath(step.path, `${where}.path`);
        break;
      case "accept-decision":
      case "withdraw-decision":
        decisionSteps++;
        if (!(step.which === "latest" || Number.isInteger(step.which))) fail(`${where}.which`, 'must be "latest" or a decision index');
        if (!decisionOffered) fail(where, "no earlier design response carries a decision object");
        if (step.do === "accept-decision" && isObj(step.expect) && isObj(step.expect.store)) {
          const accepted = Object.entries(step.expect.store).some(([p, v]) => lastSegment(p) === "selectionStatus" && v === "accepted");
          if (accepted) acceptedStatedAt = i;
        }
        break;
      case "mark-complete":
        if (!STAGES.includes(step.stage)) fail(`${where}.stage`, `"${step.stage}" is not one of the 13 stage ids`);
        break;
      case "change-source":
        if (typeof step.record !== "string" || !step.record.trim()) fail(`${where}.record`, "must be a record title");
        else if (!scanTitles.has(step.record)) fail(`${where}.record`, "matches no retrieved record title or lead title earlier in the scenario");
        if (!SOURCE_FIELDS.includes(step.field)) fail(`${where}.field`, `must be one of ${SOURCE_FIELDS.join(", ")}`);
        if (step.field === "status" && !SOURCE_STATUSES.includes(step.value)) fail(`${where}.value`, `must be a SourceStatus (${SOURCE_STATUSES.join(", ")})`);
        if (step.field === "year" && !(step.value === null || Number.isInteger(step.value))) warn(`${where}.value`, "a year is normally an integer or null");
        if (step.field === "abstract" && !requires.includes("D1")) warn(`${where}.field`, "EvidenceItem.abstract is added by D1; name D1 in requires");
        if ((step.field === "keyFindings" || step.field === "abstract") && typeof step.value !== "string") fail(`${where}.value`, "must be a string");
        if (acceptedStatedAt < 0) fail(where, "a change-source step must follow an accept-decision step whose expectation states selectionStatus \"accepted\" (a supported positive predecessor)");
        changeSources.push(i);
        break;
      case "reload":
        reloads++;
        break;
      case "reopen":
        reopens++;
        break;
      case "export":
        if (isObj(step.expect) && isObj(step.expect.export) && step.expect.export.equalsStore === true) exportsEqual++;
        break;
      case "wait":
        if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > 5000) fail(`${where}.ms`, "must be an integer from 0 to 5000");
        break;
    }
    // Retrieved record titles can be changed by change-source too.
    if (step.do === "retrieve" && isObj(step.response) && Array.isArray(step.response.records)) {
      for (const rec of step.response.records) if (isObj(rec) && typeof rec.title === "string") scanTitles.add(rec.title);
    }
    if (has(step, "expect")) checkExpect(step.expect, step, `${where}.expect`);
    // G2: a completed Scan needs a retrieved record or the investigator's confirmation of an empty search.
    if (!scanCompletionChecked && expectsScanComplete(step.expect)) {
      scanCompletionChecked = true;
      if (recordsRetrieved === 0 && !unknownCountRetrieve && !confirmSeen) fail(`${where}.expect`, "expects the Scan stage complete, but no earlier retrieve returned a record and no confirm-empty-search came first (G2)");
    }
  });
  r.stages = stagesRun.size;

  // ---- change-source follow-up (bank acceptance rule): stale in store, on screen, in the export and after reload ----
  for (const i of changeSources) {
    const later = steps.slice(i).map((s, k) => ({ s, k: i + k })).filter(({ s }) => isObj(s));
    const own = steps[i];
    if (!(isObj(own.expect) && statesStale(own.expect.store))) fail(`steps[${i}]`, "the change-source step must expect a status field \"stale\" in the store");
    const onScreen = later.some(({ s }) => isObj(s.expect) && isObj(s.expect.screen) && Array.isArray(s.expect.screen.includes) && s.expect.screen.includes.some((t) => typeof t === "string" && t.toLowerCase().includes("stale")));
    if (!onScreen) fail(`steps[${i}]`, 'no screen check names "stale" at or after the change-source step');
    const inExport = later.some(({ s }) => s.do === "export" && isObj(s.expect) && isObj(s.expect.export) && statesStale(s.expect.export.path));
    if (!inExport) fail(`steps[${i}]`, "no later export step checks a status field \"stale\" in export.path");
    const afterReload = later.some(({ s }) => s.do === "reload" && isObj(s.expect) && statesStale(s.expect.store));
    if (!afterReload) fail(`steps[${i}]`, "no later reload step checks a status field \"stale\" in the store");
  }

  // ---- full-scenario rule ----
  const earlyStop = typeof sc.earlyStop === "string" && sc.earlyStop.trim().length > 0;
  const missingStages = STAGES.filter((s) => !stagesRun.has(s));
  if (missingStages.length && !earlyStop) fail("steps", `a full scenario runs all 13 stages or documents an earlyStop; not run: ${missingStages.join(", ")}`);
  if (decisionSteps === 0) {
    if (earlyStop && !stagesRun.has("design")) warn("steps", "no decision step (accepted because earlyStop is documented and design never runs)");
    else fail("steps", "at least one decision step (accept-decision or withdraw-decision) is required");
  }
  if (reloads === 0) fail("steps", "at least one reload step is required");
  if (reopens === 0) fail("steps", "at least one reopen step is required");
  if (exportsEqual === 0) fail("steps", "at least one export step with expect.export.equalsStore true is required");
  if (!scanCompletionChecked && recordsRetrieved === 0 && !unknownCountRetrieve && !confirmSeen && stagesRun.has("scan")) warn("steps", "no retrieve with a record and no confirm-empty-search: the Scan stage can never complete (G2); state that in the expectations if intended");
  if ((sc.level === 4 || sc.level === 5) && !refusalStated) fail("steps", "a level 4 or 5 scenario must state at least one refusal (error shown, refusal issue code, quarantine entry, stale status or blocked action)");

  // ---- text rules over the whole scenario ----
  const forbiddenHits = new Map();
  walk(sc, "", (s, p) => {
    const low = s.toLowerCase();
    for (const t of forbidden) {
      if (low.includes(t)) {
        const hits = forbiddenHits.get(t) ?? [];
        hits.push(p);
        forbiddenHits.set(t, hits);
      }
    }
    for (const m of s.matchAll(DOI_LIKE)) if (m[1] !== "5555") fail(p, `real-looking DOI "${m[0]}"; invented DOIs use the reserved prefix 10.5555/`);
    if (PMID_TEXT.test(s)) fail(p, "contains a PMID; invented PMIDs are omitted");
    if (TRIAL_NUMBER.test(s)) fail(p, `contains a trial registration number (${s.match(TRIAL_NUMBER)[0]})`);
    if (DASHES.test(s)) warn(p, "contains an en or em dash");
  }, (k, p, v) => {
    if (k.toLowerCase() === "pmid") fail(p, 'a "pmid" key is not allowed');
    if (k.toLowerCase() === "doi" && typeof v === "string" && v.startsWith("10.") && !v.startsWith("10.5555/")) fail(p, `doi "${v}" does not use the reserved prefix 10.5555/`);
  });
  for (const [t, hits] of forbiddenHits) fail(hits.length > 3 ? `${hits.slice(0, 3).join(", ")} and ${hits.length - 3} more` : hits.join(", "), `contains the forbidden term "${t}"`);
  return r;
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
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".json") && e.name !== "INDEX.json").map((e) => path.join(args.dir, e.name)).sort();
  const forbidden = args.forbidden ? loadForbidden(args.forbidden) : [];
  console.log(`Meridian scenario validator, format version ${FORMAT_VERSION}`);
  console.log(`folder: ${path.resolve(args.dir)}  files: ${files.length}  forbidden terms: ${args.forbidden ? `${forbidden.length} from ${args.forbidden}` : "none (no --forbidden file)"}`);
  if (files.length === 0) {
    console.log("no scenario files found");
    process.exit(1);
  }
  const rows = files.map((f) => validateFile(f, forbidden));
  const byId = new Map();
  for (const r of rows) if (r.id) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  for (const [id, rs] of byId) if (rs.length > 1) for (const r of rs) r.fails.push(`id: "${id}" is used by ${rs.map((x) => x.file).join(" and ")}`);

  console.log("");
  console.log(table(rows));
  for (const r of rows) {
    if (!r.fails.length && !r.warns.length) continue;
    console.log(`\n${r.file}`);
    for (const f of r.fails) console.log(`  FAIL  ${f}`);
    for (const w of r.warns) console.log(`  warn  ${w}`);
  }
  const failed = rows.filter((r) => r.fails.length).length;
  const warnings = rows.reduce((n, r) => n + r.warns.length, 0);
  console.log(`\n${rows.length} files: ${rows.length - failed} passed, ${failed} failed, ${warnings} warnings`);

  if (args.index) {
    if (failed) console.log(`INDEX not written (${args.index}): ${failed} file(s) failed`);
    else {
      const index = rows
        .map((r) => ({ id: r.sc.id, title: r.sc.title, field: r.sc.field, level: r.sc.level, family: r.sc.family, requires: r.sc.requires, sha256: r.sha256, executedWorkflow: r.sc.requires.length === 0 }))
        .sort((a, b) => a.id.localeCompare(b.id));
      fs.mkdirSync(path.dirname(path.resolve(args.index)), { recursive: true });
      fs.writeFileSync(args.index, `${JSON.stringify(index, null, 2)}\n`);
      console.log(`INDEX written: ${args.index} (${index.length} entries; executedWorkflow true for ${index.filter((x) => x.executedWorkflow).length})`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
