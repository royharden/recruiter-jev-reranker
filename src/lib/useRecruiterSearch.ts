import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeFunction, supabase, DailyLimitError, isSupabaseConfigured } from './supabase';
import { parseQueryMock, PRESET_SPECS } from './mockParse';
import { rankCandidates, DEFAULT_WEIGHTS, DEFAULT_SETTINGS } from './ranking';
import { heuristicRank } from './heuristic';
import type {
  JevAnswer, LlmMode, RankedCandidate, RetrievalHit, RoleSpec, Retriever, Weights, RankSettings,
} from './types';
import type { SearchResponse, JevCandidateResult } from './types';

export interface StageTimings {
  parse_ms: number;
  search_ms: number;
  jev_ms: number;
}

export interface PastSearch {
  id: string;
  query_text: string;
  preset: string | null;
  created_at: string;
}

export interface SearchState {
  searchId: string | null;
  spec: RoleSpec;
  hits: RetrievalHit[];
  retriever_used: Retriever;
  fallback_reason: string | null;
  ranked: RankedCandidate[];
  timings: StageTimings;
  total_cost_usd: number;
  jev_calls: number;
  heuristic: boolean;
}

interface JevResponse {
  results: (JevCandidateResult & { candidate_id: string })[];
  errors: string[];
  model: string;
  total_latency_ms: number;
}

interface ExplainResponse {
  explanation: { why: string; strengths: string[]; gaps: string[] };
  mode: string;
}

const num = (v: number | string | null | undefined, fallback = 0) =>
  v === null || v === undefined ? fallback : typeof v === 'number' ? v : Number(v) || fallback;

