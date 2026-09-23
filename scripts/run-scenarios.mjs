#!/usr/bin/env node
/**
 * Meridian scenario runner (A3 S17 / A3.3).
 * Usage: npx tsx scripts/run-scenarios.mjs <bankDir> <outDir> [--ids sc-001] [--mode ui|store] [--base-url url]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { treeSha256 as digestSourceTree } from "./tree-digest.mjs";

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error("usage: npx tsx scripts/run-scenarios.mjs <bankDir> <outDir> [--ids a,b] [--mode ui|store] [--base-url url]");
  process.exit(2);
}

const ROOT = path.resolve(".");
let ids = null;
let mode = "store";
let baseUrl = null;
let bankDir = ROOT;
let outDir = path.join(ROOT, "results");

function parseArgv(argv) {
  const positional = [];
  ids = null;
  mode = "store";
  baseUrl = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ids") ids = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--mode") mode = argv[++i];
    else if (argv[i] === "--base-url") baseUrl = argv[++i];
    else if (argv[i].startsWith("-")) usage(`unknown flag ${argv[i]}`);
    else positional.push(argv[i]);
  }
  if (positional.length < 2) usage("bankDir and outDir required");
  if (mode !== "ui" && mode !== "store") usage("mode must be ui or store");
  bankDir = path.resolve(positional[0]);
  outDir = path.resolve(positional[1]);
}
const PERSIST_KEY = "meridian-studio-v2";
const STAGE_LABEL = {
  problem: "Problem",
  scan: "Scan",
  map: "Map",
  gaps: "Gaps",
  hypotheses: "Hypotheses",
  questions: "Questions",
  design: "Design",
  protocol: "Protocol",
  stats: "Stats",
  ethics: "Ethics",
  voices: "Voices",
  manuscript: "Manuscript",
  audit: "Audit",
};

export function canonicalJson(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => canonicalJson(v));
  const out = {};
  for (const k of Object.keys(value).sort()) {
    const v = canonicalJson(value[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function normalizeJson(value) {
  return canonicalJson(value) ?? null;
}

export function deepEqualJson(a, b) {
  return JSON.stringify(canonicalJson(a) ?? null) === JSON.stringify(canonicalJson(b) ?? null);
}

export function parsePersistedStudio(raw) {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed?.state?.studies)) return parsed.state.studies;
  if (Array.isArray(parsed?.studies)) return parsed.studies;
  return [];
}

export function studyWithoutEnvelope(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const { meta: _meta, ...rest } = obj;
  return rest;
}

export function sourceContentChanged(beforeVal, afterVal) {
  return JSON.stringify(canonicalJson(beforeVal) ?? null) !== JSON.stringify(canonicalJson(afterVal) ?? null);
}

export function sha256Of(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function collectArtifactHashes(dir, names) {
  const artifacts = [];
  const artifactSha256 = {};
  for (const name of names) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
    const buf = fs.readFileSync(p);
    artifacts.push(name);
    artifactSha256[name] = sha256Of(buf);
  }
  return { artifacts, artifactSha256 };
}

export function statusOfCheckpoints(checkpoints) {
  const failed = (checkpoints ?? []).filter((c) => !c.ok);
  if (!checkpoints || checkpoints.length === 0) return "INCOMPLETE";
  if (failed.some((c) => /could not start|server/i.test(c.reason || ""))) return "BLOCKED";
  return failed.length ? "FAIL" : "PASS";
}

export function exitCodeForStatuses(statuses) {
  return statuses.some((s) => s !== "PASS") ? 1 : 0;
}

function readPersistedById(studyId) {
  try {
    const raw = globalThis.localStorage?.getItem(PERSIST_KEY);
    if (!raw) return { raw: null, study: null, studies: [] };
    const studies = parsePersistedStudio(raw);
    const study = studyId ? (studies.find((s) => s.id === studyId) ?? null) : (studies.at(-1) ?? null);
    return { raw, study, studies };
  } catch {
    return { raw: null, study: null, studies: [] };
  }
}

const WORK_ORDER_PATHS = [
  [/(^|\.)selectionStatus$/, "S11"],
  [/(^|\.)actionStatus$/, "S11"],
  [/(^|\.)recommendedFamily$/, "S11"],
  [/(^|\.)priorFamily$/, "S11"],
  [/^design\.routing(\.|$)/, "S11"],
  [/^design\.basis$/, "S11"],
  [/(^|\.)resourcesAssumed(\[|\.|$)/, "D10"],
  [/(^|\.)legacyScores(\.|$)/, "M6"],
  [/^scan\.comparisons(\[|\.|$)/, "S9"],
];

const IMPLEMENTED = new Set(["D1", "D5", "D7", "D10", "D18", "D20", "D20(a)", "D21", "L1", "P1", "P2", "R1", "S3", "S10", "S11", "S16", "S17", "F4"]);

function capabilityOf(storePath) {
  for (const [re, entry] of WORK_ORDER_PATHS) {
    if (re.test(storePath)) return entry;
  }
  return null;
}

function getPath(obj, p) {
  const parts = p.replace(/\[(-?\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (/^-?\d+$/.test(part)) {
      const i = Number(part);
      if (!Array.isArray(cur)) return undefined;
      cur = cur[i < 0 ? cur.length + i : i];
    } else cur = cur[part];
  }
  return cur;
}

function matchPred(observed, expected) {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if ("length" in expected && !("min" in expected) && !("max" in expected)) {
      const n = Array.isArray(observed) ? observed.length : observed == null ? 0 : String(observed).length;
      return n === expected.length;
    }
    if ("includes" in expected && !("path" in expected)) return String(observed ?? "").includes(expected.includes);
    if ("isNull" in expected) return expected.isNull ? observed === null : observed !== null;
    if ("absent" in expected) return expected.absent ? observed === undefined : observed !== undefined;
    if ("oneOf" in expected) return expected.oneOf.some((v) => matchPred(observed, v));
    if ("anyOf" in expected) return expected.anyOf.some((v) => matchPred(observed, v));
    if ("min" in expected || "max" in expected) {
      const n = typeof observed === "number" ? observed : Array.isArray(observed) ? observed.length : Number(observed);
      if (Number.isNaN(n)) return false;
      if ("min" in expected && n < expected.min) return false;
      if ("max" in expected && n > expected.max) return false;
      return true;
    }
    if ("notEquals" in expected) return JSON.stringify(canonicalJson(observed)) !== JSON.stringify(canonicalJson(expected.notEquals));
    if ("matches" in expected) return new RegExp(expected.matches).test(String(observed ?? ""));
  }
  return JSON.stringify(canonicalJson(observed) ?? null) === JSON.stringify(canonicalJson(expected) ?? null);
}

/** Screen text match: case-insensitive substring, with anyOf/oneOf objects from the bank goldens. */
export function screenHas(body, t) {
  const hay = String(body ?? "");
  if (t && typeof t === "object" && !Array.isArray(t)) {
    if (Array.isArray(t.anyOf)) return t.anyOf.some((x) => screenHas(hay, x));
    if (Array.isArray(t.oneOf)) return t.oneOf.some((x) => screenHas(hay, x));
    if (typeof t.includes === "string") return screenHas(hay, t.includes);
  }
  if (typeof t !== "string") return false;
  return hay.toLowerCase().includes(t.toLowerCase());
}

