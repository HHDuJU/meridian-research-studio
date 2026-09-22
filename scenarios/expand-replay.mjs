#!/usr/bin/env node
// expand-replay.mjs: writes the replay files that scenario files imply (SCENARIO_FORMAT.md version 1.1, "Files";
// amendment sheet A3, R1).
//
// Usage: node expand-replay.mjs <bankDir | scenario.json> [more ...] [--out <replayRoot>]
//   <bankDir>   every *.json in the folder except INDEX.json is read as a scenario (subfolders are not read)
//   --out       replay root; default: a folder named "replay" next to the first input's folder
//
// Model responses: for each illuminate step, <out>/<id>/<stage>.<n>.json holds exactly the text the model
// returns in replay mode: JSON.stringify(response, null, 2) for a response object, or the raw responseText
// string, with nothing added. n counts illuminate steps per stage in scenario order, 1-based, which is the order
// in which the replay server numbers calls; a step whose "call" disagrees with that count is an error.
//
// Provider responses: for each retrieve step, <out>/<id>/retrieval/<provider>.<n>.json holds
// JSON.stringify({ status, body, note }, null, 2), where body is the text the provider adapter parses:
// JSON.stringify({ total, records }) for the fixture provider (an empty string for a failed call that carries no
// records), or the raw body string for a real-provider format; note is the response's note or "". n counts
// retrieve steps per provider in scenario order, 1-based.
//
// Files named <stage>.<n>.json or retrieval/<provider>.<n>.json left by an earlier expansion of the same id and
// not written now are removed, so a replay can never serve a stale response. Prints the files written per
// scenario and the totals. Exit 1 when any scenario has an error (its files are then not written), 2 on a usage
// error. No dependencies; Node 18 or later.

import fs from "node:fs";
import path from "node:path";

const STAGES = [
  "problem", "scan", "map", "gaps", "hypotheses", "questions", "design", "protocol", "stats", "ethics", "voices",
  "manuscript", "audit",
];
const PROVIDERS = ["fixture", "openalex", "crossref", "pubmed", "consensus"];
const REPLAY_KEY = /^[A-Za-z0-9._-]{1,64}$/;
const MODEL_FILE = new RegExp(`^(${STAGES.join("|")})\\.\\d+\\.json$`);
const RETRIEVAL_FILE = new RegExp(`^(${PROVIDERS.join("|")})\\.\\d+\\.json$`);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error("usage: node expand-replay.mjs <bankDir | scenario.json> [more ...] [--out <replayRoot>]");
  process.exit(2);
}

const inputs = [];
let out = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") {
    if (!argv[i + 1]) usage("--out needs a folder");
    out = argv[++i];
  } else if (argv[i] === "-h" || argv[i] === "--help") usage();
  else if (argv[i].startsWith("--")) usage(`unknown option ${argv[i]}`);
  else inputs.push(argv[i]);
}
if (!inputs.length) usage("at least one scenario folder or file is required");

const files = [];
for (const input of inputs) {
  let st;
  try {
    st = fs.statSync(input);
  } catch (e) {
    usage(`cannot read ${input} (${e.code ?? e.message})`);
  }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(input).sort()) if (name.endsWith(".json") && name !== "INDEX.json") files.push(path.join(input, name));
  } else files.push(input);
}
if (!out) {
  const first = fs.statSync(inputs[0]).isDirectory() ? inputs[0] : path.dirname(inputs[0]);
  out = path.join(path.dirname(path.resolve(first)), "replay");
}

