/**
 * D25: immutable byte backup of the persisted studio JSON before a destructive
 * migration or same-version repair. A stale or corrupt backup.N.* key does not
 * prove the current original is recoverable. Autosaves do not write extra copies.
 *
 * A same-version schema-4 rehydrate that fills documents:[] or claim.origin
 * without adding repairsApplied ids is still a reconciliation: the pre-repair
 * raw is backed up (or the main write is refused) the same as a marked repair.
 */

export interface BackupReport {
  written: boolean;
  key?: string;
  reason?: string;
  at?: string;
}

export interface BackupStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
  key?(index: number): string | null;
  length?: number;
}

export const MAIN_KEY = "meridian-studio-v2";
export const FAIL_KEY = "meridian-studio-v2.backup-failure";
const PREFIX = "meridian-studio-v2.backup.";

export function backupKey(fromVersion: number, at: string): string {
  return `${PREFIX}${fromVersion}.${at}`;
}

function backupKeysForVersion(storage: BackupStorage, fromVersion: number): string[] {
  const needle = `${PREFIX}${fromVersion}.`;
  const keys: string[] = [];
  if (typeof storage.length === "number" && typeof storage.key === "function") {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(needle)) keys.push(k);
    }
  }
  return keys;
}

/** A backup proves `originalJson` recoverable only when its stored bytes equal it. */
export function findValidBackup(storage: BackupStorage, fromVersion: number, originalJson: string): string | undefined {
  for (const k of backupKeysForVersion(storage, fromVersion)) {
    if (storage.getItem(k) === originalJson) return k;
  }
  return undefined;
}

type PersistStudyHint = {
  id?: string;
  schemaVersion?: number;
  repairsApplied?: unknown;
  documents?: unknown;
  scan?: { claims?: unknown };
};
type PersistShape = { version: number | null; studies: PersistStudyHint[] };

function parsePersist(json: string): PersistShape | null {
  try {
    const p = JSON.parse(json) as unknown;
    if (!p || typeof p !== "object" || Array.isArray(p)) return null;
    const rec = p as Record<string, unknown>;
    const version = typeof rec.version === "number" ? rec.version : null;
    const state = rec.state && typeof rec.state === "object" && !Array.isArray(rec.state) ? (rec.state as Record<string, unknown>) : rec;
    const studies = Array.isArray(state.studies) ? state.studies : null;
    if (!studies) return null;
    return {
      version,
      studies: studies.filter((s): s is PersistStudyHint => !!s && typeof s === "object" && !Array.isArray(s)) as PersistStudyHint[],
    };
  } catch {
    return null;
  }
}

function repairIds(s: PersistStudyHint): string[] {
  return Array.isArray(s.repairsApplied) ? s.repairsApplied.filter((x): x is string => typeof x === "string") : [];
}

function claimOriginFilled(oldClaims: unknown, newClaims: unknown): boolean {
  if (!Array.isArray(oldClaims) || !Array.isArray(newClaims)) return false;
  const oldById = new Map<string, Record<string, unknown>>();
  for (const c of oldClaims) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    const rec = c as Record<string, unknown>;
    if (typeof rec.id === "string") oldById.set(rec.id, rec);
  }
  for (const c of newClaims) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    const rec = c as Record<string, unknown>;
    const oc = typeof rec.id === "string" ? oldById.get(rec.id) : undefined;
    if (oc && !Object.prototype.hasOwnProperty.call(oc, "origin") && Object.prototype.hasOwnProperty.call(rec, "origin")) {
      return true;
    }
  }
  return false;
}

/**
 * True when `next` filled fields that migrateStudy writes on rehydrate, including
 * documents:[] and claim.origin, even when repairsApplied is unchanged.
 */