/** Which listed wording matched; used so anyOf results record the visible string (A4.1 R-3). */
export function screenMatch(body, t) {
  const hay = String(body ?? "");
  if (t && typeof t === "object" && !Array.isArray(t) && Array.isArray(t.anyOf)) {
    const matched = t.anyOf.find((x) => screenHas(hay, x));
    return { ok: matched != null, matched: matched ?? null };
  }
  if (t && typeof t === "object" && !Array.isArray(t) && Array.isArray(t.oneOf)) {
    const matched = t.oneOf.find((x) => screenHas(hay, x));
    return { ok: matched != null, matched: matched ?? null };
  }
  const ok = screenHas(hay, t);
  return { ok, matched: ok ? t : null };
}

export function evalIssues(expectIssues, lastIssues, step, n, action, checkpoints) {
  const issues = Array.isArray(lastIssues) ? lastIssues : [];
  let emitted = false;
  if (expectIssues.count !== undefined) {
    emitted = true;
    const observed = issues.length;
    const ok = matchPred(observed, expectIssues.count);
    checkpoints.push(checkpoint({
      step: n,
      action,
      check: "issues.count",
      expected: expectIssues.count,
      observed,
      ok,
      reason: ok ? "" : `observed ${observed}`,
    }));
  }
  if (Array.isArray(expectIssues.includes)) {
    for (const want of expectIssues.includes) {
      emitted = true;
      const ok = issues.some((i) => i.path === want.path && i.code === want.code);
      checkpoints.push(checkpoint({
        step: n,
        action,
        check: `issues.${want.path}`,
        expected: want,
        observed: issues,
        ok,
        reason: ok ? "" : "issue not recorded",
      }));
    }
  }
  if (!emitted) {
    checkpoints.push(checkpoint({
      step: n,
      action,
      check: "issues",
      expected: expectIssues,
      observed: issues,
      ok: false,
      reason: "issues expect has no evaluable assertion",
    }));
  }
}

export function evalError(expectError, lastError, screenText, step, n, action, checkpoints) {
  const hay = `${lastError ?? ""}\n${screenText ?? ""}`;
  if (expectError.shown !== undefined) {
    const shown = /failed|rejected|error|not applied|did not return JSON|nothing applied/i.test(hay) && hay.trim().length > 0;
    const ok = expectError.shown ? shown : !shown;
    checkpoints.push(checkpoint({
      step: n,
      action,
      check: "error.shown",
      expected: expectError.shown,
      observed: shown,
      ok,
      reason: ok ? "" : "error not visible",
    }));
  }
  if (expectError.includes) {
    const ok = hay.includes(expectError.includes);
    checkpoints.push(checkpoint({
      step: n,
      action,
      check: "error.includes",
      expected: expectError.includes,
      observed: hay.slice(0, 240),
      ok,
      reason: ok ? "" : `required refusal text omitted: ${expectError.includes}`,
    }));
  }
  if (expectError.shown === undefined && !expectError.includes) {
    checkpoints.push(checkpoint({
      step: n,
      action,
      check: "error",
      expected: expectError,
      observed: hay.slice(0, 240),
      ok: false,
      reason: "error expect has no evaluable assertion",
    }));
  }
}

function evalExpect({ study, persistedStudy, step, n, action, checkpoints, lastIssues, lastError, screenText, errorText, exportJson, requires }) {
  if (step.expect?.store) evalStoreExpect(study, step.expect.store, requires || [], n, action, checkpoints, lastIssues);
  if (step.expect?.stage) {
    for (const [st, want] of Object.entries(step.expect.stage)) {
      const observed = study ? stageState(study, st) : "missing";
      checkpoints.push(checkpoint({ step: n, action, check: `stage.${st}`, expected: want, observed, ok: observed === want, reason: observed === want ? "" : `observed ${observed}` }));
    }
  }
  if (step.expect?.issues) evalIssues(step.expect.issues, lastIssues, step, n, action, checkpoints);
  if (step.expect?.error) evalError(step.expect.error, "", errorText ?? screenText, step, n, action, checkpoints);
  if (step.expect?.screen?.includes) {
    const body = screenText ?? "";
    for (const t of step.expect.screen.includes) {
      const { ok, matched } = screenMatch(body, t);
      checkpoints.push(checkpoint({
        step: n,
        action,
        check: "screen.includes",
        expected: t,
        observed: ok ? matched : body.slice(0, 200),
        ok,
        reason: ok ? (matched && typeof matched === "string" && t && t.anyOf ? `matched ${matched}` : "") : "text not visible",
      }));
    }
  }
  if (step.expect?.screen?.excludes) {
    const body = screenText ?? "";
    for (const t of step.expect.screen.excludes) {
      const ok = !body.includes(t);
      checkpoints.push(checkpoint({ step: n, action, check: "screen.excludes", expected: t, observed: ok, ok, reason: ok ? "" : "text was visible" }));
    }
  }
  if (step.expect?.export) {
    if (!exportJson) {
      checkpoints.push(checkpoint({ step: n, action, check: "export", expected: "file", observed: null, ok: false, reason: "export.json not written" }));
    } else {
      const parsed = JSON.parse(exportJson);
      const rest = studyWithoutEnvelope(parsed);
      if (step.expect.export.equalsStore) {
        const saved = persistedStudy ?? null;
        const ok = saved != null && deepEqualJson(rest, studyWithoutEnvelope(saved));
        checkpoints.push(checkpoint({
          step: n,
          action,
          check: "export.equalsStore",
          expected: true,
          observed: ok,
          ok,
          reason: ok ? "" : saved == null ? "no persisted study to compare" : "export JSON does not deep-equal persisted study (key order ignored only)",
        }));
      }
      if (step.expect.export.path) evalStoreExpect(parsed, step.expect.export.path, requires || [], n, { ...step, do: "export" }, checkpoints, lastIssues);
    }
  }
}

function polyfillStorage() {
  if (globalThis.localStorage) return;
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(String(k), String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  };
  if (!globalThis.window) globalThis.window = globalThis;
}

async function loadLib() {
  polyfillStorage();
  const store = await import(pathToFileURL(path.join(ROOT, "src/lib/store.ts")).href);
  const defaults = await import(pathToFileURL(path.join(ROOT, "src/lib/defaults.ts")).href);
  const stages = await import(pathToFileURL(path.join(ROOT, "src/lib/stages.ts")).href);
  const decision = await import(pathToFileURL(path.join(ROOT, "src/lib/evidence/decision.ts")).href);
  const apply = await import(pathToFileURL(path.join(ROOT, "src/lib/apply-ai.ts")).href);
  const exp = await import(pathToFileURL(path.join(ROOT, "src/lib/export.ts")).href);
  const retrieve = await import(pathToFileURL(path.join(ROOT, "src/lib/evidence/retrieve.ts")).href);
  const fixture = await import(pathToFileURL(path.join(ROOT, "src/lib/evidence/fixture-adapter.ts")).href);
  const transport = await import(pathToFileURL(path.join(ROOT, "src/lib/evidence/transport.ts")).href);
  const runtime = await import(pathToFileURL(path.join(ROOT, "src/lib/model-runtime.ts")).href);
  return { store, defaults, stages, decision, apply, exp, runtime, retrieve, fixture, transport };
}

