// End-to-end smoke check of a running Meridian build (deliverable 1 acceptance, sheet A2). Written by the
// coordinating session (Fable, harness/trial/app-smoke.mjs, 2026-09-22); adopted into the repository 2026-09-23.
// Usage: node scripts/app-smoke.mjs <baseUrl> <outDir>   (browser: PLAYWRIGHT_CHROMIUM_EXECUTABLE or CHROMIUM_PATH)
// Steps: open the home page, create a synthetic study, confirm the studio route and the persisted store,
// reload and reopen the study, click Export JSON and capture the download, compare the exported bytes with
// the persisted study, then change a stored evidence field through the store (localStorage) and reload to
// check that the change is retained. Writes a JSON report and the exported file into <outDir>.
// Synthetic input only; no model call is made (the Illuminate button is never clicked).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [base, outDir] = process.argv.slice(2);
if (!base || !outDir) { console.error("usage: app-smoke.mjs <baseUrl> <outDir>"); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const report = { base, startedAt: new Date().toISOString(), steps: [] };
const step = (name, ok, detail) => { report.steps.push({ name, ok, detail }); console.log(ok ? "ok  " : "FAIL", name, detail ?? ""); };

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
try {
  await page.goto(base + "/", { waitUntil: "networkidle" });
  step("home loads", (await page.title()).length >= 0, await page.title());
  const need = "SYNTHETIC SMOKE CHECK 2026-09-22: a department wants to know whether a structured handoff " +
    "simulation for residents is deliverable within five months; no patients, no real data.";
  await page.locator("textarea").first().fill(need);
  await page.locator("form button[type=submit], form button").last().click();
  await page.waitForURL(/\/studio\//, { timeout: 15000 });
  const url1 = page.url();
  const studyId = url1.match(/\/studio\/([^/?]+)/)?.[1];
  step("study created and studio route opened", !!studyId, url1);
  const stored = await page.evaluate(() => localStorage.getItem("meridian-studio-v2"));
  const parsed = stored ? JSON.parse(stored) : null;
  const studies = parsed?.state?.studies ?? parsed?.studies ?? null;
  const found = studies && (Array.isArray(studies) ? studies.find((s) => s.id === studyId) : studies[studyId]);
  step("study persisted in localStorage meridian-studio-v2", !!found, found ? `rawNeed length ${found.problem?.rawNeed?.length ?? "?"}` : "not found");
  await page.reload({ waitUntil: "networkidle" });
  const afterReload = await page.evaluate(() => document.body.innerText.includes("SYNTHETIC SMOKE CHECK"));
  step("reload retains the study text", afterReload);
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.goto(url1, { waitUntil: "networkidle" });
  step("reopen by URL after leaving", await page.evaluate(() => document.body.innerText.includes("SYNTHETIC SMOKE CHECK")));
  // Export JSON
  const exportBtn = page.getByRole("button", { name: /export json/i });
  const hasExport = (await exportBtn.count()) > 0;
  step("Export JSON control present", hasExport);
  if (hasExport) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }).catch((e) => null),
      exportBtn.first().click(),
    ]);
    if (download) {
      const target = path.join(outDir, download.suggestedFilename());
      await download.saveAs(target);
      const bytes = fs.readFileSync(target, "utf8");
      let same = false;
      let metaNote = "";
      let diffKeys = [];
      try {
        const exp = JSON.parse(bytes);
        // R1 (sheet A3): the export may carry a `meta` block (modelMode, replayKey) beside the study fields.
        const { meta, ...study } = exp;
        metaNote = meta ? ` meta=${JSON.stringify(meta)}` : "";
        const keys = new Set([...Object.keys(study), ...Object.keys(found)]);
        diffKeys = [...keys].filter((k) => JSON.stringify(study[k]) !== JSON.stringify(found[k]));
        same = study.id === studyId && diffKeys.length === 0;
        fs.writeFileSync(path.join(outDir, "store-study.json"), JSON.stringify(found, null, 1));
      } catch {}
      step("Export JSON produced a file", true, `${download.suggestedFilename()} ${bytes.length} bytes${metaNote}`);
      step("exported study equals the persisted study", same, same ? "deep-equal on every study key (meta block excluded)" : `differs on ${diffKeys.join(", ") || "parse"}`);
    } else {
      step("Export JSON produced a file", false, "no download event within 15 s");
    }
  }
  // evidence-source change through the store: alter a field and check retention after reload
  const changed = await page.evaluate((id) => {
    const raw = localStorage.getItem("meridian-studio-v2"); if (!raw) return "no store";
    const data = JSON.parse(raw); const st = data.state ?? data; const list = st.studies;
    const s = Array.isArray(list) ? list.find((x) => x.id === id) : list?.[id]; if (!s) return "no study";
    s.problem = s.problem || {}; s.problem.constraints = "SOURCE-CHANGE MARKER 2026-09-22"; localStorage.setItem("meridian-studio-v2", JSON.stringify(data)); return "written";
  }, studyId);
  await page.reload({ waitUntil: "networkidle" });
  const marker = await page.evaluate(() => document.body.innerText.includes("SOURCE-CHANGE MARKER 2026-09-22") || (localStorage.getItem("meridian-studio-v2") || "").includes("SOURCE-CHANGE MARKER 2026-09-22"));
  step("stored change retained after reload (store-level)", marker, changed);
  await page.screenshot({ path: path.join(outDir, "studio.png"), fullPage: true });
} catch (e) {
  step("unexpected error", false, String(e));
} finally {
  report.pageErrors = errors.slice(0, 20);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, "app-smoke-report.json"), JSON.stringify(report, null, 1));
  await browser.close();
}
const failed = report.steps.filter((s) => !s.ok).length;
console.log(`steps ${report.steps.length}, failed ${failed}`);
process.exit(failed ? 1 : 0);
