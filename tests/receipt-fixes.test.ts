import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudy, migrateStudy, scanMayComplete, REPAIR_EMPTY_SCAN_COMPLETION } from "../src/lib/defaults";
import { useStudio } from "../src/lib/store";
import { compareWithRegistry, applyLookupOutcome } from "../src/lib/evidence/verify";
import { titleSimilarity, titlesExactlyEquivalent } from "../src/lib/evidence/identifiers";
import { writeImmutableBackup, createGuardedStorage, MAIN_KEY, FAIL_KEY, isConsequentialReconciliation, migrationChangedStudy } from "../src/lib/persist-backup";
import { replayEnabledFromEnv } from "../src/lib/replay-key";
import { studyToJson } from "../src/lib/export";
import type { EvidenceItem } from "../src/lib/types";

const S = () => useStudio.getState();

function item(partial: Partial<EvidenceItem> & Pick<EvidenceItem, "id" | "title">): EvidenceItem {
  return {
    authors: "",
    year: 2020,
    source: "",
    kind: "grey",
    grade: "unrated",
    methodQuality: null,
    relevance: null,
    notes: "",
    verification: "verify",
    contextTags: [],
    keyFindings: "",
    limitations: "",
    provenance: {
      origin: "retrieval",
      retrievalEventIds: ["r1"],
      identifiers: { doi: partial.doi },
      access: "abstract",
      status: "retrieved",
      checks: [],
    },
    ...partial,
  };
}

test("query_change_withdraws_existing_scan_completion", () => {
  const created = S().create({ family: "qi-pdsa", setting: "Ward", rawNeed: "Need." });
  S().mergeStage(created.id, "scan", { query: "school heat empty query" });
  S().confirmEmptySearch(created.id);
  S().markComplete(created.id, "scan");
  assert.equal(S().studies.find((x) => x.id === created.id)!.completedStages.includes("scan"), true);
  S().mergeStage(created.id, "scan", { query: "unrelated marine ecology of kelp forests" });
  const after = S().studies.find((x) => x.id === created.id)!;
  assert.equal(scanMayComplete(after), false);
  assert.equal(after.completedStages.includes("scan"), false);
  assert.equal(after.scan.completionWithdrawn?.wasComplete, true);
  const exported = JSON.parse(studyToJson(after)) as { completedStages: string[] };
  assert.equal(exported.completedStages.includes("scan"), false);
});

test("legacy_actor_flag_does_not_keep_scan_complete_through_migration", () => {
  const raw = {
    schemaVersion: 4,
    id: "study-legacy-actor",
    title: "school heat",
    family: "qi-pdsa",
    setting: "Ontario",
    status: "active",
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    currentStage: "scan",
    completedStages: ["scan"],
    needsReview: [],
    scan: {
      items: [],
      query: "school heat",
      emptySearchConfirmedBy: "investigator",
      emptySearchConfirmed: { at: "2026-09-22T00:00:00.000Z", actor: "investigator" },
      retrievalEvents: [],
      gradeOverall: "",
    },
  };
  const migrated = migrateStudy(raw);
  assert.equal(migrated.completedStages.includes("scan"), false);
  assert.ok(migrated.repairsApplied?.includes(REPAIR_EMPTY_SCAN_COMPLETION));
  assert.equal(migrated.scan.completionWithdrawn?.wasComplete, true);
});

test("chinese_titles_are_informative_and_do_not_match_when_unrelated", () => {
  const r = compareWithRegistry(
    { title: "麻醉镇痛", year: 2020, doi: "10.5555/cjk.a" },
    { title: "心脏疾病", authors: "", year: 2020, venue: "J", doi: "10.5555/cjk.a" },
  );
  assert.equal(titlesExactlyEquivalent("麻醉镇痛", "心脏疾病"), false);
  assert.equal(titleSimilarity("麻醉镇痛", "心脏疾病") < 0.5, true);
  assert.equal(r.result, "mismatch");
  assert.equal(r.informative, true);
});

test("empty_titles_are_not_equivalent", () => {
  const r = compareWithRegistry(
    { title: "", year: 2020, doi: "10.5555/empty" },
    { title: "", authors: "", year: 2020, venue: "", doi: "10.5555/empty" },
  );
  assert.equal(titlesExactlyEquivalent("", ""), false);
  assert.equal(r.result, "mismatch");
  assert.equal(r.informative, false);
});

