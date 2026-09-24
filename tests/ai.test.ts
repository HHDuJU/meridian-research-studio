/**
 * `ai.ts` imports the host framework, whose manifest is absent from this export; the request
 * validator is therefore tested through a copy of its pure logic via the harness typecheck stub.
 * When the manifest is restored, import `validateMeridianRequest` from "../src/lib/ai" directly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MAX_COMPACT_CHARS, SYSTEM, validateMeridianRequest } from "../src/lib/prompt";

const src = fs.readFileSync(new URL("../src/lib/ai.ts", import.meta.url), "utf8");
// The prompt, its schemas and the request validator moved to prompt.ts (pure) on 24 September 2026 so the
// Cowork edition sends the same words; ai.ts keeps the server function and imports them.
const promptSrc = fs.readFileSync(new URL("../src/lib/prompt.ts", import.meta.url), "utf8");

test("server function no longer uses an identity validator", () => {
  assert.doesNotMatch(src, /\.validator\(\(input: \{[\s\S]*?\}\) => input\)/);
  assert.match(src, /\.validator\(\(input: unknown\) => validateMeridianRequest\(input\)\)/);
});

test("validator rejects unknown stage/family and oversized context (source-level checks)", () => {
  assert.match(promptSrc, /Unknown stage/);
  assert.match(promptSrc, /Unknown study family/);
  assert.match(promptSrc, /MAX_COMPACT_CHARS = 32_000/);
  assert.match(src, /from "\.\/prompt"/);
});

test("validator rejects unknown stage/family and oversized context (behaviour)", () => {
  assert.throws(() => validateMeridianRequest({ stage: "nope", family: null, compact: "x" }), /Unknown stage/);
  assert.throws(() => validateMeridianRequest({ stage: "problem", family: "nope", compact: "x" }), /Unknown study family/);
  assert.throws(() => validateMeridianRequest({ stage: "problem", family: null, compact: "x".repeat(MAX_COMPACT_CHARS + 1) }), /limit is 32000/);
  assert.equal(validateMeridianRequest({ stage: "problem", family: null, compact: "x" }).stage, "problem");
});

test("the prompt still forbids invented identifiers (guard preserved)", () => {
  assert.match(promptSrc, /Never invent a DOI/);
  assert.match(SYSTEM, /Never invent a DOI/);
});
