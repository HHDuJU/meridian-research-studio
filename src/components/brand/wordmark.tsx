import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function MeridianMark({ className, invert = false }: { className?: string; invert?: boolean }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7", className)}
      aria-hidden="true"
    >
      <ellipse
        cx="16"
        cy="16"
        rx="9"
        ry="12"
        fill="none"
        stroke={invert ? "#F2EFE7" : "#2F4A46"}
        strokeWidth="1.6"
      />
      <path
        d="M16 4v24"
        fill="none"
        stroke={invert ? "#F2EFE7" : "#2F4A46"}
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function Wordmark({
  invert = false,
  to = "/",
}: {
  invert?: boolean;
  to?: string;
}) {
  return (
    <Link to={to} className="flex items-center gap-2.5 no-underline">
      <MeridianMark invert={invert} />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "font-display text-[1.15rem] font-medium tracking-tight",
            invert ? "text-spine-foreground" : "text-foreground",
          )}
        >
          Meridian
        </span>
        <span
          className={cn(
            "mt-0.5 text-[10px] uppercase tracking-[0.18em]",
            invert ? "text-spine-muted" : "text-muted-foreground",
          )}
        >
          Research studio
        </span>
      </span>
    </Link>
  );
}