export function useRecruiterSearch(
  retriever: Retriever,
  llmMode: LlmMode,
  k: number,
  weights: Weights,
  settings: RankSettings,
  pushToast: (msg: string, kind?: 'info' | 'error' | 'success') => void,
) {
  const [state, setState] = useState<SearchState | null>(null);
  const [running, setRunning] = useState(false);
  const [pastSearches, setPastSearches] = useState<PastSearch[]>([]);

  const rankedRef = useRef<RankedCandidate[]>([]);
  const specRef = useRef<RoleSpec | null>(null);
  const metaRef = useRef<{ searchId: string | null; timings: StageTimings; cost: number; calls: number; heuristic: boolean; hits: RetrievalHit[]; retriever_used: Retriever; fallback: string | null }>({
    searchId: null, timings: { parse_ms: 0, search_ms: 0, jev_ms: 0 }, cost: 0, calls: 0, heuristic: false, hits: [], retriever_used: 'bm25', fallback: null,
  });

  const applyRanking = useCallback(() => {
    const spec = specRef.current;
    if (!spec) return;
    const answersPerCandidate = rankedRef.current;
    const inputs = answersPerCandidate.map((r) => ({
      hit: { candidate_id: r.candidate.id, retrieval_rank: r.retrieval_rank, retrieval_score: r.retrieval_score, candidate: r.candidate },
      answers: r.answers,
      model: r.model,
      usage: r.usage,
      latency_ms: r.latency_ms,
      cost_usd: r.cost_usd,
      heuristic: r.heuristic,
    }));
    const ranked = rankCandidates(inputs, spec, weights, settings);
    setState({
      searchId: metaRef.current.searchId,
      spec,
      hits: metaRef.current.hits,
      retriever_used: metaRef.current.retriever_used,
      fallback_reason: metaRef.current.fallback,
      ranked,
      timings: metaRef.current.timings,
      total_cost_usd: metaRef.current.cost,
      jev_calls: metaRef.current.calls,
      heuristic: metaRef.current.heuristic,
    });
  }, [weights, settings]);

  useEffect(() => {
    if (rankedRef.current.length && specRef.current) applyRanking();
  }, [weights, settings, applyRanking]);

  const loadPastSearches = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('searches')
      .select('id, query_text, preset, created_at')
      .order('created_at', { ascending: false })
      .limit(12);
    if (data) setPastSearches(data as PastSearch[]);
  }, []);

  useEffect(() => {
    loadPastSearches();
  }, [loadPastSearches]);

  const persistSearch = useCallback(
    async (spec: RoleSpec, hits: RetrievalHit[], jevResults: (JevCandidateResult & { candidate_id: string })[], ranked: RankedCandidate[], queryText: string, presetKey: string | null, cost: number) => {
      if (!supabase) return null;
      const { data: searchData, error } = await supabase
        .from('searches')
        .insert({
          query_text: queryText,
          preset: presetKey,
          role_spec: spec,
          retriever,
          k,
          llm_mode: llmMode,
          weights,
          settings: settings as unknown as Record<string, unknown>,
          jev_cost_usd: cost,
        })
        .select('id')
        .maybeSingle();
      if (error || !searchData) return null;
      const searchId = (searchData as { id: string }).id;
      const byId = new Map(ranked.map((r) => [r.candidate.id, r]));
      const rows = hits.map((h) => {
        const jev = jevResults.find((j) => j.candidate_id === h.candidate_id);
        const r = byId.get(h.candidate_id);
        return {
          search_id: searchId,
          candidate_id: h.candidate_id,
          retrieval_rank: h.retrieval_rank,
          retrieval_score: h.retrieval_score,
          jev_request: jev?.jev_request ?? null,
          jev_response: jev ? { answers: jev.answers } : null,
          model: r?.model ?? null,
          latency_ms: r?.latency_ms ?? null,
          input_tokens: r?.usage?.input_tokens ?? null,
          cost_usd: r?.cost_usd ?? null,
          subscores: r?.subscores ?? null,
          composite: r?.composite ?? null,
          final_rank: r?.final_rank ?? null,
          flags: r?.flags ?? null,
        };
      });
      if (rows.length) await supabase.from('search_results').insert(rows);
      return searchId;
    },
    [retriever, k, llmMode, weights, settings],
  );

  const runSearch = useCallback(
    async (queryText: string, presetKey: string | null = null) => {
      setRunning(true);
      try {
        // Stage 1: parse
        const parseStart = performance.now();
        let spec: RoleSpec;
        if (presetKey && PRESET_SPECS[presetKey]) {
          spec = PRESET_SPECS[presetKey];
        } else if (llmMode === 'mock' || !supabase) {
          spec = parseQueryMock(queryText);
        } else {
          try {
            const res = await invokeFunction<{ spec: RoleSpec; mode: string }>('parse-query', { query_text: queryText, llm_mode: llmMode });
            spec = res.spec;
            if (res.mode === 'mock_fallback') pushToast('LLM unavailable — used the rule-based parser instead.', 'info');
          } catch (e) {
            if (e instanceof DailyLimitError) {
              pushToast('Daily demo limit reached — switching to Replay mode.', 'info');
            } else {
              pushToast(`Query parse failed: ${e instanceof Error ? e.message : 'error'}`, 'error');
            }
            spec = parseQueryMock(queryText);
          }
        }
        const parse_ms = Math.round(performance.now() - parseStart);
        specRef.current = spec;

        // Stage 2: retrieve
        const searchStart = performance.now();
        let hits: RetrievalHit[];
        let retriever_used: Retriever = retriever;
        let fallback_reason: string | null = null;
        try {
          if (!supabase) throw new Error('Supabase is not configured.');
          const res = await invokeFunction<SearchResponse>('search', { query_spec: spec, query_text: queryText, retriever, k });
          hits = res.hits;
          retriever_used = res.retriever_used;
          fallback_reason = res.fallback_reason;
          if (res.fallback_reason) pushToast(res.fallback_reason, 'info');
        } catch (e) {
          if (e instanceof DailyLimitError) {
            pushToast('Daily demo limit reached — switching to Replay mode.', 'info');
          } else {
            pushToast(`Retrieval failed: ${e instanceof Error ? e.message : 'error'}`, 'error');
            setRunning(false);
            return;
          }
          if (!supabase) {
            pushToast('No candidates available for local fallback.', 'error');
            setRunning(false);
            return;
          }
          const { data: candRows } = await supabase.from('candidates').select('*');
          if (!candRows || candRows.length === 0) {
            pushToast('No candidates available for local fallback.', 'error');
            setRunning(false);
            return;
          }
          const { Bm25Index } = await import('./bm25');
          const index = new Bm25Index(candRows as import('./types').Candidate[]);
          const bm25Hits = index.search(`${queryText} ${spec.must_have.join(' ')}`, candRows.length);
          hits = bm25Hits.slice(0, k).map((h, i) => ({
            candidate_id: h.candidate_id,
            retrieval_rank: i + 1,
            retrieval_score: h.score,
            candidate: (candRows as import('./types').Candidate[]).find((c) => c.id === h.candidate_id)!,
          }));
          fallback_reason = 'Daily limit reached — using client-side BM25.';
        }
        const search_ms = Math.round(performance.now() - searchStart);

        // Stage 3: Jev fan-out
        const jevStart = performance.now();
        let jevResults: (JevCandidateResult & { candidate_id: string })[] = [];
        let heuristic = false;
        let jev_ms = 0;
        try {
          if (!supabase) throw new Error('Supabase is not configured.');
          const res = await invokeFunction<JevResponse>('jev-rerank', {
            query_spec: spec,
            candidate_ids: hits.map((h) => h.candidate_id),
          });
          jevResults = res.results;
          if (res.errors?.length) pushToast(`${res.errors.length} candidate(s) failed to rerank; others succeeded.`, 'info');
        } catch (e) {
          if (e instanceof DailyLimitError) {
            pushToast('Daily demo limit reached — showing heuristic scores instead (not Jev).', 'info');
          } else {
            pushToast(`Jev unreachable: ${e instanceof Error ? e.message : 'error'}. Showing heuristic scores instead — not Jev.`, 'error');
          }
          heuristic = true;
        }
        jev_ms = heuristic ? 0 : Math.round(performance.now() - jevStart);

        // Stage 4: rank in code
        const inputs = hits.map((h) => {
          const jev = jevResults.find((j) => j.candidate_id === h.candidate_id);
          return {
            hit: h,
            answers: (jev?.answers ?? {}) as Record<string, JevAnswer>,
            model: jev?.model ?? 'heuristic',
            usage: jev?.usage ?? { input_tokens: 0 },
            latency_ms: jev?.latency_ms ?? 0,
            cost_usd: jev?.cost_usd ?? 0,
            heuristic,
          };
        });

        let ranked: RankedCandidate[];
        if (heuristic) {
          ranked = heuristicRank(hits, spec, weights, settings);
        } else {
          ranked = rankCandidates(inputs, spec, weights, settings);
        }

        const cost = ranked.reduce((s, r) => s + r.cost_usd, 0);
        metaRef.current = { searchId: null, timings: { parse_ms, search_ms, jev_ms }, cost, calls: jevResults.length, heuristic, hits, retriever_used, fallback: fallback_reason };
        rankedRef.current = ranked;
        setState({
          searchId: null,
          spec,
          hits,
          retriever_used,
          fallback_reason,
          ranked,
          timings: { parse_ms, search_ms, jev_ms },
          total_cost_usd: cost,
          jev_calls: jevResults.length,
          heuristic,
        });

        (async () => {
          const searchId = await persistSearch(spec, hits, jevResults, ranked, queryText, presetKey, cost);
          if (searchId) {
            metaRef.current.searchId = searchId;
            setState((s) => (s ? { ...s, searchId } : s));
            loadPastSearches();
          }
        })();
      } finally {
        setRunning(false);
      }
    },
    [retriever, llmMode, k, weights, settings, pushToast, persistSearch, loadPastSearches],
  );

  const rerankWithEditedSpec = useCallback(
    async (spec: RoleSpec, queryText: string) => {
      specRef.current = spec;
      await runSearch(queryText, null);
    },
    [runSearch],
  );

  const loadPastSearch = useCallback(
    async (searchId: string) => {
      if (!supabase) return;
      setRunning(true);
      try {
        const [{ data: sRow }, { data: rRows }] = await Promise.all([
          supabase.from('searches').select('*').eq('id', searchId).maybeSingle(),
          supabase.from('search_results').select('*').eq('search_id', searchId).order('retrieval_rank'),
        ]);
        if (!sRow || !rRows) {
          pushToast('Could not load that past search.', 'error');
          return;
        }
        const spec = sRow.role_spec as RoleSpec;
        specRef.current = spec;
        const candidateIds = (rRows as { candidate_id: string }[]).map((r) => r.candidate_id);
        const { data: candRows } = await supabase.from('candidates').select('*').in('id', candidateIds);
        const candMap = new Map((candRows ?? []).map((c: { id: string }) => [c.id, c]));
        const hits: RetrievalHit[] = (rRows as StoredRow[]).map((r) => ({
          candidate_id: r.candidate_id,
          retrieval_rank: r.retrieval_rank,
          retrieval_score: num(r.retrieval_score),
          candidate: candMap.get(r.candidate_id) as never,
        })).filter((h) => h.candidate);

        const inputs = (rRows as StoredRow[]).filter((r) => candMap.has(r.candidate_id)).map((r) => {
          const answers = (r.jev_response?.answers ?? {}) as Record<string, JevAnswer>;
          return {
            hit: hits.find((h) => h.candidate_id === r.candidate_id)!,
            answers,
            model: r.model ?? 'heuristic',
            usage: { input_tokens: r.input_tokens ?? 0 },
            latency_ms: r.latency_ms ?? 0,
            cost_usd: num(r.cost_usd),
            heuristic: (r.model ?? '') === 'heuristic',
          };
        });
        const ranked = rankCandidates(inputs, spec, weights, settings);
        const cost = ranked.reduce((s, r) => s + r.cost_usd, 0);
        metaRef.current = {
          searchId, timings: { parse_ms: 0, search_ms: 0, jev_ms: 0 }, cost, calls: ranked.filter((r) => !r.heuristic).length,
          heuristic: ranked.some((r) => r.heuristic), hits, retriever_used: (sRow.retriever as Retriever) ?? 'bm25', fallback: null,
        };
        rankedRef.current = ranked;
        setState({
          searchId, spec, hits, retriever_used: (sRow.retriever as Retriever) ?? 'bm25', fallback_reason: null, ranked,
          timings: { parse_ms: 0, search_ms: 0, jev_ms: 0 }, total_cost_usd: cost, jev_calls: metaRef.current.calls, heuristic: metaRef.current.heuristic,
        });
        pushToast('Loaded a past search from history — no new Jev calls.', 'success');
      } finally {
        setRunning(false);
      }
    },
    [weights, settings, pushToast],
  );

  const fetchExplanation = useCallback(
    async (candidateId: string): Promise<ExplainResponse['explanation'] | null> => {
      const spec = specRef.current;
      const row = rankedRef.current.find((r) => r.candidate.id === candidateId);
      if (!spec || !row) return null;
      if (llmMode === 'live' && supabase) {
        try {
          const res = await invokeFunction<ExplainResponse>('explain', {
            query_spec: spec,
            candidate: {
              headline: row.candidate.headline,
              skills: row.candidate.skills,
              experience: row.candidate.experience.map((e) => ({ title: e.title, company: e.company, summary: e.summary })),
              location: `${row.candidate.city}, ${row.candidate.country}`,
              remote_preference: row.candidate.remote_preference,
              summary: row.candidate.summary,
            },
            subscores: row.subscores,
            composite: row.composite,
            answers: row.answers,
            llm_mode: llmMode,
          });
          return res.explanation;
        } catch (e) {
          if (e instanceof DailyLimitError) return null;
          pushToast(`Explanation failed: ${e instanceof Error ? e.message : 'error'}`, 'error');
          return null;
        }
      }
      return null;
    },
    [llmMode, pushToast],
  );

  return { state, running, pastSearches, runSearch, rerankWithEditedSpec, loadPastSearch, loadPastSearches, fetchExplanation, setState };
}

interface StoredRow {
  candidate_id: string;
  retrieval_rank: number;
  retrieval_score: number | string;
  jev_response: { answers?: Record<string, JevAnswer> } | null;
  model: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  cost_usd: number | string | null;
  subscores: RankedCandidate['subscores'] | null;
  composite: number | string | null;
  final_rank: number | null;
  flags: RankedCandidate['flags'] | null;
}

export { DEFAULT_WEIGHTS, DEFAULT_SETTINGS };
