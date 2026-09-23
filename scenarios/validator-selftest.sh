#!/usr/bin/env bash
# validator-selftest.sh: self-test of the scenario validator (validator revision 1.3).
#
# Usage: bash validator-selftest.sh [path/to/validator.mjs]
#   The default validator is validate-scenarios.mjs next to this script. Temporary folders go under $TMPDIR
#   (default /tmp) and are removed on exit.
#
# Checks, all against the files in validator-selftest/ (built by validator-selftest/make-selftest.mjs):
#   1. The good set (validator-selftest/*.json: the three version-2 samples, with the corrections that
#      make-selftest.mjs lists) passes, and it contains an appraisal scan reply and a discovery reply with an empty
#      items array (rule 4: both must be accepted).
#   2. Every accept file (validator-selftest/accept/) passes, validated alone or with the good files its case
#      lists (a shared step skeleton must not be reported as a duplicate).
#   3. Every broken file (validator-selftest/broken/) makes the validator exit non-zero, the rules failing for that
#      file are exactly the expected ones (from the validator's "Failing checks per file" list), and the output
#      contains the listed message fragments, one per sub-check the case exercises (so that a regression in one
#      check cannot hide behind another check of the same rule).
# A case is staged in its own folder: each file under its scenario id (the validator requires id == file name),
# with the good files it must be compared against for the duplicate cases.
# Exit status: 0 when every check passes, 1 otherwise.

set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
validator="${1:-$here/validate-scenarios.mjs}"
st="$here/validator-selftest"
command -v node > /dev/null || { echo "validator-selftest: node is required"; exit 1; }
[ -f "$validator" ] || { echo "validator-selftest: no validator at $validator"; exit 1; }
tmp="$(mktemp -d "${TMPDIR:-/tmp}/validator-selftest.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
checks=0
failures=0
cases=0

ok() { checks=$((checks + 1)); printf 'PASS  %s\n' "$1"; }
bad() { checks=$((checks + 1)); failures=$((failures + 1)); printf 'FAIL  %s\n' "$1"; }
scenario_id() { node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).id))' "$1"; }
sorted_words() { printf '%s\n' $1 | sort -u | tr '\n' ' ' | sed 's/ $//'; }
# The rules listed for one file in the validator's "Failing checks per file" section.
failing_rules() {
  awk -v f="$2" '
    /^Failing checks per file:/ { on = 1; next }
    on && NF == 0 { on = 0 }
    on && $1 == f { $1 = ""; print }
  ' "$1" | grep -oE '[A-Za-z0-9-]+ x[0-9]+' | sed -E 's/ x[0-9]+$//' | sort -u | tr '\n' ' ' | sed 's/ $//'
}

echo "Validator self-test"
echo "validator: $validator"
echo

echo "== 1. good set ($st, must pass)"
node "$validator" "$st" > "$tmp/good.out" 2>&1
status=$?
sed 's/^/    | /' "$tmp/good.out"
if [ "$status" -eq 0 ]; then ok "good set passes (exit 0)"; else bad "good set: exit $status, expected 0"; fi
if node -e '
  const fs = require("fs"), path = require("path"), dir = process.argv[1];
  const steps = fs.readdirSync(dir).filter((n) => /^sc-.*\.json$/.test(n)).flatMap((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")).steps);
  const scan = (shape) => steps.filter((s) => s.do === "illuminate" && s.stage === "scan" && s.shape === shape && s.response && typeof s.response === "object");
  const appraisal = scan("appraisal").length;
  const emptyDiscovery = scan("discovery").filter((s) => Array.isArray(s.response.items) && s.response.items.length === 0).length;
  console.log(`    good set holds ${appraisal} appraisal scan repl${appraisal === 1 ? "y" : "ies"} and ${emptyDiscovery} discovery repl${emptyDiscovery === 1 ? "y" : "ies"} with an empty items array`);
  process.exit(appraisal > 0 && emptyDiscovery > 0 ? 0 : 1);
' "$st"; then ok "rule 4: the passing good set includes an appraisal reply and an empty discovery reply"; else bad "rule 4: the good set lacks an appraisal reply or an empty discovery reply"; fi
# Rule 6: the index a passing folder produces has eligible true and no executedWorkflow.
node "$validator" "$st" --index "$tmp/INDEX.json" > "$tmp/index.out" 2>&1
if node -e '
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  const [file, dir] = process.argv.slice(1);
  const index = JSON.parse(fs.readFileSync(file, "utf8"));
  const keys = "id,title,field,level,family,requires,sha256,eligible";
  const names = fs.readdirSync(dir).filter((n) => /^sc-.*\.json$/.test(n));
  const bad = index.filter((e) => Object.keys(e).join(",") !== keys || e.eligible !== true || e.sha256 !== crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, `${e.id}.json`))).digest("hex"));
  console.log(`    INDEX.json: ${index.length} entries with keys ${keys}`);
  process.exit(index.length === names.length && bad.length === 0 ? 0 : 1);
