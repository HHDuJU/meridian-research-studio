#!/usr/bin/env node
/**
 * Live end-to-end run of one study through the real UI, with real literature sources.
 *
 *   npx tsx scripts/live-e2e.mjs <plan.json> <out-dir> --base-url http://127.0.0.1:8199
 *
 * The app must be a live build (no scenario replay). Model calls go wherever XAI_BASE_URL points
 * on the app host (xAI, or a stand-in endpoint); literature calls go to PubMed, OpenAlex,
 * ClinicalTrials.gov and Crossref through the app's own server functions. Nothing is mocked here:
 * the script only clicks what an investigator would click and records what the app shows and stores.
 *
 * plan.json: { id, inputs: { need, setting?, constraints?, localFacts?: string[], family?: label },
 *              providers?: ["pubmed","openalex","clinicaltrials"], steps: [ { do, stage?, query?, gate?, evidence? } ] }
 * steps: illuminate(stage) | visit(stage) | search(query?) | check-identities | accept-decision
 *        | set-gate(gate, evidence) | reload | export
 * Output: report.json (one entry per step), study-final.json, export.json, step-NN-*.png.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PERSIST_KEY = "meridian-studio-v2";
const LIVE_LABEL = { pubmed: "PubMed", openalex: "OpenAlex", clinicaltrials: "ClinicalTrials.gov" };
const STAGE_LABEL = {
  problem: "Problem", scan: "Scan", map: "Map", gaps: "Gaps", hypotheses: "Hypotheses", questions: "Questions",
  design: "Design", protocol: "Protocol", stats: "Analysis", ethics: "Ethics", voices: "Voices", manuscript: "Manuscript", audit: "Audit",
};

function args(argv) {
  const out = { plan: null, outDir: null, baseUrl: "http://127.0.0.1:8199", modelWaitMin: 45, checkerRoot: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base-url") out.baseUrl = argv[++i];
    else if (argv[i] === "--model-wait-min") out.modelWaitMin = Number(argv[++i]);
    else if (argv[i] === "--checker-root") out.checkerRoot = argv[++i];
    else rest.push(argv[i]);
  }
  [out.plan, out.outDir] = rest;
  if (!out.plan || !out.outDir) {
    console.error("usage: live-e2e.mjs <plan.json> <out-dir> [--base-url URL] [--model-wait-min N]");
    process.exit(2);
  }
  return out;
}

const opts = args(process.argv.slice(2));
const plan = JSON.parse(fs.readFileSync(opts.plan, "utf8"));
fs.mkdirSync(opts.outDir, { recursive: true });
// The checks below are read-only judgements on the stored study. --checker-root lets a run against
// an older build be judged by this tree's checks (the older build is still what the user drove).
const root = path.resolve(opts.checkerRoot ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."));
const lib = async (p) => import(pathToFileURL(path.join(root, p)).href).catch(() => ({}));
const { studyStatus } = await lib("src/lib/status.ts");
const { claimSupport } = await lib("src/lib/evidence/support.ts");
const { evaluateDecision } = await lib("src/lib/evidence/decision.ts");

// The start page may hold other studies (examples, earlier runs); the run's study is the one whose
// id is in the studio URL after "Begin a study".
let studyId = null;
async function readStudy(page) {
  if (!studyId) return null;
  const raw = await page.evaluate((k) => localStorage.getItem(k), PERSIST_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  const studies = parsed?.state?.studies ?? [];
  return studies.find((s) => s.id === studyId) ?? null;
}

async function gotoStage(page, stage) {
  const loc = page.locator(`[data-meridian-stage="${stage}"]`);
  for (let i = 0; i < (await loc.count()); i++) {
    if (await loc.nth(i).isVisible().catch(() => false)) {
      await loc.nth(i).click();
      await page.waitForTimeout(250);
      return;
    }
  }
  await page.getByRole("button", { name: STAGE_LABEL[stage] ?? stage, exact: true }).first().click();
  await page.waitForTimeout(250);
}

function summarize(study) {
  if (!study) return null;
  const st = studyStatus ? studyStatus(study) : null;
  const claims = (study.scan.claims ?? []).map((c) => {
    const s = claimSupport ? claimSupport(c, study) : { status: "not-checked", blocking: false };
    return { id: c.id, kind: c.kind, origin: c.origin ?? null, sources: c.sourceIds ?? [], support: s.status, blocking: s.blocking, text: c.text.slice(0, 220) };
  });
  const decisions = (study.design.decisions ?? []).map((d) => {
    const e = evaluateDecision ? evaluateDecision(d, study) : { status: d.selectionStatus ?? d.status, canAct: null, blockers: [] };
    return {
      kind: d.kind, statement: d.statement, status: e.status, canAct: e.canAct, blockers: e.blockers,
      gates: (d.gates ?? []).map((g) => ({ id: g.id, requirement: g.requirement, status: g.status, setBy: g.setBy ?? null, grounding: g.grounding ?? null, evidence: g.evidence ?? null })),
    };
  });
  const items = study.scan.items.map((i) => ({
    id: i.id, title: i.title?.slice(0, 160), year: i.year ?? null, doi: i.doi ?? null, pmid: i.provenance?.identifiers?.pmid ?? null,
    nct: i.provenance?.identifiers?.nct ?? null, origin: i.provenance?.origin ?? null, status: i.provenance?.status ?? null,
    provider: i.provenance?.provider ?? null, hasText: !!i.abstract?.text, publicationStatus: i.publicationStatus ?? null,
    checks: (i.provenance?.checks ?? []).map((c) => `${c.provider}:${c.result}`),
  }));
  return {
    status: st,
    items,
    claims,
    decisions,
    completedStages: study.completedStages,
    needsReview: study.needsReview ?? [],
    modelRuns: (study.modelRuns ?? []).map((r) => ({ stage: r.stage, purpose: r.purpose ?? null, model: r.model, provider: r.provider, outcome: r.outcome, elapsedMs: r.elapsedMs, issues: r.issues ?? 0, batch: r.batch ? { index: r.batch.index, of: r.batch.of, records: r.batch.recordIds?.length ?? null } : null })),
    evidenceRuns: (study.evidenceRuns ?? []).map((r) => ({ kind: r.kind, provider: r.provider, status: r.status, records: r.records, elapsedMs: r.elapsedMs, note: r.note ?? null, requests: r.requests })),
    lastIlluminate: study.lastIlluminate
      ? { stage: study.lastIlluminate.stage, ok: study.lastIlluminate.ok, summary: study.lastIlluminate.summary ?? null, error: study.lastIlluminate.error ?? null, issues: (study.lastIlluminate.issues ?? []).map((x) => `${x.path}: ${x.code}`) }
      : null,
  };
}

const { chromium } = await import("playwright");
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const toasts = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 400)); });
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 400)));
// A full page load while a model call is in flight (for example a dev-server dependency reload)
// drops the reply; count loads so such a step is reported as failed instead of passing silently.
let loads = 0;
page.on("load", () => loads++);

const report = { plan: plan.id, checkerRoot: root, baseUrl: opts.baseUrl, startedAt: new Date().toISOString(), browser: browser.version(), steps: [] };
const save = () => fs.writeFileSync(path.join(opts.outDir, "report.json"), JSON.stringify(report, null, 1));

async function collectToasts() {
  const t = await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
  for (const x of t) if (!toasts.includes(x)) toasts.push(x);
  return t.map((x) => x.replace(/\s+/g, " ").slice(0, 400));
}

async function step(n, s, fn) {
  const started = Date.now();
  const entry = { n, do: s.do, stage: s.stage ?? null, startedAt: new Date(started).toISOString() };
  try {
    entry.result = (await fn()) ?? null;
    entry.ok = true;
  } catch (err) {
    entry.ok = false;
    entry.error = err instanceof Error ? err.message : String(err);
  }
  entry.elapsedMs = Date.now() - started;
  entry.toasts = await collectToasts();
  entry.statusPanel = (await page.locator("[data-meridian-status]").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600);
  const file = `step-${String(n).padStart(2, "0")}-${s.do}${s.stage ? `-${s.stage}` : ""}.png`;
  await page.screenshot({ path: path.join(opts.outDir, file), fullPage: true }).catch(() => undefined);
  entry.screenshot = file;
  try {
    entry.after = summarize(await readStudy(page).catch(() => null));
  } catch (err) {
    entry.after = null;
    entry.summarizeError = err instanceof Error ? err.message : String(err);
  }
  report.steps.push(entry);
  save();
  console.log(`[live] step ${n} ${s.do}${s.stage ? ` ${s.stage}` : ""} ${entry.ok ? "ok" : `FAILED: ${entry.error}`} (${Math.round(entry.elapsedMs / 1000)} s)`);
}

try {
  await page.goto(opts.baseUrl, { waitUntil: "networkidle", timeout: 120000 });
  await page.evaluate((k) => localStorage.removeItem(k), PERSIST_KEY);
  await page.reload({ waitUntil: "networkidle" });

  await step(0, { do: "create" }, async () => {
    const inp = plan.inputs;
    await page.getByPlaceholder(/Adults with refractory neuropathic pain/i).fill(inp.need);
    if (inp.setting) {
      const setting = page.locator("label", { hasText: /Setting/i }).locator("input").first();
      if (await setting.count()) await setting.fill(inp.setting);
    }
    if (inp.constraints) await page.getByPlaceholder(/Funding, time, data access/i).fill(inp.constraints);
    const facts = (inp.localFacts ?? []).filter((f) => f.trim());
    let localFacts = facts.length ? "entered" : "none";
    if (facts.length) {
      const box = page.locator("[data-meridian-local-facts-input]");
      if ((await box.count()) === 0) localFacts = "field not on screen (this build cannot take local facts)";
      else await box.fill(facts.join("\n"));
    }
    let family = inp.family ? "chosen" : "suggest";
    if (inp.family) {
      const chip = page.getByRole("button", { name: inp.family, exact: true });
      if (await chip.count()) await chip.first().click();
      else family = `"${inp.family}" is not offered on the start page; left on Suggest`;
    }
    await page.getByRole("button", { name: /Begin a study/i }).click();
    await page.waitForURL(/\/studio\//, { timeout: 30000 });
    studyId = decodeURIComponent(new URL(page.url()).pathname.split("/studio/")[1]?.split("/")[0] ?? "") || null;
    await page.locator("[data-meridian-illuminate]").waitFor({ timeout: 30000 });
    return { url: page.url(), studyId, localFacts, family };
  });

  if (!report.steps[0]?.ok) throw new Error("study was not created; later steps not attempted");
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    const n = i + 1;
    await step(n, s, async () => {
      if (s.do === "visit") {
        await gotoStage(page, s.stage);
        await page.waitForTimeout(1500);
        return null;
      }
      if (s.do === "illuminate") {
        await gotoStage(page, s.stage);
        const btn = page.locator("[data-meridian-illuminate]").first();
        const loadsBefore = loads;
        await btn.click();
        await page.waitForTimeout(500);
        await page.waitForFunction(() => {
          const el = document.querySelector("[data-meridian-illuminate]");
          return el && !el.hasAttribute("disabled") && !/Working/i.test(el.textContent || "");
        }, null, { timeout: opts.modelWaitMin * 60 * 1000, polling: 1000 });
        await page.waitForTimeout(800);
        if (loads !== loadsBefore) throw new Error("the page reloaded while the model call was in flight; the reply was lost");
        return null;
      }
      if (s.do === "search") {
        await gotoStage(page, "scan");
        const panel = page.locator("[data-meridian-live-search]");
        if ((await panel.count()) === 0) return { unsupported: "no live search control on screen" };
        const queryBox = page.getByLabel(/Search query/i).first();
        const setQuery = async (text) => {
          await queryBox.fill(text);
          await queryBox.blur().catch(() => undefined);
          await page.waitForTimeout(400);
        };
        if (s.query) await setQuery(s.query);
        const want = new Set(s.providers ?? plan.providers ?? ["pubmed", "openalex", "clinicaltrials"]);
        for (const [p, label] of Object.entries(LIVE_LABEL)) {
          const box = panel.locator("label", { hasText: label }).locator("input[type=checkbox]");
          if ((await box.count()) && (await box.isChecked()) !== want.has(p)) await box.click();
        }
        const runOnce = async () => {
          const query = await queryBox.inputValue().catch(() => null);
          const btn = page.locator("[data-meridian-search-live]");
          if (await btn.isDisabled()) return { query, line: "Search control disabled (no query)" };
          await btn.click();
          await page.waitForTimeout(500);
          await page.waitForFunction(() => {
            const el = document.querySelector("[data-meridian-search-live]");
            return el && !el.hasAttribute("disabled") && !/Searching/i.test(el.textContent || "");
          }, null, { timeout: 6 * 60 * 1000, polling: 1000 });
          return { query, line: await page.locator("[data-meridian-live-result]").innerText().catch(() => null) };
        };
        const retrievedCount = async () => ((await readStudy(page))?.scan.items ?? []).filter((i) => i.provenance?.status === "retrieved" || (i.provenance?.origin === "retrieval")).length;
        const first = await runOnce();
        const firstRetrieved = await retrievedCount();
        // An investigator whose search found nothing rewrites the query; the plan's fallback query is
        // that edit, and the report keeps both attempts.
        if (s.fallbackQuery && firstRetrieved === 0) {
          await setQuery(s.fallbackQuery);
          const second = await runOnce();
          return { first, firstRetrieved, investigatorEditedQuery: true, second, retrieved: await retrievedCount() };
        }
        return { first, firstRetrieved, investigatorEditedQuery: false };
      }
      if (s.do === "check-identities") {
        await gotoStage(page, "scan");
        const btn = page.locator("[data-meridian-check-identities]");
        if ((await btn.count()) === 0) return { unsupported: "no identity-check control on screen" };
        if (await btn.isDisabled()) return { skipped: await btn.innerText() };
        await btn.click();
        await page.waitForTimeout(500);
        await page.waitForFunction(() => {
          const el = document.querySelector("[data-meridian-check-identities]");
          return el && !/Checking/i.test(el.textContent || "");
        }, null, { timeout: 6 * 60 * 1000, polling: 1000 });
        return { line: await page.locator("[data-meridian-live-result]").innerText().catch(() => null) };
      }
      if (s.do === "accept-decision") {
        await gotoStage(page, "design");
        const btn = page.getByRole("button", { name: /^Accept$/ });
        if ((await btn.count()) === 0) return { unsupported: "no Accept control on screen" };
        await btn.first().click();
        await page.waitForTimeout(800);
        const refusal = await page.locator("[data-meridian-decision-refusal]").allInnerTexts().catch(() => []);
        return { refusal: refusal.map((x) => x.replace(/\s+/g, " ").slice(0, 400)) };
      }
      if (s.do === "set-gate") {
        await gotoStage(page, "design");
        const gate = page.locator(`[data-meridian-gate="${s.gate}"]`).last();
        if ((await gate.count()) === 0) return { unsupported: `gate ${s.gate} not on screen` };
        await gate.getByRole("button", { name: /I can document this/i }).click();
        await gate.locator("input").fill(s.evidence);
        await gate.getByRole("button", { name: /^Save$/ }).click();
        await page.waitForTimeout(500);
        return { gate: await gate.getAttribute("data-gate-status") };
      }
      if (s.do === "reload") {
        await page.reload({ waitUntil: "networkidle" });
        return null;
      }
      if (s.do === "export") {
        const wait = page.waitForEvent("download", { timeout: 20000 });
        await page.getByRole("button", { name: /Export JSON/i }).click();
        const d = await wait;
        const file = path.join(opts.outDir, "export.json");
        await d.saveAs(file);
        return { bytes: fs.statSync(file).size };
      }
      throw new Error(`unknown step ${s.do}`);
    });
  }
} catch (err) {
  report.fatal = err instanceof Error ? err.message : String(err);
} finally {
  report.finishedAt = new Date().toISOString();
  report.consoleErrors = consoleErrors;
  report.pageErrors = pageErrors;
  const study = await readStudy(page).catch(() => null);
  if (study) fs.writeFileSync(path.join(opts.outDir, "study-final.json"), JSON.stringify(study, null, 1));
  save();
  await browser.close();
}
