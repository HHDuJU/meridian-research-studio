/*
 * Meridian on Cowork: studies follow the investigator across devices. Browser storage keeps working as
 * before (the page opens instantly with the studies this browser holds); on top of it each study is kept
 * in the artifact's database, in the viewer's private subtree (data/users/<id>/meridian/studies/<study>),
 * so the Claude app on the Mac, a browser and the phone see the same studies. Nobody else, the artifact's
 * owner included, can read another viewer's subtree.
 *
 * A document holds at most 256 KiB, so a study is stored as parts (80,000 characters each) under its
 * head document, which carries the parts count and the SHA-256 of the whole study. Parts are written
 * before the head, and a reader that finds the joined parts disagreeing with the head's hash skips that
 * study until the next pull, so a half-written study is never loaded.
 *
 * Which copy wins is decided per study against the hash this browser last synced: whichever side changed
 * since then wins; if both changed, the later save wins (the loser is gone, so this is for one person
 * working on one device at a time, which is how Meridian is used today).
 */
import type { Study } from "../lib/types";
import { sha256Hex } from "../lib/evidence/hash";
import { migrateStudy } from "../lib/defaults";
import { refreshDecisionStatuses } from "../lib/evidence/decision";

export const PART_CHARS = 80_000;
const STATE_KEY = "meridian-cowork-sync";

export interface DocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
export interface DocRef {
  get(): Promise<DocSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}
export interface CollRef {
  get(): Promise<{ docs: DocSnap[] }>;
  doc(id: string): DocRef;
}
export interface Db {
  doc(path: string): DocRef;
  collection(path: string): CollRef;
}

export interface Head {
  kind: "meridian-study";
  id: string;
  title: string;
  sha256: string;
  parts: number;
  savedAt: string;
  schema: 1;
}

/**
 * The seed studies ship with every copy of Meridian, so each device already has them; syncing them only
 * trades copies that differ in load-time stamps. They are left out (an investigator's own work lives in
 * studies they create).
 */
export function syncable(study: { id: string }): boolean {
  return !study.id.startsWith("seed-");
}

export function splitParts(json: string, size = PART_CHARS): string[] {
  const out: string[] = [];
  for (let i = 0; i < json.length; i += size) out.push(json.slice(i, i + size));
  return out.length ? out : [""];
}

export function studyJson(study: Study): string {
  return JSON.stringify(study);
}

/** What this browser last saw for a study: the local hash after the sync and the remote head's hash. */
export interface Synced {
  local: string;
  remote: string;
}

/** Which way one study moves, from the local copy, the remote head and what was last synced here. */
export function decide(local: { sha: string; updatedAt: string } | undefined, remote: { sha: string; savedAt: string } | undefined, last: Synced | undefined): "pull" | "push" | "same" {
  if (!remote) return local ? "push" : "same";
  if (!local) return "pull";
  if (local.sha === remote.sha) return "same";
  const localChanged = !last || local.sha !== last.local;
  const remoteChanged = !last || remote.sha !== last.remote;
  if (!localChanged && !remoteChanged) return "same";
  if (!localChanged) return "pull";
  if (!remoteChanged) return "push";
  return remote.savedAt > local.updatedAt ? "pull" : "push";
}

function readState(): Record<string, Synced> {
  try {
    const raw = globalThis.localStorage?.getItem(STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Synced>) : {};
  } catch {
    return {};
  }
}

function writeState(state: Record<string, Synced>): void {
  try {
    globalThis.localStorage?.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* browser storage unavailable: the next pull compares by save time */
  }
}

function asHead(snap: DocSnap): Head | null {
  const d = snap.exists ? snap.data() : undefined;
  if (!d || d.kind !== "meridian-study" || typeof d.sha256 !== "string" || typeof d.parts !== "number" || typeof d.savedAt !== "string") return null;
  return { kind: "meridian-study", id: String(d.id ?? snap.id), title: String(d.title ?? ""), sha256: d.sha256, parts: d.parts, savedAt: d.savedAt, schema: 1 };
}

export class StudySync {
  private readonly base: string;
  private state: Record<string, Synced>;

  constructor(
    private readonly db: Db,
    uid: string,
    private readonly now: () => string = () => new Date().toISOString(),
    initialState?: Record<string, Synced>,
  ) {
    this.base = `data/users/${uid}/meridian/studies`;
    this.state = initialState ?? readState();
  }

  private remember(id: string, synced: Synced): void {
    this.state = { ...this.state, [id]: synced };
    writeState(this.state);
  }

