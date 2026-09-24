import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPulled, decide, splitParts, studyJson, StudySync, PART_CHARS, type Db, type DocSnap } from "../src/cowork/sync";
import { createStudy } from "../src/lib/defaults";
import type { Study } from "../src/lib/types";

/*
 * Meridian on Cowork: studies follow the investigator across devices through the artifact's database.
 * An in-memory store stands in for the database; two StudySync objects with separate sync state stand in
 * for two devices. All study content is invented.
 */

function memoryDb(): Db & { docs: Map<string, Record<string, unknown>> } {
  const docs = new Map<string, Record<string, unknown>>();
  const snap = (path: string): DocSnap => {
    const body = docs.get(path);
    return { id: path.split("/").pop()!, exists: !!body, data: () => (body ? structuredClone(body) : undefined) };
  };
  const doc = (path: string) => ({
    get: async () => snap(path),
    set: async (data: Record<string, unknown>) => {
      const size = JSON.stringify(data).length;
      if (size > 256 * 1024) throw { code: "invalid_argument", message: `document over 256 KiB (${size})` };
      docs.set(path, structuredClone(data));
    },
    delete: async () => {
      docs.delete(path);
    },
  });
  return {
    docs,
    doc,
    collection: (path: string) => ({
      get: async () => ({
        docs: [...docs.keys()].filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes("/")).map(snap),
      }),
      doc: (id: string) => doc(`${path}/${id}`),
    }),
  };
}

function study(title: string, need = "Audit night-time opioid prescribing on the surgical wards."): Study {
  const s = createStudy({ family: "qi-pdsa", setting: "Surgical wards", rawNeed: need, constraints: "", localFacts: [] });
  return { ...s, title };
}

let clock = 0;
const tick = () => new Date(Date.UTC(2026, 8, 24, 12, 0, clock++)).toISOString();

test("a study larger than one database document is stored in parts and read back whole", async () => {
  const db = memoryDb();
  const big = { ...study("Big study"), audit: { entries: [], openFixes: [], improvementNotes: "x".repeat(300_000), lastReview: "" } } as unknown as Study;
  const json = studyJson(big);
  assert.ok(json.length > 256 * 1024);
  assert.equal(splitParts(json).join(""), json);
  assert.equal(splitParts(json).length, Math.ceil(json.length / PART_CHARS));
  const a = new StudySync(db, "u_1", tick, {});
  const head = await a.upload(big);
  assert.equal(head.parts, Math.ceil(json.length / PART_CHARS));
  const back = await a.download(head);
  assert.equal(back?.title, "Big study");
  assert.equal(back?.audit.improvementNotes.length, 300_000);
});

test("which copy wins: the side that changed since the last sync; both changed, the later save", () => {
  const last = { local: "L0", remote: "R0" };
  assert.equal(decide(undefined, { sha: "R", savedAt: "t" }, undefined), "pull");
  assert.equal(decide({ sha: "L", updatedAt: "t" }, undefined, undefined), "push");
  assert.equal(decide({ sha: "S", updatedAt: "t" }, { sha: "S", savedAt: "t" }, last), "same");
  assert.equal(decide({ sha: "L0", updatedAt: "t" }, { sha: "R0", savedAt: "t" }, last), "same", "nothing changed on either side");
  assert.equal(decide({ sha: "L0", updatedAt: "t" }, { sha: "R1", savedAt: "t" }, last), "pull");
  assert.equal(decide({ sha: "L1", updatedAt: "t" }, { sha: "R0", savedAt: "t" }, last), "push");
  assert.equal(decide({ sha: "L1", updatedAt: "2026-09-24T12:00:05Z" }, { sha: "R1", savedAt: "2026-09-24T12:00:09Z" }, last), "pull");
  assert.equal(decide({ sha: "L1", updatedAt: "2026-09-24T12:00:09Z" }, { sha: "R1", savedAt: "2026-09-24T12:00:05Z" }, last), "push");
});

test("two devices: a study made on one appears on the other; a change travels back", async () => {
  const db = memoryDb();
  const mac = new StudySync(db, "u_1", tick, {});
  const phone = new StudySync(db, "u_1", tick, {});
  const s1 = study("Ketamine protocol");
  const first = await mac.exchange([s1]);
  assert.equal(first.pushed, 1);
  const onPhone = await phone.exchange([]);
  assert.equal(onPhone.pulled.length, 1);
  assert.equal(onPhone.added, 1);
  assert.equal(onPhone.pulled[0].title, "Ketamine protocol");
  const again = await phone.exchange(onPhone.pulled);
  assert.equal(again.pulled.length + again.pushed, 0, "a study just pulled is not pulled or pushed again");
  const edited = { ...onPhone.pulled[0], title: "Ketamine protocol, revised", updatedAt: tick() };
  assert.equal(await phone.pushChanged([edited]), 1);
  assert.equal(await phone.pushChanged([edited]), 0, "unchanged studies are not pushed twice");
  const back = await mac.exchange([s1]);
  assert.equal(back.pulled.length, 1);
  assert.equal(back.pulled[0].title, "Ketamine protocol, revised");
  assert.deepEqual(applyPulled([s1, study("Other")], back.pulled).map((s) => s.title), ["Ketamine protocol, revised", "Other"]);
});

test("a half-written study (parts not matching the head's hash) is skipped, never loaded", async () => {
  const db = memoryDb();
  const mac = new StudySync(db, "u_1", tick, {});
  const s1 = study("Half written");
  await mac.upload(s1);
  const partPath = [...db.docs.keys()].find((k) => k.includes("/parts/0"))!;
  db.docs.set(partPath, { chunk: "{\"id\": \"broken" });
  const phone = new StudySync(db, "u_1", tick, {});
  const r = await phone.exchange([]);
  assert.equal(r.pulled.length, 0);
  assert.equal(r.skipped, 1);
});

test("each viewer's studies stay under their own private path", async () => {
  const db = memoryDb();
  await new StudySync(db, "u_abc", tick, {}).upload(study("Private"));
  assert.ok([...db.docs.keys()].every((k) => k.startsWith("data/users/u_abc/meridian/studies/")));
  const other = await new StudySync(db, "u_other", tick, {}).exchange([]);
  assert.equal(other.pulled.length, 0);
});

test("seed studies stay out of sync; seed copies an earlier version uploaded are removed", async () => {
  const db = memoryDb();
  const seed = { ...study("Seed example"), id: "seed-ketamine" } as Study;
  const mine = study("My study");
  const old = new StudySync(db, "u_1", tick, {});
  await old.upload(seed);
  assert.ok([...db.docs.keys()].some((k) => k.includes("/seed-ketamine")));
  const r = await new StudySync(db, "u_1", tick, {}).exchange([seed, mine]);
  assert.equal(r.pushed, 1, "only the investigator's own study is pushed");
  assert.equal(r.pulled.length, 0);
  assert.ok(![...db.docs.keys()].some((k) => k.includes("/seed-ketamine")), "the old seed copy and its parts are gone");
  assert.equal(await new StudySync(db, "u_1", tick, {}).pushChanged([seed]), 0);
});
