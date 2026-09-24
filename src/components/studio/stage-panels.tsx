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
import { approvalReview, evaluateDecision, decisionIsSupported } from "@/lib/evidence/decision";
import { BODY_LABEL, DETERMINATION_GATE, LITERATURE_FAMILIES, NO_WORK_REASON, RECORD_PRESETS, type AuthorityBody } from "@/lib/evidence/authority";
import { checkClaim, localFactEstablished, type LedgerCheckStatus } from "@/lib/evidence/grounding";
import { checkIdentities, IDENTITY_PROVIDER, LIVE_SOURCES, searchLiterature } from "@/lib/evidence-server";
import { DEFAULT_IMPORT, doisToCheck } from "@/lib/evidence/requests";
import type { LiveProvider } from "@/lib/evidence/live";
import type { LookupOutcome } from "@/lib/evidence/verify";
import { useStudio } from "@/lib/store";
import { nowIso, uid } from "@/lib/utils";
import type { CheckProvider, GradeLevel, StageId, Study } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { EmptyHint, Field, GradeBadge, Panel, Prose, ScoreBar, VerifyBadge } from "./bits";
import { EvidenceGraph } from "./evidence-graph";
import { SearchReportPanel } from "./search-report-panel";

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
        <p data-meridian-raw-need="" data-meridian-visible="" className="whitespace-pre-wrap text-[15px] leading-relaxed">
          {p.rawNeed}
        </p>
        <Field
          name="problem.rawNeed"
          label="Raw need"
          value={p.rawNeed}
          rows={8}
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
          <Field
            name="problem.constraints"
            label="Constraints"
            value={p.constraints}
            rows={3}
            onChange={(v) => patchProblem(study, "constraints", v)}
          />
          <Field
            label="Patient-centred goal"
            value={p.patientCenteredGoal}
            rows={3}
            onChange={(v) => patchProblem(study, "patientCenteredGoal", v)}
          />
        </div>
      </Panel>
      <LocalFactsPanel study={study} />
    </div>
  );
}

