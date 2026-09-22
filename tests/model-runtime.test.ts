import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseModelMode,
  parseReplayKey,
  readReplayText,
  replayEnabledFromEnv,
  replayFilePath,
  resetReplayCounters,
  resolveModelText,
  writeReplayText,
} from "../src/lib/model-runtime";

test("replay_returns_recorded_text_in_order", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-replay-"));
  writeReplayText(dir, "sc-demo", "scan", 1, "first-call");
  writeReplayText(dir, "sc-demo", "scan", 2, "second-call");
  resetReplayCounters();
  const env = { MERIDIAN_REPLAY_DIR: dir };
  const a = await resolveModelText({
    mode: "replay",
    replayKey: "sc-demo",
    stage: "scan",
    live: async () => "SHOULD-NOT-RUN",
    env,
  });
  const b = await resolveModelText({
    mode: "replay",
    replayKey: "sc-demo",
    stage: "scan",
    live: async () => "SHOULD-NOT-RUN",
    env,
  });
  assert.equal(a.text, "first-call");
  assert.equal(b.text, "second-call");
  assert.equal(a.call, 1);
  assert.equal(b.call, 2);
});

test("replay_missing_file_is_an_error_not_a_default", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-replay-"));
  resetReplayCounters();
  await assert.rejects(
    () =>
      resolveModelText({
        mode: "replay",
        replayKey: "missing-key",
        stage: "problem",
        live: async () => '{"title":"invented"}',
        env: { MERIDIAN_REPLAY_DIR: dir },
      }),
    /no recorded response for missing-key\/problem\.1/,
  );
  assert.equal(parseModelMode(undefined), "live");
  assert.throws(() => readReplayText(dir, "missing-key", "problem", 1), /no recorded response/);
});

test("live_mode_ignores_replay_dir", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-replay-"));
  writeReplayText(dir, "sc-demo", "problem", 1, "from-disk");
  resetReplayCounters();
  let liveRan = 0;
  const r = await resolveModelText({
    mode: "live",
    replayKey: "sc-demo",
    stage: "problem",
    live: async () => {
      liveRan += 1;
      return "from-live";
    },
    env: { MERIDIAN_REPLAY_DIR: dir, MERIDIAN_MODEL_MODE: "live" },
  });
  assert.equal(r.text, "from-live");
  assert.equal(liveRan, 1);
  assert.equal(r.mode, "live");
  assert.equal(fs.readFileSync(path.join(dir, "sc-demo", "problem.1.json"), "utf8"), "from-disk");
});

test("record_mode_is_deferred_to_live", () => {
  assert.equal(parseModelMode("record"), "live");
  assert.equal(parseModelMode("replay"), "replay");
  assert.equal(replayEnabledFromEnv({ MERIDIAN_MODEL_MODE: "replay" }, ""), false);
  assert.equal(replayEnabledFromEnv({ VITE_SCENARIO_MODE: "true", MERIDIAN_MODEL_MODE: "replay" }, ""), false);
  assert.equal(replayEnabledFromEnv({ VITE_SCENARIO_MODE: "true", MERIDIAN_MODEL_MODE: "replay" }, "true"), true);
  assert.equal(replayEnabledFromEnv({ VITE_SCENARIO_MODE: "true", MERIDIAN_MODEL_MODE: "live" }, "true"), false);
});

test("replay_key_rejects_dot_dotdot_and_path_escape", () => {
  assert.throws(() => parseReplayKey("."), /Invalid replayKey/);
  assert.throws(() => parseReplayKey(".."), /Invalid replayKey/);
  assert.throws(() => parseReplayKey("../etc"), /Invalid replayKey/);
  assert.throws(() => parseReplayKey("foo/bar"), /Invalid replayKey/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-replay-"));
  const file = replayFilePath(dir, "sc-demo", "scan", 1);
  assert.equal(file.startsWith(path.resolve(dir) + path.sep), true);
  assert.equal(path.resolve(file).startsWith(path.resolve(dir) + path.sep), true);
});

test("resetReplayCounters_is_per_key", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-replay-"));
  writeReplayText(dir, "sc-a", "scan", 1, "a1");
  writeReplayText(dir, "sc-a", "scan", 2, "a2");
  writeReplayText(dir, "sc-b", "scan", 1, "b1");
  resetReplayCounters();
  const env = { MERIDIAN_REPLAY_DIR: dir };
  const a1 = await resolveModelText({ mode: "replay", replayKey: "sc-a", stage: "scan", live: async () => "x", env });
  assert.equal(a1.call, 1);
  resetReplayCounters("sc-a");
  const aAgain = await resolveModelText({ mode: "replay", replayKey: "sc-a", stage: "scan", live: async () => "x", env });
  assert.equal(aAgain.call, 1);
  assert.equal(aAgain.text, "a1");
  const b1 = await resolveModelText({ mode: "replay", replayKey: "sc-b", stage: "scan", live: async () => "x", env });
  assert.equal(b1.text, "b1");
});