test("same_doi_1901_vs_2024_without_typed_dates_is_not_verified", () => {
  const r = compareWithRegistry(
    { title: "Identical title", year: 1901, doi: "10.5555/old" },
    { title: "Identical title", authors: "", year: 2024, venue: "J", doi: "10.5555/old" },
  );
  assert.notEqual(r.result, "match");
  assert.equal(r.dateVariant?.corroborated, false);
});

test("unrelated_title_does_not_write_a_match_check_even_with_doi_and_year_gap", () => {
  const rec = item({
    id: "ev-econ",
    title: "Economic migration patterns in urban housing markets",
    doi: "10.5555/econ",
    year: 2018,
  });
  const applied = applyLookupOutcome(
    [rec],
    ["10.5555/econ"],
    "crossref",
    {
      status: "ok",
      records: [
        {
          title: "Cardiac output under spinal anaesthesia",
          authors: "",
          year: 2024,
          venue: "J",
          doi: "10.5555/econ",
        },
      ],
    },
  );
  assert.equal(applied.items[0].provenance.status, "mismatch");
  assert.equal(applied.checks.some((c) => c.result === "match"), false);
});

test("pubmed_34624374_online_2021_print_2024_is_a_corroborated_match", () => {
  const r = compareWithRegistry(
    {
      title: "Official online then print date variant",
      year: 2021,
      doi: "10.5555/pm34624374",
    },
    {
      title: "Official online then print date variant",
      authors: "",
      year: 2024,
      venue: "J",
      doi: "10.5555/pm34624374",
      pmid: "34624374",
      dates: { online: 2021, print: 2024 },
    },
  );
  assert.equal(r.result, "match");
  assert.equal(r.dateVariant?.corroborated, true);
  const rec = item({
    id: "ev-pm",
    title: "Official online then print date variant",
    year: 2021,
    doi: "10.5555/pm34624374",
  });
  const applied = applyLookupOutcome([rec], ["10.5555/pm34624374"], "pubmed", {
    status: "ok",
    records: [
      {
        title: rec.title,
        authors: "",
        year: 2024,
        venue: "J",
        doi: "10.5555/pm34624374",
        pmid: "34624374",
        dates: { online: 2021, print: 2024 },
      },
    ],
  });
  assert.equal(applied.items[0].provenance.status, "verified");
  assert.equal(applied.checks[0].result, "match");
});

test("same_version_write_backs_up_original_before_overwrite", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  const original = JSON.stringify({
    state: { studies: [{ id: "orig", schemaVersion: 4, repairsApplied: [], notes: "investigator notes" }] },
    version: 4,
  });
  const repaired = JSON.stringify({
    state: {
      studies: [{ id: "orig", schemaVersion: 4, repairsApplied: ["d20-empty-scan-certainty"], notes: "investigator notes" }],
    },
    version: 4,
  });
  storage.setItem(MAIN_KEY, original);
  const guarded = createGuardedStorage(storage, 4);
  guarded.setItem(MAIN_KEY, repaired);
  assert.equal(storage.getItem(MAIN_KEY), repaired);
  const backup = [...store.keys()].find((k) => k.startsWith("meridian-studio-v2.backup.4."));
  assert.ok(backup);
  assert.equal(storage.getItem(backup!), original);
});

test("quota_failure_refuses_main_overwrite_and_persists_failure", () => {
  const store = new Map<string, string>();
  store.set(MAIN_KEY, "ORIGINAL");
  const inner = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (k.startsWith("meridian-studio-v2.backup.")) throw new Error("QuotaExceededError");
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  const guarded = createGuardedStorage(inner, 4);
  guarded.setItem(MAIN_KEY, "NEW");
  assert.equal(store.get(MAIN_KEY), "ORIGINAL");
  const fail = store.get(FAIL_KEY);
  assert.ok(fail);
  assert.match(fail!, /quota/);
});

function memoryStorage(init: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(init));
  return {
    store,
    storage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  };
}

const NOTES_ORIGINAL = JSON.stringify({
  state: {
    studies: [{ id: "s1", schemaVersion: 4, repairsApplied: [], problem: { constraints: "newer investigator notes" } }],
  },
  version: 4,
});
const NOTES_REPAIRED = JSON.stringify({
  state: {
    studies: [
      {
        id: "s1",
        schemaVersion: 4,
        repairsApplied: ["d20-empty-scan-certainty"],
        problem: { constraints: "newer investigator notes" },
      },
    ],
  },
  version: 4,
});
const EMPTY_SNAPSHOT = JSON.stringify({ state: { studies: [] }, version: 4 });