/** Investigator-owned facts about the setting. The only basis on which a model may call a gate met. */
function LocalFactsPanel({ study }: { study: Study }) {
  const facts = study.problem.localFacts ?? [];
  const addLocalFact = useStudio((st) => st.addLocalFact);
  const removeLocalFact = useStudio((st) => st.removeLocalFact);
  const [draft, setDraft] = useState("");
  return (
    <Panel title="Local facts you can document">
      <p className="mb-3 text-sm text-muted-foreground">
        Approvals with their reference, protected time, budget lines, data-access agreements. Only you can add or remove these. A decision gate counts as met only when it rests on one of them or on your own confirmation.
      </p>
      {facts.length ? (
        <ul className="mb-3 space-y-2" data-meridian-local-facts="">
          {facts.map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-2 text-sm">
              <span>{f.text}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => removeLocalFact(study.id, f.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-muted-foreground">None entered.</p>
      )}
      <div className="flex gap-2">
        <input
          className="w-full rounded-md border border-border bg-background p-2 text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. REB file 26-311 approved 2026-08-27"
          data-meridian-local-fact-draft=""
        />
        <Button
          type="button"
          size="sm"
          disabled={!draft.trim()}
          onClick={() => {
            const r = addLocalFact(study.id, draft);
            if (r.ok) setDraft("");
          }}
        >
          Add
        </Button>
      </div>
    </Panel>
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
        {!SCENARIO_MODE ? <LiveSearch study={study} /> : null}
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
                const providerEl = document.querySelector<HTMLSelectElement>("[data-meridian-retrieve-provider]");
                const provider = providerEl?.value || "fixture";
                void (async () => {
                  try {
                    const res = await fetch("/__scenario/retrieve", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ key: study.replayKey ?? "", query: s.query, provider }),
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
            <label className="ml-2 text-xs text-muted-foreground">
              Provider
              <select data-meridian-retrieve-provider="" className="ml-1 rounded-md border border-border bg-background px-2 py-1 text-sm" defaultValue="fixture">
                <option value="fixture">fixture</option>
                <option value="pubmed">pubmed</option>
                <option value="crossref">crossref</option>
                <option value="openalex">openalex</option>
              </select>
            </label>
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
      {s.retrievalEvents?.length ? (
        <Panel title="Searches actually run">
          <ul className="space-y-2 text-sm" data-meridian-searches="">
            {s.retrievalEvents.map((e) => (
              <li key={e.id} className="rounded-md border border-border p-2">
                <span className="font-medium">{e.provider}</span> · "{e.query}" · {e.status}
                {e.resultCount !== null ? ` · ${e.resultCount} hits` : ""} · {e.recordIds.length} records kept
                {e.performedBy !== "app" ? ` · by ${e.performedBy}` : ""}
                {e.note ? <span className="block text-xs text-muted-foreground">{e.note}</span> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <SearchReportPanel study={study} />
      {s.claims?.length ? <ClaimLedger study={study} /> : null}
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
                <span className="mb-1 block text-muted-foreground">Record identity check</span>
                <select
                  data-meridian-change-source="status"
                  data-record-id={item.id}
                  className="w-full rounded-md border border-border bg-background p-2 text-sm"
                  defaultValue="mismatch"
                >
                  <option value="mismatch">mismatch</option>
                  <option value="not-found">not-found</option>
                  <option value="error">error</option>
                  <option value="blocked">blocked</option>
                  <option value="match">match</option>
                </select>
                <input
                  data-meridian-check-note=""
                  data-record-id={item.id}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
                  placeholder="Note required"
                  defaultValue=""
                />
                <button
                  type="button"
                  data-meridian-record-check=""
                  data-record-id={item.id}
                  className="mt-1 text-xs underline"
                  onClick={(e) => {
                    const box = (e.currentTarget.parentElement ?? document).querySelector<HTMLSelectElement>(
                      `[data-meridian-change-source="status"][data-record-id="${item.id}"]`,
                    );
                    const note = (e.currentTarget.parentElement ?? document).querySelector<HTMLInputElement>(
                      `[data-meridian-check-note][data-record-id="${item.id}"]`,
                    );
                    const r = useStudio.getState().changeSource(study.id, { id: item.id }, "status", box?.value ?? "mismatch", note?.value ?? "");
                    if (!r.ok) toast.warning(r.reason ?? "Check not recorded");
                  }}
                >
                  Record check
                </button>
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
            data-meridian-hypothesis={item.id}
            className={`rounded-xl bg-card p-5 shadow-[var(--shadow-border)] ${selected ? "ring-1 ring-primary/40" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant={selected ? "default" : "outline"}>{selected ? "Selected" : "Candidate"}</Badge>
              <Button size="sm" variant="ghost" data-meridian-field="hypotheses.selectedId" onClick={() => merge(study.id, "hypotheses", { selectedId: item.id })}>
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
  if (!d.rationale && !d.decisions.length) return <EmptyHint>Illuminate to match the question to the simplest honest design.</EmptyHint>;
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
                const selection = dec.selectionStatus ?? dec.status;
                const acceptDisabled = selection === "withdrawn" || selection === "stale";
                const acceptReason =
                  selection === "withdrawn" ? "withdrawn: cannot be accepted" : selection === "stale" ? "stale: re-run Design" : "";
                return (
              <li key={dec.id} data-meridian-decision={dec.id} className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {dec.kind} · selection {selection} · action {ev.actionStatus} · {dec.actor}
                </p>
                <p className="mt-1 text-sm leading-relaxed">{dec.statement}</p>
                {!support.ok ? (
                  <p data-meridian-decision-refusal="" data-meridian-error="" role="alert" className="mt-2 text-sm text-amber-700">
                    {support.reason}
                  </p>
                ) : null}
                {acceptReason ? (
                  <p data-meridian-error="" role="alert" className="mt-2 text-sm text-amber-700">
                    {acceptReason}
                  </p>
                ) : null}
                {ev.blockers.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">{ev.blockers.join("; ")}</p>
                ) : null}
                <ApprovalPanel study={study} decisionIndex={idx} />
                {dec.gates.length ? <GateList study={study} decisionIndex={idx} /> : null}
                {selection === "proposed" || acceptDisabled ? (
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      data-meridian-accept=""
                      disabled={acceptDisabled}
                      onClick={() => {
                        const r = acceptDecision(study.id, idx);
                        if (!r.ok) toast.warning(r.reason ?? "Accept refused");
                      }}
                    >
                      Accept
                    </Button>
                    {selection !== "withdrawn" ? (
                      <Button type="button" size="sm" variant="outline" data-meridian-withdraw="" onClick={() => withdrawDecision(study.id, idx)}>
                        Withdraw
                      </Button>
                    ) : null}
                  </div>
                ) : selection === "accepted" ? (
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" variant="outline" data-meridian-withdraw="" onClick={() => withdrawDecision(study.id, idx)}>
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
          <Field
            name="protocol.population"
            label="Population"
            value={p.population}
            rows={3}
            onChange={(v) => useStudio.getState().mergeStage(study.id, "protocol", { population: v })}
          />
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
                {p.outcomes.map((o, i) => (
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
                      <textarea
                        data-meridian-field={`protocol.outcomes[${i}].measure`}
                        className="w-full min-h-12 rounded-md border border-border bg-background px-2 py-1 text-sm"
                        value={o.measure}
                        onChange={(e) => {
                          const outcomes = p.outcomes.map((x, j) => (j === i ? { ...x, measure: e.target.value } : x));
                          useStudio.getState().mergeStage(study.id, "protocol", { outcomes });
                        }}
                      />
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
        <Field
          name="audit.openFixes"
          label="Open fixes"
          value={a.openFixes.join("\n")}
          rows={3}
          onChange={(v) =>
            merge(study.id, "audit", {
              openFixes: v
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
            })
          }
        />
      </Panel>
      <Panel title="How the studio should improve">
        <Field
          name="audit.improvementNotes"
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


const SUPPORT_LABEL: Record<LedgerCheckStatus, string> = {
  supported: "Quotation and numbers resolve to the cited source text",
  "no-source-text": "Not checkable: no stored text for the source",
  unsupported: "Not supported by the cited source text",
  "text-title-mismatch": "Stored text may belong to another work (it shares no content word with the title); check the record",
  "not-source-derived": "",
};

/** The claim ledger with S1 re-run on the current stored texts and the text-title check (grounding.ts). */
function ClaimLedger({ study }: { study: Study }) {
  const claims = study.scan.claims ?? [];
  const byId = new Map(study.scan.items.map((i) => [i.id, i]));
  const checks = claims.map((c) => ({ c, sup: checkClaim(c, study) }));
  const blocked = checks.filter((x) => x.sup.blocking).length;
  return (
    <Panel title="Claim ledger">
      <p className="mb-3 text-sm text-muted-foreground" data-meridian-claim-summary="">
        {claims.length} claims · {checks.filter((x) => x.sup.status === "supported").length} supported by the cited text ·{" "}
        {blocked} not supported by the cited text{(study.scan.supersededClaims?.length ?? 0) ? ` · ${study.scan.supersededClaims!.length} superseded kept` : ""}
      </p>
      <ul className="space-y-3">
        {checks.map(({ c, sup }) => (
          <li key={c.id} data-meridian-claim={c.id} data-support={sup.status} className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {c.id} · {c.kind} · {c.uncertainty} uncertainty · {c.origin ?? "unknown"}
            </p>
            <p className="mt-1 text-sm leading-relaxed">{c.text}</p>
            {c.kind === "local-fact" &&
            c.origin !== "investigator" &&
            !localFactEstablished(c.text, (study.problem.localFacts ?? []).filter((f) => f.by === "investigator").map((f) => f.text)) ? (
              <p className="mt-1 text-xs text-amber-700" data-meridian-proposed-local-fact="">
                Model proposal, not a local fact: it counts only after you enter it yourself under local facts on the Problem stage.
              </p>
            ) : null}
            {c.passage ? <p className="mt-1 text-xs italic text-muted-foreground">"{c.passage}"{c.location ? ` (${c.location})` : ""}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              Sources: {c.sourceIds.map((id) => byId.get(id)?.title ?? id).join("; ") || "none"}
            </p>
            {sup.status !== "not-source-derived" ? (
              <p className={`mt-1 text-xs ${sup.blocking ? "text-amber-700" : "text-muted-foreground"}`} data-meridian-claim-support="">
                {SUPPORT_LABEL[sup.status]}
                {sup.blocking ? `: ${sup.message}` : ""}
                {sup.approximateFigures.length ? ` · approximate figures to compare with the source: ${sup.approximateFigures.join(", ")}` : ""}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const LIVE_LABEL: Record<LiveProvider, string> = { pubmed: "PubMed", openalex: "OpenAlex", clinicaltrials: "ClinicalTrials.gov" };
const CHECK_LABEL: Record<string, string> = { crossref: "Crossref", pubmed: "PubMed", openalex: "OpenAlex", clinicaltrials: "ClinicalTrials.gov", manual: "Manual" };

/** Production literature search and identity checks (server functions; live network on the app host). */
function LiveSearch({ study }: { study: Study }) {
  const applyRetrieval = useStudio((st) => st.applyRetrieval);
  const applyIdentityChecks = useStudio((st) => st.applyIdentityChecks);
  const recordEvidenceRun = useStudio((st) => st.recordEvidenceRun);
  const [sources, setSources] = useState<Record<string, boolean>>(() => Object.fromEntries(LIVE_SOURCES.map((p) => [p, true])));
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<string>("");
  const query = (study.scan.query ?? "").trim();
  const dois = doisToCheck(study.scan.items, IDENTITY_PROVIDER);

  async function search() {
    const chosen = LIVE_SOURCES.filter((p) => sources[p]);
    if (!query) {
      toast.warning("Enter a search query first (Illuminate can suggest one).");
      return;
    }
    const lines: string[] = [];
    try {
      for (const provider of chosen) {
        setBusy(`Searching ${LIVE_LABEL[provider]}`);
        const started = Date.now();
        const res = await searchLiterature({ data: { provider, query, max: DEFAULT_IMPORT[provider] } });
        if (!res || !res.ok) {
          const error = res && "error" in res ? String(res.error) : "search failed";
          lines.push(`${LIVE_LABEL[provider]}: refused (${error})`);
          recordEvidenceRun(study.id, { id: uid("erun"), at: nowIso(), kind: "search", provider, query, requests: [], status: "error", records: 0, elapsedMs: Date.now() - started, note: error });
          continue;
        }
        const data = JSON.parse(res.json) as {
          event: Study["scan"]["retrievalEvents"][number];
          items: Study["scan"]["items"];
          documents: NonNullable<Study["documents"]>;
          requests: string[];
        };
        applyRetrieval(study.id, { event: data.event, items: data.items, documents: data.documents });
        recordEvidenceRun(study.id, {
          id: uid("erun"),
          at: nowIso(),
          kind: "search",
          provider,
          query,
          requests: data.requests,
          status: data.event.status,
          records: data.items.length,
          elapsedMs: typeof res.elapsedMs === "number" ? res.elapsedMs : Date.now() - started,
          note: data.event.note,
          eventId: data.event.id,
        });
        const why = data.event.status === "error" || data.event.status === "blocked" ? ` (${(data.event.note ?? "no detail").slice(0, 220)})` : "";
        lines.push(`${LIVE_LABEL[provider]}: ${data.event.status}, ${data.items.length} records${data.event.resultCount !== null ? ` of ${data.event.resultCount}` : ""}${why}`);
      }
    } finally {
      setBusy(null);
      setLast(lines.join(" · "));
      if (lines.length) toast.message("Literature search finished", { description: lines.join(" · ") });
    }
  }

  async function checkIds() {
    if (!dois.length) return;
    setBusy("Checking identities");
    const started = Date.now();
    try {
      const res = await checkIdentities({ data: { dois: dois.slice(0, 100) } });
      if (!res || !res.ok) {
        const error = res && "error" in res ? String(res.error) : "identity check failed";
        toast.error(error);
        recordEvidenceRun(study.id, { id: uid("erun"), at: nowIso(), kind: "identity-check", provider: IDENTITY_PROVIDER, requests: [], status: "error", records: 0, elapsedMs: Date.now() - started, note: error });
        return;
      }
      const data = JSON.parse(res.json) as { provider: CheckProvider; chunks: { requested: string[]; outcome: LookupOutcome }[]; requests: string[] };
      const summary = applyIdentityChecks(study.id, data.provider, data.chunks);
      const failed = data.chunks.filter((c) => c.outcome.status !== "ok");
      recordEvidenceRun(study.id, {
        id: uid("erun"),
        at: nowIso(),
        kind: "identity-check",
        provider: data.provider,
        requests: data.requests,
        status: failed.length === 0 ? "ok" : failed.length === data.chunks.length ? failed[0].outcome.status === "blocked" ? "blocked" : "error" : "partial",
        records: summary.checked,
        elapsedMs: Date.now() - started,
        note: `${summary.verified} verified, ${summary.mismatch} mismatch, ${summary.notFound} not found, ${summary.unresolved} unresolved, ${summary.failed} failed`,
      });
      const line = `${CHECK_LABEL[data.provider] ?? data.provider}: ${summary.verified} verified, ${summary.mismatch} mismatch, ${summary.notFound} not found, ${summary.unresolved} unresolved, ${summary.failed} failed`;
      setLast(line);
      toast.message("Identity check finished", { description: line });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border p-3" data-meridian-live-search="">
      <p className="text-sm font-medium">Search the literature</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Runs the query above against the sources you tick. Every record keeps where it came from; its abstract is stored as retrieved and never rewritten.
      </p>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {LIVE_SOURCES.map((p) => (
          <label key={p} className="flex items-center gap-1.5">
            <input type="checkbox" checked={sources[p]} onChange={(e) => setSources({ ...sources, [p]: e.target.checked })} />
            {LIVE_LABEL[p]}
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={!!busy || !query} onClick={() => void search()} data-meridian-search-live="">
          {busy?.startsWith("Searching") ? busy : "Search"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!!busy || !dois.length} onClick={() => void checkIds()} data-meridian-check-identities="">
          {busy === "Checking identities" ? busy : `Check identities (${dois.length} DOIs)`}
        </Button>
      </div>
      {last ? <p className="mt-2 text-xs text-muted-foreground" data-meridian-live-result="">{last}</p> : null}
    </div>
  );
}


/**
 * D10 / S5: where the decision stands on approvals. The investigator records the research ethics status of
 * the work (and settles approvals their own facts leave open); the model's statements about approvals are
 * listed to check and change nothing by themselves.
 */
function ApprovalPanel({ study, decisionIndex }: { study: Study; decisionIndex: number }) {
  const addGate = useStudio((st) => st.addGate);
  const setFamily = useStudio((st) => st.setFamily);
  const dec = study.design.decisions[decisionIndex];
  if (!dec) return null;
  const review = approvalReview(dec, study);
  if (!review.ethicsRecordMissing && !review.ethicsByStudyType && !review.openItems.length && !review.modelStatements.length) return null;
  return (
    <div className="mt-2 space-y-1.5" data-meridian-approvals="">
      {review.ethicsByStudyType ? (
        <div className="rounded-md border border-border p-2 text-xs" data-meridian-ethics-by-study-type="">
          <span className="block">Research ethics status, from the study type you chose: {review.ethicsByStudyType}</span>
          <span className="mt-1 block text-muted-foreground">To record something else for this decision (an approval, or another reason):</span>
          <RecordForm study={study} decisionIndex={decisionIndex} body="ethics" />
        </div>
      ) : null}
      {review.ethicsRecordMissing ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/40 p-2 text-xs" data-meridian-ethics-record-missing="">
          <span className="block">
            Research ethics status of this work: not recorded. Only you or the review board can say whether this work is approved or
            needs no review.
          </span>
          {review.approvalFacts.length ? (
            <span className="mt-1 block text-muted-foreground" data-meridian-approval-facts="">
              Your facts about approvals, to check before you record:
              <span className="block">{review.approvalFacts.map((f) => `"${f}"`).join(" ")}</span>
            </span>
          ) : null}
          {study.family && LITERATURE_FAMILIES.has(study.family) && study.familyBy !== "investigator" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-1"
              data-meridian-confirm-literature-family=""
              onClick={() => setFamily(study.id, study.family)}
            >
              Confirm the study type: {familyOf(study.family).label} of published literature (no REB review, TCPS 2, Article 2.2)
            </Button>
          ) : null}
          <RecordForm study={study} decisionIndex={decisionIndex} body="ethics" suggestion={review.suggestedEthicsRecord} suggestionSource={review.suggestionSource} />
          {review.leadsToNoWork ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-1"
              data-meridian-record-no-work=""
              onClick={() => {
                const r = addGate(study.id, decisionIndex, DETERMINATION_GATE.ethics, "not-required", NO_WORK_REASON);
                if (!r.ok) toast.warning(r.reason ?? "Refused");
              }}
            >
              No people, records or practice are involved
            </Button>
          ) : null}
        </div>
      ) : null}
      {review.openItems.map((it, k) => (
        <OpenItemForm key={it.text} study={study} decisionIndex={decisionIndex} text={it.text} index={k} />
      ))}
      {review.modelStatements.length ? (
        <div className="rounded-md border border-border p-2 text-xs" data-meridian-model-statements="">
          <span className="block text-muted-foreground">
            The model&apos;s text says the following about approvals and local facts. Check it: it is not a record and changes nothing
            by itself.
          </span>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {review.modelStatements.map((m) => (
              <li key={`${m.kind}:${m.text}`} data-meridian-model-statement={m.kind}>
                {m.text}
                {m.kind === "authority" ? <span className="text-muted-foreground"> ({m.bodies.map((b) => BODY_LABEL[b]).join(", ")})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** One of the investigator's own facts that leaves an approval open: given (with the reference) or not concerning this decision (with the reason). */
function OpenItemForm({ study, decisionIndex, text, index }: { study: Study; decisionIndex: number; text: string; index: number }) {
  const settle = useStudio((st) => st.settleOpenItem);
  const [note, setNote] = useState("");
  const act = (how: "given" | "aside") => {
    const r = settle(study.id, decisionIndex, text, how, note);
    if (!r.ok) toast.warning(r.reason ?? "Refused");
    else setNote("");
  };
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/40 p-2 text-xs" data-meridian-open-item={index} data-meridian-open-item-text={text}>
      <span className="block">Your facts leave this open: &quot;{text}&quot;</span>
      <span className="mt-1 flex gap-1.5">
        <input
          className="w-full rounded border border-border bg-background px-1.5 py-1"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="The reference that shows it was given, or why it does not concern this decision"
          data-meridian-open-item-input={index}
        />
        <Button type="button" size="sm" disabled={!note.trim()} data-meridian-item-given={index} onClick={() => act("given")}>
          Given
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!note.trim()} data-meridian-item-aside={index} onClick={() => act("aside")}>
          Not for this decision
        </Button>
      </span>
    </div>
  );
}

/** The investigator records, for one kind of body, the approval's reference or why it is not required. */
function RecordForm({
  study,
  decisionIndex,
  body,
  suggestion,
  suggestionSource,
}: {
  study: Study;
  decisionIndex: number;
  body: AuthorityBody;
  suggestion?: string;
  suggestionSource?: "gate" | "fact";
}) {
  const addGate = useStudio((st) => st.addGate);
  const [text, setText] = useState("");
  const save = (status: "met" | "not-required") => {
    const r = addGate(study.id, decisionIndex, DETERMINATION_GATE[body], status, text);
    if (!r.ok) toast.warning(r.reason ?? "Refused");
    else setText("");
  };
  return (
    <span className="mt-1 block" data-meridian-record-form={body}>
      <span className="flex gap-1.5">
        <input
          className="w-full rounded border border-border bg-background px-1.5 py-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`${BODY_LABEL[body]}: the approval's reference, or why it is not required`}
          data-meridian-record-input={body}
        />
        <Button type="button" size="sm" disabled={!text.trim()} data-meridian-record-approved={body} onClick={() => save("met")}>
          Record: approved
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!text.trim()} data-meridian-record-not-required={body} onClick={() => save("not-required")}>
          Record: not required
        </Button>
      </span>
      {body === "ethics" ? (
        <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5" data-meridian-record-presets="">
          {RECORD_PRESETS.map((p) => (
            <button key={p.label} type="button" className="text-left text-muted-foreground underline" data-meridian-record-preset={p.label} onClick={() => setText(p.text)}>
              {p.label}
            </button>
          ))}
        </span>
      ) : null}
      {suggestion ? (
        <button type="button" className="mt-0.5 text-left text-muted-foreground underline" data-meridian-record-suggestion={body} onClick={() => setText(suggestion)}>
          {suggestionSource === "gate" ? "Use the gate you confirmed (the model's words): " : "Use your fact: "}
          {suggestion}
        </button>
      ) : null}
    </span>
  );
}

/** Gates of one decision. Only the investigator can mark a gate met by hand, with the evidence. */
function GateList({ study, decisionIndex }: { study: Study; decisionIndex: number }) {
  const setGate = useStudio((st) => st.setGate);
  const dec = study.design.decisions[decisionIndex];
  // "met": the investigator documents the gate; "not-required": the gate does not apply to this decision.
  const [editing, setEditing] = useState<{ gateId: string; mode: "met" | "not-required" } | null>(null);
  const [evidence, setEvidence] = useState("");
  if (!dec) return null;
  return (
    <ul className="mt-2 space-y-1.5" data-meridian-gates="">
      {dec.gates.map((g) => (
        <li key={g.id} data-meridian-gate={g.id} data-gate-status={g.status} className="rounded-md bg-muted/40 p-2 text-xs">
          <span className="font-medium">{g.status === "not-required" ? "not required" : g.status}</span> · {g.requirement}
          {g.evidence ? (
            <span className="block text-muted-foreground">
              {g.status === "not-required" ? "Reason" : "Evidence"}: {g.evidence}
              {g.setBy ? ` (${g.setBy === "investigator" ? "you" : "model"})` : ""}
            </span>
          ) : null}
          {g.grounding && g.setBy !== "investigator" && !g.proposal ? <span className="block text-muted-foreground">{g.grounding}</span> : null}
          {g.proposal && g.status === "unknown" && g.setBy !== "investigator" ? (
            <span className="mt-1 block rounded border border-border bg-background p-1.5" data-meridian-gate-proposal={g.id}>
              <span className="block">The model proposes this gate is met: {g.proposal.evidence}</span>
              {g.proposal.supportingFacts.length ? (
                <span className="block text-muted-foreground">Your fact it points to: {g.proposal.supportingFacts.join(" | ")}</span>
              ) : (
                <span className="block text-muted-foreground">None of your local facts or constraints says this.</span>
              )}
              {g.proposal.concerns.length ? (
                <span className="block text-amber-700" data-meridian-gate-concern="">Check before confirming: {g.proposal.concerns.join(" | ")}</span>
              ) : null}
              <span className="mt-1 flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  data-meridian-gate-confirm={g.id}
                  onClick={() => {
                    const r = setGate(study.id, decisionIndex, g.id, "met", g.proposal!.evidence);
                    if (!r.ok) toast.warning(r.reason ?? "Refused");
                  }}
                >
                  Confirm: this is met
                </Button>
              </span>
            </span>
          ) : null}
          {editing?.gateId === g.id ? (
            <span className="mt-1 flex gap-1.5">
              <input
                className="w-full rounded border border-border bg-background px-1.5 py-1"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder={
                  editing.mode === "met"
                    ? "Reference that shows it (approval number, memo, agreement)"
                    : "Why this gate does not apply to this decision"
                }
                data-meridian-gate-input={editing.mode}
              />
              <Button
                type="button"
                size="sm"
                disabled={!evidence.trim()}
                onClick={() => {
                  const r = setGate(study.id, decisionIndex, g.id, editing.mode, evidence);
                  if (!r.ok) toast.warning(r.reason ?? "Refused");
                  else {
                    setEditing(null);
                    setEvidence("");
                  }
                }}
              >
                Save
              </Button>
            </span>
          ) : (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {g.status !== "met" || g.setBy !== "investigator" ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ gateId: g.id, mode: "met" })}>
                  I can document this
                </Button>
              ) : null}
              {g.status !== "unmet" ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setGate(study.id, decisionIndex, g.id, "unmet")}>
                  Not in place
                </Button>
              ) : null}
              {g.status !== "not-required" || g.setBy !== "investigator" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-meridian-gate-not-required=""
                  onClick={() => setEditing({ gateId: g.id, mode: "not-required" })}
                >
                  Not required for this decision
                </Button>
              ) : null}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
