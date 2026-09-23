#!/usr/bin/env python3
"""Written by the coordinating session (Fable, harness/trial/, 2026-09-22); adopted into the repository 2026-09-23.
Aggregate a scenario runner output folder into the three counts and a per-entry attribution.
usage: aggregate-bank-run.py <runDir> <bankDir> [out.md]"""
import json, sys, os, collections, glob, re
run, bank = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else None
idx = {i['id']: i for i in json.load(open(os.path.join(bank, 'INDEX.json')))}
rows = []; by_reason = collections.Counter(); by_entry = collections.Counter(); routes = collections.Counter(); statuses = collections.Counter()
executed = qualifying = 0; unsupported_actions = collections.Counter(); behaviour_checks = collections.Counter()
for d in sorted(glob.glob(os.path.join(run, 'sc-*'))):
    p = os.path.join(d, 'result.json')
    if not os.path.exists(p): continue
    r = json.load(open(p)); sid = r['scenarioId']
    cps = r.get('checkpoints', []); fails = [c for c in cps if not c.get('ok')]
    cap = beh = uns = 0
    for c in fails:
        rs = c.get('reason') or ''
        if 'capability absent' in rs:
            cap += 1; m = re.search(r'capability absent:\s*([A-Z0-9, ]+)', rs)
            for e in (m.group(1).split(',') if m else ['?']): by_entry[e.strip()] += 1
        elif 'unsupported' in rs: uns += 1
        else:
            beh += 1; behaviour_checks[(c.get('do'), c.get('stage'), c.get('check'))] += 1
    ar = r.get('actionRoutes') or []
    for a in ar:
        routes[a.get('route')] += 1
        if a.get('route') != 'ui': unsupported_actions[a.get('do')] += 1
    statuses[r.get('status')] += 1
    ran_all = r.get('status') in ('PASS', 'FAIL') and all(c.get('do') != 'run' for c in cps[:1])
    if ran_all: executed += 1
    if r.get('executedWorkflow'): qualifying += 1
    rows.append((sid, idx.get(sid, {}).get('level'), r.get('status'), len(cps), len(fails), cap, beh, uns, ','.join(idx.get(sid, {}).get('requires', []))))
lines = []
lines.append(f"scenarios with a result: {len(rows)} | status: {dict(statuses)} | executed attempts (ran past start): {executed} | qualifying (executedWorkflow true): {qualifying}")
lines.append(f"action routes: {dict(routes)} | non-ui actions by kind: {dict(unsupported_actions)}")
lines.append(f"capability-absent checkpoints by entry: {dict(by_entry.most_common())}")
lines.append("most frequent behaviour failures (do, stage, check): " + '; '.join(f"{k[0]}/{k[1]}/{k[2]}: {v}" for k, v in behaviour_checks.most_common(12)))
lines.append("")
lines.append("| scenario | level | status | checks | fail | capability absent | behaviour | unsupported | requires |")
lines.append("|---|---|---|---|---|---|---|---|---|")
for row in rows: lines.append("| " + " | ".join(str(x) for x in row) + " |")
text = "\n".join(lines)
print("\n".join(lines[:4]))
if out: open(out, 'w').write(text + "\n")
