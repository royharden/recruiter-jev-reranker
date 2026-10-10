import type { Candidate } from './types';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'he', 'her', 'his', 'i',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'own', 'she', 'so', 'that', 'the', 'their', 'them',
  'they', 'this', 'to', 'was', 'we', 'were', 'will', 'with', 'work', 'working', 'years', 'year', 'built',
  'used', 'using', 'own',
]);

export interface Bm25Doc {
  candidate_id: string;
  tokens: string[];
  termFreqs: Map<string, number>;
  length: number;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function candidateDocument(c: Candidate): string {
  const titles = c.experience.map((e) => `${e.title} ${e.company} ${e.summary}`).join(' ');
  return [c.headline, c.skills.join(' '), titles, c.summary].join(' ');
}

export class Bm25Index {
  docs: Bm25Doc[] = [];
  private df = new Map<string, number>();
  private avgLen = 0;
  private k1 = 1.2;
  private b = 0.75;

  constructor(candidates: Candidate[]) {
    for (const c of candidates) {
      const tokens = tokenize(candidateDocument(c));
      const termFreqs = new Map<string, number>();
      for (const t of tokens) termFreqs.set(t, (termFreqs.get(t) ?? 0) + 1);
      this.docs.push({ candidate_id: c.id, tokens, termFreqs, length: tokens.length });
      for (const term of termFreqs.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }
    this.avgLen = this.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, this.docs.length);
  }

  search(queryText: string, k: number): { candidate_id: string; score: number }[] {
    const queryTokens = tokenize(queryText);
    const N = this.docs.length;
    const scores: { candidate_id: string; score: number }[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const term of queryTokens) {
        const f = doc.termFreqs.get(term);
        if (!f) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        score += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * (doc.length / this.avgLen))));
      }
      if (score > 0) scores.push({ candidate_id: doc.candidate_id, score });
    }
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, k);
  }
}
