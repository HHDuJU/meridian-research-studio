import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import { AppHeader, FinePrint } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FAMILY_GROUPS, FAMILY_META, familyOf, guessFamily, STAGES } from "@/lib/stages";
import { useStudio } from "@/lib/store";
import type { StudyFamily } from "@/lib/types";
import { formatDate } from "@/lib/utils";

const SCENARIO_MODE = import.meta.env.VITE_SCENARIO_MODE === "true";

export function HomePage() {
  const studies = useStudio((s) => s.studies);
  const restoreSeeds = useStudio((s) => s.restoreSeeds);
  const backupFailure = useStudio((s) => s.backupFailure);
  const navigate = useNavigate();
  const [rawNeed, setRawNeed] = useState("");
  const [setting, setSetting] = useState("Academic hospital, Ontario");
  const [constraints, setConstraints] = useState("");
  const [localFacts, setLocalFacts] = useState("");
  const [family, setFamily] = useState<StudyFamily | "auto">("auto");
  const [scenarioKey, setScenarioKey] = useState("");

  const suggested = useMemo(() => (rawNeed.trim() ? guessFamily(rawNeed) : null), [rawNeed]);

  function begin() {
    const text = rawNeed.trim();
    if (!text) return;
    const fam = family === "auto" ? suggested : family;
    const study = useStudio.getState().create({
      family: fam,
      setting: setting.trim() || "Unspecified setting",
      rawNeed: text,
      title: text.length > 72 ? `${text.slice(0, 70)}…` : text,
      replayKey: SCENARIO_MODE && scenarioKey.trim() ? scenarioKey.trim() : undefined,
      constraints: constraints.trim() || undefined,
      localFacts: localFacts.split("\n").map((l) => l.trim()).filter(Boolean),
    });
    navigate({ to: "/studio/$studyId", params: { studyId: study.id }, search: { stage: "problem" } });
  }

  return (
    <div className="min-h-dvh">
      <AppHeader />
      {backupFailure && !backupFailure.written ? (
        <p className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm" data-meridian-backup-failure="">
          Study backup could not be written ({backupFailure.reason ?? "storage failure"}). The last saved original was kept. New edits will not replace it until a backup succeeds.
        </p>
      ) : null}
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="grid gap-8 py-8 lg:grid-cols-[1.2fr_0.8fr] lg:gap-14 lg:py-10">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Anesthesia · Pain · Improvement science
            </p>
            <h1 className="mt-4 font-display text-[2.15rem] font-medium leading-[1.12] tracking-tight sm:text-5xl">
              The shortest true line through the evidence.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-[17px]">
              Meridian holds a study in one field of view — literature, context, gaps, design, ethics,
              and the people the work is for. Illuminate each stage. Verify every citation. Refuse
              complexity that does not earn its keep.
            </p>
          </div>
          <form
            className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)] sm:p-6"
            onSubmit={(e) => {
              e.preventDefault();
              begin();
            }}
          >
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Describe the problem
              </span>
              <Textarea
                className="mt-2 min-h-36 font-display text-base"
                value={rawNeed}
                onChange={(e) => setRawNeed(e.target.value)}
                placeholder="Adults with refractory neuropathic pain are being offered ketamine infusions with no shared protocol, and I am not sure the chairs are worth it…"
              />
            </label>
            <label className="mt-4 block">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Setting
              </span>
              <Input className="mt-2" value={setting} onChange={(e) => setSetting(e.target.value)} />
            </label>
            <label className="mt-4 block">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Constraints
              </span>
              <Textarea
                className="mt-2 min-h-16"
                value={constraints}
                onChange={(e) => setConstraints(e.target.value)}
                placeholder="Funding, time, data access, what must not change…"
              />
            </label>
            <label className="mt-4 block">
              <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Local facts you can document (optional, one per line)
              </span>
              <Textarea
                className="mt-2 min-h-16"
                value={localFacts}
                onChange={(e) => setLocalFacts(e.target.value)}
                data-meridian-local-facts-input=""
                placeholder="REB file 26-311 approved 2026-08-27 · Analyst time 0.2 FTE from January (memo CP-44)"
              />
            </label>
            <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Study family
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <FamilyChip
                label={`Suggest · ${suggested ? familyOf(suggested).label : "undetermined"}`}
                on={family === "auto"}
                onClick={() => setFamily("auto")}
              />
              {FAMILY_META.map((f) => (
                <FamilyChip key={f.id} label={f.label} on={family === f.id} onClick={() => setFamily(f.id)} />
              ))}
            </div>
            {family === "auto" && suggested == null && rawNeed.trim() ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Design undetermined — choose a family, or begin and choose later. Mixed methods is not substituted.
              </p>
            ) : null}
            {SCENARIO_MODE ? (
              <label className="mt-4 block">
                <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Scenario key
                </span>
                <Input
                  className="mt-2 font-mono"
                  value={scenarioKey}
                  onChange={(e) => setScenarioKey(e.target.value)}
                  placeholder="sc-000-level1"
                />
              </label>
            ) : null}
            <Button type="submit" className="mt-5 w-full sm:w-auto" disabled={!rawNeed.trim()}>
              Begin a study
              <ArrowRight className="size-4" />
            </Button>
          </form>
        </section>

        <section className="border-t border-border py-12">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Open studies</p>
              <h2 className="mt-1 font-display text-3xl font-medium tracking-tight">Work already on the desk</h2>
            </div>
            <Button variant="outline" size="sm" onClick={() => restoreSeeds()}>
              Restore examples
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {studies.map((s) => (
              <Link
                key={s.id}
                to="/studio/$studyId"
                params={{ studyId: s.id }}
                search={{ stage: s.currentStage }}
                className="group flex flex-col rounded-xl bg-card p-5 shadow-[var(--shadow-border)] transition-shadow duration-200 hover:shadow-[var(--shadow-border-hover)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{familyOf(s.family).label}</Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(s.updatedAt)}</span>
                </div>
                <h3 className="mt-3 font-display text-xl font-medium leading-snug group-hover:text-primary">
                  {s.title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{s.subtitle}</p>
                <p className="mt-4 text-xs text-muted-foreground">
                  {s.completedStages.filter((st) => !(s.needsReview ?? []).includes(st)).length}/{STAGES.length} stages · {s.setting}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className="border-t border-border py-12">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">How it works</p>
          <h2 className="mt-1 font-display text-3xl font-medium tracking-tight">Thirteen stages. One spine.</h2>
          <ol className="mt-8 grid gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-2 lg:grid-cols-3">
            {STAGES.map((s) => (
              <li key={s.id} className="bg-card p-5">
                <p className="font-mono text-[11px] text-muted-foreground">{s.n}</p>
                <p className="mt-1 font-display text-lg font-medium">{s.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.kicker}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-border py-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Method compass
              </p>
              <h2 className="mt-1 font-display text-3xl font-medium tracking-tight">
                The right reporting guideline, not a longer protocol.
              </h2>
            </div>
            <Button variant="outline" asChild>
              <Link to="/method">
                Open the compass
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FAMILY_GROUPS.map((g) => (
              <div key={g.id}>
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{g.label}</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {FAMILY_META.filter((f) => f.group === g.id).map((f) => (
                    <li key={f.id}>{f.label}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>
      <FinePrint />
    </div>
  );
}

function FamilyChip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-full border px-3 text-xs ${
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
