import type { Study } from "./types";
import { studyRevision } from "./evidence/decision";
import { runtimeMeta } from "./runtime-meta";
import { migrateStudy } from "./defaults";

export interface ExportEnvelope {
  study: Study;
  meta: { modelMode: string; replayKey: string | null };
}

/** Schema-4 study JSON for investigator backup. New in 2026-09-22 (A2 item 7). R1 adds meta. */
export function studyToJson(study: Study): string {
  const envelope = {
    ...study,
    meta: {
      modelMode: runtimeMeta().modelMode,
      replayKey: study.replayKey ?? runtimeMeta().replayKey ?? null,
    },
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function parseExportedStudy(json: string): { study: Study; meta?: { modelMode?: string; replayKey?: string | null } } {
  const parsed = JSON.parse(json) as Study & { meta?: { modelMode?: string; replayKey?: string | null } };
  const { meta, ...rest } = parsed;
  return { study: migrateStudy(rest), meta };
}

export function exportEnvironment(): { inIframe: boolean; clipboard: boolean } {
  const inIframe = typeof window !== "undefined" && window.self !== window.top;
  const clipboard = typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
  return { inIframe, clipboard };
}

type FileSaver = (filename: string, data: string | Blob, type: string) => Promise<void>;
let fileSaver: FileSaver | null = null;

/**
 * Where a download goes. A page served on its own uses a link click; the Cowork edition registers
 * the viewer's save prompt instead, because an artifact frame ignores link downloads.
 */
export function setFileSaver(saver: FileSaver | null): void {
  fileSaver = saver;
}

/**
 * Offer a file to the investigator: the registered saver (Cowork: the viewer's save prompt) or one link
 * click. One investigator click produces one download (D22: a single click event, never also click()).
 */
export async function saveFile(filename: string, data: string | Blob, type: string): Promise<void> {
  if (fileSaver) {
    await fileSaver(filename, data, type);
    return;
  }
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  queueMicrotask(() => {
    a.remove();
    URL.revokeObjectURL(url);
  });
}

/**
 * One investigator click produces one download. D22: dispatch a single click event; do not also call click().
 */
export function downloadStudyJson(study: Study): { filename: string; bytes: number; revision: string; json: string; inIframe: boolean } {
  const json = studyToJson(study);
  const filename = `meridian-study-${study.id}.json`;
  const blob = new Blob([json], { type: "application/json" });
  if (fileSaver) {
    void fileSaver(filename, json, "application/json").catch(() => undefined);
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.setAttribute("data-meridian-export", study.id);
    document.body.appendChild(a);
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    queueMicrotask(() => {
      a.remove();
      URL.revokeObjectURL(url);
    });
  }
  const env = exportEnvironment();
  if (env.clipboard) {
    void navigator.clipboard.writeText(json).catch(() => undefined);
  }
  return { filename, bytes: blob.size, revision: studyRevision(study), json, inIframe: env.inIframe };
}
