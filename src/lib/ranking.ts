import type {
  Candidate, JevAnswer, RankedCandidate, RankFlags, RetrievalHit, RoleSpec, SubScores, Weights, RankSettings,
} from './types';

export const DEFAULT_WEIGHTS: Weights = { skills: 0.4, seniority: 0.25, location: 0.2, domain: 0.15, retrieval_prior: 0 };

export const WEIGHT_PRESETS: Record<string, Weights> = {
  Balanced: { skills: 0.4, seniority: 0.25, location: 0.2, domain: 0.15, retrieval_prior: 0 },
  'Skills-first': { skills: 0.6, seniority: 0.2, location: 0.1, domain: 0.1, retrieval_prior: 0 },
  'Local hire': { skills: 0.3, seniority: 0.2, location: 0.4, domain: 0.1, retrieval_prior: 0 },
};

export const DEFAULT_SETTINGS: RankSettings = {
  must_have_gate: true,
  show_flagged_in_place: false,
  seniority_ev: { below: 0.25, matches: 1.0, above: 0.6, uncertain: 0.5 },
};

const LOCATION_EV: Record<string, number> = {
  works_now: 1.0, relocate: 0.7, mismatch: 0.0, uncertain: 0.5,
};

// Sum years across experience entries, merging overlapping ranges.
export function totalYears(c: Candidate): number {
  const parse = (s: string) => {
    const [y, m] = s.split('-').map(Number);
    return y + (m - 1) / 12;
  };
  const now = new Date();
  const nowDec = now.getFullYear() + now.getMonth() / 12;
  const ranges = c.experience
    .map((e) => [parse(e.start), e.end ? parse(e.end) : nowDec] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [s, e] of ranges) {
    if (curStart < 0) { curStart = s; curEnd = e; continue; }
    if (s <= curEnd) curEnd = Math.max(curEnd, e);
    else { total += curEnd - curStart; curStart = s; curEnd = e; }
  }
  if (curStart >= 0) total += curEnd - curStart;
  return Math.round(total * 10) / 10;
}

function noulCertainty(a: JevAnswer): number {
  if (a.type !== 'noul') return 1;
  return Math.abs(2 * a.noul - 1);
}

function evFor(a: JevAnswer, ev: Record<string, number>): number {
  if (a.type === 'choice') {
    let sum = 0;
    for (const [k, p] of Object.entries(a.probabilities)) sum += (ev[k] ?? 0.5) * p;
    return sum;
  }
  return 0.5;
}

function scoreEv(a: JevAnswer): number {
  if (a.type === 'score') {
    let sum = 0;
    for (const [k, p] of Object.entries(a.probabilities)) sum += Number(k) * p;
    return sum / 3;
  }
  return 0;
}

export function computeSubscores(
  answers: Record<string, JevAnswer>,
  spec: RoleSpec,
  candidate: Candidate,
  settings: RankSettings,
): SubScores {
  const mustNouls: number[] = [];
  const niceNouls: number[] = [];
  spec.must_have.forEach((_, i) => {
    const a = answers[`must_${i}`];
    if (a && a.type === 'noul') mustNouls.push(a.noul);
  });
  spec.nice_to_have.forEach((_, i) => {
    const a = answers[`nice_${i}`];
    if (a && a.type === 'noul') niceNouls.push(a.noul);
  });

  const mustMean = mustNouls.length ? mustNouls.reduce((s, v) => s + v, 0) / mustNouls.length : 0.5;
  const niceMean = niceNouls.length ? niceNouls.reduce((s, v) => s + v, 0) / niceNouls.length : mustMean;
  const skills = mustNouls.length === 0 ? 0.5 : 0.75 * mustMean + 0.25 * niceMean;

  const seniorityAnswer = answers['seniority'];
  const ev = evFor(seniorityAnswer, settings.seniority_ev as unknown as Record<string, number>);
  const years = totalYears(candidate);
  const yearsFit = spec.min_years ? Math.min(1, years / spec.min_years) : 1;
  const seniority = 0.7 * ev + 0.3 * yearsFit;

  let location = seniorityAnswer && answers['location'] ? evFor(answers['location'], LOCATION_EV) : 0.5;
  const timezoneCapped = capForTimezone(spec, candidate);
  if (timezoneCapped) location = Math.min(location, 0.4);

  const domain = answers['domain'] && answers['domain'].type === 'score' ? scoreEv(answers['domain']) : 0.5;

  return { skills, seniority, location, domain, total_years: years };
}

