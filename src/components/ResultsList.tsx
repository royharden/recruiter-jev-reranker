import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, TrendingUp, TrendingDown, Minus, AlertTriangle, Clock, ShieldAlert,
  Sparkles, HelpCircle, MapPin, X, ChevronRight,
} from 'lucide-react';
import type { RankedCandidate, RoleSpec } from '@/lib/types';

interface Props {
  ranked: RankedCandidate[];
  spec: RoleSpec;
  onOpenDrawer: (c: RankedCandidate) => void;
  fetchExplanation: (candidateId: string) => Promise<{ why: string; strengths: string[]; gaps: string[] } | null>;
}

const SKILL_COLOR = (noul: number) =>
  noul >= 0.8 ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
  : noul >= 0.5 ? 'bg-amber-100 text-amber-800 border-amber-200'
  : 'bg-red-100 text-red-700 border-red-200';

function SubBar({ label, value }: { label: string; value: number }) {
  const color = value >= 0.7 ? 'bg-emerald-500' : value >= 0.4 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-slate-500 w-12 shrink-0">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.round(value * 100)}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-slate-400 w-7 text-right">{Math.round(value * 100)}</span>
    </div>
  );
}

function Chip({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'amber' | 'red' | 'green' | 'indigo' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
    green: 'bg-emerald-100 text-emerald-800',
    indigo: 'bg-indigo-100 text-indigo-700',
  };
  return <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${tones[tone]}`}>{children}</span>;
}

function ProbBar({ label, prob }: { label: string; prob: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-16 text-slate-600 truncate">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.round(prob * 100)}%` }} />
      </div>
      <span className="tabular-nums text-slate-400 w-8 text-right">{Math.round(prob * 100)}%</span>
    </div>
  );
}

