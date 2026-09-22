import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { chart } from "@/lib/chart-tokens";
import { familyOf } from "@/lib/stages";
import { emptySearchConfirmationValid, scanHasRetrievedRecord, scanMayComplete } from "@/lib/defaults";
import { evaluateDecision, decisionIsSupported } from "@/lib/evidence/decision";
import { useStudio } from "@/lib/store";
import type { GradeLevel, StageId, Study } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { EmptyHint, Field, GradeBadge, Panel, Prose, ScoreBar, VerifyBadge } from "./bits";
import { EvidenceGraph } from "./evidence-graph";

function patchProblem(study: Study, key: keyof Study["problem"], value: string) {
  useStudio.getState().mergeStage(study.id, "problem", { [key]: value });
}

export function StagePanel({ study, stage }: { study: Study; stage: StageId }) {
  switch (stage) {
    case "problem":
      return <ProblemPanel study={study} />;
    case "scan":
      return <ScanPanel study={study} />;
    case "map":
      return <MapPanel study={study} />;
    case "gaps":
      return <GapsPanel study={study} />;
    case "hypotheses":
      return <HypothesesPanel study={study} />;
    case "questions":
      return <QuestionsPanel study={study} />;
    case "design":
      return <DesignPanel study={study} />;
    case "protocol":
      return <ProtocolPanel study={study} />;
    case "stats":
      return <StatsPanel study={study} />;
    case "ethics":
      return <EthicsPanel study={study} />;
    case "voices":
      return <VoicesPanel study={study} />;
    case "manuscript":
      return <ManuscriptPanel study={study} />;
    case "audit":
      return <AuditPanel study={study} />;
  }
}

function ProblemPanel({ study }: { study: Study }) {
  const p = study.problem;
  return (
    <div className="grid gap-4">
      <Panel title="The itch, in the language you think in">
        <Field
          label="Raw need"
          value={p.rawNeed}
          rows={4}
          onChange={(v) => patchProblem(study, "rawNeed", v)}
          placeholder="What is going wrong, for whom, in what service?"
        />
      </Panel>
      <Panel title="Structured problem">
        <div className="grid gap-4">
          <Field label="Statement" value={p.statement} rows={4} onChange={(v) => patchProblem(study, "statement", v)} />
          <Field label="Who is affected" value={p.whoAffected} rows={3} onChange={(v) => patchProblem(study, "whoAffected", v)} />
          <Field label="What hurts" value={p.whatHurts} rows={3} onChange={(v) => patchProblem(study, "whatHurts", v)} />
          <Field label="Current practice" value={p.currentPractice} rows={3} onChange={(v) => patchProblem(study, "currentPractice", v)} />
          <Field label="Why now" value={p.whyNow} rows={3} onChange={(v) => patchProblem(study, "whyNow", v)} />
          <Field label="Constraints" value={p.constraints} rows={3} onChange={(v) => patchProblem(study, "constraints", v)} />
          <Field
            label="Patient-centred goal"
            value={p.patientCenteredGoal}
            rows={3}
            onChange={(v) => patchProblem(study, "patientCenteredGoal", v)}
          />
        </div>
      </Panel>
    </div>
  );
}

