import { createFileRoute, Link } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { AppHeader, FinePrint } from "@/components/layout/app-header";
import { StudioView } from "@/components/studio/studio-view";
import { Button } from "@/components/ui/button";
import { studioAvailability, useStudio, useStudy } from "@/lib/store";
import { STAGE_IDS, type StageId } from "@/lib/types";

function parseStage(value: unknown): StageId {
  if (typeof value === "string" && (STAGE_IDS as readonly string[]).includes(value)) {
    return value as StageId;
  }
  return "problem";
}

export const Route = createFileRoute("/studio/$studyId")({
  validateSearch: (search: Record<string, unknown>) => ({
    stage: parseStage(search.stage),
  }),
  component: StudioPage,
});

function subscribeHydration(onStoreChange: () => void): () => void {
  const persist = useStudio.persist;
  if (persist.hasHydrated()) {
    queueMicrotask(onStoreChange);
    return () => undefined;
  }
  return persist.onFinishHydration(onStoreChange);
}

function StudioPage() {
  const { studyId } = Route.useParams();
  const { stage } = Route.useSearch();
  const persistHydrated = useSyncExternalStore(
    subscribeHydration,
    () => useStudio.persist.hasHydrated(),
    () => false,
  );
  const flagHydrated = useStudio((s) => s.hydrated);
  const hydrated = persistHydrated || flagHydrated;
  const study = useStudy(studyId);
  const availability = studioAvailability(hydrated, study);

  if (availability === "loading") {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <main className="mx-auto max-w-lg px-6 py-20 text-center">
          <h1 className="font-display text-3xl font-medium">Loading this study</h1>
          <p className="mt-3 text-sm text-muted-foreground">Restoring the desk from this browser.</p>
        </main>
        <FinePrint />
      </div>
    );
  }

  if (availability === "missing" || !study) {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <main className="mx-auto max-w-lg px-6 py-20 text-center">
          <h1 className="font-display text-3xl font-medium">This study is not on the desk</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            It may have been removed from this browser, or the link is from another session.
          </p>
          <Button asChild className="mt-6">
            <Link to="/">Back to the studio</Link>
          </Button>
        </main>
        <FinePrint />
      </div>
    );
  }

  return <StudioView study={study} stage={stage} />;
}