function listScenarios(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "INDEX.json")
    .map((f) => path.join(dir, f));
}

function checkpoint({ step, action, check, expected, observed, ok, reason }) {
  return { step, do: action.do, stage: action.stage, check, expected, observed, ok, reason: reason || "" };
}

function stageState(study, stageId) {
  if ((study.needsReview ?? []).includes(stageId)) return "needs-review";
  if ((study.completedStages ?? []).includes(stageId)) return "complete";
  return "incomplete";
}

function evalStoreExpect(study, expectStore, requires, step, action, checkpoints, lastIssues) {
  void lastIssues;
  for (const [p, pred] of Object.entries(expectStore || {})) {
    const observed = getPath(study, p);
    let ok = matchPred(observed, pred);
    let reason = "";
    const cap = capabilityOf(p);
    const required = cap && (requires.includes(cap) || requires.some((r) => cap.startsWith(r)));
    if (required && !IMPLEMENTED.has(cap)) {
      if (ok) {
        ok = false;
        reason = `capability absent: ${cap}`;
      } else if (observed === undefined) {
        reason = `capability absent: ${cap}`;
      } else {
        reason = `observed ${JSON.stringify(observed)}`;
      }
    } else if (!ok) {
      if (observed === undefined && cap && !IMPLEMENTED.has(cap)) reason = `capability absent: ${cap}`;
      else reason = `observed ${JSON.stringify(observed)}`;
    }
    checkpoints.push(checkpoint({ step, action, check: `store.${p}`, expected: pred, observed, ok, reason }));
  }
}

function resetPersistedStudio(lib) {
  try {
    if (globalThis.localStorage) {
      const keys = [];
      for (let i = 0; i < globalThis.localStorage.length; i++) {
        const k = globalThis.localStorage.key(i);
        if (k && (k === PERSIST_KEY || k.startsWith(`${PERSIST_KEY}.`))) keys.push(k);
      }
      for (const k of keys) globalThis.localStorage.removeItem(k);
    }
  } catch {
    /* storage may refuse */
  }
  if (lib.store?.useStudio) {
    lib.store.useStudio.setState({ studies: [], hydrated: true, backupFailure: null });
  }
}

async function waitStoreHydrated(lib) {
  const api = lib.store?.useStudio?.persist;
  if (!api) return;
  if (api.hasHydrated?.()) return;
  await new Promise((resolve) => {
    const unsub = api.onFinishHydration?.(() => {
      unsub?.();
      resolve();
    });
    if (api.hasHydrated?.()) {
      unsub?.();
      resolve();
    }
    setTimeout(resolve, 1000);
  });
}

async function runStore(scenario, lib) {
  const { store, stages, decision, exp } = lib;
  await waitStoreHydrated(lib);
  resetPersistedStudio(lib);
  const S = () => store.useStudio.getState();
  const fam = stages.guessFamily(scenario.inputs.need);
  const created = S().create({
    family: fam,
    setting: "Unspecified setting",
    rawNeed: scenario.inputs.need,
    replayKey: scenario.id,
    constraints: scenario.inputs.constraints || "",
    localFacts: Array.isArray(scenario.inputs.localFacts) ? scenario.inputs.localFacts.filter((f) => typeof f === "string") : [],
  });
  let studyId = created.id;
  let lastIssues = [];
  let lastError = "";
  let exportJson = null;
  const checkpoints = [];
  const artifacts = [];
  const actionRoutes = [];

  function study() {
    return S().studies.find((s) => s.id === studyId);
  }

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const n = i + 1;
    try {
      if (step.do === "create") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
      } else if (step.do === "retrieve") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
        const provider = step.provider || "fixture";
        const adapter = provider === "fixture" ? lib.fixture.fixtureAdapter() : lib.fixture.replaySearchAdapter(provider);
        const url = provider === "fixture" ? lib.fixture.fixtureRecordingUrl(step.query || "") : lib.fixture.replayRecordingUrl(provider, step.query || "");
        const raw = step.response ?? {};
        const body = typeof raw.body === "string" ? raw.body : JSON.stringify(raw);
        const status = typeof raw.status === "number" ? raw.status : 200;
        const transport = lib.transport.recordedTransport({ [url]: { status, body, note: raw.note } });
        const result = await lib.retrieve.runSearch(adapter, step.query || "", transport);
        S().applyRetrieval(studyId, result);
      } else if (step.do === "confirm-empty-search") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
        S().confirmEmptySearch(studyId);
        S().markComplete(studyId, "scan");
      } else if (step.do === "illuminate") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
        let payload = step.response ?? null;
        let parseError = "";
        if (payload == null && step.responseText) {
          try {
            payload = JSON.parse(step.responseText);
          } catch {
            parseError = "The model did not return JSON.";
            payload = null;
          }
        }
        if (parseError) {
          S().recordIlluminateFailure(studyId, step.stage, parseError);
          lastError = parseError;
          lastIssues = [];
        } else {
          const s = study();
          const rev = decision.studyRevision(s);
          if (step.late && Array.isArray(step.during)) {
            for (const act of step.during) {
              actionRoutes.push({ do: act.do, route: "store-fallback" });
              if (act.do === "set-field") applyStoreField(S, study(), studyId, act.path, act.value);
              else if (act.do === "confirm-empty-search") S().confirmEmptySearch(studyId);
              else if (act.do === "accept-decision") S().acceptDecision(studyId, act.which ?? "latest");
              else if (act.do === "withdraw-decision") S().withdrawDecision(studyId, act.which ?? "latest");
              else if (act.do === "mark-complete") S().markComplete(studyId, act.stage);
              else if (act.do === "change-source") {
                const beforeItem = study().scan.items.find((it) => it.title === act.record);
                S().changeSource(studyId, { title: act.record, id: beforeItem?.id }, act.field, act.value, act.note || (act.field === "status" ? "manual identity check" : undefined));
              }
              const mid = study();
              evalExpect({
                study: mid,
                persistedStudy: mid,
                step: act,
                n,
                action: act,
                checkpoints,
                lastIssues,
                lastError: "",
                screenText: mid ? JSON.stringify(mid) : "",
                errorText: "",
                exportJson: null,
                requires: scenario.requires || [],
              });
            }
          }
          const result = S().illuminateApply(studyId, step.stage, payload, rev);
          lastIssues = result.issues ?? [];
          lastError = result.ok ? "" : (result.reason || result.summary || "");
        }
      } else if (step.do === "accept-decision") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
        S().acceptDecision(studyId, step.which ?? "latest");
      } else if (step.do === "withdraw-decision") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
        S().withdrawDecision(studyId, step.which ?? "latest");
      } else if (step.do === "mark-complete") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
        S().markComplete(studyId, step.stage);
      } else if (step.do === "set-field") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
        applyStoreField(S, study(), studyId, step.path, step.value);
      } else if (step.do === "change-source") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
        const s = study();
        const beforeItem = s.scan.items.find((it) => it.title === step.record);
        const r = S().changeSource(studyId, { title: step.record, id: beforeItem?.id }, step.field, step.value, step.note || (step.field === "status" ? "manual identity check" : undefined));
        const afterItem = study().scan.items.find((it) => it.title === step.record);
        const changed = r.ok === true;
        checkpoints.push(checkpoint({ step: n, action: step, check: "change-source.content", expected: true, observed: changed, ok: changed, reason: changed ? "" : (r.reason || "source content did not change; staleness not supported") }));
        void afterItem;
      } else if (step.do === "reload") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
        const raw = globalThis.localStorage?.getItem(PERSIST_KEY);
        if (!raw) {
          checkpoints.push(checkpoint({ step: n, action: step, check: "reload.storage", expected: "persisted bytes", observed: 0, ok: false, reason: "storage empty after writes; reload cannot roundtrip" }));
          store.useStudio.setState({ studies: [] });
        } else {
          const persisted = parsePersistedStudio(raw).map((x) => lib.defaults.migrateStudy(x));
          store.useStudio.setState({ studies: persisted, hydrated: true });
        }
      } else if (step.do === "reopen") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
        const raw = globalThis.localStorage?.getItem(PERSIST_KEY);
        if (!raw) {
          checkpoints.push(checkpoint({ step: n, action: step, check: "reopen.storage", expected: "persisted bytes", observed: 0, ok: false, reason: "storage empty; reopen cannot roundtrip" }));
        } else {
          const persisted = parsePersistedStudio(raw).map((x) => lib.defaults.migrateStudy(x));
          store.useStudio.setState({ studies: persisted, hydrated: true });
          const found = persisted.find((x) => x.id === studyId);
          if (!found) checkpoints.push(checkpoint({ step: n, action: step, check: "reopen.study", expected: studyId, observed: null, ok: false, reason: "study missing after storage reopen" }));
        }
      } else if (step.do === "export") {
        actionRoutes.push({ do: step.do, route: "store-fallback" });
        const json = exp.studyToJson(study());
        exportJson = json;
        artifacts.push("export.json");
      } else if (step.do === "wait") {
        await new Promise((r) => setTimeout(r, Math.min(step.ms || 0, 5000)));
      } else {
        checkpoints.push(checkpoint({ step: n, action: step, check: "do", expected: "known", observed: step.do, ok: false, reason: "unknown do" }));
      }
    } catch (err) {
      checkpoints.push(checkpoint({ step: n, action: step, check: "run", expected: "ok", observed: String(err), ok: false, reason: err instanceof Error ? err.message : String(err) }));
    }

    const s = study();
    const illum = s?.lastIlluminate;
    const persisted = readPersistedById(studyId).study;
    evalExpect({
      study: s,
      persistedStudy: persisted,
      step,
      n,
      action: step,
      checkpoints,
      lastIssues: lastIssues.length ? lastIssues : (illum?.issues ?? []),
      lastError: lastError || illum?.error || "",
      screenText: [lastError, illum?.error, illum?.summary, s ? JSON.stringify(s) : ""].filter(Boolean).join("\n"),
      errorText: [lastError, illum?.error, illum?.summary].filter(Boolean).join("\n"),
      exportJson,
      requires: scenario.requires || [],
    });
  }

  const persistedFinal = readPersistedById(studyId).study;
  return {
    checkpoints,
    artifacts,
    study: persistedFinal ?? study(),
    actionRoutes,
    exportJson,
    consoleErrors: [],
    pageErrors: [],
    files: {},
  };
}