// Returns { id, model: [{ name, text }], retrieval: [{ name, text }] } or throws with every problem found.
function plan(file) {
  const errors = [];
  let sc;
  try {
    sc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`not valid JSON (${e.message})`);
  }
  if (!isObj(sc)) throw new Error("the top level must be an object");
  if (typeof sc.id !== "string" || !REPLAY_KEY.test(sc.id)) throw new Error(`id "${sc.id}" is not a replay key (1 to 64 characters, A-Z a-z 0-9 . _ -)`);
  if (!Array.isArray(sc.steps)) throw new Error("steps must be an array");
  const stageCount = {};
  const providerCount = {};
  const model = [];
  const retrieval = [];
  sc.steps.forEach((step, i) => {
    if (!isObj(step)) return;
    const where = `steps[${i}]`;
    if (step.do === "illuminate") {
      if (!STAGES.includes(step.stage)) {
        errors.push(`${where}: unknown stage "${step.stage}"`);
        return;
      }
      const n = (stageCount[step.stage] = (stageCount[step.stage] ?? 0) + 1);
      if (step.call !== undefined && step.call !== n) errors.push(`${where}: call ${step.call} disagrees with the order of ${step.stage} calls (this is call ${n})`);
      const hasResp = has(step, "response");
      const hasText = has(step, "responseText");
      if (hasResp === hasText) {
        errors.push(`${where}: needs exactly one of response or responseText`);
        return;
      }
      if (hasText && typeof step.responseText !== "string") {
        errors.push(`${where}: responseText must be a string`);
        return;
      }
      if (hasResp && !isObj(step.response)) {
        errors.push(`${where}: response must be a JSON object (use responseText for anything else)`);
        return;
      }
      model.push({ name: `${step.stage}.${n}.json`, text: hasText ? step.responseText : JSON.stringify(step.response, null, 2) });
    } else if (step.do === "retrieve") {
      if (!PROVIDERS.includes(step.provider)) {
        errors.push(`${where}: unknown provider "${step.provider}"`);
        return;
      }
      const res = step.response;
      if (!isObj(res) || !Number.isInteger(res.status)) {
        errors.push(`${where}: response must be an object with an integer status`);
        return;
      }
      let body;
      if (step.provider === "fixture") {
        const carriesRecords = Array.isArray(res.records) || has(res, "total");
        if (res.records !== undefined && !Array.isArray(res.records)) {
          errors.push(`${where}: fixture records must be an array`);
          return;
        }
        body = carriesRecords ? JSON.stringify({ total: res.total ?? null, records: res.records ?? [] }) : "";
      } else {
        if (typeof res.body !== "string") {
          errors.push(`${where}: a ${step.provider} response needs the raw body as a string`);
          return;
        }
        body = res.body;
      }
      const n = (providerCount[step.provider] = (providerCount[step.provider] ?? 0) + 1);
      const note = typeof res.note === "string" ? res.note : "";
      retrieval.push({ name: `${step.provider}.${n}.json`, text: JSON.stringify({ status: res.status, body, note }, null, 2) });
    }
  });
  if (errors.length) throw new Error(errors.join("; "));
  return { id: sc.id, model, retrieval };
}

// Writes the planned files into dir and removes files matching `pattern` that were not written now.
function writeSet(dir, planned, pattern) {
  fs.mkdirSync(dir, { recursive: true });
  const names = new Set(planned.map((x) => x.name));
  const stale = fs.readdirSync(dir).filter((name) => pattern.test(name) && !names.has(name));
  for (const f of planned) fs.writeFileSync(path.join(dir, f.name), f.text);
  for (const name of stale) fs.rmSync(path.join(dir, name));
  return stale;
}

let modelTotal = 0;
let retrievalTotal = 0;
let removed = 0;
let failed = 0;
const seen = new Map();
console.log(`replay root: ${path.resolve(out)}`);
for (const file of files) {
  let p;
  try {
    p = plan(file);
  } catch (e) {
    failed++;
    console.log(`ERROR ${file}: ${e.message}`);
    continue;
  }
  if (seen.has(p.id)) {
    failed++;
    console.log(`ERROR ${file}: id "${p.id}" was already expanded from ${seen.get(p.id)}`);
    continue;
  }
  seen.set(p.id, file);
  const dir = path.join(out, p.id);
  const staleModel = writeSet(dir, p.model, MODEL_FILE);
  const retrievalDir = path.join(dir, "retrieval");
  let staleRetrieval = [];
  if (p.retrieval.length || fs.existsSync(retrievalDir)) staleRetrieval = writeSet(retrievalDir, p.retrieval, RETRIEVAL_FILE).map((n) => `retrieval/${n}`);
  const stale = [...staleModel, ...staleRetrieval];
  modelTotal += p.model.length;
  retrievalTotal += p.retrieval.length;
  removed += stale.length;
  console.log(`${p.id}: ${p.model.length} model files, ${p.retrieval.length} retrieval files${stale.length ? `, removed stale ${stale.join(", ")}` : ""}`);
}
console.log(`wrote ${modelTotal + retrievalTotal} replay files (${modelTotal} model, ${retrievalTotal} retrieval) for ${seen.size} scenario(s)${removed ? `, removed ${removed} stale file(s)` : ""}${failed ? `; ${failed} scenario file(s) had errors and were not expanded` : ""}`);
process.exit(failed ? 1 : 0);
