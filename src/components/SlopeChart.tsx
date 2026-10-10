import type { RankedCandidate } from '@/lib/types';

interface Props {
  ranked: RankedCandidate[];
  onHover: (id: string | null) => void;
  hoveredId: string | null;
}

export function SlopeChart({ ranked, onHover, hoveredId }: Props) {
  const top = ranked.slice(0, 12);
  const W = 560;
  const rowH = 26;
  const H = top.length * rowH + 20;
  const x1 = 70;
  const x2 = W - 130;
  const y = (rank: number) => 14 + (rank - 1) * rowH;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-2">Before / after reranking</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 400 }}>
        <text x={x1} y={8} textAnchor="middle" className="fill-slate-400" fontSize={10}>Retrieval rank</text>
        <text x={x2} y={8} textAnchor="middle" className="fill-slate-400" fontSize={10}>After Jev + weights</text>
        {top.map((item) => {
          const y1 = y(item.retrieval_rank);
          const y2 = y(item.final_rank);
          const promoted = item.final_rank < item.retrieval_rank;
          const demoted = item.final_rank > item.retrieval_rank;
          const hovered = hoveredId === item.candidate.id;
          return (
            <g
              key={item.candidate.id}
              onMouseEnter={() => onHover(item.candidate.id)}
              onMouseLeave={() => onHover(null)}
              className="cursor-default"
            >
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={hovered ? '#4f46e5' : promoted ? '#10b981' : demoted ? '#ef4444' : '#cbd5e1'}
                strokeWidth={hovered ? 2.5 : 1.5}
                opacity={hoveredId && !hovered ? 0.25 : 0.85}
              />
              <text x={x1 - 6} y={y1 + 3.5} textAnchor="end" fontSize={10} className="fill-slate-500 tabular-nums">{item.retrieval_rank}</text>
              <text x={x2 + 6} y={y2 + 3.5} fontSize={10} className={hovered ? 'fill-indigo-700 font-semibold' : 'fill-slate-600'}>
                {item.candidate.initials} · {item.final_rank}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-[10px] text-slate-400 mt-1">Top 12 by final rank. Green = promoted, red = demoted. Hover a line to highlight.</p>
    </div>
  );
}