function capForTimezone(spec: RoleSpec, candidate: Candidate): boolean {
  const w = spec.location.overlap_window;
  if (!w) return false;
  const off = candidate.utc_offset;
  // Hours of the candidate's workday (9-17 local) overlapping the window
  const candStart = 9 - off;
  const candEnd = 17 - off;
  const overlap = Math.max(0, Math.min(candEnd, w.end_utc_hour) - Math.max(candStart, w.start_utc_hour));
  return overlap < 3;
}

export function computeFlags(
  answers: Record<string, JevAnswer>,
  spec: RoleSpec,
  candidate: Candidate,
  settings: RankSettings,
): RankFlags {
  const gate_skills: string[] = [];
  spec.must_have.forEach((skill, i) => {
    const a = answers[`must_${i}`];
    if (a && a.type === 'noul' && a.noul < 0.2) gate_skills.push(skill);
  });
  const injection = answers['injection'];
  const flagged = !!(injection && injection.type === 'noul' && injection.noul >= 0.5);
  const timezone = !!spec.location.overlap_window && capForTimezone(spec, candidate);

  const uncertain: string[] = [];
  for (const [key, a] of Object.entries(answers)) {
    if (a.type === 'choice' && (a.confidence < 0.6 || a.choice === 'uncertain')) uncertain.push(key);
    if (a.type === 'noul' && noulCertainty(a) < 0.4) uncertain.push(key);
  }

  return { gate_skills, timezone, uncertain, flagged };
}

export function rankCandidates(
  results: {
    hit: RetrievalHit;
    answers: Record<string, JevAnswer>;
    model: string;
    usage: { input_tokens: number };
    latency_ms: number;
    cost_usd: number;
    heuristic: boolean;
  }[],
  spec: RoleSpec,
  weights: Weights,
  settings: RankSettings,
): RankedCandidate[] {
  const wSum = weights.skills + weights.seniority + weights.location + weights.domain + weights.retrieval_prior;
  const maxScore = Math.max(...results.map((r) => r.hit.retrieval_score), 1e-9);

  const scored = results.map((r) => {
    const subscores = computeSubscores(r.answers, spec, r.hit.candidate, settings);
    const prior = r.hit.retrieval_score / maxScore;
    const raw =
      weights.skills * subscores.skills +
      weights.seniority * subscores.seniority +
      weights.location * subscores.location +
      weights.domain * subscores.domain +
      weights.retrieval_prior * prior;
    let composite = 100 * (raw / Math.max(wSum, 1e-9));

    const flags = computeFlags(r.answers, spec, r.hit.candidate, settings);
    if (settings.must_have_gate && flags.gate_skills.length > 0) composite *= 0.6;

    return { ...r, subscores, composite, flags };
  });

  // Injection flags drop to the bottom (unless toggled otherwise)
  scored.sort((a, b) => {
    const fa = !settings.show_flagged_in_place && a.flags.flagged ? 1 : 0;
    const fb = !settings.show_flagged_in_place && b.flags.flagged ? 1 : 0;
    if (fa !== fb) return fa - fb;
    if (Math.abs(b.composite - a.composite) > 1e-9) return b.composite - a.composite;
    return a.hit.retrieval_rank - b.hit.retrieval_rank;
  });

  return scored.map((s, i) => ({
    candidate: s.hit.candidate,
    retrieval_rank: s.hit.retrieval_rank,
    retrieval_score: s.hit.retrieval_score,
    answers: s.answers,
    model: s.model,
    usage: s.usage,
    latency_ms: s.latency_ms,
    cost_usd: s.cost_usd,
    subscores: s.subscores,
    composite: Math.round(s.composite * 10) / 10,
    final_rank: i + 1,
    rank_delta: s.hit.retrieval_rank - (i + 1),
    flags: s.flags,
    heuristic: s.heuristic,
  }));
}