function Card({ item, spec, onOpenDrawer, fetchExplanation }: { item: RankedCandidate; spec: RoleSpec; onOpenDrawer: Props['onOpenDrawer']; fetchExplanation: Props['fetchExplanation'] }) {
  const [expanded, setExpanded] = useState(false);
  const [why, setWhy] = useState<{ why: string; strengths: string[]; gaps: string[] } | null>(null);
  const [whyLoading, setWhyLoading] = useState(false);
  const c = item.candidate;
  const delta = item.rank_delta;

  const loadWhy = async () => {
    if (why || whyLoading) return;
    setWhyLoading(true);
    const res = await fetchExplanation(item.candidate.id);
    setWhy(res ?? { why: 'Explanation unavailable right now.', strengths: [], gaps: [] });
    setWhyLoading(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ layout: { type: 'spring', stiffness: 300, damping: 32 } }}
      className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
        item.flags.flagged ? 'border-red-300' : 'border-slate-200'
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center shrink-0">
            <span className="text-lg font-bold text-slate-800 tabular-nums leading-none">{item.final_rank}</span>
            <span
              className={`mt-1 flex items-center gap-0.5 text-[10px] font-semibold tabular-nums ${
                delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-500' : 'text-slate-400'
              }`}
              title={`Retrieval rank was ${item.retrieval_rank}`}
            >
              {delta > 0 ? <TrendingUp className="w-3 h-3" /> : delta < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
              {delta !== 0 ? Math.abs(delta) : ''}
            </span>
          </div>

          <div className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
            {c.initials}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{c.headline}</p>
                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{c.city}, {c.country}</span>
                  <span>·</span>
                  <span>{item.subscores.total_years} yrs</span>
                  <span>·</span>
                  <span className="capitalize">{c.remote_preference}</span>
                </p>
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`inline-block px-2 py-0.5 rounded-md text-sm font-bold tabular-nums ${
                    item.composite >= 70 ? 'bg-emerald-50 text-emerald-700' : item.composite >= 45 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                  }`}
                >
                  {item.composite.toFixed(0)}
                </span>
                {item.latency_ms > 0 && (
                  <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                    {item.latency_ms}ms · ${item.cost_usd.toFixed(4)}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-2.5 space-y-1">
              <SubBar label="Skills" value={item.subscores.skills} />
              <SubBar label="Seniority" value={item.subscores.seniority} />
              <SubBar label="Location" value={item.subscores.location} />
              <SubBar label="Domain" value={item.subscores.domain} />
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {spec.must_have.map((s, i) => {
                const a = item.answers[`must_${i}`];
                const noul = a?.type === 'noul' ? a.noul : null;
                if (noul === null) return null;
                return (
                  <span key={s} className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${SKILL_COLOR(noul)}`}>
                    {s} {Math.round(noul * 100)}%
                  </span>
                );
              })}
              {item.flags.gate_skills.map((s) => (
                <Chip key={`gate-${s}`} tone="red">Missing: {s}</Chip>
              ))}
              {item.flags.timezone && <Chip tone="amber"><Clock className="w-3 h-3" />Timezone</Chip>}
              {item.flags.uncertain.length > 0 && <Chip tone="amber">Uncertain ×{item.flags.uncertain.length}</Chip>}
              {item.flags.flagged && (
                <Chip tone="red"><ShieldAlert className="w-3 h-3" />Flagged: instructions to AI</Chip>
              )}
              {item.heuristic && <Chip tone="amber">Heuristic (not Jev)</Chip>}
            </div>
          </div>

          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 shrink-0"
            aria-label="Toggle details"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-slate-100 bg-slate-50/60"
          >
            <div className="p-4 space-y-3 text-xs">
              {(['seniority', 'location'] as const).map((key) => {
                const a = item.answers[key];
                if (!a || a.type !== 'choice') return null;
                return (
                  <div key={key} className="space-y-1">
                    <p className="font-semibold text-slate-700 capitalize">{key}: {a.choice} <span className="font-normal text-slate-400">({Math.round(a.confidence * 100)}% conf)</span></p>
                    {Object.entries(a.probabilities).map(([k, p]) => (
                      <ProbBar key={k} label={k} prob={p} />
                    ))}
                  </div>
                );
              })}
              {item.answers['domain']?.type === 'score' && (
                <div className="space-y-1">
                  <p className="font-semibold text-slate-700">Domain: {item.answers['domain'].score.toFixed(1)} / 3</p>
                  {Object.entries(item.answers['domain'].probabilities).map(([k, p]) => (
                    <ProbBar key={k} label={['Unrelated', 'Adjacent', 'Related', 'Same'][Number(k)] ?? k} prob={p} />
                  ))}
                </div>
              )}
              {item.flags.flagged && (
                <p className="text-red-600 flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" /> Jev answers for this candidate are marked untrusted.</p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={loadWhy}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 font-medium"
                >
                  <Sparkles className="w-3 h-3" /> Why this rank?
                </button>
                <button
                  onClick={() => onOpenDrawer(item)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 font-medium"
                >
                  Full profile <ChevronRight className="w-3 h-3" />
                </button>
              </div>
              {why && <WhyPanel why={why.why} strengths={why.strengths} gaps={why.gaps} loading={whyLoading} onClose={() => setWhy(null)} />}
              <details className="group">
                <summary className="cursor-pointer text-slate-400 hover:text-slate-600 font-medium select-none flex items-center gap-1">
                  <HelpCircle className="w-3.5 h-3.5" /> Raw Jev JSON
                </summary>
                <pre className="mt-1.5 p-2 rounded-lg bg-slate-900 text-slate-100 text-[10px] leading-relaxed overflow-x-auto max-h-56">
                  {JSON.stringify(item.answers, null, 2)}
                </pre>
              </details>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function ResultsList({ ranked, spec, onOpenDrawer, fetchExplanation }: Props) {
  return (
    <div className="space-y-2.5">
      <AnimatePresence initial={false}>
        {ranked.map((item) => (
          <motion.div key={item.candidate.id} layout>
            <Card item={item} spec={spec} onOpenDrawer={onOpenDrawer} fetchExplanation={fetchExplanation} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function WhyPanel({ why, strengths, gaps, loading, onClose }: {
  why: string; strengths: string[]; gaps: string[]; loading: boolean; onClose: () => void;
}) {
  return (
    <div className="p-4 border-t border-indigo-100 bg-indigo-50/50 space-y-2">
      {loading ? (
        <p className="text-xs text-indigo-600 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 animate-pulse" /> Writing explanation…</p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-slate-700 leading-relaxed flex-1">{why}</p>
            <button onClick={onClose} className="p-1 rounded hover:bg-indigo-100 text-indigo-400"><X className="w-3.5 h-3.5" /></button>
          </div>
          {strengths.length > 0 && (
            <ul className="space-y-0.5">
              {strengths.map((s, i) => <li key={i} className="text-[11px] text-emerald-700 flex gap-1"><span>+</span>{s}</li>)}
            </ul>
          )}
          {gaps.length > 0 && (
            <ul className="space-y-0.5">
              {gaps.map((s, i) => <li key={i} className="text-[11px] text-amber-700 flex gap-1"><span>−</span>{s}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export { AlertTriangle };
