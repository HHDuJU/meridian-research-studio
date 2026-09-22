#!/usr/bin/env node
// expand-replay.mjs: writes the replay files that scenario files imply (SCENARIO_FORMAT.md, "Files";
// amendment sheet A3, R1).
//
// Usage: node expand-replay.mjs <bankDir | scenario.json> [more ...] [--out <replayRoot>]
//   <bankDir>   every *.json in the folder except INDEX.json is read as a scenario
//   --out       replay root; default: a folder named "replay" next to the first input's folder
//
// For each illuminate step, writes <out>/<id>/<stage>.<n>.json holding exactly the text the model returns
// in replay mode: JSON.stringify(response, null, 2) for a response object, or the raw responseText string,
// with nothing added. n counts illuminate steps per stage in scenario order, 1-based, which is the order in
// which the replay server numbers calls; a step whose "call" disagrees with that count is an error.
// Files named <stage>.<n>.json left in <out>/<id>/ by an earlier expansion and not written now are removed,
// so a replay can never return a stale response; the retrieval/ subfolder is never touched.
// Prints the files written per scenario and the total count. Exit 1 when any scenario has an error (its
// files are then not written), 2 on a usage error. No dependencies; Node 18 or later.

import fs from "node:fs";
import path from "node:path";

const STAGES = [
  "problem", "scan", "map", "gaps", "hypotheses", "questions", "design", "protocol", "stats", "ethics", "voices",
  "manuscript", "audit",
];
const REPLAY_KEY = /^[A-Za-z0-9._-]{1,64}$/;
const REPLAY_FILE = new RegExp(`^(${STAGES.join("|")})\\.\\d+\\.json$`);

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

// Returns the replay files of one scenario as [{ name, text }] or throws with every problem found.
function plan(file) {
  const errors = [];
  let sc;
  try {
    sc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`not valid JSON (${e.message})`);
  }
  if (!sc || typeof sc !== "object" || Array.isArray(sc)) throw new Error("the top level must be an object");
  if (typeof sc.id !== "string" || !REPLAY_KEY.test(sc.id)) throw new Error(`id "${sc.id}" is not a replay key (1 to 64 characters, A-Z a-z 0-9 . _ -)`);
  if (!Array.isArray(sc.steps)) throw new Error("steps must be an array");
  const count = {};
  const planned = [];
  sc.steps.forEach((step, i) => {
    if (!step || step.do !== "illuminate") return;
    const where = `steps[${i}]`;
    if (!STAGES.includes(step.stage)) {
      errors.push(`${where}: unknown stage "${step.stage}"`);
      return;
    }
    const n = (count[step.stage] = (count[step.stage] ?? 0) + 1);
    if (step.call !== undefined && step.call !== n) errors.push(`${where}: call ${step.call} disagrees with the order of ${step.stage} calls (this is call ${n})`);
    const hasResp = Object.prototype.hasOwnProperty.call(step, "response");
    const hasText = Object.prototype.hasOwnProperty.call(step, "responseText");
    if (hasResp === hasText) {
      errors.push(`${where}: needs exactly one of response or responseText`);
      return;
    }
    if (hasText && typeof step.responseText !== "string") {
      errors.push(`${where}: responseText must be a string`);
      return;
    }
    if (hasResp && (!step.response || typeof step.response !== "object" || Array.isArray(step.response))) {
      errors.push(`${where}: response must be a JSON object (use responseText for anything else)`);
      return;
    }
    planned.push({ name: `${step.stage}.${n}.json`, text: hasText ? step.responseText : JSON.stringify(step.response, null, 2) });
  });
  if (errors.length) throw new Error(errors.join("; "));
  return { id: sc.id, planned };
}

let total = 0;
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
  fs.mkdirSync(dir, { recursive: true });
  const names = new Set(p.planned.map((x) => x.name));
  const stale = fs.readdirSync(dir).filter((name) => REPLAY_FILE.test(name) && !names.has(name));
  for (const f of p.planned) fs.writeFileSync(path.join(dir, f.name), f.text);
  for (const name of stale) fs.rmSync(path.join(dir, name));
  total += p.planned.length;
  removed += stale.length;
  console.log(`${p.id}: ${p.planned.length} files${stale.length ? `, removed stale ${stale.join(", ")}` : ""}`);
}
console.log(`wrote ${total} replay files for ${seen.size} scenario(s)${removed ? `, removed ${removed} stale file(s)` : ""}${failed ? `; ${failed} scenario file(s) had errors and were not expanded` : ""}`);
process.exit(failed ? 1 : 0);