' "$tmp/INDEX.json" "$st" 2> /dev/null; then ok "rule 6: --index writes { id, title, field, level, family, requires, sha256, eligible: true } per file"; else bad "rule 6: the index is missing or its entries are not { id, title, field, level, family, requires, sha256, eligible: true }"; sed 's/^/    | /' "$tmp/index.out"; fi
echo "    good copies versus bank-samples (the corrections make-selftest.mjs applies; informational):"
node -e '
  const fs = require("fs"), path = require("path");
  const [dir, samples] = process.argv.slice(1);
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const key = (p, k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? (p ? `${p}.${k}` : k) : `${p}["${k}"]`);
  function diff(a, b, p, out) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (isObj(a) && isObj(b)) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], key(p, k), out); return; }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) { a.forEach((x, i) => diff(x, b[i], `${p}[${i}]`, out)); return; }
    out.push(p);
  }
  for (const n of fs.readdirSync(dir).filter((n) => /^sc-.*\.json$/.test(n)).sort()) {
    const out = [];
    const s = path.join(samples, n);
    if (!fs.existsSync(s)) { console.log(`      ${n}: no sample of that name`); continue; }
    diff(JSON.parse(fs.readFileSync(s, "utf8")), JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")), "", out);
    console.log(`      ${n}: ${out.length ? `differs at ${out.join(", ")}` : "identical to the sample"}`);
  }
' "$st" "$here/bank-samples"
echo

echo "== 2. accept files (must pass; each alone unless good files are listed with it)"
# accept_case <accept file> "<good files staged with it>"
accept_case() {
  local f="$1" companions="$2" id c status warns
  cases=$((cases + 1))
  local d="$tmp/accept$cases"
  mkdir -p "$d"
  id="$(scenario_id "$st/accept/$f")"
  cp "$st/accept/$f" "$d/$id.json"
  for c in $companions; do cp "$st/$c" "$d/"; done
  node "$validator" "$d" > "$d.out" 2>&1
  status=$?
  warns="$(grep -c '^  warn' "$d.out")"
  if [ "$status" -eq 0 ]; then ok "$f passes (as $id.json${companions:+, with $companions}; $warns warning(s))"; else bad "$f (as $id.json${companions:+, with $companions}): exit $status, expected 0"; sed 's/^/    | /' "$d.out"; fi
}
accept_case "accept-brief-need.json" ""
accept_case "accept-long-need.json" ""
accept_case "accept-investigator-edits-constraints.json" ""
accept_case "accept-confirm-before-discovery.json" ""
accept_case "accept-openalex-body.json" ""
accept_case "accept-shared-skeleton.json" "sc-000-level1.json"
accept_case "accept-late-reply.json" ""
# Bank metadata in capitals (bank-v1/ holds ASSIGNMENTS.json and ASSIGNMENT_BATCHES.json) is skipped, not failed.
d="$tmp/metadata"
mkdir -p "$d"
cp "$st/sc-000-level1.json" "$d/"
echo '[{ "id": "sc-001" }]' > "$d/ASSIGNMENTS.json"
echo '[]' > "$d/INDEX.json"
node "$validator" "$d" > "$d.out" 2>&1
status=$?
if [ "$status" -eq 0 ] && grep -qF "skipped (bank metadata, not scenarios): ASSIGNMENTS.json, INDEX.json" "$d.out"; then ok "bank metadata files (ASSIGNMENTS.json, INDEX.json) are skipped and listed"; else bad "bank metadata files: exit $status, expected 0 and a skipped line"; sed 's/^/    | /' "$d.out"; fi
echo

echo "== 3. broken files (must fail with exactly the expected rules)"
# run_case "<broken files>" "<expected failing rules>" "<good files staged with them>" "<fragment>|<fragment>|..." [validator options]
run_case() {
  local files="$1" expected="$2" companions="$3" mentions="$4" options="${5:-}"
  cases=$((cases + 1))
  local d="$tmp/case$cases" f id c status got want frag missing
  local -a names=() staged=() frags=()
  mkdir -p "$d"
  for f in $files; do
    id="$(scenario_id "$st/broken/$f")"
    cp "$st/broken/$f" "$d/$id.json"
    names+=("$f")
    staged+=("$id.json")
  done
  for c in $companions; do cp "$st/$c" "$d/"; done
  node "$validator" "$d" $options > "$d.out" 2>&1
  status=$?
  want="$(sorted_words "$expected")"
  missing=""
  IFS='|' read -r -a frags <<< "$mentions"
  for frag in "${frags[@]}"; do
    [ -n "$frag" ] && ! grep -qF -- "$frag" "$d.out" && missing="$missing [$frag]"
  done
  for i in "${!names[@]}"; do
    got="$(failing_rules "$d.out" "${staged[$i]}")"
    if [ "$status" -ne 0 ] && [ "$got" = "$want" ] && [ -z "$missing" ]; then
      ok "${names[$i]} (as ${staged[$i]}${companions:+, with $companions}): exit $status, failing rules: $got; ${#frags[@]} message fragment(s) found"
    else
      bad "${names[$i]} (as ${staged[$i]}): exit $status, failing rules [$got], expected [$want]${missing:+; fragments not found:$missing}"
      sed 's/^/    | /' "$d.out"
    fi
  done
}

# Counterexample 1: outcome checks, reload and reopen expectations, final export.
run_case "broken-c1-no-outcome-checks.json" "outcome-check reload-reopen-expect final-export" "" \
  'steps[3]: a consequential step (do "retrieve") needs an expect|steps[10]: a consequential step (do "accept-decision") needs an expect|a reload step needs an expect|a reopen step needs an expect|(steps[1]) come before the last consequential step'
run_case "broken-c1-screen-only-expect.json" "outcome-check" "" \
  'steps[9]: a consequential step (do "accept-decision") needs an expect with at least one store, stage, issues or error check that states the correct outcome (it has only screen)|steps[16]: a consequential step (do "set-field") needs an expect'
run_case "broken-c1-export-before-last-step.json" "final-export" "" \
  '(steps[15]) come before the last consequential step steps[16] (illuminate)'
# Counterexample 2: semantic duplicates, each pair reported by name.
run_case "broken-c2-renamed-copy-a.json broken-c2-renamed-copy-b.json" "duplicate" "" \
  'sc-911.json and sc-912.json: need text equal after normalisation; 7 shared retrieved record titles|; identical step trajectory signature'
run_case "broken-c2-need-only.json" "duplicate" "sc-000-level1.json" \
  'sc-000-level1.json and sc-913.json: need text word-set Jaccard 0.96 (above 0.8)'
run_case "broken-c2-records-only.json" "duplicate" "sc-000-level1.json" \
  'sc-000-level1.json and sc-914.json: 2 shared retrieved record titles ("Structured handoff tools in inpatient nursing'
run_case "broken-c2-trajectory-only.json" "duplicate" "sc-000-level1.json" \
  'sc-000-level1.json and sc-915.json: identical step trajectory signature'
# Counterexample 3: an unknown top-level key, malformed retrieve steps.
run_case "broken-c3-retrieval-key.json" "top-level" "" \
  'retrieval: unknown top-level field'
run_case "broken-c3-fixture-records.json" "retrieve" "" \
  'records[0].year: must be an integer year or null (got "2021")|records[1].authors: must be a string|records[2].doi: must be a string starting with the reserved prefix 10.5555/|records[3].abstract: must be a string when present|records[4].journal: not a RawRecord field|records[6].title: must be a non-empty string'
run_case "broken-c3-fixture-total-status.json" "retrieve" "" \
  'steps[2].response.total: must be a non-negative integer, the provider'"'"'s hit count (got null)|steps[3].response.status: must be an HTTP status number'
run_case "broken-c3-provider-format.json" "retrieve" "" \
  'steps[3].response.records: unknown key for a provider-format response from openalex|steps[3].response.body: must be the provider'"'"'s raw body text|steps[4].provider: "scholar" must be one of|steps[4].query: must be a non-empty string'
# Rule 7: G11.
run_case "broken-g11-level3-sample-v2.json" "G11" "" \
  'steps[1].expect.issues.includes: { path "constraints", code "cleared" }|steps[1].expect.store["problem.constraints"]: expects ""|steps[14].expect.store["problem.constraints"]: expects ""|steps[21].expect.export.path["problem.constraints"]: expects ""'
run_case "broken-g11-model-value.json" "G11" "" \
  'steps[1].expect.store["problem.constraints"]: expects "Fieldwork budget of 18,000; fieldwork ends|steps[23].expect.export.path["problem.constraints"]: expects "Fieldwork budget of 18,000; fieldwork ends|steps[0].expect.store["problem.rawNeed"]: expects "I work in the environmental health team'
run_case "broken-g11-hedge-and-count.json" "G11" "" \
  'steps[1].expect.issues.count: 1 leaves no room for the dropped issue|also accepts "", a value a model response tried to write over the typed constraints'
# Rule 8: golden-rule guards.
run_case "broken-g1-discovery-certainty.json" "G1" "" \
  'steps[3].expect.store["scan.gradeOverall"]: "low" on a discovery step with no retrieved record before it|steps[3].expect.screen.includes: "low certainty" shows a certainty label'
run_case "broken-g1-grade-before-appraisal.json" "G1" "" \
  'steps[4].expect.store["scan.gradeOverall"]: "moderate" accepts certainty "moderate", but no appraisal call over retrieved records|steps[4].expect.screen.includes: "moderate certainty" shows a certainty label'
run_case "broken-g2-discovery-complete.json" "G2" "" \
  'steps[4].expect: expects the Scan stage complete, but no earlier retrieve returned a record and no confirm-empty-search came first'
run_case "broken-g7-no-accepted-predecessor.json" "G7" "" \
  'the latest accept-decision (steps[13]) does not expect design.decisions[-1].selectionStatus "accepted"'
run_case "broken-g7-accepted-positive-index.json" "G7" "" \
  'the latest accept-decision (steps[13]) states acceptance only at design.decisions[1].selectionStatus, a positive index'
run_case "broken-g7-uncited-record.json" "G7" "" \
  'record ev-1jty10q is not a source of any claim the accepted decision rests on'
run_case "broken-g7-no-stale-after.json" "G7" "" \
  'the change-source step must expect a decision status field "stale" in the store|no screen check names "stale" at or after the change-source step|no later reload step checks a status field "stale" in the store'
# Rule 9: screen status words.
run_case "broken-screen-status.json" "screen-status" "" \
  'steps[10].expect.screen: the store check names a status|steps[13].expect.screen: the store check names a status|steps[22].expect.screen: the store check names a status'
# Rule 5: need word bounds.
run_case "broken-need-words.json" "need-words" "" \
  'inputs.need: 15 words; the bank accepts 20 to 700'
# Rule 10: the earlier checks (text rules with a --forbidden list, call numbering, stage schema keys, earlyStop).
printf '# selftest forbidden terms\nselftest forbidden marker\n' > "$tmp/forbidden.txt"
run_case "broken-earlier-checks.json" "pmid trial-number doi forbidden ascii call-numbering stage-schema early-stop" "" \
  'contains a PMID; invented PMIDs are omitted|contains a PubMed article URL|a "pmid" key is not allowed|contains a trial registration number (NCT00000000)|real-looking DOI "10.1000/selftest-not-a-real-doi,"|contains the forbidden term "selftest forbidden marker"|1 non-ASCII character(s)|U+00E9|is 2 but this is illuminate call 1 for "scan"|missing top-level key(s) of the map schema: reading|earlyStop: must be a string of 20 to 600 characters' \
  "--forbidden $tmp/forbidden.txt"

# Format 1.2: the late illuminate step and its during actions (validator 1.3).
run_case "broken-late-no-during.json" "step-schema" "" \
  'late: true needs a non-empty during array'
run_case "broken-during-no-late.json" "step-schema" "" \
  'during needs late: true on the same illuminate step'
run_case "broken-during-illuminate.json" "step-schema outcome-check" "" \
  'during[0].do: "illuminate" is not an investigator action a held reply can span|during[1]: a during action (do "set-field") needs an expect'

listed="$(grep -oE '(run|accept)_case "[^"]+"' "$0" | sed -E 's/^(run|accept)_case "//; s/"$//' | tr ' ' '\n' | grep -E '^(broken|accept)-.*\.json$' | sort -u)"
present="$(cd "$st" && ls broken/broken-*.json accept/accept-*.json | xargs -n1 basename | sort -u)"
if [ "$listed" = "$present" ]; then ok "every broken and accept file has a case, and every case has a file"; else bad "files and cases differ: $(comm -3 <(echo "$listed") <(echo "$present") | tr -s ' \t\n' ' ')"; fi

echo
echo "selftest: $checks checks, $((checks - failures)) passed, $failures failed"
[ "$failures" -eq 0 ]
