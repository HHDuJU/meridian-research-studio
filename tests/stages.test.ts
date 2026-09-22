import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFamily, guessFamily } from "../src/lib/stages";

test("'Scoping review using PRISMA-ScR' → scoping-review, explicit (PRISMA is a cue, not a design)", () => {
  const c = classifyFamily("Scoping review using PRISMA-ScR");
  assert.equal(c.family, "scoping-review");
  assert.equal(c.basis, "explicit");
});

test("'Mixed methods study with an interview component' → mixed-methods, components noted", () => {
  const c = classifyFamily("Mixed methods study with an interview component");
  assert.equal(c.family, "mixed-methods");
  assert.equal(c.basis, "explicit");
  assert.ok(c.candidates.includes("qualitative"));
});

test("'Why are recovery room delays increasing?' → unresolved, no default", () => {
  const c = classifyFamily("Why are recovery room delays increasing?");
  assert.equal(c.family, null);
  assert.equal(c.basis, "unresolved");
  assert.equal(guessFamily("Why are recovery room delays increasing?"), null);
});

test("fresh: plural 'interviews' is recognised; feasibility + interviews keeps both", () => {
  const c = classifyFamily("Prospective non-randomised feasibility study with embedded interviews");
  assert.equal(c.family, "feasibility");
  assert.deepEqual(c.candidates, ["feasibility", "mixed-methods"]);
  assert.match(c.note, /qualitative component/);
});

test("fresh: 'non-randomised' does not trigger the randomised-trial design", () => {
  assert.equal(classifyFamily("A non-randomised prospective cohort of block responders").family, "cohort");
});

test("fresh: 'Implement a new block protocol and randomise wards' → rct explicit; implement is only a cue", () => {
  const c = classifyFamily("Implement a new block protocol and randomise wards");
  assert.equal(c.family, "rct");
  assert.ok(c.matched.some((m) => /implement \(verb\) \[cue\]/.test(m)));
});

test("fresh: 'A scoping review reported per PRISMA' stays scoping-review", () => {
  assert.equal(classifyFamily("A scoping review reported per PRISMA of ketamine infusions").family, "scoping-review");
});

test("fresh: 'Retrospective cohort using our RFA registry, with a cost analysis' → retrospective; cost noted", () => {
  const c = classifyFamily("Retrospective cohort using our RFA registry, with a cost analysis");
  assert.equal(c.family, "retrospective");
  assert.ok(c.matched.some((m) => /cost \[cue\]/.test(m)));
});

test("fresh: only a cue → inferred, flagged to confirm", () => {
  const c = classifyFamily("We would report it with STROBE");
  assert.equal(c.basis, "inferred");
  assert.equal(c.family, "cohort");
  assert.match(c.note, /Confirm/);
});

test("fresh: contradictory designs → unresolved with candidates", () => {
  const c = classifyFamily("Randomised trial or retrospective chart review, not sure which");
  assert.equal(c.basis, "unresolved");
  assert.deepEqual([...c.candidates].sort(), ["rct", "retrospective"]);
});

test("fresh: QI language is not silently turned into a trial", () => {
  const c = classifyFamily("PDSA cycles on the overnight stay pathway");
  assert.equal(c.family, "qi-pdsa");
});