async function readPersistedStudies(page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), PERSIST_KEY);
  return parsePersistedStudio(raw);
}

async function readPersistedStudy(page, studyId, replayKey) {
  const studies = await readPersistedStudies(page);
  if (studyId) {
    const hit = studies.find((s) => s.id === studyId);
    if (hit) return hit;
  }
  if (replayKey) {
    const hit = studies.find((s) => s.replayKey === replayKey);
    if (hit) return hit;
  }
  return studies.at(-1) ?? null;
}

function unsupported(checkpoints, step, n, reason, actionRoutes) {
  actionRoutes.push({ do: step.do, route: "unsupported" });
  checkpoints.push(checkpoint({ step: n, action: step, check: "action", expected: "executed", observed: "unsupported", ok: true, reason }));
}

async function waitIlluminateIdle(page) {
  const btn = page.locator("[data-meridian-illuminate]");
  if (await btn.count()) {
    await page.waitForFunction(() => {
      const el = document.querySelector("[data-meridian-illuminate]");
      return el && !el.hasAttribute("disabled") && !/Working/i.test(el.textContent || "");
    }, null, { timeout: 30000 }).catch(() => undefined);
  }
}

async function waitPersistedLastIlluminate(page, stage) {
  await page.waitForFunction(({ key, stage: st }) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      const studies = parsed?.state?.studies ?? parsed?.studies ?? [];
      return studies.some((s) => s?.lastIlluminate?.stage === st);
    } catch {
      return false;
    }
  }, { key: PERSIST_KEY, stage }, { timeout: 8000 }).catch(() => undefined);
}

async function waitRetrieveIdle(page) {
  const btn = page.locator("[data-meridian-retrieve]");
  if (await btn.count()) {
    await page.waitForFunction(() => {
      const el = document.querySelector("[data-meridian-retrieve]");
      return el && !el.hasAttribute("disabled") && !/Retrieving/i.test(el.textContent || "");
    }, null, { timeout: 15000 }).catch(() => undefined);
  }
}

function fieldValueForFill(value) {
  if (Array.isArray(value)) return value.map((x) => String(x ?? "")).join("\n");
  if (value == null) return "";
  return String(value);
}

export { fieldValueForFill };

const STORE_STAGES = new Set(["problem", "scan", "map", "gaps", "hypotheses", "questions", "design", "protocol", "stats", "ethics", "voices", "manuscript", "audit"]);

function setPathValue(root, pathName, value) {
  const parts = String(pathName).split(".");
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    const m = /^([^[]+)\[(\d+)\]$/.exec(seg);
    if (m) {
      const key = m[1];
      const idx = Number(m[2]);
      const arr = Array.isArray(cur[key]) ? cur[key].slice() : [];
      arr[idx] = { ...(arr[idx] ?? {}) };
      cur[key] = arr;
      cur = arr[idx];
    } else {
      cur[seg] = Array.isArray(cur[seg]) ? cur[seg].slice() : { ...(cur[seg] ?? {}) };
      cur = cur[seg];
    }
  }
  const last = parts[parts.length - 1];
  const lm = /^([^[]+)\[(\d+)\]$/.exec(last);
  if (lm) {
    const key = lm[1];
    const idx = Number(lm[2]);
    const arr = Array.isArray(cur[key]) ? cur[key].slice() : [];
    arr[idx] = value;
    cur[key] = arr;
  } else {
    cur[last] = value;
  }
}

function applyStoreField(S, study, studyId, pathName, value) {
  const parts = String(pathName).split(".");
  const stage = parts[0];
  if (STORE_STAGES.has(stage) && parts.length > 1) {
    const clone = structuredClone(study[stage]);
    setPathValue(clone, parts.slice(1).join("."), value);
    S().mergeStage(studyId, stage, clone);
    return;
  }
  if (pathName === "family") S().setFamily(studyId, value ?? null);
  else S().update(studyId, { [pathName]: value });
}

async function clickFirstVisible(locator) {
  const n = await locator.count();
  for (let i = 0; i < n; i++) {
    const el = locator.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      return true;
    }
  }
  return false;
}

