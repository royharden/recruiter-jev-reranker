import { Search, Braces, Layers, Zap, Calculator, ListOrdered } from 'lucide-react';
import type { StageTimings } from '@/lib/useRecruiterSearch';

export function PipelineStrip({ timings, k, jevCalls, running }: {
  timings: StageTimings; k: number; jevCalls: number; running: boolean;
}) {
  const stages = [
    { icon: <Search className="w-3.5 h-3.5" />, label: 'Query', value: 'free text' },
    { icon: <Braces className="w-3.5 h-3.5" />, label: 'LLM parse', value: timings.parse_ms ? `${timings.parse_ms}ms` : '—' },
    { icon: <Layers className="w-3.5 h-3.5" />, label: 'Retriever top-k', value: timings.search_ms ? `${timings.search_ms}ms · k=${k}` : `k=${k}` },
    { icon: <Zap className="w-3.5 h-3.5" />, label: 'Jev fan-out', value: jevCalls ? `${jevCalls} reqs · ${timings.jev_ms}ms` : '1 req / candidate' },
    { icon: <Calculator className="w-3.5 h-3.5" />, label: 'rankCandidates()', value: 'in code' },
    { icon: <ListOrdered className="w-3.5 h-3.5" />, label: 'Ranked list', value: jevCalls ? `${jevCalls} rows` : '—' },
  ];

  return (
    <div className={`flex items-stretch gap-1.5 overflow-x-auto pb-1 transition-opacity ${running ? 'opacity-60' : ''}`}>
      {stages.map((s, i) => (
        <div key={s.label} className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
            <span className="text-indigo-600">{s.icon}</span>
            <div>
              <p className="text-[11px] font-semibold text-slate-700 leading-tight">{s.label}</p>
              <p className="text-[10px] text-slate-400 tabular-nums leading-tight">{s.value}</p>
            </div>
          </div>
          {i < stages.length - 1 && <span className="text-slate-300 text-xs">→</span>}
        </div>
      ))}
    </div>
  );
}
