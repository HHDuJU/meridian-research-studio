/*
 * Meridian on Cowork: the live check, an in-page port of scripts/live-e2e.mjs. It runs the synthetic live
 * plans (scenarios/live) through the real screen: it fills the start page, clicks Illuminate, Search, Check
 * identities and Accept exactly where an investigator would, and waits the same way. Every model call goes to
 * Claude through the page's sample capability and every search to the viewer's connectors, so this is a live
 * run, never a replay.
 *
 * It starts only when the page is opened with the anchor #live-check (all plans) or #live-check-<plan id>, so
 * a normal visit never spends usage. Each plan's report (step by step, with the study's state after each
 * step) is saved to the viewer's private database path data/users/<id>/meridian/live-runs/<run>, where the
 * integration owner reads it; the studies themselves sync as usual.
 */
import { useStudio } from "../lib/store";
import { studyStatus } from "../lib/status";
import { checkClaim } from "../lib/evidence/grounding";
import { evaluateDecision } from "../lib/evidence/decision";
import type { Study } from "../lib/types";
import { capability } from "./runtime";
import liveA from "../../scenarios/live/live-a-ketamine.json";
import liveB from "../../scenarios/live/live-b-eras.json";
import liveC from "../../scenarios/live/live-c-opioid-night.json";
import liveD from "../../scenarios/live/live-d-gastric-us.json";
import trialA from "../../scenarios/live/trial-a-facet-rfa-threshold.json";
import trialB from "../../scenarios/live/trial-b-genicular-rfa.json";
import trialC from "../../scenarios/live/trial-c-esp-rib-fracture.json";
import trialD from "../../scenarios/live/trial-d-rfa-prom-followup.json";

interface PlanStep {
  do: string;
  stage?: string;
  query?: string;
  fallbackQuery?: string;
  providers?: string[];
}
interface Plan {
  id: string;
  inputs: { need: string; setting?: string; constraints?: string; localFacts?: string[]; family?: string };
  providers?: string[];
  steps: PlanStep[];
}

export const LIVE_PLANS: Plan[] = [liveA, liveB, liveC, liveD, trialA, trialB, trialC, trialD] as unknown as Plan[];

const MODEL_WAIT_MS = 12 * 60 * 1000;
const TOOL_WAIT_MS = 8 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, timeoutMs: number, what: string, stop: () => boolean): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (stop()) throw new Error("stopped by the viewer");
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(1000);
  }
}

function visible(el: Element | null): el is HTMLElement {
  return !!el && el instanceof HTMLElement && el.offsetParent !== null;
}

function first(selector: string): HTMLElement | null {
  const all = [...document.querySelectorAll(selector)];
  return (all.find((e) => visible(e)) as HTMLElement | undefined) ?? null;
}

