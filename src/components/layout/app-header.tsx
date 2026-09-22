import { Link } from "@tanstack/react-router";
import { Wordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/utils";

export function AppHeader({ solid = false }: { solid?: boolean }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border/80",
        solid ? "bg-card/95 backdrop-blur-sm" : "bg-background/90 backdrop-blur-sm",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Wordmark />
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/"
            className="rounded-md px-3 py-2 text-muted-foreground hover:text-foreground"
            activeProps={{ className: "text-foreground" }}
          >
            Studio
          </Link>
          <Link
            to="/method"
            className="rounded-md px-3 py-2 text-muted-foreground hover:text-foreground"
            activeProps={{ className: "text-foreground" }}
          >
            Method compass
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function FinePrint() {
  return (
    <p className="mx-auto max-w-6xl px-4 pb-10 pt-8 text-xs leading-relaxed text-muted-foreground sm:px-6">
      Meridian drafts research. It does not replace REB or IRB review, a named statistician, or
      clinical judgement. Citations are leads until you verify them in PubMed, OpenEvidence,
      Consensus, or the primary PDF. Not for clinical decision-making at the bedside.
    </p>
  );
}