async function installModelHold(page) {
  let releaseHold;
  const gate = new Promise((resolve) => {
    releaseHold = resolve;
  });
  let markHit;
  const hit = new Promise((resolve) => {
    markHit = resolve;
  });
  let markContinued;
  const continued = new Promise((resolve) => {
    markContinued = resolve;
  });
  let held = false;
  const handler = async (route) => {
    const req = route.request();
    const post = req.method() === "POST" ? req.postData() || "" : "";
    const model = post.includes("replayKey") || post.includes('"compact"') || post.includes("scanPurpose");
    const finish = async () => {
      try {
        await route.continue();
      } catch (err) {
        if (!/already handled/i.test(String(err))) throw err;
      }
    };
    if (!held && model) {
      held = true;
      markHit();
      await gate;
      await finish();
      markContinued();
      return;
    }
    await finish();
  };
  await page.route("**/*", handler);
  return {
    waitHit: () =>
      Promise.race([
        hit,
        new Promise((_, reject) => setTimeout(() => reject(new Error("model request was not dispatched")), 20000)),
      ]),
    release: async () => {
      releaseHold();
      await continued;
      await page.unroute("**/*", handler).catch(() => undefined);
    },
  };
}

async function waitHydratedStage(page, stage) {
  await page.locator('[data-meridian-hydrated="true"]').waitFor({ timeout: 15000 });
  if (stage) await page.locator(`[data-meridian-stage-panel="${stage}"]`).waitFor({ timeout: 15000 });
}

async function retryNavigation(page, fn, checkpoints, n, step) {
  const attempts = [];
  try {
    await fn();
    attempts.push({ n: 1, ok: true });
  } catch (err) {
    attempts.push({ n: 1, ok: false, error: err instanceof Error ? err.message : String(err) });
    await fn();
    attempts.push({ n: 2, ok: true });
  }
  checkpoints.push(checkpoint({ step: n, action: step, check: "navigation.attempts", expected: "recorded", observed: attempts, ok: attempts.at(-1)?.ok === true, reason: attempts.map((a) => (a.ok ? `attempt ${a.n} ok` : `attempt ${a.n} ${a.error}`)).join("; ") }));
}

async function gotoStage(page, stage) {
  const label = STAGE_LABEL[stage] || stage;
  if (await clickFirstVisible(page.locator(`[data-meridian-stage="${stage}"]`))) return;
  if (await clickFirstVisible(page.getByRole("button", { name: label, exact: true }))) return;
  if (await clickFirstVisible(page.getByRole("button", { name: new RegExp(label, "i") }))) return;
  throw new Error(`stage control not found: ${stage}`);
}

async function readScreenText(page) {
  return page.evaluate(() => {
    const body = document.body ? document.body.innerText || "" : "";
    const fields = [...document.querySelectorAll("input, textarea, select")]
      .map((el) => ("value" in el ? String(el.value || "") : ""))
      .filter(Boolean)
      .join("\n");
    const extras = [...document.querySelectorAll("[data-meridian-visible]")]
      .map((el) => el.textContent || "")
      .join("\n");
    return [body, fields, extras].filter(Boolean).join("\n");
  }).catch(() => "");
}

async function readErrorRegion(page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll("[data-meridian-error], [data-meridian-partial-apply], [role='alert']");
    return [...nodes].map((el) => el.textContent || "").join("\n");
  }).catch(() => "");
}

function fieldStage(path) {
  const head = String(path).split(".")[0];
  return STAGE_LABEL[head] ? head : null;
}

async function screenshotStep(page, files, artifacts, n, name) {
  const file = `step-${String(n).padStart(2, "0")}-${name}.png`;
  const buf = await page.screenshot({ fullPage: false });
  files[file] = buf;
  artifacts.push(file);
}

export function chromiumExecutable() {
  const p = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH;
  return p && String(p).trim() ? String(p).trim() : "";
}

export function chromiumLaunchOptions() {
  const executablePath = chromiumExecutable();
  const args = ["--no-sandbox", "--disable-dev-shm-usage"];
  return executablePath ? { headless: true, executablePath, args } : { headless: true, args };
}

