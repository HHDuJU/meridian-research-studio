#!/usr/bin/env python3
"""Bank amendment D10 (format 1.3, 2026-09-23): model proposals and model authorization claims.

Part 1. For every illuminate step of the Design stage whose decision had a gate set "met" by the model and
kept "met" by the build before the confirmation design (commit 11016b6, read from that build's final
stores), the amendment:
  1. changes that step's expectation for each such gate from status "met" to status "unknown" with
     proposal.status "met" (and adds both checks for such gates the step did not check);
  2. inserts, right after that step, a confirm-gate step for exactly those gates, which expects each gate
     "met" and set by the investigator, and the decision still "proposed" on screen.

Part 2. Every decision is ready only when the investigator has recorded, on it, the research ethics status of
the work (rule G12). For each decision the scenario expects ready that has no such record (read from a store run
of the Part 1 bank: --missing, a JSON of {scenario: {decisions: [{index, suggestion}]}}):
  - when the investigator confirmed a gate for this work's ethics approval or determination, a
    record-determination step before the accept-decision step records it, citing that gate;
  - when the investigator's own facts state the determination or approval (FACT_RECORDS), the step cites that fact;
  - in literature reviews, the step records that review is not required (published literature only);
  - otherwise the investigator has no ethics status to record, and every "ready" expected for that decision
    from its acceptance on becomes "blocked".

Model responses, the need, records and every other expectation are unchanged. The file's previous version is
kept as <bank>/original-v<version>/<file>.

Usage: python3 scenarios/amend-d10.py <bankDir> <finalStoresRunDir> <timestampZ> [--missing <analysis.json>]
"""
import copy
import glob
import json
import os
import re
import sys

bank, runs, stamp = sys.argv[1], sys.argv[2], sys.argv[3]
MISSING = {}
if "--missing" in sys.argv:
    MISSING = json.load(open(sys.argv[sys.argv.index("--missing") + 1]))


def final_decisions(sc_id):
    f = glob.glob(os.path.join(runs, "run-*", sc_id, "store-final.json"))
    if not f:
        return None
    d = json.load(open(f[0]))
    study = d.get("study") if isinstance(d, dict) and "study" in d else d
    if isinstance(study, dict) and "design" not in study:
        # store-final may hold the whole studio state
        for s in (study.get("studies") or []):
            study = s
    return (study.get("design") or {}).get("decisions") or []


LITERATURE = "Review of published literature only: no participants and no identifiable data."
LITERATURE_FAMILIES = {"systematic-review", "scoping-review", "umbrella-review", "narrative-review", "rapid-review"}
# The investigator's own fact that states the ethics status: (status, words that find the fact).
FACT_RECORDS = {
    "sc-001": ("not-required", "classified the project as quality improvement"),
    "sc-007": ("not-required", "program evaluation not requiring review"),
    "sc-014": ("not-required", "SE-2026-077"),
    "sc-015": ("met", "waiver of consent"),
    "sc-020": ("not-required", "SEV-MAT"),
    "sc-022": ("not-required", "SE-NEU"),
    "sc-024": ("not-required", "SE-PCN-2026-03"),
    "sc-030": ("not-required", "RSE-26-044"),
    "sc-042": ("not-required", "not requiring ethics review"),
    "sc-073": ("not-required", "screened the weaning protocol as quality improvement"),
    "sc-076": ("not-required", "quality improvement not requiring"),
    "sc-081": ("not-required", "registered the clinic's monitoring plan"),
}

# The investigator's own facts that leave an approval open, acted on per scenario (rule G12 c): "aside" with
# the reason it does not concern the decision, or "keep" (the decision stays blocked).
OPEN_ITEM_ACTIONS = {
    "sc-004": [
        ("The board will decide on the extended opening hours scheme", "aside",
         "The board's decision on the scheme is what this review informs; the review itself needs no approval from the board."),
        ("requires the data governance lead's approval", "aside",
         "This decision is a review of published studies; it uses none of the authority's activity data."),
    ],
    "sc-019": [("The network board meets in November 2026 to approve the design", "keep", None)],
    "sc-023": [
        ("The ICB commissioning board will consider link worker funding", "aside",
         "The board's funding decision is what this review informs; the review itself needs no approval from the board."),
    ],
}

