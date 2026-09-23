#!/usr/bin/env python3
"""Written by the coordinating session (Fable, harness/trial/, 2026-09-22); adopted into the repository 2026-09-23.
Print every failing checkpoint of a bank run, grouped by scenario and step, compactly.
usage: triage-bank-failures.py <runDir> [--ids sc-001,sc-002] [--max-len 160]"""
import json, os, sys, glob
run = sys.argv[1]
ids = None; maxlen = 160
args = sys.argv[2:]
while args:
    a = args.pop(0)
    if a == "--ids": ids = set(args.pop(0).split(","))
    elif a == "--max-len": maxlen = int(args.pop(0))
def short(v):
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    s = s.replace("\n", " ")
    return s if len(s) <= maxlen else s[:maxlen] + "…"
for d in sorted(glob.glob(os.path.join(run, "sc-*"))):
    sid = os.path.basename(d)
    if ids and sid not in ids: continue
    p = os.path.join(d, "result.json")
    if not os.path.exists(p): continue
    r = json.load(open(p))
    bad = [c for c in r.get("checkpoints", []) if c.get("ok") is False]
    if not bad: continue
    print(f"== {sid} {r.get('status')} fails={len(bad)} executedWorkflow={r.get('executedWorkflow')}")
    for c in bad:
        print(f"  step {c.get('step')} {c.get('do')}{'/'+str(c.get('stage')) if c.get('stage') else ''} :: {c.get('check')}")
        print(f"     expected {short(c.get('expected'))}")
        print(f"     observed {short(c.get('observed'))}")
        if c.get("reason") and c.get("check") == "run":
            print(f"     reason   {short(c.get('reason'))}")
