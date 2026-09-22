import { AppHeader, FinePrint } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { FRAMEWORKS, GUIDELINES, VERIFY_SOURCES } from "@/lib/guidelines";
import { FAMILY_META } from "@/lib/stages";

export function MethodPage() {
  return (
    <div className="min-h-dvh">
      <AppHeader solid />
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Method compass</p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-medium tracking-tight sm:text-5xl">
          Match the question to a design, then to a reporting spine.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Meridian reasons with Grok. It does not replace PubMed, OpenEvidence, Consensus, Cochrane, or
          a statistician. Use this compass to keep the studio honest when a stage wants to become a
          cathedral.
        </p>

        <section className="mt-14">
          <h2 className="font-display text-2xl font-medium">Reporting and appraisal</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {GUIDELINES.map((g) => (
              <article key={g.id} className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-lg font-medium">{g.name}</h3>
                  <Badge variant="outline">{g.year}</Badge>
                  <Badge variant="secondary">{g.hub}</Badge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{g.useWhen}</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                  {g.essentials.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-2xl font-medium">Frameworks that earn their place</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {FRAMEWORKS.map((f) => (
              <article key={f.id} className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
                <h3 className="font-display text-lg font-medium">{f.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.useWhen}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-2xl font-medium">Verify the leads</h2>
          <ul className="mt-6 divide-y divide-border rounded-xl bg-card shadow-[var(--shadow-border)]">
            {VERIFY_SOURCES.map((s) => (
              <li key={s.name} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:justify-between">
                <a href={s.href} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">
                  {s.name}
                </a>
                <span className="text-sm text-muted-foreground">{s.job}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-2xl font-medium">Families the studio can hold</h2>
          <ul className="mt-6 grid gap-2 sm:grid-cols-2">
            {FAMILY_META.map((f) => (
              <li key={f.id} className="rounded-lg bg-card px-4 py-3 shadow-[var(--shadow-border)]">
                <p className="font-medium">{f.label}</p>
                <p className="text-sm text-muted-foreground">
                  {f.short} · {f.reporting.join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <FinePrint />
    </div>
  );
}
