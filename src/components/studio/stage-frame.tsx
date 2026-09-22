import { Loader2, ScanSearch } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { runMeridian } from "@/lib/ai";
import { compactStudy, scanAppraisalBatches } from "@/lib/compact";
import { formatPartialApplyNotice } from "@/lib/contracts";
import { STAGE_BY_ID } from "@/lib/stages";
import { useStudio } from "@/lib/store";
import { studyRevision } from "@/lib/evidence/decision";
import { setRuntimeMeta } from "@/lib/runtime-meta";
import type { ModelRun, StageId, Study } from "@/lib/types";
import { sha256Hex } from "@/lib/evidence/hash";
import { nowIso, uid } from "@/lib/utils";
import { Kicker } from "./bits";

const SCENARIO_MODE = import.meta.env.VITE_SCENARIO_MODE === "true";

export function StageFrame({
  study,
  stage,
  children,
}: {
  study: Study;
  stage: StageId;
  children: ReactNode;
}) {
  const meta = STAGE_BY_ID[stage];
  const illuminateApply = useStudio((s) => s.illuminateApply);
  const recordIlluminateFailure = useStudio((s) => s.recordIlluminateFailure);
  const recordModelRun = useStudio((s) => s.recordModelRun);
  const [busy, setBusy] = useState(false);
  const [steer, setSteer] = useState("");

  /** One model call for this stage (or one appraisal batch), applied and recorded as a ModelRun. */
  async function callOnce(
    study: Study,
    opts: { recordIds?: string[]; batch?: { index: number; of: number } } = {},
  ): Promise<{ ok: boolean; message?: string; complete?: boolean; summary?: string; issues?: { path: string; code: string; message?: string }[]; reason?: string }> {
    const expectedRevision = studyRevision(study);
    const retrieved = study.scan.items.some(
      (i) => i.provenance?.status === "retrieved" || i.provenance?.status === "verified",
    );
    const scanPurpose = stage === "scan" ? (retrieved ? "appraisal" : "discovery") : undefined;
    const compact = compactStudy(study, stage, opts.recordIds ? { recordIds: opts.recordIds, batch: opts.batch } : {});
    const at = nowIso();
    const res = await runMeridian({
      data: {
        stage,
        family: study.family,
        compact,
        instruction: steer || undefined,
        replayKey: SCENARIO_MODE ? study.replayKey : undefined,
        scanPurpose,
      },
    });
    const meta = res && typeof res === "object" && "run" in res ? (res as { run?: Partial<ModelRun> }).run : undefined;
    const record = (outcome: ModelRun["outcome"], issues: number, note?: string) =>
      recordModelRun(study.id, {
        id: uid("run"),
        at,
        stage,
        ...(scanPurpose ? { purpose: scanPurpose } : {}),
        provider: meta?.provider ?? "unknown",
        model: meta?.model ?? null,
        mode: res && typeof res === "object" && "modelMode" in res && res.modelMode === "replay" ? "replay" : "live",
        promptSha256: meta?.promptSha256 ?? null,
        contextSha256: sha256Hex(compact),
        contextChars: compact.length,
        ...(steer ? { instructionSha256: sha256Hex(steer) } : {}),
        outputSha256: meta?.outputSha256 ?? null,
        elapsedMs: typeof meta?.elapsedMs === "number" ? meta.elapsedMs : null,
        ...(meta?.usage ? { usage: meta.usage } : {}),
        outcome,
        issues,
        requestRevision: expectedRevision,
        ...(opts.recordIds && opts.batch ? { batch: { index: opts.batch.index, of: opts.batch.of, recordIds: opts.recordIds } } : {}),
        ...(note ? { note } : {}),
      });
    if (!res || typeof res !== "object" || !("ok" in res) || !res.ok) {
      const message =
        res && typeof res === "object" && "error" in res && typeof res.error === "string" ? res.error : "Generation failed.";
      recordIlluminateFailure(study.id, stage, message);
      record("failed", 0, message);
      return { ok: false, message };
    }
    if ("modelMode" in res && (res.modelMode === "live" || res.modelMode === "replay")) {
      setRuntimeMeta({ modelMode: res.modelMode, replayKey: study.replayKey ?? null });
    }
    const payload = JSON.parse(res.json) as Record<string, unknown>;
    const result = illuminateApply(study.id, stage, payload, expectedRevision, opts.recordIds ? { appraisedRecordIds: opts.recordIds } : undefined);
    record(result.ok ? "applied" : result.reason === "stale" ? "stale" : "refused", result.issues?.length ?? 0, result.ok ? undefined : result.reason);
    return { ok: result.ok, complete: result.complete, summary: result.summary, issues: result.issues, reason: result.reason };
  }

  async function illuminate() {
    setBusy(true);
    try {
      const fresh = () => useStudio.getState().studies.find((x) => x.id === study.id) ?? study;
      const appraising =
        stage === "scan" &&
        study.scan.items.some((i) => i.provenance?.status === "retrieved" || i.provenance?.status === "verified");
      // Appraisal shows every record whole; a set too large for one call runs in batches (S4/D6).
      const batches = appraising ? scanAppraisalBatches(study) : [];
      if (batches.length > 1) {
        let applied = 0;
        const notes: string[] = [];
        for (let i = 0; i < batches.length; i++) {
          const r = await callOnce(fresh(), { recordIds: batches[i], batch: { index: i + 1, of: batches.length } });
          if (!r.ok) {
            toast.error(`Appraisal batch ${i + 1} of ${batches.length} not applied: ${r.message ?? r.reason ?? "refused"}. Earlier batches stay applied.`);
            return;
          }
          applied++;
          if (r.issues?.length) notes.push(formatPartialApplyNotice(r.issues));
        }
        if (notes.length) toast.warning(`Appraised ${applied} batches. ${notes.join(" ")}`);
        else toast.success(`Appraised ${batches.flat().length} records in ${applied} batches.`);
        return;
      }
      const r = await callOnce(fresh());
      if (!r.ok) {
        const issues = r.issues?.map((i) => `${i.path}: ${i.code}`).join("; ");
        toast.error(
          r.message
            ? r.message
            : r.reason === "stale"
              ? "Study changed while the model was working; the reply was not applied."
              : r.reason === "rejected"
                ? `Model output was rejected; nothing applied.${issues ? ` ${issues}` : ""}`
                : r.summary || "Nothing applied.",
        );
        return;
      }
      const partial = r.issues?.length ? formatPartialApplyNotice(r.issues) : "";
      if (partial) toast.warning(partial);
      else if (r.complete) toast.success(r.summary ?? "Applied.");
      else toast.message(r.summary ?? "Applied.", { description: "Scan not marked complete: no retrieved records." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed.";
      recordIlluminateFailure(study.id, stage, message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  const last = study.lastIlluminate;
  const partialNotice =
    last && last.ok && last.stage === stage && last.issues?.length
      ? formatPartialApplyNotice(last.issues)
      : "";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Kicker>
            {meta.n} · {meta.kicker}
          </Kicker>
          <h1 className="mt-1 font-display text-3xl font-medium tracking-tight sm:text-4xl">
            {meta.label}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{meta.hint}</p>
        </div>
        <Button onClick={illuminate} disabled={busy} className="shrink-0" data-meridian-illuminate="">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
          {busy ? "Working" : "Illuminate"}
        </Button>
      </div>
      {partialNotice ? (
        <p
          role="status"
          data-meridian-partial-apply=""
          className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
        >
          {partialNotice}
        </p>
      ) : null}
      <label className="mb-8 block">
        <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Steer this stage (optional)
        </span>
        <Textarea
          value={steer}
          onChange={(e) => setSteer(e.target.value)}
          rows={2}
          placeholder="e.g. stay with SQUIRE, do not propose an RCT; primary outcome must be function."
          className="min-h-16"
        />
      </label>
      {children}
    </div>
  );
}
