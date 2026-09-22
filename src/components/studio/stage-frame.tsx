import { Loader2, ScanSearch } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { runMeridian } from "@/lib/ai";
import { compactStudy } from "@/lib/compact";
import { formatPartialApplyNotice } from "@/lib/contracts";
import { STAGE_BY_ID } from "@/lib/stages";
import { useStudio } from "@/lib/store";
import { studyRevision } from "@/lib/evidence/decision";
import { setRuntimeMeta } from "@/lib/runtime-meta";
import type { StageId, Study } from "@/lib/types";
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
  const markComplete = useStudio((s) => s.markComplete);
  const [busy, setBusy] = useState(false);
  const [steer, setSteer] = useState("");

  async function illuminate() {
    setBusy(true);
    try {
      const expectedRevision = studyRevision(study);
      const retrieved = study.scan.items.some(
        (i) => i.provenance?.status === "retrieved" || i.provenance?.status === "verified",
      );
      const res = await runMeridian({
        data: {
          stage,
          family: study.family,
          compact: compactStudy(study, stage),
          instruction: steer || undefined,
          replayKey: SCENARIO_MODE ? study.replayKey : undefined,
          scanPurpose: stage === "scan" ? (retrieved ? "appraisal" : "discovery") : undefined,
        },
      });
      if (!res || typeof res !== "object" || !("ok" in res) || !res.ok) {
        const message =
          res && typeof res === "object" && "error" in res && typeof res.error === "string"
            ? res.error
            : "Generation failed.";
        toast.error(message);
        recordIlluminateFailure(study.id, stage, message);
        return;
      }
      if ("modelMode" in res && (res.modelMode === "live" || res.modelMode === "replay")) {
        setRuntimeMeta({ modelMode: res.modelMode, replayKey: study.replayKey ?? null });
      }
      const payload = JSON.parse(res.json) as Record<string, unknown>;
      const result = illuminateApply(study.id, stage, payload, expectedRevision);
      if (!result.ok) {
        const issues = result.issues?.map((i) => `${i.path}: ${i.code}`).join("; ");
        toast.error(
          result.reason === "stale"
            ? "Study changed while the model was working; the reply was not applied."
            : result.reason === "rejected"
              ? `Model output was rejected; nothing applied.${issues ? ` ${issues}` : ""}`
              : result.summary || "Nothing applied.",
        );
        return;
      }
      const partial = result.issues?.length ? formatPartialApplyNotice(result.issues) : "";
      if (partial) toast.warning(partial);
      else if (result.complete) toast.success(result.summary);
      else toast.message(result.summary, { description: "Scan not marked complete: no retrieved records." });
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
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button onClick={illuminate} disabled={busy} className="shrink-0" data-meridian-illuminate="">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
            {busy ? "Working" : "Illuminate"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            data-meridian-mark-complete=""
            onClick={() => markComplete(study.id, stage)}
          >
            Mark complete
          </Button>
        </div>
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