export async function ensureScenarioServer(preferred) {
  if (preferred) return { url: preferred.replace(/\/$/, ""), child: null };
  const port = 8091;
  const url = `http://127.0.0.1:${port}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (r.ok || r.status === 404) {
      const probe = await fetch(`${url}/__scenario/reset?key=probe`, { method: "POST" });
      if (probe.status !== 404) return { url, child: null };
    }
  } catch {
    /* start our own */
  }
  const env = {
    ...process.env,
    VITE_SCENARIO_MODE: "true",
    MERIDIAN_MODEL_MODE: "replay",
    MERIDIAN_RETRIEVAL_MODE: "replay",
    MERIDIAN_REPLAY_DIR: path.join(ROOT, "scenarios/replay"),
  };
  const child = spawn("node", ["scripts/with-app-env.mjs", "vite", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ready = false;
  const onData = (buf) => {
    const s = buf.toString();
    if (/ready in/i.test(s) || /Local:/i.test(s)) ready = true;
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const start = Date.now();
  while (!ready && Date.now() - start < 25000) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (r.status) {
        ready = true;
        break;
      }
    } catch {
      /* wait */
    }
  }
  if (!ready) {
    child.kill();
    throw new Error("could not start scenario server on 8091");
  }
  return { url, child };
}

export function attachDownloadWait(page, timeoutMs = 10000) {
  const downloads = [];
  const onDl = (d) => downloads.push(d);
  page.on("download", onDl);
  const wait = page.waitForEvent("download", { timeout: timeoutMs }).then(
    (d) => ({ download: d, error: null }),
    (err) => ({ download: null, error: err instanceof Error ? err : new Error(String(err)) }),
  );
  return {
    wait,
    downloads,
    detach() {
      page.off("download", onDl);
    },
  };
}

async function runUi(scenario, lib, url) {
  void lib;
  const { chromium } = await import("playwright");
  const launchOpts = chromiumLaunchOptions();
  const browser = await chromium.launch(launchOpts);
  const browserMeta = {
    product: "chromium",
    executablePath: launchOpts.executablePath || "playwright-bundled",
    version: browser.version(),
  };
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const checkpoints = [];
  const artifacts = [];
  const actionRoutes = [];
  const consoleErrors = [];
  const pageErrors = [];
  const files = {};
  let studyId = null;
  let exportJson = null;
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(err instanceof Error ? err.message : String(err));
  });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate((key) => {
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k === key || k.startsWith(`${key}.`))) drop.push(k);
      }
      for (const k of drop) localStorage.removeItem(k);
    }, PERSIST_KEY);
    await page.reload({ waitUntil: "networkidle" });
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const n = i + 1;
      const consequential = ["create", "illuminate", "retrieve", "confirm-empty-search", "accept-decision", "withdraw-decision", "change-source", "reload", "reopen", "export", "set-field", "mark-complete"].includes(step.do);
      try {
        if (step.do === "create") {
          actionRoutes.push({ do: step.do, route: "ui" });
          const needBox = page.getByPlaceholder(/Adults with refractory neuropathic pain/i).or(page.locator("textarea").first());
          await needBox.fill(scenario.inputs.need);
          if (scenario.inputs.constraints) {
            const boxes = page.locator("textarea");
            if ((await boxes.count()) > 1) await boxes.nth(1).fill(scenario.inputs.constraints);
          }
          // Local facts the scenario's investigator can document (approvals, resources) are entered on
          // screen, one per line, so gates can rest on them; before this field existed they were never
          // given to the application.
          const facts = Array.isArray(scenario.inputs.localFacts) ? scenario.inputs.localFacts.filter((f) => typeof f === "string" && f.trim()) : [];
          if (facts.length) {
            const factBox = page.locator("[data-meridian-local-facts-input]");
            if ((await factBox.count()) === 0) throw new Error("local-facts field not on screen");
            await factBox.fill(facts.join("\n"));
          }
          const key = page.getByPlaceholder("sc-000-level1");
          if ((await key.count()) === 0) throw new Error("scenario-key field not on screen");
          await key.fill(scenario.id);
          await page.getByRole("button", { name: /Begin a study/i }).click();
          await page.waitForURL(/\/studio\//, { timeout: 15000 });
          await page.locator("[data-meridian-illuminate]").waitFor({ timeout: 15000 });
          await page.locator("[data-meridian-raw-need]").waitFor({ timeout: 8000 }).catch(() => undefined);
          await page.waitForFunction((k) => !!localStorage.getItem(k), PERSIST_KEY, { timeout: 8000 }).catch(() => undefined);
          const s = await readPersistedStudy(page, null, scenario.id);
          studyId = s?.id ?? null;
        } else if (step.do === "illuminate") {
          actionRoutes.push({ do: step.do, route: "ui" });
          await gotoStage(page, step.stage);
          const hold = step.late ? await installModelHold(page) : null;
          const btn = page.getByRole("button", { name: /Illuminate/i }).or(page.locator("[data-meridian-illuminate]")).first();
          if ((await btn.count()) === 0) throw new Error("Illuminate control not on screen");
          await btn.click();
          if (hold) {
            await hold.waitHit();
            for (const act of step.during || []) {
              actionRoutes.push({ do: act.do, route: "ui" });
              if (act.do === "set-field") {
                const st = fieldStage(String(act.path || ""));
                if (st) await gotoStage(page, st).catch(() => undefined);
                const loc = page.locator(`[data-meridian-field="${act.path}"]`);
                if ((await loc.count()) === 0) throw new Error(`no screen control for ${act.path}`);
                await loc.first().fill(fieldValueForFill(act.value));
                await loc.first().blur().catch(() => undefined);
                await page.waitForTimeout(150);
              }
              const mid = await readPersistedStudy(page, studyId, scenario.id);
              const midBody = await readScreenText(page);
              const midErr = await readErrorRegion(page);
              evalExpect({
                study: mid,
                persistedStudy: mid,
                step: act,
                n,
                action: act,
                checkpoints,
                lastIssues: mid?.lastIlluminate?.issues ?? [],
                lastError: "",
                screenText: midBody,
                errorText: midErr,
                exportJson,
                requires: scenario.requires || [],
              });
            }
            await gotoStage(page, step.stage);
            await hold.release();
          }
          await waitIlluminateIdle(page);
          await waitPersistedLastIlluminate(page, step.stage);
          if (step.stage === "design") {
            await page.locator("[data-meridian-decision]").first().waitFor({ timeout: 5000 }).catch(() => undefined);
          }
        } else if (step.do === "retrieve") {
          await gotoStage(page, "scan");
          const q = page.getByLabel(/Search query/i);
          if ((await q.count()) && step.query) {
            await q.fill(step.query);
            await page.waitForTimeout(150);
          }
          const btn = page.locator("[data-meridian-retrieve]");
          if ((await btn.count()) === 0) {
            unsupported(checkpoints, step, n, "Run recorded search control not on screen", actionRoutes);
          } else {
            actionRoutes.push({ do: step.do, route: "ui" });
            if (step.provider) {
              const sel = page.locator("[data-meridian-retrieve-provider]");
              if ((await sel.count()) > 0) await sel.first().selectOption(String(step.provider));
            }
            await btn.click();
            await waitRetrieveIdle(page);
            await page.waitForFunction((k) => !!localStorage.getItem(k), PERSIST_KEY, { timeout: 8000 }).catch(() => undefined);
          }
        } else if (step.do === "confirm-empty-search") {
          await gotoStage(page, "scan");
          const btn = page.getByRole("button", { name: /I confirm the search was run/i });
          if ((await btn.count()) === 0) {
            unsupported(checkpoints, step, n, "empty-search confirmation control not on screen", actionRoutes);
          } else {
            actionRoutes.push({ do: step.do, route: "ui" });
            await btn.click();
          }
        } else if (step.do === "accept-decision") {
          await gotoStage(page, "design");
          await page.locator("[data-meridian-decision]").first().waitFor({ timeout: 5000 }).catch(() => undefined);
          const cards = page.locator("[data-meridian-decision]");
          const count = await cards.count();
          if (count === 0) {
            unsupported(checkpoints, step, n, "Accept control not on screen: no decision cards (data-meridian-accept)", actionRoutes);
          } else {
            const which = step.which ?? "latest";
            const idx = which === "latest" ? count - 1 : Number(which);
            const card = cards.nth(Number.isFinite(idx) ? idx : count - 1);
            const btn = card.locator("[data-meridian-accept]");
            if ((await btn.count()) === 0) {
              unsupported(checkpoints, step, n, `Accept control not on screen for decision index ${idx}: card has no data-meridian-accept`, actionRoutes);
            } else {
              actionRoutes.push({ do: step.do, route: "ui" });
              const disabled = await btn.isDisabled().catch(() => false);
              if (!disabled) await btn.click();
              await page.waitForTimeout(150);
              await page.waitForFunction((k) => !!localStorage.getItem(k), PERSIST_KEY, { timeout: 4000 }).catch(() => undefined);
            }
          }
        } else if (step.do === "withdraw-decision") {
          await gotoStage(page, "design");
          await page.locator("[data-meridian-decision]").first().waitFor({ timeout: 5000 }).catch(() => undefined);
          const cards = page.locator("[data-meridian-decision]");
          const count = await cards.count();
          if (count === 0) {
            unsupported(checkpoints, step, n, "Withdraw control not on screen: no decision cards (data-meridian-withdraw)", actionRoutes);
          } else {
            const which = step.which ?? "latest";
            const idx = which === "latest" ? count - 1 : Number(which);
            const card = cards.nth(Number.isFinite(idx) ? idx : count - 1);
            const btn = card.locator("[data-meridian-withdraw]");
            if ((await btn.count()) === 0) {
              unsupported(checkpoints, step, n, `Withdraw control not on screen for decision index ${idx}: card has no data-meridian-withdraw`, actionRoutes);
            } else {
              actionRoutes.push({ do: step.do, route: "ui" });
              await btn.click();
              await page.waitForTimeout(150);
              await page.waitForFunction((k) => !!localStorage.getItem(k), PERSIST_KEY, { timeout: 4000 }).catch(() => undefined);
            }
          }
        } else if (step.do === "export") {
          actionRoutes.push({ do: step.do, route: "ui" });
          const pending = attachDownloadWait(page, 10000);
          let download = null;
          try {
            await page.getByRole("button", { name: /Export JSON/i }).click();
            const got = await pending.wait;
            if (got.download) download = got.download;
            else {
              checkpoints.push(checkpoint({ step: n, action: step, check: "export.download", expected: "file", observed: String(got.error ?? "timeout"), ok: false, reason: "no download event" }));
            }
          } catch (err) {
            await pending.wait.catch(() => undefined);
            checkpoints.push(checkpoint({ step: n, action: step, check: "run", expected: "ok", observed: String(err), ok: false, reason: err instanceof Error ? err.message : String(err) }));
          } finally {
            pending.detach();
          }
          const downloads = pending.downloads;
          const count = downloads.length + (download && !downloads.includes(download) ? 1 : 0);
          const unique = new Set(downloads).size || (download ? 1 : 0);
          checkpoints.push(checkpoint({ step: n, action: step, check: "export.downloadCount", expected: 1, observed: unique || count, ok: (unique || count) === 1, reason: (unique || count) === 1 ? "" : `D22 expected 1 download, observed ${unique || count}` }));
          if (download) {
            const tmp = await download.path();
            if (tmp) exportJson = fs.readFileSync(tmp, "utf8");
          }
        } else if (step.do === "reload") {
          actionRoutes.push({ do: step.do, route: "ui" });
          await retryNavigation(page, async () => {
            await page.reload({ waitUntil: "networkidle" });
            const after = await readPersistedStudy(page, studyId, scenario.id);
            await waitHydratedStage(page, after?.currentStage);
          }, checkpoints, n, step);
        } else if (step.do === "reopen") {
          actionRoutes.push({ do: step.do, route: "ui" });
          const s = await readPersistedStudy(page, studyId, scenario.id);
          const title = s?.title || scenario.inputs.need.slice(0, 40);
          await retryNavigation(page, async () => {
            await page.getByRole("link", { name: /All studies/i }).click();
            await page.waitForURL(/\/$/, { timeout: 10000 }).catch(() => page.goto(url));
            await page.getByRole("heading", { name: title }).first().click();
            await page.waitForURL(/\/studio\//, { timeout: 15000 });
            const after = await readPersistedStudy(page, studyId, scenario.id);
            await waitHydratedStage(page, after?.currentStage || s?.currentStage);
          }, checkpoints, n, step);
        } else if (step.do === "set-field") {
          const pathName = String(step.path || "");
          if (pathName === "currentStage") {
            actionRoutes.push({ do: step.do, route: "ui" });
            await gotoStage(page, step.value);
          } else {
            const st = fieldStage(pathName);
            if (st) await gotoStage(page, st).catch(() => undefined);
            if (pathName === "family") {
              const loc = page.locator('[data-meridian-field="family"]');
              if ((await loc.count()) === 0) {
                unsupported(checkpoints, step, n, `no screen control for ${pathName}`, actionRoutes);
              } else {
                actionRoutes.push({ do: step.do, route: "ui" });
                await loc.first().selectOption(String(step.value ?? "")).catch(async () => {
                  await loc.first().fill(String(step.value ?? ""));
                });
              }
            } else if (pathName === "hypotheses.selectedId") {
              const card = page.locator(`[data-meridian-hypothesis="${step.value}"]`);
              const btn = card.getByRole("button", { name: /Prefer this/i });
              if ((await btn.count()) === 0) {
                unsupported(checkpoints, step, n, `no screen control for ${pathName}`, actionRoutes);
              } else {
                actionRoutes.push({ do: step.do, route: "ui" });
                await btn.first().click();
              }
            } else {
              const loc = page.locator(`[data-meridian-field="${pathName}"]`);
              const label = pathName.split(".").pop();
              const byLabel = page.getByLabel(new RegExp(String(label).replace(/\[|\]/g, "\\$&"), "i"));
              const field = (await loc.count()) ? loc.first() : byLabel;
              if ((await field.count()) === 0) {
                unsupported(checkpoints, step, n, `no screen control for ${pathName}`, actionRoutes);
              } else {
                actionRoutes.push({ do: step.do, route: "ui" });
                await field.fill(fieldValueForFill(step.value));
                await field.blur().catch(() => undefined);
                await page.waitForTimeout(150);
              }
            }
          }
        } else if (step.do === "change-source") {
          await gotoStage(page, "scan");
          const field = step.field || "keyFindings";
          const rec = page.locator("article[data-meridian-record]").filter({ hasText: String(step.record || "") });
          const loc = (await rec.count())
            ? rec.locator(`[data-meridian-change-source="${field}"]`).first()
            : page.locator(`[data-meridian-change-source="${field}"]`).first();
          if ((await loc.count()) === 0) {
            unsupported(checkpoints, step, n, "no screen control for change-source", actionRoutes);
            checkpoints.push(checkpoint({ step: n, action: step, check: "change-source.content", expected: true, observed: false, ok: false, reason: "source content did not change; UI change-source is unsupported" }));
          } else {
            actionRoutes.push({ do: step.do, route: "ui" });
            const beforeStudy = await readPersistedStudy(page, studyId, scenario.id);
            const beforeItem = beforeStudy?.scan?.items?.find((it) => it.title === step.record);
            if (field === "status") {
              const note = step.note || "manual identity check";
              const noteBox = (await rec.count()) ? rec.locator("[data-meridian-check-note]").first() : page.locator("[data-meridian-check-note]").first();
              if ((await noteBox.count())) await noteBox.fill(note);
              await loc.selectOption(String(step.value));
              const recordBtn = (await rec.count()) ? rec.locator("[data-meridian-record-check]").first() : page.locator("[data-meridian-record-check]").first();
              if ((await recordBtn.count())) await recordBtn.click();
            } else if (field === "year") {
              await loc.fill(String(step.value));
              await loc.blur();
            } else {
              await loc.fill(String(step.value ?? ""));
              await loc.blur();
            }
            await page.waitForTimeout(200);
            await page.locator("[data-meridian-decision-stale]").waitFor({ timeout: 4000 }).catch(() => undefined);
            const afterStudy = await readPersistedStudy(page, studyId, scenario.id);
            const afterItem = afterStudy?.scan?.items?.find((it) => it.id === beforeItem?.id || it.title === step.record);
            let changed = false;
            if (field === "status") {
              const checks = afterItem?.provenance?.checks ?? [];
              changed = checks.some((c) => c.provider === "manual" && c.result === String(step.value)) && afterItem?.provenance?.status !== "verified";
            } else if (field === "keyFindings" || field === "limitations") {
              changed = afterItem?.[field] === String(step.value ?? "");
            } else if (field === "year") {
              changed = Number(afterItem?.year) === Number(step.value);
            } else if (field === "abstract") {
              changed = (afterItem?.abstract?.text ?? "") === String(step.value ?? "") && (afterItem?.abstract?.sha256 ?? "") !== (beforeItem?.abstract?.sha256 ?? "");
            }
            checkpoints.push(checkpoint({ step: n, action: step, check: "change-source.content", expected: true, observed: changed, ok: changed, reason: changed ? "" : "source content did not change; staleness not supported" }));
          }
        } else if (step.do === "mark-complete") {
          if (step.stage) await gotoStage(page, step.stage).catch(() => undefined);
          const btn = page.locator("[data-meridian-mark-complete]");
          if ((await btn.count()) === 0) {
            unsupported(checkpoints, step, n, "no dedicated mark-complete control on screen", actionRoutes);
          } else {
            actionRoutes.push({ do: step.do, route: "ui" });
            await btn.first().click();
            await page.waitForTimeout(100);
          }
        } else if (step.do === "wait") {
          actionRoutes.push({ do: step.do, route: "ui" });
          await page.waitForTimeout(Math.min(step.ms || 0, 5000));
        } else {
          unsupported(checkpoints, step, n, `unknown do ${step.do}`, actionRoutes);
        }
      } catch (err) {
        actionRoutes.push({ do: step.do, route: "ui" });
        checkpoints.push(checkpoint({ step: n, action: step, check: "run", expected: "ok", observed: String(err), ok: false, reason: err instanceof Error ? err.message : String(err) }));
      }

      if (consequential) await screenshotStep(page, files, artifacts, n, step.do).catch(() => undefined);

      const s = await readPersistedStudy(page, studyId, scenario.id);
      if (s?.id) studyId = s.id;
      const illum = s?.lastIlluminate;
      const body = await readScreenText(page);
      const errorText = await readErrorRegion(page);
      evalExpect({
        study: s,
        persistedStudy: s,
        step,
        n,
        action: step,
        checkpoints,
        lastIssues: illum?.issues ?? [],
        lastError: illum?.error || (illum && !illum.ok ? illum.summary : "") || "",
        screenText: body,
        errorText,
        exportJson,
        requires: scenario.requires || [],
      });
    }
  } catch (err) {
    checkpoints.push(checkpoint({ step: 0, action: { do: "ui" }, check: "run", expected: "ok", observed: String(err), ok: false, reason: err instanceof Error ? err.message : String(err) }));
  }
  let study = null;
  try {
    study = await readPersistedStudy(page, studyId, scenario.id);
  } catch {
    study = null;
  }
  try {
    await browser.close();
  } catch {
    /* already closed */
  }
  return { checkpoints, artifacts, study, studyId, actionRoutes, exportJson, consoleErrors, pageErrors, files, browser: browserMeta };
}

async function main() {
  const files = listScenarios(bankDir).filter((f) => {
    if (!ids) return true;
    const id = JSON.parse(fs.readFileSync(f, "utf8")).id;
    return ids.includes(id);
  });
  if (!files.length) usage("no scenarios matched");
  const pinnedTreeSha256 = digestSourceTree(ROOT);
  const lib = mode === "store" ? await loadLib() : { runtime: { resetReplayCounters() {} } };
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = path.join(outDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const summaryPath = path.join(runDir, "summary.jsonl");
  const statuses = [];
  let qualifyingFullWorkflows = 0;
  let counts = { authored: files.length, executedAttempts: 0, qualifyingFullWorkflows: 0 };

  let server = { url: baseUrl || "http://127.0.0.1:8080", child: null };
  if (mode === "ui") {
    try {
      server = await ensureScenarioServer(baseUrl);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  }

  try {
    for (const file of files) {
      const scenario = JSON.parse(fs.readFileSync(file, "utf8"));
      const startedAt = new Date().toISOString();
      const resultDir = path.join(runDir, scenario.id);
      fs.mkdirSync(resultDir, { recursive: true });
      let run;
      try {
        if (mode === "ui") {
          await fetch(`${server.url}/__scenario/reset?key=${encodeURIComponent(scenario.id)}`, { method: "POST" }).catch(() => undefined);
          run = await runUi(scenario, lib, server.url);
        } else {
          if (lib.runtime?.resetReplayCounters) lib.runtime.resetReplayCounters(scenario.id);
          run = await runStore(scenario, lib);
        }
      } catch (err) {
        run = { checkpoints: [checkpoint({ step: 0, action: { do: "run" }, check: "start", expected: "ok", observed: String(err), ok: false, reason: err instanceof Error ? err.message : String(err) })], artifacts: [], study: null, actionRoutes: [], consoleErrors: [], pageErrors: [], files: {}, exportJson: null };
      }

      const pending = [];
      if (run.exportJson) {
        fs.writeFileSync(path.join(resultDir, "export.json"), run.exportJson.endsWith("\n") ? run.exportJson : `${run.exportJson}\n`);
        pending.push("export.json");
      }
      if (run.study) {
        fs.writeFileSync(path.join(resultDir, "store-final.json"), `${JSON.stringify(run.study, null, 2)}\n`);
        pending.push("store-final.json");
      }
      for (const [name, buf] of Object.entries(run.files || {})) {
        fs.writeFileSync(path.join(resultDir, name), buf);
        pending.push(name);
      }
      for (const name of run.artifacts ?? []) {
        if (!pending.includes(name) && fs.existsSync(path.join(resultDir, name))) pending.push(name);
      }
      const { artifacts, artifactSha256 } = collectArtifactHashes(resultDir, pending);

      const status = statusOfCheckpoints(run.checkpoints);
      statuses.push(status);
      const routes = run.actionRoutes ?? [];
      const usedStoreFallback = routes.some((r) => r.route === "store-fallback");
      const usedUnsupported = routes.some((r) => r.route === "unsupported");
      const capabilityAbsent = run.checkpoints.some((c) => /capability absent/i.test(c.reason || ""));
      const executedWorkflow =
        status === "PASS" &&
        mode === "ui" &&
        routes.length > 0 &&
        !usedStoreFallback &&
        !usedUnsupported &&
        !capabilityAbsent;
      if (executedWorkflow) qualifyingFullWorkflows += 1;
      const failed = run.checkpoints.filter((c) => !c.ok);
      const result = {
        scenarioId: scenario.id,
        runId,
        mode,
        startedAt,
        finishedAt: new Date().toISOString(),
        treeSha256: pinnedTreeSha256,
        appVersion: "a33",
        status,
        executedWorkflow,
        authored: files.length,
        executedAttempts: 1,
        qualifyingFullWorkflows: executedWorkflow ? 1 : 0,
        actionRoutes: routes,
        checkpoints: run.checkpoints,
        consoleErrors: run.consoleErrors ?? [],
        pageErrors: run.pageErrors ?? [],
        browser: run.browser ?? { product: mode === "ui" ? "chromium" : "none", executablePath: mode === "ui" ? (chromiumExecutable() || "playwright-bundled") : "", version: "" },
        artifacts,
        artifactSha256,
      };
      fs.writeFileSync(path.join(resultDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
      const line = JSON.stringify({ scenarioId: scenario.id, status, failed: failed.length, checkpoints: run.checkpoints.length, executedWorkflow, mode });
      fs.appendFileSync(summaryPath, `${line}\n`);
      console.log(`${scenario.id} ${mode} ${status} ${run.checkpoints.length} checks ${failed.length} fail`);
    }
  } finally {
    if (server.child) server.child.kill();
    counts = { authored: files.length, executedAttempts: statuses.length, qualifyingFullWorkflows };
    fs.writeFileSync(path.join(runDir, "COUNTS.json"), `${JSON.stringify(counts, 2)}\n`.replace(" 2}", " 2}"));
    fs.writeFileSync(path.join(runDir, "COUNTS.json"), `${JSON.stringify(counts, null, 2)}\n`);
    console.log(`wrote ${runDir}`);
    console.log(`counts authored=${counts.authored} executedAttempts=${counts.executedAttempts} qualifyingFullWorkflows=${counts.qualifyingFullWorkflows}`);
  }
  process.exitCode = exitCodeForStatuses(statuses);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  process.on("unhandledRejection", (err) => {
    console.error("unhandledRejection", err);
  });
  parseArgv(process.argv.slice(2));
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