function ScanPanel({ study }: { study: Study }) {
  const s = study.scan;
  const merge = useStudio((st) => st.mergeStage);
  const confirmEmptySearch = useStudio((st) => st.confirmEmptySearch);
  const markComplete = useStudio((st) => st.markComplete);
  const retrieved = scanHasRetrievedRecord(study);
  const leadsOnly = s.items.length > 0 && !retrieved;
  const applyRetrieval = useStudio((st) => st.applyRetrieval);
  const SCENARIO_MODE = import.meta.env.VITE_SCENARIO_MODE === "true";
  const [retrieveBusy, setRetrieveBusy] = useState(false);
  const counts = ["high", "moderate", "low", "very-low"].map((g) => ({
    name: g === "very-low" ? "Very low" : g[0].toUpperCase() + g.slice(1),
    n: s.items.filter((i) => i.grade === g).length,
    fill:
      g === "high" ? chart.high : g === "moderate" ? chart.moderate : g === "low" ? chart.low : chart.veryLow,
  }));

  return (
    <div className="grid gap-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <GradeBadge grade={s.gradeOverall as GradeLevel | ""} />
          {!s.gradeOverall ? (
            <p className="text-sm text-muted-foreground">Certainty not assessed (no GRADE label).</p>
          ) : null}
          {leadsOnly ? (
            <p className="text-sm text-muted-foreground">leads only, evidence not inspected</p>
          ) : null}
          {s.completionWithdrawn && !scanMayComplete(study) ? (
            <p className="text-sm text-muted-foreground">Scan incomplete (no retrieved records).</p>
          ) : null}
          <Field label="Search query" value={s.query} onChange={(v) => merge(study.id, "scan", { query: v })} />
          <p className="mt-2 text-sm text-muted-foreground">{s.query || "No query stored yet."}</p>
        </div>
        {(study.design.decisions ?? []).some((d) => (d.selectionStatus ?? d.status) === "stale") ? (
          <p data-meridian-decision-stale="" className="mt-3 text-sm text-amber-700">
            An accepted decision is now stale; review required on Design.
          </p>
        ) : null}
        {SCENARIO_MODE ? (
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-meridian-retrieve=""
              disabled={retrieveBusy}
              onClick={() => {
                setRetrieveBusy(true);
                void (async () => {
                  try {
                    const res = await fetch("/__scenario/retrieve", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ key: study.replayKey ?? "", query: s.query }),
                    });
                    if (!res.ok) throw new Error(await res.text());
                    const data = (await res.json()) as {
                      event: Study["scan"]["retrievalEvents"][number];
                      items: Study["scan"]["items"];
                      documents: NonNullable<Study["documents"]>;
                    };
                    applyRetrieval(study.id, data);
                  } finally {
                    setRetrieveBusy(false);
                  }
                })();
              }}
            >
              {retrieveBusy ? "Retrieving" : "Run recorded search"}
            </Button>
          </div>
        ) : null}
        {s.unsupportedGradeOverall ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Earlier unsupported assignment ({s.unsupportedGradeOverall.value}, {s.unsupportedGradeOverall.status}):{" "}
            {s.unsupportedGradeOverall.reason}
          </p>
        ) : null}
        {s.gradeRationale ? <Prose className="mt-3">{s.gradeRationale}</Prose> : null}
        {s.sourcesConsulted.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {s.sourcesConsulted.map((src) => (
              <Badge key={src} variant="secondary">
                {src}
              </Badge>
            ))}
          </div>
        ) : null}
        {retrieved === false && s.items.filter((i) => i.provenance?.origin === "retrieval").length === 0 ? (
          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={emptySearchConfirmationValid(study)}
              onClick={() => {
                confirmEmptySearch(study.id);
                markComplete(study.id, "scan");
              }}
            >
              {emptySearchConfirmationValid(study)
                ? "Empty search confirmed"
                : "I confirm the search was run and returned no records"}
            </Button>
          </div>
        ) : null}
      </Panel>
      {s.items.length ? (
        <Panel title="Certainty across the set">
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={counts} barCategoryGap={18}>
                <CartesianGrid vertical={false} stroke={chart.wash} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: chart.stone }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} width={24} tick={{ fontSize: 11, fill: chart.stone }} axisLine={false} tickLine={false} />
                <RTooltip cursor={{ fill: "transparent" }} />
                <Bar dataKey="n" radius={[4, 4, 0, 0]}>
                  {counts.map((c) => (
                    <Cell key={c.name} fill={c.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      ) : null}
      <Panel title="Synthesis">
        {s.synthesis ? (
          <Field label="Reading of the body of evidence" value={s.synthesis} rows={7} onChange={(v) => merge(study.id, "scan", { synthesis: v })} />
        ) : (
          <EmptyHint>Illuminate this stage to rank a first evidence set. Every item is a lead until verified.</EmptyHint>
        )}
      </Panel>
      <div className="grid gap-3">
        {s.items.map((item) => (
          <article key={item.id} data-meridian-record={item.id} className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-display text-lg font-medium leading-snug">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.authors} · {item.year} · {item.source}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <GradeBadge grade={item.grade} />
                <VerifyBadge v={item.verification} status={item.provenance?.status} />
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed">{item.keyFindings}</p>
            <p className="mt-2 text-sm text-muted-foreground">{item.limitations}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Change key findings</span>
                <textarea
                  data-meridian-change-source="keyFindings"
                  data-record-id={item.id}
                  className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  defaultValue={item.keyFindings}
                  onBlur={(e) => {
                    if (e.target.value !== item.keyFindings) {
                      useStudio.getState().changeSource(study.id, { id: item.id }, "keyFindings", e.target.value);
                    }
                  }}
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Change year</span>
                <input
                  data-meridian-change-source="year"
                  data-record-id={item.id}
                  type="number"
                  className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  defaultValue={item.year ?? ""}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n !== item.year) {
                      useStudio.getState().changeSource(study.id, { id: item.id }, "year", n);
                    }
                  }}
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block text-muted-foreground">Change status</span>
                <select
                  data-meridian-change-source="status"
                  data-record-id={item.id}
                  className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  defaultValue={item.provenance?.status}
                  onChange={(e) => {
                    if (e.target.value !== item.provenance?.status) {
                      useStudio.getState().changeSource(study.id, { id: item.id }, "status", e.target.value);
                    }
                  }}
                >
                  <option value="unverified">unverified</option>
                  <option value="retrieved">retrieved</option>
                  <option value="verified">verified</option>
                  <option value="mismatch">mismatch</option>
                  <option value="check-failed">check-failed</option>
                  <option value="access-blocked">access-blocked</option>
                </select>
              </label>
              <label className="block text-xs sm:col-span-2">
                <span className="mb-1 block text-muted-foreground">Change abstract</span>
                <textarea
                  data-meridian-change-source="abstract"
                  data-record-id={item.id}
                  className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  defaultValue={item.abstract?.text ?? ""}
                  onBlur={(e) => {
                    if (e.target.value !== (item.abstract?.text ?? "")) {
                      useStudio.getState().changeSource(study.id, { id: item.id }, "abstract", e.target.value);
                    }
                  }}
                />
              </label>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <ScoreBar label="Method quality" value={item.methodQuality} />
              <ScoreBar label="Relevance" value={item.relevance} />
            </div>
            {item.contextTags.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.contextTags.map((t) => (
                  <Badge key={t} variant="outline">
                    {t}
                  </Badge>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function MapPanel({ study }: { study: Study }) {
  const m = study.map;
  const merge = useStudio((st) => st.mergeStage);
  return (
    <div className="grid gap-4">
      <Panel title="How the pieces talk to each other">
        {m.nodes.length ? <EvidenceGraph nodes={m.nodes} edges={m.edges} /> : <EmptyHint>Illuminate to draw the first map of evidence, context, and people.</EmptyHint>}
      </Panel>
      {m.contexts.length ? (
        <Panel title="Contexts in play">
          <div className="flex flex-wrap gap-1.5">
            {m.contexts.map((c) => (
              <Badge key={c} variant="secondary">
                {c}
              </Badge>
            ))}
          </div>
        </Panel>
      ) : null}
      <Panel title="Re-reading after the map">
        {m.reading ? (
          <Field label="What changed once context was in the room" value={m.reading} rows={6} onChange={(v) => merge(study.id, "map", { reading: v })} />
        ) : (
          <EmptyHint>The map is not a literature list. It is why a paper means something different in this service.</EmptyHint>
        )}
      </Panel>
    </div>
  );
}

function GapsPanel({ study }: { study: Study }) {
  const g = study.gaps;
  if (!g.items.length && !g.errorsFound.length) {
    return <EmptyHint>Illuminate to hunt gaps, method errors, and practice-change opportunities.</EmptyHint>;
  }
  return (
    <div className="grid gap-3">
      {g.reevaluation ? (
        <Panel title="Re-evaluation">
          <Prose>{g.reevaluation}</Prose>
        </Panel>
      ) : null}
      {g.items.map((item) => (
        <article key={item.id} className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={item.severity === "high" ? "low" : "outline"}>{item.severity}</Badge>
            <Badge variant="secondary">{item.kind}</Badge>
          </div>
          <h3 className="mt-2 font-display text-lg font-medium">{item.title}</h3>
          <p className="mt-2 text-sm leading-relaxed">{item.whyItMatters}</p>
          <p className="mt-2 text-sm text-muted-foreground">Opportunity — {item.opportunity}</p>
        </article>
      ))}
      {g.errorsFound.length ? (
        <Panel title="Errors and over-reads">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
            {g.errorsFound.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function HypothesesPanel({ study }: { study: Study }) {
  const h = study.hypotheses;
  const merge = useStudio((st) => st.mergeStage);
  if (!h.items.length) return <EmptyHint>Illuminate to rank hypotheses by need, novelty, practice-change, feasibility, and parsimony.</EmptyHint>;
  return (
    <div className="grid gap-3">
      {h.items.map((item) => {
        const selected = h.selectedId === item.id;
        return (
          <article
            key={item.id}
            className={`rounded-xl bg-card p-5 shadow-[var(--shadow-border)] ${selected ? "ring-1 ring-primary/40" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant={selected ? "default" : "outline"}>{selected ? "Selected" : "Candidate"}</Badge>
              <Button size="sm" variant="ghost" onClick={() => merge(study.id, "hypotheses", { selectedId: item.id })}>
                Prefer this
              </Button>
            </div>
            <p className="mt-2 font-display text-lg font-medium leading-snug">{item.statement}</p>
            <p className="mt-2 text-sm leading-relaxed">{item.rationale}</p>
            <p className="mt-2 text-sm text-muted-foreground">Risks — {item.risks}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <ScoreBar label="Need" value={item.need} />
              <ScoreBar label="Practice change" value={item.practiceChange} />
              <ScoreBar label="Novelty" value={item.novelty} />
              <ScoreBar label="Feasibility" value={item.feasibility} />
              <ScoreBar label="Parsimony" value={item.parsimony} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function QuestionsPanel({ study }: { study: Study }) {
  const q = study.questions;
  if (!q.items.length) return <EmptyHint>Illuminate to write the smallest question that is still worth answering.</EmptyHint>;
  return (
    <div className="grid gap-4">
      {q.items.map((item) => (
        <Panel key={item.id}>
          <Badge variant="secondary">{item.framework}</Badge>
          <p className="mt-3 font-display text-xl font-medium leading-snug">{item.text}</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Population</dt>
              <dd className="mt-1">{item.population}</dd>
            </div>
            {item.intervention ? (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Intervention</dt>
                <dd className="mt-1">{item.intervention}</dd>
              </div>
            ) : null}
            {item.comparator ? (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Comparator</dt>
                <dd className="mt-1">{item.comparator}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Outcome</dt>
              <dd className="mt-1">{item.outcome}</dd>
            </div>
            {item.time ? (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Time</dt>
                <dd className="mt-1">{item.time}</dd>
              </div>
            ) : null}
            {item.setting ? (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Setting</dt>
                <dd className="mt-1">{item.setting}</dd>
              </div>
            ) : null}
          </dl>
        </Panel>
      ))}
      {q.finer ? (
        <Panel title="FINER">
          <Prose>{q.finer}</Prose>
        </Panel>
      ) : null}
    </div>
  );
}

function DesignPanel({ study }: { study: Study }) {
  const d = study.design;
  const fam = familyOf(d.recommended || study.family);
  const acceptDecision = useStudio((st) => st.acceptDecision);
  const withdrawDecision = useStudio((st) => st.withdrawDecision);
  if (!d.rationale) return <EmptyHint>Illuminate to match the question to the simplest honest design.</EmptyHint>;
  return (
    <div className="grid gap-4">
      <Panel>
        <KickerLine>Recommended</KickerLine>
        <p className="mt-1 font-display text-2xl font-medium">{fam.label}</p>
        <p className="mt-1 text-sm text-muted-foreground">{fam.short}</p>
        <Prose className="mt-4">{d.rationale}</Prose>
      </Panel>
      {d.decisions.length ? (
        <Panel title="Decisions">
          <ul className="space-y-3">
            {d.decisions.map((dec, idx) => {
                const support = decisionIsSupported(dec, study);
                const ev = evaluateDecision(dec, study);
                return (
              <li key={dec.id} data-meridian-decision={dec.id} className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {dec.kind} · selection {dec.selectionStatus ?? dec.status} · action {dec.actionStatus ?? ev.actionStatus} · {dec.actor}
                </p>
                <p className="mt-1 text-sm leading-relaxed">{dec.statement}</p>
                {!support.ok ? (
                  <p data-meridian-decision-refusal="" className="mt-2 text-sm text-amber-700">
                    {support.reason}
                  </p>
                ) : null}
                {ev.blockers.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">{ev.blockers.join("; ")}</p>
                ) : null}
                {(dec.selectionStatus ?? dec.status) === "proposed" ? (
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        const r = acceptDecision(study.id, idx);
                        if (!r.ok) toast.warning(r.reason ?? "Accept refused");
                      }}
                    >
                      Accept
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => withdrawDecision(study.id, idx)}>
                      Withdraw
                    </Button>
                  </div>
                ) : null}
              </li>
                );
              })}
          </ul>
        </Panel>
      ) : null}
      <Panel title="Why not more complex">
        <Prose>{d.whyNotMoreComplex}</Prose>
      </Panel>
      {d.alternatives.length ? (
        <Panel title="Rejected alternatives">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
            {d.alternatives.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {d.guidelines.length ? (
        <div className="flex flex-wrap gap-1.5">
          {d.guidelines.map((g) => (
            <Badge key={g}>{g}</Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KickerLine({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{children}</p>
  );
}

function ProtocolPanel({ study }: { study: Study }) {
  const p = study.protocol;
  if (!p.overview) return <EmptyHint>Illuminate to draft a feasible protocol with one primary outcome and named bias controls.</EmptyHint>;
  return (
    <div className="grid gap-4">
      <Panel title="Overview">
        <Prose>{p.overview}</Prose>
      </Panel>
      <Panel title="Who, what, how">
        <div className="grid gap-3 text-sm leading-relaxed">
          <p>
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Population. </span>
            {p.population}
          </p>
          <p>
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Exposure. </span>
            {p.exposure}
          </p>
          <p>
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Procedures. </span>
            {p.procedures}
          </p>
        </div>
      </Panel>
      {p.outcomes.length ? (
        <Panel title="Outcomes — one primary">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Measure</th>
                  <th className="py-2 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {p.outcomes.map((o) => (
                  <tr key={o.id} className="border-b border-border/70 align-top">
                    <td className="py-2 pr-3">
                      <Badge variant={o.role === "primary" ? "default" : "outline"}>{o.role}</Badge>
                    </td>
                    <td className="py-2 pr-3 font-medium">
                      {o.name}
                      {o.patientCentered ? (
                        <span className="mt-1 block text-[11px] font-normal text-ok">Patient-centred</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {o.measure}
                      <span className="block text-[11px]">{o.timing}</span>
                    </td>
                    <td className="py-2">{o.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
      <Panel title="Parsimony">
        <div className="mb-3 flex items-end justify-between">
          <p className="font-display text-4xl font-medium tabular-nums">{p.parsimony.score}</p>
          <p className="text-xs text-muted-foreground">
            {p.parsimony.primaryOutcomeCount} primary · {p.parsimony.secondaryOutcomeCount} secondary ·{" "}
            {p.parsimony.covariateCount} covariates
          </p>
        </div>
        <Prose>{p.parsimony.simplestPath}</Prose>
        {p.parsimony.flags.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {p.parsimony.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : null}
      </Panel>
      <Panel title="Bias watch">
        <ul className="space-y-3">
          {p.biasFlags.map((b) => (
            <li key={b.id} className="text-sm">
              <Badge variant={b.severity === "high" ? "low" : b.severity === "ok" ? "high" : "outline"}>
                {b.severity}
              </Badge>
              <span className="ml-2 font-medium">{b.label}</span>
              <p className="mt-1 text-muted-foreground">{b.note}</p>
            </li>
          ))}
        </ul>
        {p.biasMitigation.length ? (
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {p.biasMitigation.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : null}
      </Panel>
      <Panel title="Feasibility">
        <Prose>{p.feasibility}</Prose>
      </Panel>
      {p.theoreticalFramework ? (
        <Panel title="Theoretical framework">
          <Prose>{p.theoreticalFramework}</Prose>
        </Panel>
      ) : null}
    </div>
  );
}

function StatsPanel({ study }: { study: Study }) {
  const s = study.stats;
  if (!s.primaryAnalysis) return <EmptyHint>Illuminate to pre-specify analysis, sample size, and overfitting guards.</EmptyHint>;
  return (
    <div className="grid gap-4">
      <Panel title="Design">
        <Prose>{s.designSummary}</Prose>
      </Panel>
      <Panel title="Sample size">
        <Prose>{s.sampleSize}</Prose>
      </Panel>
      <Panel title="Primary analysis">
        <Prose>{s.primaryAnalysis}</Prose>
      </Panel>
      <Panel title="Secondary analysis">
        <Prose>{s.secondaryAnalysis}</Prose>
      </Panel>
      <Panel title="Missing data">
        <Prose>{s.missingData}</Prose>
      </Panel>
      <Panel title="Multiplicity">
        <Prose>{s.multiplicity}</Prose>
      </Panel>
      <Panel title="Overfitting and over-optimisation">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
          {s.overfittingGuards.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </Panel>
      {s.software ? (
        <p className="text-sm text-muted-foreground">Software — {s.software}</p>
      ) : null}
    </div>
  );
}

function EthicsPanel({ study }: { study: Study }) {
  const e = study.ethics;
  if (!e.rebPath && !e.risks) return <EmptyHint>Illuminate for REB path, equity, cost, and partnership — not a boilerplate consent paragraph.</EmptyHint>;
  const cells = [
    ["Risks", e.risks],
    ["Consent", e.consent],
    ["Data", e.data],
    ["Equity", e.equity],
    ["Effectiveness", e.effectiveness],
    ["Efficiency", e.efficiency],
    ["Costs", e.costs],
    ["Grants", e.grants],
    ["Partnerships", e.partnerships],
    ["REB path", e.rebPath],
    ["Limits of this draft", e.limitations],
  ] as const;
  return (
    <div className="grid gap-3">
      {cells
        .filter(([, v]) => v)
        .map(([label, v]) => (
          <Panel key={label} title={label}>
            <Prose>{v}</Prose>
          </Panel>
        ))}
    </div>
  );
}

function VoicesPanel({ study }: { study: Study }) {
  const v = study.voices;
  if (!v.items.length && !v.partnershipPlan) {
    return <EmptyHint>Illuminate to bring patients, families, clinicians, and public discourse into the design — as partners, not ornaments.</EmptyHint>;
  }
  return (
    <div className="grid gap-4">
      {v.partnershipPlan ? (
        <Panel title="Partnership plan">
          <Prose>{v.partnershipPlan}</Prose>
        </Panel>
      ) : null}
      {v.socialListening ? (
        <Panel title="Field and public discourse">
          <Prose>{v.socialListening}</Prose>
        </Panel>
      ) : null}
      {v.items.map((item) => (
        <blockquote key={item.id} className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{item.source}</Badge>
            <VerifyBadge v={item.verification} />
          </div>
          <p className="mt-3 font-display text-xl font-medium italic leading-snug">“{item.quote}”</p>
          <p className="mt-3 text-sm font-medium">{item.theme}</p>
          <p className="mt-1 text-sm text-muted-foreground">{item.implication}</p>
        </blockquote>
      ))}
    </div>
  );
}

function ManuscriptPanel({ study }: { study: Study }) {
  const m = study.manuscript;
  if (!m.abstract && !m.title) {
    return <EmptyHint>Illuminate to draft IMRaD in the language of a serious journal — then edit it as a human.</EmptyHint>;
  }
  const sections = [
    ["Abstract", m.abstract],
    ["Introduction", m.introduction],
    ["Methods", m.methods],
    ["Results", m.results],
    ["Discussion", m.discussion],
    ["Limitations", m.limitations],
    ["Conclusion", m.conclusion],
  ] as const;
  return (
    <article className="rounded-xl bg-card px-5 py-8 shadow-[var(--shadow-border)] sm:px-10">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Working manuscript</p>
      <h2 className="mt-2 font-display text-2xl font-medium leading-snug sm:text-3xl">{m.title || study.title}</h2>
      {m.reportingChecklist ? (
        <p className="mt-3 text-xs text-muted-foreground">Reporting — {m.reportingChecklist}</p>
      ) : null}
      <div className="mt-8 space-y-8">
        {sections
          .filter(([, t]) => t)
          .map(([label, t]) => (
            <section key={label}>
              <h3 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</h3>
              <p className="mt-2 font-display text-[17px] leading-[1.65]">{t}</p>
            </section>
          ))}
      </div>
    </article>
  );
}

function AuditPanel({ study }: { study: Study }) {
  const a = study.audit;
  const merge = useStudio((st) => st.mergeStage);
  return (
    <div className="grid gap-4">
      <Panel title="Open fixes">
        {a.openFixes.length ? (
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
            {a.openFixes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing queued. Illuminate this stage after a pass through the others.</p>
        )}
      </Panel>
      <Panel title="How the studio should improve">
        <Field
          label="Notes to the next cycle"
          value={a.improvementNotes}
          rows={4}
          onChange={(v) => merge(study.id, "audit", { improvementNotes: v })}
        />
      </Panel>
      <Panel title="Log">
        {a.entries.length ? (
          <ol className="space-y-3">
            {a.entries.map((e) => (
              <li key={e.id} className="border-l border-border pl-3 text-sm">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {formatDate(e.at)} · {e.kind} · {e.stage}
                </p>
                <p className="mt-1 leading-relaxed">{e.summary}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">Generations and human edits will land here.</p>
        )}
      </Panel>
    </div>
  );
}