test("corrupt_backup_does_not_authorize_overwrite_of_current_original", () => {
  const { store, storage } = memoryStorage({
    [MAIN_KEY]: NOTES_ORIGINAL,
    "meridian-studio-v2.backup.4.old": "not json",
  });
  const guarded = createGuardedStorage(storage, 4);
  guarded.setItem(MAIN_KEY, NOTES_REPAIRED);
  const backups = [...store.keys()].filter((k) => k.startsWith("meridian-studio-v2.backup.4."));
  const valid = backups.find((k) => store.get(k) === NOTES_ORIGINAL);
  assert.ok(valid, "current original must be stored in a backup key");
  assert.equal(store.get("meridian-studio-v2.backup.4.old"), "not json");
  assert.equal(store.get(MAIN_KEY), NOTES_REPAIRED);
  assert.equal(store.get(valid!), NOTES_ORIGINAL);
});

test("stale_empty_snapshot_does_not_prove_current_original_recoverable", () => {
  const { store, storage } = memoryStorage({
    [MAIN_KEY]: NOTES_ORIGINAL,
    "meridian-studio-v2.backup.4.old": EMPTY_SNAPSHOT,
  });
  const guarded = createGuardedStorage(storage, 4);
  guarded.setItem(MAIN_KEY, NOTES_REPAIRED);
  assert.notEqual(store.get("meridian-studio-v2.backup.4.old"), NOTES_ORIGINAL);
  const valid = [...store.keys()].find((k) => k.startsWith("meridian-studio-v2.backup.4.") && store.get(k) === NOTES_ORIGINAL);
  assert.ok(valid);
  assert.equal(store.get(MAIN_KEY), NOTES_REPAIRED);
  assert.equal(store.get("meridian-studio-v2.backup.4.old"), EMPTY_SNAPSHOT);
});

test("corrupt_backup_and_quota_on_new_copy_refuses_repair_and_keeps_original", () => {
  const store = new Map<string, string>([
    [MAIN_KEY, NOTES_ORIGINAL],
    ["meridian-studio-v2.backup.4.old", "not json"],
  ]);
  const inner = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (k.startsWith("meridian-studio-v2.backup.") && k !== "meridian-studio-v2.backup.4.old") {
        throw new Error("QuotaExceededError");
      }
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  const guarded = createGuardedStorage(inner, 4);
  guarded.setItem(MAIN_KEY, NOTES_REPAIRED);
  assert.equal(store.get(MAIN_KEY), NOTES_ORIGINAL);
  assert.equal(store.get("meridian-studio-v2.backup.4.old"), "not json");
  const fail = store.get(FAIL_KEY);
  assert.ok(fail);
  assert.match(fail!, /quota|not the current original/);
});

test("autosave_does_not_write_another_backup_copy", () => {
  const autosaveNext = JSON.stringify({
    state: {
      studies: [{ id: "s1", schemaVersion: 4, repairsApplied: [], problem: { constraints: "edited notes" } }],
    },
    version: 4,
  });
  const { store, storage } = memoryStorage({
    [MAIN_KEY]: NOTES_ORIGINAL,
    "meridian-studio-v2.backup.4.old": EMPTY_SNAPSHOT,
  });
  const guarded = createGuardedStorage(storage, 4);
  guarded.setItem(MAIN_KEY, autosaveNext);
  assert.equal(store.get(MAIN_KEY), autosaveNext);
  const backups = [...store.keys()].filter((k) => k.startsWith("meridian-studio-v2.backup.4."));
  assert.deepEqual(backups, ["meridian-studio-v2.backup.4.old"]);
  assert.equal(isConsequentialReconciliation(NOTES_ORIGINAL, autosaveNext), false);
  assert.equal(isConsequentialReconciliation(NOTES_ORIGINAL, NOTES_REPAIRED), true);
});

const SCHEMA4_RAW_STUDY = {
  id: "study-s4",
  schemaVersion: 4,
  repairsApplied: [] as string[],
  title: "School heat",
  family: "qi-pdsa",
  scan: {
    items: [] as unknown[],
    claims: [{ id: "c1", text: "heat is high", kind: "assumption", sourceIds: [] as string[], uncertainty: "low" }],
  },
};

