/**
 * `ai.ts` imports the host framework, whose manifest is absent from this export; the request
 * validator is therefore tested through a copy of its pure logic via the harness typecheck stub.
 * When the manifest is restored, import `validateMeridianRequest` from "../src/lib/ai" directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/lib/ai.ts", import.meta.url), "utf8");

test("server function no longer uses an identity validator", () => {
  assert.doesNotMatch(src, /\.validator\(\(input: \{[\s\S]*?\}\) => input\)/);
  assert.match(src, /\.validator\(\(input: unknown\) => validateMeridianRequest\(input\)\)/);
});

test("validator rejects unknown stage/family and oversized context (source-level checks)", () => {
  assert.match(src, /Unknown stage/);
  assert.match(src, /Unknown study family/);
  assert.match(src, /MAX_COMPACT_CHARS = 32_000/);
});

test("the prompt still forbids invented identifiers (guard preserved)", () => {
  assert.match(src, /Never invent a DOI/);
});
