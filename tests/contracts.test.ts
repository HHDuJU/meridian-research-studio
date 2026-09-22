import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Issues,
  compactPatch,
  enumOrResolve,
  scoreOrNull,
  strictBoolOrNull,
  stringArray,
  yearOrNull,
} from "../src/lib/contracts";

test("yearOrNull: absent → null, implausible → null + issue, 4-digit string → number", () => {
  const issues = new Issues();
  assert.equal(yearOrNull(undefined, "y", issues), null);
  assert.equal(yearOrNull(2020, "y", issues), 2020);
  assert.equal(yearOrNull(3020, "y", issues), null);
  assert.equal(yearOrNull("2018", "y", issues), 2018);
  assert.equal(yearOrNull("nineteen", "y", issues), null);
  assert.deepEqual(issues.list.map((i) => i.code), ["out-of-range", "invalid-type"]);
});

test("scoreOrNull: 0–100 kept, 1200 → null + out-of-range, 'high' → null + invalid-type, absent → null with no issue", () => {
  const issues = new Issues();
  assert.equal(scoreOrNull(73.4, "q", issues), 73);
  assert.equal(scoreOrNull(1200, "q", issues), null);
  assert.equal(scoreOrNull("high", "q", issues), null);
  assert.equal(scoreOrNull(undefined, "q", issues), null);
  assert.deepEqual(issues.list.map((i) => i.code), ["out-of-range", "invalid-type"]);
});

test("strictBoolOrNull: only true/false are booleans", () => {
  const issues = new Issues();
  assert.equal(strictBoolOrNull(true, "b", issues), true);
  assert.equal(strictBoolOrNull(false, "b", issues), false);
  assert.equal(strictBoolOrNull("false", "b", issues), null);
  assert.equal(strictBoolOrNull(1, "b", issues), null);
  assert.equal(strictBoolOrNull("yes", "b", issues), null);
  assert.equal(issues.list.length, 3);
  assert.ok(issues.list.every((i) => i.code === "malformed-boolean"));
});

test("enumOrResolve: invalid member resolved visibly to fallback, or undefined without fallback", () => {
  const issues = new Issues();
  assert.equal(enumOrResolve(["a", "b"] as const, "zzz", "e", issues, "a"), "a");
  assert.equal(issues.list[0].code, "resolved");
  assert.equal(enumOrResolve(["a", "b"] as const, "zzz", "e", issues), undefined);
  assert.equal(issues.list[1].code, "invalid-enum");
  assert.equal(enumOrResolve(["a", "b"] as const, "b", "e", issues), "b");
  const i2 = new Issues();
  assert.equal(enumOrResolve(["a", "b"] as const, null, "e", i2), undefined);
  assert.equal(i2.hasErrors, false, "null is 'none', not an error");
});

test("stringArray: objects are dropped with an issue, never '[object Object]'", () => {
  const issues = new Issues();
  assert.deepEqual(stringArray(["PubMed", { name: "Embase" }, 7, ""], "s", issues), ["PubMed"]);
  assert.equal(issues.list.length, 2);
  assert.ok(issues.list.every((i) => i.code === "dropped"));
  assert.deepEqual(stringArray(null, "s", issues), []);
});

test("compactPatch removes undefined keys so omitted fields never overwrite stored values", () => {
  assert.deepEqual(compactPatch({ a: 1, b: undefined, c: null, d: "" }), { a: 1, c: null, d: "" });
});
