import { useCallback, useMemo, useState } from 'react';
import { Search as SearchIcon, Zap, Sparkles, Briefcase, ChevronDown, X, RefreshCw, Loader2, Database } from 'lucide-react';
import { ToastProvider, useToast } from '@/components/Toasts';
import { WeightsPanel } from '@/components/WeightsPanel';
import { ResultsList } from '@/components/ResultsList';
import { SlopeChart } from '@/components/SlopeChart';
import { StatsPanel } from '@/components/StatsPanel';
import { CandidateDrawer } from '@/components/CandidateDrawer';
import { PipelineStrip } from '@/components/PipelineStrip';
import { useRecruiterSearch } from '@/lib/useRecruiterSearch';
import { PRESET_QUERIES, PRESET_SPECS } from '@/lib/mockParse';
import { DEFAULT_SETTINGS } from '@/lib/ranking';
import { DailyLimitError, isSupabaseConfigured } from '@/lib/supabase';
import type { Retriever, LlmMode, RoleSpec, Weights, RankSettings, RankedCandidate } from '@/lib/types';
import type { Job } from '@/lib/jobs';

const RETRIEVERS: { key: Retriever; label: string }[] = [
  { key: 'bm25', label: 'BM25' },
  { key: 'embeddings', label: 'Embeddings' },
  { key: 'hybrid', label: 'Hybrid' },
];