GATE_STATUS = re.compile(r"^design\.decisions\[(-?\d+)\]\.gates\[(\d+)\]\.status$")
changed = []
for path in sorted(glob.glob(os.path.join(bank, "*.json"))):
    name = os.path.basename(path)
    stem = os.path.splitext(name)[0]
    if stem.upper() == stem:
        continue
    raw = open(path, encoding="utf-8").read()
    sc = json.loads(raw)
    decs = final_decisions(sc["id"])
    if decs is None:
        print(f"{name}: no final store, skipped")
        continue
    def norm(t):
        return re.sub(r"\u27e6unresolved:([^\u27e7]+)\u27e7", r"\1", t or "").strip()

    unused = list(decs)

    def take(statement):
        for d in unused:
            if norm(d.get("statement")) == norm(statement):
                unused.remove(d)
                return d
        return None

    steps = []
    amended = []
    for n, step in enumerate(sc["steps"], start=1):
        steps.append(step)
        if not (step.get("do") == "illuminate" and step.get("stage") == "design" and not step.get("late")):
            continue
        resp = step.get("response") or {}
        raw_dec = resp.get("decision") if isinstance(resp, dict) else None
        if not isinstance(raw_dec, dict):
            continue
        stored = take(raw_dec.get("statement"))
        if stored is None:
            print(f"{name} step {n}: decision not found in the final store, skipped")
            continue
        met = [(i, g["id"]) for i, g in enumerate(stored.get("gates") or []) if g.get("status") == "met" and g.get("setBy") == "model"]
        if not met:
            continue
        store = step.setdefault("expect", {}).setdefault("store", {})
        # the decision path this step uses (a negative or explicit index); default latest
        prefix = "design.decisions[-1]"
        for k in store:
            m = GATE_STATUS.match(k)
            if m:
                prefix = f"design.decisions[{m.group(1)}]"
                break
        for i, gid in met:
            key = f"{prefix}.gates[{i}].status"
            if store.get(key, "met") != "met":
                raise SystemExit(f"{name} step {n}: {key} expected {store[key]!r} for a gate the earlier build set met")
            store[key] = "unknown"
            store[f"{prefix}.gates[{i}].proposal.status"] = "met"
        ids = [gid for _, gid in met]
        confirm = {
            "do": "confirm-gate",
            "which": "latest",
            "gates": ids,
            "note": (
                "D10 (format 1.3): the model proposed "
                + ("this gate" if len(ids) == 1 else "these gates")
                + " as met; the investigator's own facts support "
                + ("it" if len(ids) == 1 else "them")
                + ", and the investigator confirms "
                + ("it" if len(ids) == 1 else "them")
                + " on screen before acceptance. Only the investigator sets a gate."
            ),
            "expect": {
                "store": {
                    **{f"design.decisions[-1].gates[{i}].status": "met" for i, _ in met},
                    **{f"design.decisions[-1].gates[{i}].setBy": "investigator" for i, _ in met},
                    "design.decisions[-1].selectionStatus": "proposed",
                },
                "screen": {"includes": ["proposed"]},
            },
        }
        amended.append((len(steps), ids))  # the Design step's number in the new version
        steps.append(confirm)
    part2 = ""
    sid = sc["id"]
    entry = MISSING.get(sid) or {}
    suggestions = {d["index"]: d.get("suggestion", "") for d in entry.get("decisions", [])}
    open_items = {d["index"]: d.get("open", []) for d in entry.get("decisions", [])}
    needs_record = {d["index"]: d.get("missing", True) for d in entry.get("decisions", [])}
    missing = set(suggestions)  # decision indexes the scenario expects ready that are not ready
    if missing:
        design_steps = [k for k, st in enumerate(steps) if st.get("do") == "illuminate" and st.get("stage") == "design"]

        def latest_at(k):
            return sum(1 for j in design_steps if j <= k) - 1

        def target(path, k):
            m = re.match(r"^design\.decisions\[(-?\d+)\]\.actionStatus$", path)
            if not m:
                return None
            i = int(m.group(1))
            return latest_at(k) if i == -1 else (latest_at(k) + 1 + i if i < 0 else i)

        notes = []
        k = 0
        while k < len(steps):
            st = steps[k]
            if st.get("do") == "accept-decision":
                which = st.get("which", "latest")
                idx = latest_at(k) if which == "latest" else int(which)
                if idx in missing:
                    missing.discard(idx)
                    sug = suggestions.get(idx, "")
                    opens = open_items.get(idx, [])
                    blocked_by = []
                    inserted = []
                    from_gate = bool(sug) and not any(sug in f for f in sc["inputs"].get("localFacts", []))
                    if needs_record.get(idx, True):
                        if from_gate or sid in FACT_RECORDS or sc["family"] in LITERATURE_FAMILIES:
                            if from_gate:
                                status = "not-required" if re.search(r"(?i)determination|exempt|not requiring|needs no|not required|no ethics review|quality improvement|service evaluation", sug) else "met"
                                reason, how = sug, "citing the ethics gate the investigator confirmed"
                            elif sid in FACT_RECORDS:
                                status, words = FACT_RECORDS[sid]
                                facts = [f for f in sc["inputs"].get("localFacts", []) if words.lower() in f.lower()]
                                if len(facts) != 1:
                                    raise SystemExit(f"{name}: {len(facts)} facts match {words!r}")
                                reason, how = facts[0], "citing the investigator's own fact"
                            else:
                                status, reason, how = "not-required", LITERATURE, "for a review of published literature"
                            p_ = f"design.decisions[{'-1' if which == 'latest' else which}]"
                            inserted.append({
                                "do": "record-determination",
                                "which": which,
                                "body": "ethics",
                                "status": status,
                                "reason": reason,
                                "note": "D10 (format 1.3, rule G12): a decision is ready only with the investigator's record of the research ethics status of the work; the investigator records it before accepting.",
                                "expect": {
                                    "store": {
                                        f"{p_}.gates[-1].status": status,
                                        f"{p_}.gates[-1].setBy": "investigator",
                                        f"{p_}.selectionStatus": "proposed",
                                    },
                                    "screen": {"includes": ["proposed"]},
                                },
                            })
                            notes.append(f"the investigator records the ethics status ({'approved' if status == 'met' else 'review not required'}) {how} before accepting decision {idx + 1}")
                        else:
                            blocked_by.append("the investigator's facts give no research ethics status")
                    settled_n = 0
                    for text in opens:
                        acts = [a for a in OPEN_ITEM_ACTIONS.get(sid, []) if a[0] in text]
                        if len(acts) != 1:
                            raise SystemExit(f"{name}: open item without a curated action: {text!r}")
                        match, how_, note_ = acts[0]
                        if how_ == "keep":
                            blocked_by.append(f"the investigator's own fact leaves an approval open (\"{match}\")")
                            continue
                        settled_n += 1
                        inserted.append({
                            "do": "settle-open-item",
                            "which": which,
                            "match": match,
                            "how": how_,
                            "note": note_,
                            "expect": {
                                "store": {f"design.decisions[{'-1' if which == 'latest' else which}].settledItems": {"length": settled_n}},
                            },
                        })
                        notes.append(f"the investigator sets aside, for decision {idx + 1}, their fact \"{match}\" ({note_[0].lower() + note_[1:].rstrip('.')})")
                    for j, ins in enumerate(inserted):
                        steps.insert(k + j, ins)
                    k += len(inserted)
                    if blocked_by:
                        flipped = 0
                        for j in range(k, len(steps)):
                            e = steps[j].get("expect") or {}
                            for exp in ((e.get("export") or {}).get("path") or {}, e.get("store") or {}):
                                for key in list(exp):
                                    if exp[key] == "ready" and target(key, j) == idx:
                                        exp[key] = "blocked"
                                        flipped += 1
                            scr = e.get("screen") or {}
                            if j == k and isinstance(scr.get("includes"), list) and "ready" in scr["includes"]:
                                scr["includes"] = ["blocked" if x == "ready" else x for x in scr["includes"]]
                                flipped += 1
                        if not flipped:
                            raise SystemExit(f"{name}: decision {idx} has no ready expectation to change")
                        notes.append(f"decision {idx + 1} is expected blocked from its acceptance (step {k + 1}) on: {'; '.join(blocked_by)}")
            k += 1
        if missing:
            raise SystemExit(f"{name}: decisions {sorted(missing)} were not accepted in the scenario")
        joined = "; ".join(notes)
        part2 = " " + joined[0].upper() + joined[1:] + "."
    if not amended and not part2:
        continue
    old_version = sc["version"]
    keep_dir = os.path.join(bank, f"original-v{old_version}")
    os.makedirs(keep_dir, exist_ok=True)
    keep = os.path.join(keep_dir, name)
    if os.path.exists(keep):
        raise SystemExit(f"{keep} exists; refusing to overwrite a kept version")
    open(keep, "w", encoding="utf-8").write(raw)
    rel_bank = os.path.basename(os.path.normpath(bank))
    what = "; ".join(f"step {n} ({', '.join(ids)})" for n, ids in amended)
    part1 = (
        f" A model \"met\" on a gate is a proposal: the Design step now expects \"unknown\" with proposal.status "
        f"\"met\" ({what}), and a confirm-gate step after it has the investigator confirm those gates."
        if amended
        else ""
    )
    text = (
        f"version {old_version} (kept as {rel_bank}/original-v{old_version}/{name}), superseded {stamp}: D10 "
        f"(format 1.3, rule G12).{part1}{part2} Model responses, need and records are unchanged."
    )
    prior = sc.get("supersedes")
    new = copy.deepcopy(sc)
    new["version"] = old_version + 1
    new["steps"] = steps
    if "D10" not in new["requires"]:
        new["requires"] = new["requires"] + ["D10"]
    # keep key order: supersedes stays last
    new.pop("supersedes", None)
    new["supersedes"] = text + (" Earlier versions are described in the supersedes field of the kept file." if prior else "")
    open(path, "w", encoding="utf-8").write(json.dumps(new, indent=2, ensure_ascii=False) + "\n")
    changed.append((name, amended))

print(f"amended {len(changed)} files")
for name, amended in changed:
    print(" ", name, amended)
