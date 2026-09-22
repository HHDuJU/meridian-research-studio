import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import type { GradeLevel, Verification } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </p>
  );
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[15px] leading-relaxed text-foreground/90", className)}>{children}</p>
  );
}

export function Field({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <Textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-0"
        style={{ minHeight: `${Math.max(rows * 1.5, 4.5)}rem` }}
      />
    </label>
  );
}

export function GradeBadge({ grade }: { grade: GradeLevel | "" | "unrated" }) {
  if (!grade) return null;
  if (grade === "unrated") {
    return <Badge variant="secondary">unrated</Badge>;
  }
  const variant =
    grade === "high"
      ? "high"
      : grade === "moderate"
        ? "moderate"
        : grade === "low"
          ? "low"
          : "very-low";
  const label =
    grade === "very-low" ? "Very low" : grade.charAt(0).toUpperCase() + grade.slice(1);
  return <Badge variant={variant}>{label} certainty</Badge>;
}

export function VerifyBadge({
  v,
  status,
}: {
  v?: Verification;
  status?: "unverified" | "retrieved" | "verified" | "mismatch" | "check-failed" | "access-blocked";
}) {
  const fromStatus =
    status === "verified"
      ? "Verified"
      : status === "retrieved"
        ? "Retrieved"
        : status === "mismatch"
          ? "Mismatch"
          : status === "check-failed"
            ? "Check failed"
            : status === "access-blocked"
              ? "Access blocked"
              : "Unverified";
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={status === "verified" ? "high" : status === "retrieved" ? "moderate" : "secondary"}>{fromStatus}</Badge>
      {v && status && status !== "verified" ? (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">model: {v}</span>
      ) : null}
    </span>
  );
}

export function ScoreBar({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  if (value === null || value === undefined) {
    return (
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">not assessed</p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
        <span className="font-mono text-xs tabular-nums text-foreground">{Math.round(value)}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-500"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export function Panel({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl bg-card p-5 shadow-[var(--shadow-border)] sm:p-6", className)}>
      {title ? (
        <h3 className="mb-3 font-display text-lg font-medium leading-snug">{title}</h3>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