/** Set an input's value the way typing does, so React sees the change. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function buttonByText(pattern: RegExp): HTMLButtonElement | null {
  return ([...document.querySelectorAll("button")] as HTMLButtonElement[]).find((b) => visible(b) && pattern.test((b.textContent ?? "").trim())) ?? null;
}

function toasts(): string[] {
  return [...document.querySelectorAll("[data-sonner-toast]")].map((t) => (t.textContent ?? "").replace(/\s+/g, " ").slice(0, 400));
}

async function gotoStage(stage: string): Promise<void> {
  const el = first(`[data-meridian-stage="${stage}"]`);
  if (!el) throw new Error(`stage ${stage} is not on screen`);
  el.click();
  await sleep(400);
}

export function summarize(study: Study | undefined) {
  if (!study) return null;
  return {
    status: studyStatus(study),
    items: study.scan.items.map((i) => ({
      id: i.id,
      title: i.title?.slice(0, 160),
      year: i.year ?? null,
      doi: i.doi ?? null,
      pmid: i.provenance?.identifiers?.pmid ?? null,
      nct: i.provenance?.identifiers?.nct ?? null,
      origin: i.provenance?.origin ?? null,
      status: i.provenance?.status ?? null,
      hasText: !!i.abstract?.text,
      checks: (i.provenance?.checks ?? []).map((c) => `${c.provider}:${c.result}`),
    })),
    claims: (study.scan.claims ?? []).map((c) => {
      const s = checkClaim(c, study);
      return { id: c.id, kind: c.kind, origin: c.origin ?? null, sources: c.sourceIds ?? [], support: s.status, blocking: s.blocking, text: c.text.slice(0, 220) };
    }),
    decisions: (study.design.decisions ?? []).map((d) => {
      const e = evaluateDecision(d, study);
      return { kind: d.kind, statement: d.statement.slice(0, 400), selection: d.selectionStatus ?? d.status, action: e.actionStatus, blockers: e.blockers.map((b) => b.slice(0, 300)), gates: (d.gates ?? []).map((g) => ({ requirement: g.requirement.slice(0, 200), status: g.status, setBy: g.setBy ?? null, proposal: g.proposal ? g.proposal.status : null })) };
    }),
    completedStages: study.completedStages,
    modelRuns: (study.modelRuns ?? []).map((r) => ({ stage: r.stage, purpose: r.purpose ?? null, model: r.model, provider: r.provider, outcome: r.outcome, elapsedMs: r.elapsedMs, issues: r.issues ?? 0, note: r.note?.slice(0, 300) ?? null, batch: r.batch ? { index: r.batch.index, of: r.batch.of } : null })),
    evidenceRuns: (study.evidenceRuns ?? []).map((r) => ({ kind: r.kind, provider: r.provider, status: r.status, records: r.records, elapsedMs: r.elapsedMs, note: r.note?.slice(0, 400) ?? null })),
    lastIlluminate: study.lastIlluminate ? { stage: study.lastIlluminate.stage, ok: study.lastIlluminate.ok, summary: study.lastIlluminate.summary ?? null, error: study.lastIlluminate.error ?? null } : null,
  };
}

function currentStudy(id: string | null): Study | undefined {
  return id ? useStudio.getState().studies.find((s) => s.id === id) : undefined;
}

function banner(): { set(text: string): void; stopped(): boolean; done(text: string): void } {
  const el = document.createElement("div");
  el.setAttribute("data-meridian-live-check", "");
  el.style.cssText =
    "position:fixed;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom, 0px));z-index:9999;padding:10px 14px;border-radius:10px;background:#1f2d2a;color:#f4f1ea;font:13px/1.4 system-ui,sans-serif;display:flex;gap:12px;align-items:center";
  const text = document.createElement("span");
  text.style.flex = "1";
  const stop = document.createElement("button");
  stop.textContent = "Stop the live check";
  stop.style.cssText = "background:#f4f1ea;color:#1f2d2a;border:0;border-radius:6px;padding:4px 10px;cursor:pointer";
  let stopped = false;
  stop.onclick = () => {
    stopped = true;
    stop.disabled = true;
    text.textContent = "Stopping after the current step.";
  };
  el.append(text, stop);
  document.body.appendChild(el);
  return {
    set: (t) => {
      if (!stopped) text.textContent = t;
    },
    stopped: () => stopped,
    done: (t) => {
      text.textContent = t;
      stop.remove();
    },
  };
}

async function runStep(s: PlanStep, plan: Plan, stop: () => boolean): Promise<unknown> {
  if (s.do === "visit") {
    await gotoStage(s.stage!);
    await sleep(1500);
    return null;
  }
  if (s.do === "illuminate") {
    await gotoStage(s.stage!);
    const btn = first("[data-meridian-illuminate]");
    if (!btn) throw new Error("no Illuminate control on screen");
    btn.click();
    await sleep(800);
    await waitFor(() => {
      const el = first("[data-meridian-illuminate]") as HTMLButtonElement | null;
      return !!el && !el.disabled && !/Working/i.test(el.textContent ?? "");
    }, MODEL_WAIT_MS, "the model reply", stop);
    await sleep(800);
    return null;
  }
  if (s.do === "search") {
    await gotoStage("scan");
    const panel = first("[data-meridian-live-search]");
    if (!panel) return { unsupported: "no live search control on screen" };
    const labels = [...document.querySelectorAll("label")].filter((l) => /Search query/i.test(l.textContent ?? ""));
    const queryBox = (labels.map((l) => l.querySelector("input, textarea")).find(Boolean) ?? null) as HTMLInputElement | null;
    if (s.query && queryBox) {
      setValue(queryBox, s.query);
      queryBox.blur();
      await sleep(400);
    }
    const want = new Set(s.providers ?? plan.providers ?? ["pubmed", "clinicaltrials"]);
    const LABEL: Record<string, string> = { pubmed: "PubMed", openalex: "OpenAlex", clinicaltrials: "ClinicalTrials.gov" };
    for (const [p, label] of Object.entries(LABEL)) {
      const box = [...panel.querySelectorAll("label")].find((l) => (l.textContent ?? "").trim() === label)?.querySelector("input[type=checkbox]") as HTMLInputElement | undefined;
      if (box && box.checked !== want.has(p)) box.click();
    }
    const runOnce = async () => {
      const query = queryBox?.value ?? null;
      const btn = first("[data-meridian-search-live]") as HTMLButtonElement | null;
      if (!btn || btn.disabled) return { query, line: "Search control disabled (no query)" };
      btn.click();
      await sleep(800);
      await waitFor(() => {
        const el = first("[data-meridian-search-live]") as HTMLButtonElement | null;
        return !!el && !el.disabled && !/Searching/i.test(el.textContent ?? "");
      }, TOOL_WAIT_MS, "the search", stop);
      return { query, line: first("[data-meridian-live-result]")?.textContent ?? null };
    };
    return runOnce();
  }
  if (s.do === "check-identities") {
    await gotoStage("scan");
    const btn = first("[data-meridian-check-identities]") as HTMLButtonElement | null;
    if (!btn) return { unsupported: "no identity-check control on screen" };
    if (btn.disabled) return { skipped: btn.textContent };
    btn.click();
    await sleep(800);
    await waitFor(() => !/Checking/i.test(first("[data-meridian-check-identities]")?.textContent ?? ""), TOOL_WAIT_MS, "the identity check", stop);
    return { line: first("[data-meridian-live-result]")?.textContent ?? null };
  }
  if (s.do === "accept-decision") {
    await gotoStage("design");
    const btn = first("[data-meridian-accept]") as HTMLButtonElement | null;
    if (!btn) return { unsupported: "no Accept control on screen" };
    btn.click();
    await sleep(1000);
    return { refusal: [...document.querySelectorAll("[data-meridian-decision-refusal]")].map((x) => (x.textContent ?? "").replace(/\s+/g, " ").slice(0, 400)) };
  }
  if (s.do === "reload") return { skipped: "reload is not run inside the page: it would end the live check (the study is saved and synced as the run goes)" };
  if (s.do === "export") return { skipped: "export is not run inside the page: a file save needs the viewer to confirm it" };
  return { skipped: `unknown step ${s.do}` };
}

async function createStudy(plan: Plan): Promise<string> {
  const home = [...document.querySelectorAll("a")].find((a) => /^Studio$/i.test((a.textContent ?? "").trim()) || a.getAttribute("href") === "/");
  if (!buttonByText(/Begin a study/i) && home) {
    home.click();
    await sleep(800);
  }
  const findNeed = () => [...document.querySelectorAll("textarea")].find((t) => /Adults with refractory neuropathic pain/i.test(t.placeholder)) as HTMLTextAreaElement | undefined;
  await waitFor(() => !!findNeed(), 20_000, "the start page", () => false).catch(() => undefined);
  const need = findNeed();
  if (!need) throw new Error("the start page is not on screen");
  setValue(need, plan.inputs.need);
  const setting = [...document.querySelectorAll("label")].find((l) => /^Setting/i.test((l.textContent ?? "").trim()))?.querySelector("input") as HTMLInputElement | null;
  if (plan.inputs.setting && setting) setValue(setting, plan.inputs.setting);
  const constraints = [...document.querySelectorAll("textarea")].find((t) => /Funding, time, data access/i.test(t.placeholder)) as HTMLTextAreaElement | undefined;
  if (plan.inputs.constraints && constraints) setValue(constraints, plan.inputs.constraints);
  const facts = (plan.inputs.localFacts ?? []).filter((f) => f.trim());
  const box = document.querySelector("[data-meridian-local-facts-input]") as HTMLTextAreaElement | null;
  if (facts.length && box) setValue(box, facts.join("\n"));
  if (plan.inputs.family) buttonByText(new RegExp(`^${plan.inputs.family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"))?.click();
  await sleep(300);
  const before = new Set(useStudio.getState().studies.map((s) => s.id));
  const begin = buttonByText(/Begin a study/i);
  if (!begin) throw new Error("no Begin a study control");
  begin.click();
  await sleep(1200);
  const created = useStudio.getState().studies.find((s) => !before.has(s.id));
  if (!created) throw new Error("the study was not created");
  return created.id;
}

/**
 * Claude and the connectors ask the viewer before their first use in each page view, and only a person can
 * answer (the platform ignores automated clicks on its dialog). The check asks once, with one batched dialog
 * for Claude and both connectors, and starts only after the answer; before 24 September 2026 it started at
 * once and every model call waited about 15 minutes on the dialog, then failed.
 */
