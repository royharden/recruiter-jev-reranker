import { findSkillsInText } from './skills';
import type { JevAnswer, RetrievalHit, RoleSpec, Weights, RankSettings, RankedCandidate } from './types';
import { totalYears, DEFAULT_SETTINGS } from './ranking';

// Labeled fallback when Jev is unreachable. Never shown as a Jev result.
export function heuristicRank(
  hits: RetrievalHit[],
  spec: RoleSpec,
  weights: Weights,
  settings: RankSettings,
): RankedCandidate[] {
  const wSum = weights.skills + weights.seniority + weights.location + weights.domain + weights.retrieval_prior;
  const maxScore = Math.max(...hits.map((h) => h.retrieval_score), 1e-9);

  const scored = hits.map((hit) => {
    const c = hit.candidate;
    const text = [c.headline, c.skills.join(' '), c.experience.map((e) => `${e.title} ${e.summary}`).join(' '), c.summary].join(' ');
    const lower = text.toLowerCase();

    const skillHit = (skill: string) => findSkillsInText(skill).some((s) => lower.includes(s.toLowerCase()));
    const mustHits = spec.must_have.filter(skillHit);
    const niceHits = spec.nice_to_have.filter(skillHit);
    const skills = (0.75 * (spec.must_have.length ? mustHits.length / spec.must_have.length : 0.5) +
      0.25 * (spec.nice_to_have.length ? niceHits.length / spec.nice_to_have.length : 0.5));

    const years = totalYears(c);
    const seniority = spec.min_years ? Math.min(1, years / spec.min_years) : 0.5;

    const countryOk = spec.location.accepted_countries.length === 0 || spec.location.accepted_countries.some((cc) => cc.toLowerCase() === c.country.toLowerCase());
    const remoteOk = spec.location.remote === c.remote_preference || c.open_to_relocate;
    const location = countryOk ? (remoteOk ? 1 : 0.5) : c.open_to_relocate ? 0.3 : 0;

    const answers: Record<string, JevAnswer> = {};
    spec.must_have.forEach((s) => {
      answers[`must_${spec.must_have.indexOf(s)}`] = { type: 'noul', noul: skillHit(s) ? 0.9 : 0.1 };
    });

    const prior = hit.retrieval_score / maxScore;
    const raw =
      weights.skills * skills + weights.seniority * seniority + weights.location * location +
      weights.retrieval_prior * prior;
    const composite = 100 * (raw / Math.max(wSum, 1e-9));

    const missing = spec.must_have.filter((s) => !skillHit(s));

    return {
      candidate: c, retrieval_rank: hit.retrieval_rank, retrieval_score: hit.retrieval_score,
      answers, model: 'heuristic', usage: { input_tokens: 0 }, latency_ms: 0, cost_usd: 0,
      subscores: { skills, seniority, location, domain: 0.5, total_years: years },
      composite: Math.round(composite * 10) / 10, rank_delta: 0,
      flags: { gate_skills: missing, timezone: false, uncertain: [], flagged: false },
      heuristic: true,
    };
  });

  scored.sort((a, b) => (b.composite !== a.composite ? b.composite - a.composite : a.retrieval_rank - b.retrieval_rank));
  return scored.map((s, i) => ({ ...s, final_rank: i + 1, rank_delta: s.retrieval_rank - (i + 1) }));
}