  async heads(): Promise<Map<string, Head>> {
    const snap = await this.db.collection(this.base).get();
    const out = new Map<string, Head>();
    for (const d of snap.docs) {
      const h = asHead(d);
      if (h) out.set(h.id, h);
    }
    return out;
  }

  async download(head: Head): Promise<Study | null> {
    const parts: string[] = [];
    for (let i = 0; i < head.parts; i++) {
      const p = await this.db.doc(`${this.base}/${head.id}/parts/${i}`).get();
      const chunk = p.exists ? p.data()?.chunk : undefined;
      if (typeof chunk !== "string") return null;
      parts.push(chunk);
    }
    const json = parts.join("");
    if (sha256Hex(json) !== head.sha256) return null;
    return refreshDecisionStatuses(migrateStudy(JSON.parse(json)));
  }

  async upload(study: Study, previousParts = 0): Promise<Head> {
    const json = studyJson(study);
    const sha = sha256Hex(json);
    const parts = splitParts(json);
    for (let i = 0; i < parts.length; i++) {
      await this.db.doc(`${this.base}/${study.id}/parts/${i}`).set({ chunk: parts[i] });
    }
    const head: Head = { kind: "meridian-study", id: study.id, title: study.title ?? "", sha256: sha, parts: parts.length, savedAt: this.now(), schema: 1 };
    await this.db.doc(`${this.base}/${study.id}`).set({ ...head });
    for (let i = parts.length; i < previousParts; i++) {
      await this.db.doc(`${this.base}/${study.id}/parts/${i}`).delete().catch(() => undefined);
    }
    this.remember(study.id, { local: sha, remote: sha });
    return head;
  }

  /**
   * One full exchange: pull what changed elsewhere, push what changed here. Returns the pulled studies
   * (the caller puts them in the store by id, so edits made meanwhile to other studies are kept).
   */
  async exchange(allLocal: Study[]): Promise<{ pulled: Study[]; added: number; pushed: number; skipped: number }> {
    const local = allLocal.filter(syncable);
    const heads = await this.heads();
    const byId = new Map(local.map((s) => [s.id, s]));
    const pulled: Study[] = [];
    let added = 0;
    let pushed = 0;
    let skipped = 0;
    for (const head of heads.values()) {
      if (!syncable(head)) {
        await this.remove(head);
        continue;
      }
      const mine = byId.get(head.id);
      const localInfo = mine ? { sha: sha256Hex(studyJson(mine)), updatedAt: mine.updatedAt ?? "" } : undefined;
      const way = decide(localInfo, { sha: head.sha256, savedAt: head.savedAt }, this.state[head.id]);
      if (way === "same") {
        if (localInfo) this.remember(head.id, { local: localInfo.sha, remote: head.sha256 });
        continue;
      }
      if (way === "pull") {
        const study = await this.download(head);
        if (!study) {
          skipped++;
          continue;
        }
        pulled.push(study);
        if (!mine) added++;
        this.remember(head.id, { local: sha256Hex(studyJson(study)), remote: head.sha256 });
      } else if (mine) {
        await this.upload(mine, head.parts);
        pushed++;
      }
    }
    for (const s of local) {
      if (heads.has(s.id)) continue;
      await this.upload(s);
      pushed++;
    }
    return { pulled, added, pushed, skipped };
  }

  /** Delete a head and its parts (used for seed studies an earlier version synced). */
  private async remove(head: Head): Promise<void> {
    for (let i = 0; i < head.parts; i++) {
      await this.db.doc(`${this.base}/${head.id}/parts/${i}`).delete().catch(() => undefined);
    }
    await this.db.doc(`${this.base}/${head.id}`).delete().catch(() => undefined);
  }

  /** Push only: studies whose content changed since they were last synced from this browser. */
  async pushChanged(local: Study[]): Promise<number> {
    let pushed = 0;
    for (const s of local.filter(syncable)) {
      const sha = sha256Hex(studyJson(s));
      if (this.state[s.id]?.local === sha) continue;
      await this.upload(s);
      pushed++;
    }
    return pushed;
  }
}

/** Put pulled studies into a list by id: replace a study with the same id, or add a new one first. */
export function applyPulled(current: Study[], pulled: Study[]): Study[] {
  const next = [...current];
  for (const p of pulled) {
    const at = next.findIndex((s) => s.id === p.id);
    if (at >= 0) next[at] = p;
    else next.unshift(p);
  }
  return next;
}