function schema4RawPersist(): string {
  return JSON.stringify({ state: { studies: [SCHEMA4_RAW_STUDY] }, version: 4 });
}

function schema4MigratedPersist(): string {
  const migrated = migrateStudy(SCHEMA4_RAW_STUDY);
  return JSON.stringify({ state: { studies: [migrated] }, version: 4 });
}

test("schema4_rehydrate_without_repair_ids_backs_up_pre_repair_raw", () => {
  const original = schema4RawPersist();
  const next = schema4MigratedPersist();
  const migrated = migrateStudy(SCHEMA4_RAW_STUDY);
  assert.deepEqual(migrated.repairsApplied, []);
  assert.ok(Array.isArray(migrated.documents));
  assert.equal(migrated.scan.claims[0]?.origin, "unknown");
  assert.equal(isConsequentialReconciliation(original, next), true);
  assert.equal(migrationChangedStudy(SCHEMA4_RAW_STUDY, migrated), true);
  const { store, storage } = memoryStorage({ [MAIN_KEY]: original });
  const guarded = createGuardedStorage(storage, 4);
  guarded.setItem(MAIN_KEY, next);
  assert.equal(store.get(MAIN_KEY), next);
  const valid = [...store.keys()].find((k) => k.startsWith("meridian-studio-v2.backup.4.") && store.get(k) === original);
  assert.ok(valid, "pre-repair schema-4 raw must be recoverable after rehydrate write-back");
});

test("schema4_rehydrate_corrupt_backup_and_quota_refuses_main_overwrite", () => {
  const original = schema4RawPersist();
  const next = schema4MigratedPersist();
  const store = new Map<string, string>([
    [MAIN_KEY, original],
    ["meridian-studio-v2.backup.4.old", "not json"],
  ]);
  const inner = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (k.startsWith("meridian-studio-v2.backup.") && k !== "meridian-studio-v2.backup.4.old") {
        throw new Error("QuotaExceededError");
      }
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  const guarded = createGuardedStorage(inner, 4);
  guarded.setItem(MAIN_KEY, next);
  assert.equal(store.get(MAIN_KEY), original);
  assert.equal(store.get("meridian-studio-v2.backup.4.old"), "not json");
  const fail = store.get(FAIL_KEY);
  assert.ok(fail);
  assert.match(fail!, /quota|not the current original/);
});

test("twelve_ordinary_autosaves_create_no_backups", () => {
  const reconciled = JSON.stringify({
    state: {
      studies: [
        {
          id: "s1",
          schemaVersion: 4,
          repairsApplied: [],
          documents: [],
          scan: { claims: [{ id: "c1", text: "x", origin: "unknown" }] },
          problem: { constraints: "start" },
        },
      ],
    },
    version: 4,
  });
  const { store, storage } = memoryStorage({ [MAIN_KEY]: reconciled });
  const guarded = createGuardedStorage(storage, 4);
  for (let i = 1; i <= 12; i++) {
    const next = JSON.stringify({
      state: {
        studies: [
          {
            id: "s1",
            schemaVersion: 4,
            repairsApplied: [],
            documents: [],
            scan: { claims: [{ id: "c1", text: "x", origin: "unknown" }] },
            problem: { constraints: `edit ${i}` },
          },
        ],
      },
      version: 4,
    });
    guarded.setItem(MAIN_KEY, next);
  }
  const backups = [...store.keys()].filter((k) => k.startsWith("meridian-studio-v2.backup."));
  assert.deepEqual(backups, []);
});

test("replay_requires_build_permission_not_runtime_vite_flag_alone", () => {
  assert.equal(replayEnabledFromEnv({ VITE_SCENARIO_MODE: "true", MERIDIAN_MODEL_MODE: "replay" }, ""), false);
  assert.equal(replayEnabledFromEnv({ VITE_SCENARIO_MODE: "true", MERIDIAN_MODEL_MODE: "replay" }, "false"), false);
  assert.equal(replayEnabledFromEnv({ MERIDIAN_MODEL_MODE: "replay" }, "true"), true);
  assert.equal(replayEnabledFromEnv({ MERIDIAN_MODEL_MODE: "live" }, "true"), false);
});
