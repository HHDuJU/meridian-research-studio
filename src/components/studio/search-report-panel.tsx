import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { buildSearchReport, searchReportDocument, searchReportText, SEARCH_QUESTIONS, type SearchReport } from "@/lib/evidence/search-report";
import { saveFile } from "@/lib/export";
import { useStudio } from "@/lib/store";
import type { SearchLogKey, Study } from "@/lib/types";
import { Panel, Prose } from "./bits";

/*
 * Search report on the Scan page: the PRISMA-S report built from the searches Meridian recorded, the
 * investigator's answers for what only they know, searches run elsewhere, and the Word file for the journal.
 */

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function fileStem(study: Study): string {
  const base = (study.title || study.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return base || study.id;
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.message(`${what} copied.`);
  } catch {
    toast.warning("Copying is not allowed in this view; use the Word file instead.");
  }
}

export function SearchReportPanel({ study }: { study: Study }) {
  const report = useMemo(() => buildSearchReport(study), [study]);
  const [busy, setBusy] = useState(false);
  const reported = report.prismaS.filter((r) => r.state !== "needs-answer").length;
  const waiting = report.prismaS.length - reported;

  async function downloadWord() {
    setBusy(true);
    try {
      const { reportToDocxBlob } = await import("@/lib/report-docx");
      const blob = await reportToDocxBlob(searchReportDocument(buildSearchReport(study)));
      await saveFile(`search-report-${fileStem(study)}.docx`, blob, DOCX_TYPE);
    } catch (err) {
      toast.error(`The Word file could not be made (${err instanceof Error ? err.message : String(err)}).`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Search report (PRISMA-S)">
      <div data-meridian-search-report="" className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          {report.searches.length
            ? `${report.searches.length} ${report.searches.length === 1 ? "search" : "searches"} in ${report.sources.length} ${report.sources.length === 1 ? "source" : "sources"}. PRISMA-S (the reporting checklist for literature searches): ${reported} of 16 items covered, ${waiting} waiting for your answer.`
            : "No search yet. Run a search above; the report fills itself from what was run."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void downloadWord()} data-meridian-search-report-docx="">
            {busy ? "Making the Word file" : "Download Word file"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!report.methods} onClick={() => void copy(report.methods, "Methods text")} data-meridian-search-report-copy-methods="">
            Copy methods text
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void copy(searchReportText(report), "Search report")} data-meridian-search-report-copy="">
            Copy full report
          </Button>
        </div>
        {report.methods ? (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Methods text for the manuscript</p>
            <Prose className="mt-1">{report.methods}</Prose>
          </div>
        ) : null}
        {report.searches.length ? <StrategyChecks report={report} /> : null}
        <Questions study={study} report={report} />
        <ExternalSearchForm study={study} />
        {report.gaps.length ? (
          <div data-meridian-search-report-gaps="">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Before submission</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {report.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function StrategyChecks({ report }: { report: SearchReport }) {
  const flagged = report.searches.flatMap((s) => s.checks.map((c, i) => ({ key: `${s.eventId}-${i}`, n: s.n, source: s.source, ...c })));
  return (
    <div data-meridian-strategy-checks="">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Automated checks of the strategies (PRESS 2015 elements)</p>
      {flagged.length ? (
        <ul className="mt-1 space-y-1 text-sm">
          {flagged.map((c) => (
            <li key={c.key}>
              <span className="font-medium">
                Search {c.n} ({c.source}), {c.element.toLowerCase()}:
              </span>{" "}
              {c.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">No problem found. These checks are prompts for a person; they are not a peer review.</p>
      )}
    </div>
  );
}

function Questions({ study, report }: { study: Study; report: SearchReport }) {
  const log = report.log;
  const needsWhy = report.prismaS[8]?.text.startsWith("The strategies restrict");
  return (
    <div data-meridian-search-questions="">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">What only you can answer</p>
      <p className="mt-1 text-xs text-muted-foreground">Write a yes answer as the sentence you want in the methods section. Nothing here is filled in by a model.</p>
      <div className="mt-2 grid gap-2">
        <TextAnswer
          key={`searcher:${log.searcher?.at ?? ""}`}
          study={study}
          logKey="searcher"
          label="Who designed and ran the searches"
          placeholder="e.g. the first author with a health sciences librarian"
          current={log.searcher?.detail}
        />
        {needsWhy || log.limitsWhy ? (
          <TextAnswer
            key={`limitsWhy:${log.limitsWhy?.at ?? ""}`}
            study={study}
            logKey="limitsWhy"
            label="Why the limits written into the strategies were used"
            placeholder="e.g. We limited the search to English because no translator was available."
            current={log.limitsWhy?.detail}
          />
        ) : null}
        {SEARCH_QUESTIONS.map((q) => (
          <YesNoAnswer key={`${q.key}:${log[q.key]?.at ?? ""}`} study={study} logKey={q.key} item={q.item} question={q.ask} placeholder={q.placeholder} current={log[q.key]} />
        ))}
      </div>
    </div>
  );
}

function TextAnswer({ study, logKey, label, placeholder, current }: { study: Study; logKey: SearchLogKey; label: string; placeholder: string; current?: string }) {
  const setSearchLog = useStudio((st) => st.setSearchLog);
  const [text, setText] = useState(current ?? "");
  const dirty = text.trim() !== (current ?? "");
  return (
    <label className="block rounded-md border border-border p-2 text-sm" data-meridian-search-answer={logKey}>
      <span className="block font-medium">{label}</span>
      <span className="mt-1 flex gap-1.5">
        <input className="w-full rounded border border-border bg-background px-1.5 py-1 text-sm" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
        <Button
          type="button"
          size="sm"
          disabled={!dirty}
          onClick={() => {
            const r = text.trim() ? setSearchLog(study.id, logKey, { detail: text }) : setSearchLog(study.id, logKey, null);
            if (!r.ok) toast.warning(r.reason ?? "Not saved");
          }}
        >
          Save
        </Button>
      </span>
    </label>
  );
}

function YesNoAnswer({
  study,
  logKey,
  item,
  question,
  placeholder,
  current,
}: {
  study: Study;
  logKey: SearchLogKey;
  item: number;
  question: string;
  placeholder: string;
  current?: { answer?: "yes" | "no"; detail: string };
}) {
  const setSearchLog = useStudio((st) => st.setSearchLog);
  const [answer, setAnswer] = useState<"yes" | "no" | undefined>(current?.answer);
  const [detail, setDetail] = useState(current?.detail ?? "");
  const dirty = answer !== current?.answer || detail.trim() !== (current?.detail ?? "");
  const save = () => {
    const r = setSearchLog(study.id, logKey, { answer, detail });
    if (!r.ok) toast.warning(r.reason ?? "Not saved");
  };
  return (
    <div className="rounded-md border border-border p-2 text-sm" data-meridian-search-answer={logKey}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <Badge variant="outline" className="mr-1.5">
            item {item}
          </Badge>
          {question}
        </span>
        <span className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" name={`${study.id}-${logKey}`} checked={answer === "yes"} onChange={() => setAnswer("yes")} /> Yes
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name={`${study.id}-${logKey}`} checked={answer === "no"} onChange={() => setAnswer("no")} /> No
          </label>
          {current ? (
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setSearchLog(study.id, logKey, null)}>
              Clear
            </button>
          ) : null}
        </span>
      </div>
      {answer === "yes" ? (
        <textarea className="mt-1.5 w-full rounded border border-border bg-background p-1.5 text-sm" rows={2} value={detail} placeholder={placeholder} onChange={(e) => setDetail(e.target.value)} />
      ) : null}
      {dirty && answer ? (
        <Button type="button" size="sm" className="mt-1.5" onClick={save} disabled={answer === "yes" && !detail.trim()}>
          Save answer
        </Button>
      ) : null}
    </div>
  );
}

function ExternalSearchForm({ study }: { study: Study }) {
  const record = useStudio((st) => st.recordExternalSearch);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ source: "", kind: "database" as "database" | "registry", platform: "", date: new Date().toISOString().slice(0, 10), strategy: "", found: "", note: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  if (!open) {
    return (
      <div>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)} data-meridian-external-search-open="">
          Record a search run elsewhere
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">For databases Meridian cannot reach (for example Embase or CENTRAL through your library), so the report lists every search.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-2 rounded-md border border-border p-3 text-sm" data-meridian-external-search="">
      <p className="font-medium">Record a search run elsewhere</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="rounded border border-border bg-background px-1.5 py-1" placeholder="Source, e.g. Embase" value={form.source} onChange={(e) => set("source", e.target.value)} />
        <input className="rounded border border-border bg-background px-1.5 py-1" placeholder="Platform, e.g. Ovid" value={form.platform} onChange={(e) => set("platform", e.target.value)} />
        <select className="rounded border border-border bg-background px-1.5 py-1" value={form.kind} onChange={(e) => set("kind", e.target.value)}>
          <option value="database">Bibliographic database</option>
          <option value="registry">Study registry</option>
        </select>
        <input className="rounded border border-border bg-background px-1.5 py-1" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        <input className="rounded border border-border bg-background px-1.5 py-1" inputMode="numeric" placeholder="Records found" value={form.found} onChange={(e) => set("found", e.target.value)} />
        <input className="rounded border border-border bg-background px-1.5 py-1" placeholder="Note (optional), e.g. Embase 1974 to 2026 September 19" value={form.note} onChange={(e) => set("note", e.target.value)} />
      </div>
      <textarea
        className="rounded border border-border bg-background p-1.5 font-mono text-xs"
        rows={5}
        placeholder="Paste the strategy exactly as run, one line per search line"
        value={form.strategy}
        onChange={(e) => set("strategy", e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            const found = form.found.trim() === "" ? null : Number(form.found.replace(/,/g, ""));
            const r = record(study.id, { ...form, found: found === null || Number.isNaN(found) ? (form.found.trim() ? -1 : null) : found });
            if (!r.ok) toast.warning(r.reason ?? "Not recorded");
            else {
              toast.message("Search recorded in the report.");
              setOpen(false);
              setForm((f) => ({ ...f, source: "", platform: "", strategy: "", found: "", note: "" }));
            }
          }}
        >
          Record search
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
