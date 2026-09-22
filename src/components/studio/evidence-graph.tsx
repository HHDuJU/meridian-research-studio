import { useMemo, useState } from "react";
import { chart } from "@/lib/chart-tokens";
import type { GraphEdge, GraphKind, GraphNode } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_COLOR: Record<string, string> = {
  guideline: chart.slate,
  framework: chart.sage,
  "systematic-review": chart.high,
  rct: chart.moderate,
  observational: chart.stone,
  "qi-report": chart.sage,
  grey: chart.stone,
  qualitative: chart.slate,
  "patient-voice": chart.warn,
  expert: chart.slate,
  preprint: chart.stone,
  "trial-registry": chart.stone,
  context: chart.ink,
  gap: chart.danger,
  outcome: chart.high,
  stakeholder: chart.warn,
};

const LAYERS: GraphKind[][] = [
  ["framework", "guideline"],
  ["systematic-review", "rct"],
  ["observational", "qi-report", "qualitative"],
  ["grey", "preprint", "trial-registry", "expert"],
  ["patient-voice", "stakeholder"],
  ["context", "gap", "outcome"],
];

function layerOf(kind: GraphKind): number {
  const i = LAYERS.findIndex((g) => g.includes(kind));
  return i === -1 ? LAYERS.length - 1 : i;
}

export function EvidenceGraph({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const [active, setActive] = useState<string | null>(nodes[0]?.id ?? null);
  const layout = useMemo(() => {
    const w = 640;
    const h = 280;
    const grouped = new Map<number, GraphNode[]>();
    for (const n of nodes) {
      const L = layerOf(n.kind);
      const list = grouped.get(L) ?? [];
      list.push(n);
      grouped.set(L, list);
    }
    const pos = new Map<string, { x: number; y: number }>();
    for (const [L, list] of grouped) {
      list.forEach((n, i) => {
        const x = (w / (list.length + 1)) * (i + 1);
        const y = 28 + L * 42;
        pos.set(n.id, { x, y });
      });
    }
    return { w, h, pos };
  }, [nodes]);

  if (!nodes.length) return null;

  const activeNode = nodes.find((n) => n.id === active) ?? nodes[0];
  const ties = edges.filter((e) => e.from === activeNode.id || e.to === activeNode.id);

  return (
    <div>
      <svg
        viewBox={`0 0 ${layout.w} ${layout.h}`}
        className="h-auto w-full"
        role="img"
        aria-label="Evidence and context map"
      >
        {edges.map((e, i) => {
          const a = layout.pos.get(e.from);
          const b = layout.pos.get(e.to);
          if (!a || !b) return null;
          const lit = e.from === activeNode.id || e.to === activeNode.id;
          return (
            <line
              key={`${e.from}-${e.to}-${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={chart.ink}
              strokeOpacity={lit ? 0.35 : 0.08}
              strokeWidth={lit ? 1.4 : 1}
            />
          );
        })}
        {nodes.map((n) => {
          const p = layout.pos.get(n.id);
          if (!p) return null;
          const fill = KIND_COLOR[n.kind] ?? chart.ink;
          const on = activeNode.id === n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x}, ${p.y})`}
              className="cursor-pointer"
              onClick={() => setActive(n.id)}
            >
              {on ? <circle r={11} fill={fill} opacity={0.18} /> : null}
              <circle r={on ? 7 : 5.5} fill={fill} opacity={0.95} />
            </g>
          );
        })}
      </svg>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {nodes.map((n) => (
          <button
            type="button"
            key={n.id}
            onClick={() => setActive(n.id)}
            className={cn(
              "h-8 rounded-full border px-2.5 text-[11px]",
              n.id === activeNode.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground",
            )}
          >
            {n.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm leading-relaxed">
        <span className="font-medium">{activeNode.label}</span>
        <span className="mx-2 text-muted-foreground">·</span>
        <span className="text-muted-foreground">{activeNode.kind}</span>
        {activeNode.detail ? <span className="text-muted-foreground"> — {activeNode.detail}</span> : null}
      </p>
      {ties.length ? (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {ties.slice(0, 5).map((e) => {
            const otherId = e.from === activeNode.id ? e.to : e.from;
            const other = nodes.find((n) => n.id === otherId);
            return (
              <li key={`${e.from}-${e.to}`}>
                {e.from === activeNode.id ? "→" : "←"} {e.relation}
                {other ? ` · ${other.label}` : ""}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
