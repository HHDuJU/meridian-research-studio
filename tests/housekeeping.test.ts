import { test } from "node:test";
import assert from "node:assert/strict";
import { markUnknownIds } from "../src/lib/evidence/ids";

test("month-year dates in prose are not decision ids; real unknown ids are still marked", () => {
  const out = markUnknownIds("Recruitment ran from Jan-2018 to Dec-2019 (and Dec-19); see dec-1 and gate-7.", new Set(["gate-7"]));
  assert.match(out.text, /to Dec-2019 \(and Dec-19\)/);
  assert.deepEqual(out.unknown, ["dec-1"]);
  assert.match(out.text, /⟦unresolved:dec-1⟧/);
});
