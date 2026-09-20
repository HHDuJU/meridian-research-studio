import type { StageId, Study } from "./types";
import { STAGE_BY_ID } from "./stages";

function clip(s: string, n = 900): string {
  const t = s.trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
}

export function compactStudy(study: Study, stage: StageId): string {
  const parts: string[] = [
    `Title: ${study.title}`,
    `Subtitle: ${study.subtitle}`,
    `Family: ${study.family}`,
    `Setting: ${study.setting}`,
    `Status: ${study.status}`,
    `Current stage requested: ${STAGE_BY_ID[stage].label}`,
    `Completed: ${study.completedStages.join(", ") || "none"}`,
    `PROBLEM raw: ${clip(study.problem.rawNeed)}`,
    `PROBLEM statement: ${clip(study.problem.statement)}`,
    `Who: ${clip(study.problem.whoAffected, 400)}`,
    `What hurts: ${clip(study.problem.whatHurts, 400)}`,
    `Practice: ${clip(study.problem.currentPractice, 400)}`,
    `Constraints: ${clip(study.problem.constraints, 400)}`,
    `Patient goal: ${clip(study.problem.patientCenteredGoal, 400)}`,
  ];

  if (study.scan.items.length) {
    parts.push(
      `SCAN grade: ${study.scan.gradeOverall}. ${clip(study.scan.synthesis, 700)}`,
    );
    parts.push(
      "EVIDENCE: " +
        study.scan.items
          .slice(0, 10)
          .map(
            (i) =>
              `${i.year} ${i.authors.split(",")[0]} — ${i.title} [${i.kind}/${i.grade}/${i.verification}]`,
          )
          .join("; "),
    );
  }
  if (study.map.reading) parts.push(`MAP: ${clip(study.map.reading, 600)}`);
  if (study.gaps.items.length) {
    parts.push(
      "GAPS: " + study.gaps.items.map((g) => `${g.title} (${g.kind})`).join("; "),
    );
  }
  if (study.hypotheses.items.length) {
    parts.push(
      "HYPOTHESES: " +
        study.hypotheses.items.map((h) => `${h.id}: ${clip(h.statement, 180)}`).join(" | "),
    );
  }
  if (study.questions.items.length) {
    parts.push("QUESTIONS: " + study.questions.items.map((q) => q.text).join(" | "));
  }
  if (study.design.rationale) {
    parts.push(`DESIGN: ${study.design.recommended}. ${clip(study.design.rationale, 500)}`);
  }
  if (study.protocol.overview) {
    parts.push(`PROTOCOL: ${clip(study.protocol.overview, 500)}`);
    parts.push(
      "OUTCOMES: " +
        study.protocol.outcomes.map((o) => `${o.role}:${o.name}`).join(", "),
    );
  }
  if (study.stats.primaryAnalysis) parts.push(`STATS: ${clip(study.stats.primaryAnalysis, 400)}`);
  if (study.ethics.rebPath) parts.push(`ETHICS REB: ${clip(study.ethics.rebPath, 300)}`);
  if (study.voices.items.length) {
    parts.push("VOICES: " + study.voices.items.map((v) => v.theme).join(", "));
  }

  return parts.join("\n");
}
