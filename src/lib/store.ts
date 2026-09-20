import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createStudy } from "./defaults";
import { SEED_IDS, SEED_STUDIES } from "./seed";
import type { StageId, Study, StudyFamily } from "./types";
import { nowIso } from "./utils";

type StudyPatch = Partial<Omit<Study, "id" | "createdAt">>;

interface StudioState {
  studies: Study[];
  hydrated: boolean;
  create: (input: {
    family: StudyFamily;
    setting: string;
    rawNeed: string;
    title?: string;
  }) => Study;
  update: (id: string, patch: StudyPatch) => void;
  remove: (id: string) => void;
  restoreSeeds: () => void;
  setStage: (id: string, stage: StageId) => void;
  markComplete: (id: string, stage: StageId) => void;
  mergeStage: <K extends StageId>(id: string, stage: K, patch: Partial<Study[K]>) => void;
  log: (id: string, entry: Study["audit"]["entries"][number]) => void;
}

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      studies: SEED_STUDIES,
      hydrated: false,
      create: (input) => {
        const study = createStudy(input);
        set({ studies: [study, ...get().studies] });
        return study;
      },
      update: (id, patch) => {
        set({
          studies: get().studies.map((s) =>
            s.id === id ? { ...s, ...patch, updatedAt: nowIso() } : s,
          ),
        });
      },
      remove: (id) => {
        set({ studies: get().studies.filter((s) => s.id !== id) });
      },
      restoreSeeds: () => {
        const existing = new Set(get().studies.map((s) => s.id));
        const missing = SEED_STUDIES.filter((s) => !existing.has(s.id));
        if (missing.length) set({ studies: [...missing, ...get().studies] });
        else set({ studies: [...SEED_STUDIES, ...get().studies.filter((s) => !SEED_IDS.includes(s.id))] });
      },
      setStage: (id, stage) => {
        set({
          studies: get().studies.map((s) =>
            s.id === id ? { ...s, currentStage: stage, updatedAt: nowIso() } : s,
          ),
        });
      },
      markComplete: (id, stage) => {
        set({
          studies: get().studies.map((s) => {
            if (s.id !== id) return s;
            const completed = s.completedStages.includes(stage)
              ? s.completedStages
              : [...s.completedStages, stage];
            return { ...s, completedStages: completed, updatedAt: nowIso() };
          }),
        });
      },
      mergeStage: (id, stage, patch) => {
        set({
          studies: get().studies.map((s) => {
            if (s.id !== id) return s;
            const current = s[stage];
            const merged = {
              ...s,
              [stage]: { ...current, ...patch },
              updatedAt: nowIso(),
              status: s.status === "complete" ? s.status : "active",
            } as Study;
            return merged;
          }),
        });
      },
      log: (id, entry) => {
        set({
          studies: get().studies.map((s) =>
            s.id === id
              ? {
                  ...s,
                  audit: { ...s.audit, entries: [entry, ...s.audit.entries].slice(0, 40) },
                  updatedAt: nowIso(),
                }
              : s,
          ),
        });
      },
    }),
    {
      name: "meridian-studio-v2",
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);

export function useStudy(id: string | undefined): Study | undefined {
  return useStudio((s) => s.studies.find((x) => x.id === id));
}
