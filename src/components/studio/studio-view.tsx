import { Link, useNavigate } from "@tanstack/react-router";
import { Check, ChevronLeft, Download, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wordmark } from "@/components/brand/wordmark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { getMeridianRuntime } from "@/lib/ai";
import { downloadStudyJson } from "@/lib/export";
import { GUIDELINES, VERIFY_SOURCES } from "@/lib/guidelines";
import { FAMILY_META, STAGES, familyOf } from "@/lib/stages";
import { runtimeMeta, setRuntimeMeta } from "@/lib/runtime-meta";
import { useStudio } from "@/lib/store";
import type { StageId, Study, StudyFamily } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StageFrame } from "./stage-frame";
import { StagePanel } from "./stage-panels";
import { studyStatus } from "@/lib/status";

const SCENARIO_MODE = import.meta.env.VITE_SCENARIO_MODE === "true";

export function StudioView({ study, stage }: { study: Study; stage: StageId }) {
  const family = familyOf(study.family);
  const done = study.completedStages.filter((s) => !(study.needsReview ?? []).includes(s)).length;
  const pct = Math.round((done / STAGES.length) * 100);
  const related = GUIDELINES.filter(
    (g) => g.families === "all" || (study.family ? g.families.includes(study.family) : false),
  ).slice(0, 6);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [modelMode, setModelMode] = useState(runtimeMeta().modelMode);
  const setFamily = useStudio((s) => s.setFamily);
  const backupFailure = useStudio((s) => s.backupFailure);

  useEffect(() => {
    void getMeridianRuntime()
      .then((r) => {
        if (r && typeof r === "object" && "mode" in r) {
          setRuntimeMeta({ modelMode: r.mode, replayKey: study.replayKey ?? null });
          setModelMode(r.mode);
        }
      })
      .catch(() => undefined);
  }, [study.replayKey]);

  return (
    <div className="flex min-h-dvh bg-background" data-meridian-hydrated="true" data-meridian-stage-panel={stage}>
      <aside className="sticky top-0 hidden h-dvh w-[17.5rem] shrink-0 flex-col bg-spine text-spine-foreground lg:flex">
        <div className="px-5 py-5">
          <Wordmark invert />
        </div>
        <div className="px-5 pb-4">
          <p className="text-[11px] uppercase tracking-[0.16em] text-spine-muted">This study</p>
          <p className="mt-1 font-display text-lg font-medium leading-snug">{study.title}</p>
          <p className="mt-1 text-xs text-spine-muted">{family.label}</p>
          {study.design.decisions?.length ? (
            <ul className="mt-2 space-y-0.5 text-xs text-spine-muted" data-meridian-decision-status-list="">
              {study.design.decisions.map((d) => (
                <li key={d.id} data-meridian-decision-status={d.selectionStatus ?? d.status}>
                  {d.selectionStatus ?? d.status} {d.actionStatus ?? "blocked"}
                </li>
              ))}
            </ul>
          ) : null}
          <label className="mt-2 block text-[10px] uppercase tracking-[0.14em] text-spine-muted">
            Family
            <select
              className="mt-1 w-full rounded-md border border-spine-foreground/30 bg-spine px-2 py-1 text-xs text-spine-foreground"
              data-meridian-field="family"
              value={study.family ?? ""}
              onChange={(e) =>
                setFamily(study.id, (e.target.value || null) as StudyFamily | null)
              }
            >
              <option value="">undetermined</option>
              {FAMILY_META.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {study.family == null ? (
            <div className="mt-2">
              <p className="text-xs text-spine-muted">Design undetermined — choose a family before routing.</p>
            </div>
          ) : null}
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-spine-foreground/15">
            <div className="h-full bg-spine-foreground/85" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 font-mono text-[11px] tabular-nums text-spine-muted">
            {done}/{STAGES.length} stages
          </p>
          {!study.scan.gradeOverall && (study.scan.items.length > 0 || (study.scan.retrievalEvents ?? []).length > 0) ? (
            <p className="mt-2 text-xs text-spine-muted">Certainty not assessed</p>
          ) : null}
          {study.scan.items.some((i) => i.grade === "unrated") ? (
            <p className="text-xs text-spine-muted">unrated</p>
          ) : null}
        </div>
        <ScrollArea className="flex-1 px-2 pb-6">
          <PipelineList study={study} stage={stage} invert />
        </ScrollArea>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur-sm sm:px-5">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open stages">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="bg-spine p-0 text-spine-foreground">
              <SheetHeader>
                <SheetTitle className="text-spine-foreground">Stages</SheetTitle>
              </SheetHeader>
              <div className="px-2 pb-8">
                <PipelineList study={study} stage={stage} invert />
              </div>
            </SheetContent>
          </Sheet>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ChevronLeft className="size-4" />
              All studies
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              const result = downloadStudyJson(study);
              const embed = result.inIframe ? " Preview iframe: clipboard copy used (downloads may be blocked)." : "";
              const msg = `Exported ${result.filename} (${result.bytes} bytes).${embed}`;
              setExportNote(msg);
              toast.success(msg);
            }}
          >
            <Download className="size-4" />
            Export JSON
          </Button>
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <Badge variant="secondary">{family.short}</Badge>
            {study.design.decisions?.length ? (
              <span className="text-xs text-muted-foreground" data-meridian-decision-status-list="">
                {study.design.decisions.map((d) => `${d.selectionStatus ?? d.status} ${d.actionStatus ?? "blocked"}`).join(" · ")}
              </span>
            ) : null}
            {SCENARIO_MODE && modelMode === "replay" ? <Badge variant="outline">model replay</Badge> : null}
            {SCENARIO_MODE && modelMode === "replay" && study.replayKey ? (
              <Badge variant="outline">replay {study.replayKey}</Badge>
            ) : null}
          </div>
        </header>
        {exportNote ? (
          <p className="border-b border-border bg-muted/50 px-4 py-2 text-sm" data-meridian-export-confirm="">
            {exportNote} Same bytes copied to the clipboard when the browser allows it.
          </p>
        ) : null}
        {backupFailure && !backupFailure.written ? (
          <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm" data-meridian-backup-failure="">
            Study backup could not be written ({backupFailure.reason ?? "storage failure"}). The last saved original was kept.
          </p>
        ) : null}

        <div className="lg:hidden">
          <div className="flex gap-2 overflow-x-auto px-3 py-3">
            {STAGES.map((s) => {
              const on = s.id === stage;
              const review = (study.needsReview ?? []).includes(s.id);
              const complete = study.completedStages.includes(s.id) && !review;
              return (
                <StageChip key={s.id} studyId={study.id} id={s.id} n={s.n} label={review ? `${s.label} (review required)` : s.label} on={on} complete={complete} />
              );
            })}
          </div>
        </div>

        <div className="flex flex-1">
          <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">
            <StudyStatusPanel study={study} />
            <StageFrame study={study} stage={stage}>
              <StagePanel study={study} stage={stage} />
            </StageFrame>
          </main>
          <aside className="hidden w-72 shrink-0 border-l border-border xl:block">
            <div className="sticky top-16 space-y-6 p-5">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Reporting spine
                </p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {family.reporting.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Nearby guidelines
                </p>
                <ul className="mt-2 space-y-2 text-sm leading-snug">
                  {related.map((g) => (
                    <li key={g.id}>
                      <span className="font-medium">{g.name}</span>
                      <span className="block text-xs text-muted-foreground">{g.useWhen}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Verify elsewhere
                </p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {VERIFY_SOURCES.slice(0, 6).map((s) => (
                    <li key={s.name}>
                      <a href={s.href} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                        {s.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function PipelineList({
  study,
  stage,
  invert,
}: {
  study: Study;
  stage: StageId;
  invert?: boolean;
}) {
  return (
    <ol className="space-y-0.5">
      {STAGES.map((s) => {
        const on = s.id === stage;
        const review = (study.needsReview ?? []).includes(s.id);
        const complete = study.completedStages.includes(s.id) && !review;
        return (
          <li key={s.id}>
            <StageLink
              studyId={study.id}
              id={s.id}
              n={s.n}
              label={review ? `${s.label} (review required)` : s.label}
              on={on}
              complete={complete}
              invert={invert}
            />
          </li>
        );
      })}
    </ol>
  );
}

function StageLink({
  studyId,
  id,
  n,
  label,
  on,
  complete,
  invert,
}: {
  studyId: string;
  id: StageId;
  n: string;
  label: string;
  on: boolean;
  complete: boolean;
  invert?: boolean;
}) {
  const navigate = useNavigate();
  const setStage = useStudio((s) => s.setStage);
  return (
    <button
      type="button"
      data-meridian-stage={id}
      onClick={() => {
        setStage(studyId, id);
        navigate({ to: "/studio/$studyId", params: { studyId }, search: { stage: id } });
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
        invert
          ? on
            ? "bg-spine-foreground/12 text-spine-foreground"
            : "text-spine-muted hover:bg-spine-foreground/8 hover:text-spine-foreground"
          : on
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span className="font-mono text-[10px] tabular-nums opacity-70">{n}</span>
      <span className="flex-1">{label}</span>
      {complete ? <Check className="size-3.5 opacity-80" /> : null}
    </button>
  );
}

function StageChip({
  studyId,
  id,
  n,
  label,
  on,
  complete,
}: {
  studyId: string;
  id: StageId;
  n: string;
  label: string;
  on: boolean;
  complete: boolean;
}) {
  const navigate = useNavigate();
  const setStage = useStudio((s) => s.setStage);
  return (
    <button
      type="button"
      data-meridian-stage={id}
      onClick={() => {
        setStage(studyId, id);
        navigate({ to: "/studio/$studyId", params: { studyId }, search: { stage: id } });
      }}
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-sm",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
      )}
    >
      <span className="font-mono text-[10px]">{n}</span>
      {label}
      {complete ? <Check className="size-3.5" /> : null}
    </button>
  );
}


/** Where the study stands, in four lines, and the next useful step. Derived; never edits the study. */
function StudyStatusPanel({ study }: { study: Study }) {
  const st = studyStatus(study);
  const navigate = useNavigate();
  const setStage = useStudio((s) => s.setStage);
  const e = st.evidence;
  return (
    <section className="mx-auto mb-6 max-w-3xl rounded-xl border border-border bg-card/60 p-4 text-sm" data-meridian-status="">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Where this study stands</p>
      <ul className="mt-2 space-y-1">
        <li data-meridian-status-evidence="">
          Evidence: {e.records} records, {e.retrieved + e.verified} from real searches ({e.verified} identity-checked
          {e.mismatch ? `, ${e.mismatch} mismatched` : ""}), {e.withText} with stored text{e.leads ? `, ${e.leads} unverified model leads` : ""}
          {e.withdrawn ? `, ${e.withdrawn} retracted or withdrawn` : ""}.
        </li>
        <li data-meridian-status-claims="">
          Claims: {st.claims.total} in the ledger, {st.claims.supported} checked against the source text
          {st.claims.notSupported ? `, ${st.claims.notSupported} not supported by it` : ""}
          {st.claims.unchecked ? `, ${st.claims.unchecked} not checkable` : ""}.
        </li>
        <li data-meridian-status-decisions="">
          Decisions: {st.decisions.accepted} accepted, {st.decisions.proposed} waiting for you, {st.decisions.stale} stale,{" "}
          {st.decisions.ready} ready to act on. Local facts entered: {st.localFacts}.
        </li>
        {st.review.length ? <li>Needs re-review: {st.review.join(", ")}.</li> : null}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-medium" data-meridian-next-step="">Next: {st.next.text}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setStage(study.id, st.next.stage);
            navigate({ to: "/studio/$studyId", params: { studyId: study.id }, search: { stage: st.next.stage } });
          }}
        >
          Go to {st.next.stage}
        </Button>
      </div>
    </section>
  );
}