export function migrationChangedStudy(os: PersistStudyHint, ns: PersistStudyHint): boolean {
  if ((os.schemaVersion ?? 0) !== (ns.schemaVersion ?? 0)) return true;
  const oldR = new Set(repairIds(os));
  if (repairIds(ns).some((id) => !oldR.has(id))) return true;
  if (!Array.isArray(os.documents) && Array.isArray(ns.documents)) return true;
  if (claimOriginFilled(os.scan?.claims, ns.scan?.claims)) return true;
  return false;
}

/**
 * True when `next` is a schema/repair write of `current`, not an investigator autosave.
 * Unreadable JSON is treated as needing a backup before overwrite.
 * Same-version rehydrate that adds documents or claim.origin is a reconciliation.
 */
export function isConsequentialReconciliation(current: string, next: string): boolean {
  if (current === next) return false;
  const a = parsePersist(current);
  const b = parsePersist(next);
  if (!a || !b) return true;
  if (a.version !== b.version) return true;
  const byId = new Map(a.studies.map((s) => [s.id, s]));
  for (const ns of b.studies) {
    const os = ns.id ? byId.get(ns.id) : undefined;
    if (!os) continue;
    if (migrationChangedStudy(os, ns)) return true;
  }
  return false;
}

export function writeImmutableBackup(
  storage: BackupStorage | undefined,
  fromVersion: number,
  originalJson: string,
  at: string,
): BackupReport {
  if (!storage) return { written: false, reason: "no backup written: no storage", at };
  const valid = findValidBackup(storage, fromVersion, originalJson);
  if (valid) return { written: true, key: valid, at };
  let key = backupKey(fromVersion, at);
  let n = 0;
  while (storage.getItem(key) != null && storage.getItem(key) !== originalJson) {
    n += 1;
    key = backupKey(fromVersion, `${at}.${n}`);
  }
  if (storage.getItem(key) === originalJson) return { written: true, key, at };
  try {
    storage.setItem(key, originalJson);
    if (storage.getItem(key) !== originalJson) {
      return { written: false, reason: "no backup written: verify failed", at };
    }
    return { written: true, key, at };
  } catch {
    return { written: false, reason: "no backup written: quota", at };
  }
}

export function persistBackupFailure(storage: BackupStorage | undefined, report: BackupReport): void {
  if (!storage) return;
  try {
    storage.setItem(FAIL_KEY, JSON.stringify(report));
  } catch {
    /* the failure itself cannot be stored; callers still refuse the main write */
  }
}

export function readBackupFailure(storage: BackupStorage | undefined): BackupReport | null {
  if (!storage) return null;
  const raw = storage.getItem(FAIL_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BackupReport;
  } catch {
    return { written: false, reason: "no backup written: unreadable failure record" };
  }
}

/**
 * Storage wrapper used by zustand persist. Backs up the current main value
 * before a consequential migration/repair overwrite. Autosaves write through.
 * If the backup cannot be written (or an existing key is stale/corrupt and a
 * new copy of the current original cannot be stored), the main value is left
 * unchanged and the failure is recorded.
 */
export function createGuardedStorage(inner: BackupStorage, fromVersion = 4): BackupStorage & { removeItem: (k: string) => void } {
  return {
    getItem: (k) => inner.getItem(k),
    removeItem: (k) => {
      inner.removeItem?.(k);
    },
    key: inner.key ? (i) => inner.key!(i) : undefined,
    get length() {
      return inner.length;
    },
    setItem(key, value) {
      if (key === MAIN_KEY) {
        const current = inner.getItem(key);
        if (current != null && current !== value && isConsequentialReconciliation(current, value)) {
          const at = new Date().toISOString().replace(/[:.]/g, "-");
          const report = writeImmutableBackup(inner, fromVersion, current, at);
          const proved = report.written && report.key != null && inner.getItem(report.key) === current;
          if (!proved) {
            persistBackupFailure(inner, {
              written: false,
              at,
              reason: report.reason ?? "no backup written: existing backup is not the current original",
            });
            return;
          }
        }
      }
      inner.setItem(key, value);
    },
  };
}

export function browserLocalStorage(): BackupStorage | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}
