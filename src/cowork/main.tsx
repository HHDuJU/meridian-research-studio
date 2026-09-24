/*
 * Meridian on Cowork: entry point of the artifact build (vite.cowork.config.ts). The same pages,
 * store and rules as the server build; the model call, literature search, identity checks and file
 * saves go through the Claude artifact runtime (./ai, ./evidence-server, ./runtime). Navigation lives
 * in memory because the artifact frame owns the address bar.
 */
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { routeTree } from "../routeTree.gen";
import { AppErrorComponent } from "../lib/error-component";
import { setFileSaver } from "../lib/export";
import { useStudio } from "../lib/store";
import { capability } from "./runtime";
import { applyPulled, StudySync } from "./sync";
import { maybeRunLiveCheck } from "./live-check";
import "../styles.css";

setFileSaver(async (filename, data) => {
  const downloads = await capability("downloads");
  if (!downloads) {
    toast.error("Saving files is not available in this view.");
    return;
  }
  try {
    await downloads.save({ filename, data });
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    if (code !== "declined") toast.error(`The file was not saved (${typeof code === "string" ? code : "error"}).`);
  }
});

const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
  defaultErrorComponent: AppErrorComponent,
});

/*
 * Studies follow the investigator across devices (./sync). Browser storage still opens the page
 * instantly; the exchange with the artifact's database runs after the first paint, again whenever the
 * page comes back into view, and pushes each change a few seconds after it happens.
 */
async function startStudySync(): Promise<void> {
  const [db, user] = await Promise.all([capability("db"), capability("user")]);
  const uid = user ? await user.id().catch(() => null) : null;
  if (!db || !uid) return;
  const sync = new StudySync(db, uid);
  let running: Promise<void> | null = null;
  let warned = false;
  const warn = (err: unknown) => {
    if (warned) return;
    warned = true;
    const code = (err as { code?: unknown })?.code;
    toast.warning(`Studies could not be synced with your Claude account (${typeof code === "string" ? code : "error"}); they stay in this browser.`);
  };
  const exchange = async () => {
    const r = await sync.exchange(useStudio.getState().studies);
    if (r.pulled.length) useStudio.setState((st) => ({ studies: applyPulled(st.studies, r.pulled) }));
    const updated = r.pulled.length - r.added;
    const parts = [
      r.added ? `loaded ${r.added} ${r.added === 1 ? "study" : "studies"} saved on your other devices` : "",
      updated ? `updated ${updated} with ${updated === 1 ? "a newer copy" : "newer copies"} from another device` : "",
    ].filter(Boolean);
    if (parts.length) toast.message(`${parts.join("; ").replace(/^./, (c) => c.toUpperCase())}.`);
  };
  const run = (job: () => Promise<unknown>) => {
    const next = (running ?? Promise.resolve()).then(job).catch(warn).then(() => undefined);
    running = next;
    return next;
  };
  await run(() => exchange());
  let timer: ReturnType<typeof setTimeout> | null = null;
  useStudio.subscribe((st, prev) => {
    if (st.studies === prev.studies) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(() => sync.pushChanged(useStudio.getState().studies)), 3000);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void run(() => exchange());
    else void run(() => sync.pushChanged(useStudio.getState().studies));
  });
}

const mount = document.getElementById("meridian-root");
if (mount) {
  createRoot(mount).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  void startStudySync().then(() => maybeRunLiveCheck());
}