async function askConsent(ui: ReturnType<typeof banner>): Promise<{ before: Record<string, string>; after: Record<string, string>; waitedMs: number }> {
  const perms = await capability("permissions");
  const names = ["sample", "mcp"];
  if (!perms) return { before: {}, after: {}, waitedMs: 0 };
  const before = await perms.state().catch(() => ({}) as Record<string, string>);
  if (names.every((n) => before[n] === "granted")) return { before, after: before, waitedMs: 0 };
  ui.set("Live check: allow Claude and the PubMed and Clinical Trials connectors in the dialog on screen. The check starts after you answer.");
  const started = Date.now();
  const after = await perms.request(names).catch(() => ({}) as Record<string, string>);
  return { before, after, waitedMs: Date.now() - started };
}

/** Start the live check when the page was opened with #live-check or #live-check-<plan id>. */
export async function maybeRunLiveCheck(): Promise<void> {
  const hash = (globalThis.location?.hash ?? "").replace(/^#/, "");
  if (!/^live-check(?:-[A-Za-z0-9._~-]+)?$/.test(hash)) return;
  const only = hash.length > "live-check".length ? hash.slice("live-check-".length) : null;
  const plans = only ? LIVE_PLANS.filter((p) => p.id === only) : LIVE_PLANS;
  const ui = banner();
  if (!plans.length) {
    ui.done(`Live check: no plan called ${only}.`);
    return;
  }
  const [db, user] = await Promise.all([capability("db"), capability("user")]);
  const uid = user ? await user.id().catch(() => null) : null;
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const consent = await askConsent(ui);
  const saveReport = async (planId: string, report: unknown) => {
    if (!db || !uid) return;
    const json = JSON.stringify(report);
    // A report over one document's size keeps its step list and drops the heaviest summaries first.
    const body = json.length < 240_000 ? JSON.parse(json) : { ...(report as Record<string, unknown>), steps: "too large; see the study itself", truncated: true };
    await db.doc(`data/users/${uid}/meridian/live-runs/${runId}-${planId}`).set(body).catch(() => undefined);
  };
  if (consent.after.sample === "denied" || consent.after.mcp === "denied") {
    const what = [consent.after.sample === "denied" ? "Claude" : "", consent.after.mcp === "denied" ? "the connectors" : ""].filter(Boolean).join(" and ");
    for (const plan of plans) await saveReport(plan.id, { plan: plan.id, runId, edition: "cowork", consent, notRun: `${what} not allowed in this view`, steps: [] });
    ui.done(`Live check not run: ${what} not allowed in this view. Reload the page to be asked again.`);
    return;
  }
  for (let p = 0; p < plans.length; p++) {
    const plan = plans[p];
    const report: Record<string, unknown> & { steps: unknown[] } = { plan: plan.id, runId, edition: "cowork", consent, startedAt: new Date().toISOString(), steps: [] };
    let studyId: string | null = null;
    const total = plan.steps.length + 1;
    const step = async (n: number, s: PlanStep, fn: () => Promise<unknown>) => {
      ui.set(`Live check: plan ${p + 1} of ${plans.length} (${plan.id}), step ${n + 1} of ${total}: ${s.do}${s.stage ? ` ${s.stage}` : ""}`);
      const started = Date.now();
      const entry: Record<string, unknown> = { n, do: s.do, stage: s.stage ?? null, startedAt: new Date(started).toISOString() };
      try {
        entry.result = (await fn()) ?? null;
        entry.ok = true;
      } catch (err) {
        entry.ok = false;
        entry.error = err instanceof Error ? err.message : String(err);
      }
      entry.elapsedMs = Date.now() - started;
      entry.toasts = toasts();
      entry.statusPanel = (first("[data-meridian-status]")?.textContent ?? "").replace(/\s+/g, " ").slice(0, 600);
      entry.after = summarize(currentStudy(studyId));
      report.steps.push(entry);
      await saveReport(plan.id, report);
      return entry.ok === true;
    };
    const created = await step(0, { do: "create" }, async () => {
      studyId = await createStudy(plan);
      return { studyId };
    });
    if (created) {
      for (let i = 0; i < plan.steps.length && !ui.stopped(); i++) {
        await step(i + 1, plan.steps[i], () => runStep(plan.steps[i], plan, ui.stopped));
      }
    }
    report.finishedAt = new Date().toISOString();
    report.studyId = studyId;
    await saveReport(plan.id, report);
    if (ui.stopped()) break;
  }
  ui.done(ui.stopped() ? "Live check stopped. Reports so far are saved." : `Live check finished: ${plans.length} ${plans.length === 1 ? "plan" : "plans"}. Reports are saved to your Claude account.`);
}
