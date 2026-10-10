import { Zap, DollarSign, ArrowUpRight, ArrowDownRight, History } from 'lucide-react';
import type { SearchState, PastSearch } from '@/lib/useRecruiterSearch';

interface Props {
  state: SearchState | null;
  pastSearches: PastSearch[];
  onLoadPast: (id: string) => void;
  llmCost: { inputPerM: number; outputPerM: number; inputMult: number; outputTokens: number };
  onLlmCostChange: (c: { inputPerM: number; outputPerM: number; inputMult: number; outputTokens: number }) => void;
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">{icon}{label}</div>
      <p className="text-lg font-bold text-slate-800 tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

export function StatsPanel({ state, pastSearches, onLoadPast, llmCost, onLlmCostChange }: Props) {
  const promoted = state?.ranked.filter((r) => r.rank_delta > 0).length ?? 0;
  const demoted = state?.ranked.filter((r) => r.rank_delta < 0).length ?? 0;
  const latencies = state?.ranked.filter((r) => r.latency_ms > 0).map((r) => r.latency_ms).sort((a, b) => a - b) ?? [];
  const avg = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0;
  const p95 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;
  const totalInput = state?.ranked.reduce((s, r) => s + r.usage.input_tokens, 0) ?? 0;
  const llmJudgeCost =
    (totalInput * llmCost.inputMult / 1e6) * llmCost.inputPerM +
    (state?.jev_calls ?? 0) * llmCost.outputTokens / 1e6 * llmCost.outputPerM;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Jev calls" value={String(state?.jev_calls ?? 0)} icon={<Zap className="w-3 h-3" />} sub={state?.heuristic ? 'heuristic fallback' : undefined} />
        <Stat label="Jev cost" value={`$${(state?.total_cost_usd ?? 0).toFixed(4)}`} icon={<DollarSign className="w-3 h-3" />} sub={`LLM judge ≈ $${llmJudgeCost.toFixed(4)}`} />
        <Stat label="Avg / p95 latency" value={avg ? `${avg} / ${p95}ms` : '—'} icon={<Zap className="w-3 h-3" />} />
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium"><ArrowUpRight className="w-3 h-3" />Promoted / demoted</div>
          <p className="text-lg font-bold tabular-nums mt-0.5">
            <span className="text-emerald-600">+{promoted}</span>{' '}
            <span className="text-red-500">−{demoted}</span>
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
        <p className="text-[11px] font-semibold text-slate-600">LLM-judge cost model (editable)</p>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <label className="flex justify-between items-center gap-1">
            <span className="text-slate-500">In $/M</span>
            <input type="number" step={0.5} value={llmCost.inputPerM} onChange={(e) => onLlmCostChange({ ...llmCost, inputPerM: Number(e.target.value) })}
              className="w-14 px-1.5 py-0.5 rounded border border-slate-200 text-right tabular-nums" />
          </label>
          <label className="flex justify-between items-center gap-1">
            <span className="text-slate-500">Out $/M</span>
            <input type="number" step={2.5} value={llmCost.outputPerM} onChange={(e) => onLlmCostChange({ ...llmCost, outputPerM: Number(e.target.value) })}
              className="w-14 px-1.5 py-0.5 rounded border border-slate-200 text-right tabular-nums" />
          </label>
          <label className="flex justify-between items-center gap-1">
            <span className="text-slate-500">In ×</span>
            <input type="number" step={0.1} value={llmCost.inputMult} onChange={(e) => onLlmCostChange({ ...llmCost, inputMult: Number(e.target.value) })}
              className="w-14 px-1.5 py-0.5 rounded border border-slate-200 text-right tabular-nums" />
          </label>
          <label className="flex justify-between items-center gap-1">
            <span className="text-slate-500">Out tok</span>
            <input type="number" step={50} value={llmCost.outputTokens} onChange={(e) => onLlmCostChange({ ...llmCost, outputTokens: Number(e.target.value) })}
              className="w-14 px-1.5 py-0.5 rounded border border-slate-200 text-right tabular-nums" />
          </label>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 mb-2"><History className="w-3.5 h-3.5" /> Past searches</p>
        {pastSearches.length === 0 ? (
          <p className="text-[11px] text-slate-400">No searches yet.</p>
        ) : (
          <ul className="space-y-1">
            {pastSearches.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onLoadPast(s.id)}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <p className="text-[11px] text-slate-700 truncate">{s.query_text || s.preset}</p>
                  <p className="text-[10px] text-slate-400">{new Date(s.created_at).toLocaleString()}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