function ChipEditor({ label, items, onRemove, tone }: {
  label: string; items: string[]; onRemove: (i: number) => void; tone: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-1 w-16 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((item, i) => (
          <span key={`${item}-${i}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${tone}`}>
            {item}
            <button onClick={() => onRemove(i)} className="opacity-50 hover:opacity-100"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
    </div>
  );
}

function SpecChips({ spec, onChange, onRerank, busy }: {
  spec: RoleSpec; onChange: (s: RoleSpec) => void; onRerank: () => void; busy: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-700">Parsed role spec — edit the chips, then rerank</p>
        <button
          onClick={onRerank}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Rerank
        </button>
      </div>
      <ChipEditor label="Must-have" items={spec.must_have} tone="bg-indigo-100 text-indigo-800"
        onRemove={(i) => onChange({ ...spec, must_have: spec.must_have.filter((_, j) => j !== i) })} />
      <ChipEditor label="Nice-to-have" items={spec.nice_to_have} tone="bg-sky-100 text-sky-800"
        onRemove={(i) => onChange({ ...spec, nice_to_have: spec.nice_to_have.filter((_, j) => j !== i) })} />
      <div className="flex items-start gap-1.5">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-1 w-16 shrink-0">Seniority</span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-100 text-violet-800 capitalize">
          {spec.seniority}{spec.min_years ? ` · ${spec.min_years}+ yrs` : ''}
        </span>
        <span className="text-[11px] text-slate-500 self-center">{spec.seniority_description}</span>
      </div>
      <div className="flex items-start gap-1.5">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-1 w-16 shrink-0">Location</span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-800">
          {spec.location.remote}{spec.location.accepted_countries.length ? ` · ${spec.location.accepted_countries.join(', ')}` : ''}
        </span>
        {spec.location.overlap_window && (
          <span className="text-[11px] text-slate-500 self-center">overlap {spec.location.overlap_window.start_utc_hour}:00–{spec.location.overlap_window.end_utc_hour}:00 UTC</span>
        )}
      </div>
      {spec.domain && (
        <div className="flex items-start gap-1.5">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-1 w-16 shrink-0">Domain</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800">{spec.domain}</span>
        </div>
      )}
    </div>
  );
}

function AppInner() {
  const { toasts, push } = useToast();
  const [query, setQuery] = useState(PRESET_QUERIES[0].query);
  const [retriever, setRetriever] = useState<Retriever>('bm25');
  const [llmMode, setLlmMode] = useState<LlmMode>('live');
  const [k, setK] = useState(20);
  const [weights, setWeights] = useState<Weights>({ skills: 0.4, seniority: 0.25, location: 0.2, domain: 0.15, retrieval_prior: 0 });
  const [settings, setSettings] = useState<RankSettings>(DEFAULT_SETTINGS);
  const [drawer, setDrawer] = useState<RankedCandidate | null>(null);
  const [editedSpec, setEditedSpec] = useState<RoleSpec | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [llmCost, setLlmCost] = useState({ inputPerM: 2.5, outputPerM: 10, inputMult: 1.5, outputTokens: 200 });
  const [buildEmbedsBusy, setBuildEmbedsBusy] = useState(false);

  const { state, running, pastSearches, runSearch, loadPastSearch, fetchExplanation } = useRecruiterSearch(
    retriever, llmMode, k, weights, settings, push,
  );

  useMemo(() => {
    import('@/lib/supabase').then(async ({ supabase }) => {
      if (!supabase) return;
      const { data } = await supabase.from('jobs').select('*').order('created_at');
      if (data) setJobs(data as Job[]);
    }).catch(() => {});
  }, []);

  const doSearch = useCallback((text?: string, preset?: string) => {
    const q = text ?? query;
    setEditedSpec(null);
    runSearch(q, preset ?? null);
  }, [query, runSearch]);

  const buildEmbeddings = useCallback(async () => {
    setBuildEmbedsBusy(true);
    try {
      const { invokeFunction, supabase } = await import('@/lib/supabase');
      if (!supabase) {
        push('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to use this feature.', 'error');
        return;
      }
      const res = await invokeFunction<{ embedded: number; skipped: number; message?: string }>('embed-candidates', {});
      push(res.message ?? `Embedded ${res.embedded} candidate(s)${res.skipped ? `, skipped ${res.skipped} existing` : ''}.`, 'success');
    } catch (e) {
      if (e instanceof DailyLimitError) {
        push('Daily demo limit reached for embed-candidates. Try again tomorrow.', 'info');
      } else {
        push(`Build embeddings failed: ${e instanceof Error ? e.message : 'error'}`, 'error');
      }
    } finally {
      setBuildEmbedsBusy(false);
    }
  }, [push]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {!isSupabaseConfigured && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-center">
          <p className="text-sm text-amber-800">
            Supabase is not configured. Set <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">VITE_SUPABASE_URL</code> and{' '}
            <code className="font-mono text-xs bg-amber-100 px-1 py-0.5 rounded">VITE_SUPABASE_ANON_KEY</code> in your environment to enable live search. The app runs in Replay mode until then.
          </p>
        </div>
      )}
      {/* Hero */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center"><SearchIcon className="w-4 h-4 text-white" /></div>
                <span className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Recruiter Search</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 leading-tight">
                Retrieval finds, Jev judges, you set the weights.
              </h1>
              <p className="text-sm text-slate-500 mt-1.5 max-w-2xl leading-relaxed">
                A fast retriever pulls a shortlist; Jev scores each candidate with explainable sub-scores;
                plain code combines the scores — so moving a slider re-sorts the list instantly, with no new model calls.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
                {RETRIEVERS.map((r) => (
                  <button key={r.key} onClick={() => setRetriever(r.key)}
                    className={`px-3 py-1.5 transition-colors ${retriever === r.key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {r.label}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
                {(['live', 'mock'] as LlmMode[]).map((m) => (
                  <button key={m} onClick={() => setLlmMode(m)}
                    className={`px-3 py-1.5 capitalize transition-colors ${llmMode === m ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {m} LLM
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-5">
            <PipelineStrip timings={state?.timings ?? { parse_ms: 0, search_ms: 0, jev_ms: 0 }} k={k} jevCalls={state?.jev_calls ?? 0} running={running} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4 min-w-0">
          {/* Search panel */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doSearch()}
                  placeholder="Describe the role, or paste a job posting…"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <button
                onClick={() => doSearch()}
                disabled={running}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Search
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_QUERIES.map((p) => (
                <button key={p.key} onClick={() => { setQuery(p.query); doSearch(p.query, p.key); }} disabled={running}
                  className="px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium hover:bg-indigo-50 hover:text-indigo-700 transition-colors">
                  {p.label}
                </button>
              ))}
              <div className="relative">
                <select
                  onChange={(e) => { const j = jobs.find((x) => x.id === e.target.value); if (j) { const q = `${j.title} at ${j.company}. ${j.description} Location: ${j.location}`; setQuery(q); doSearch(q); } }}
                  defaultValue=""
                  disabled={running || jobs.length === 0}
                  className="appearance-none pl-3 pr-7 py-1.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium focus:outline-none cursor-pointer"
                >
                  <option value="" disabled>Use a job posting…</option>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.title} · {j.company}</option>)}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <label className="text-xs text-slate-500">Shortlist k</label>
                <input type="range" min={10} max={30} step={5} value={k} onChange={(e) => setK(Number(e.target.value))} className="w-24 accent-indigo-600" />
                <span className="text-xs font-semibold tabular-nums text-slate-700 w-5">{k}</span>
              </div>
            </div>
          </section>

          {/* Spec chips */}
          {state && (
            <SpecChips
              spec={editedSpec ?? state.spec}
              onChange={setEditedSpec}
              onRerank={() => { if (editedSpec) { const q = query; runSearch(q, null); setEditedSpec(null); } }}
              busy={running}
            />
          )}

          {/* Results */}
          {state && state.ranked.length > 0 && (
            <ResultsList ranked={state.ranked} spec={state.spec} onOpenDrawer={setDrawer} fetchExplanation={fetchExplanation} />
          )}

          {!state && !running && (
            <div className="text-center py-16 text-slate-400">
              <Briefcase className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Run a search to see the ranked shortlist.</p>
              <p className="text-xs mt-1">Try a preset above — the demo is fully seeded with fictional candidates.</p>
            </div>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-4 lg:sticky lg:top-4 self-start">
          <WeightsPanel weights={weights} settings={settings} onWeights={setWeights} onSettings={setSettings} disabled={false} />
          <SlopeChart ranked={state?.ranked ?? []} onHover={setHoveredId} hoveredId={hoveredId} />
          <StatsPanel state={state} pastSearches={pastSearches} onLoadPast={loadPastSearch} llmCost={llmCost} onLlmCostChange={setLlmCost} />
          <button
            onClick={buildEmbeddings}
            disabled={buildEmbedsBusy}
            className="w-full inline-flex items-center justify-center gap-2 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            {buildEmbedsBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
            Build embeddings
          </button>
        </div>
      </main>

      <CandidateDrawer item={drawer} onClose={() => setDrawer(null)} />

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-[60] space-y-2 max-w-sm">
        {toasts.map((t) => (
          <div key={t.id}
            className={`px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium animate-[slideUp_0.2s_ease-out] ${
              t.kind === 'error' ? 'bg-red-600 text-white' : t.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'
            }`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
