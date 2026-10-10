export interface Experience {
  title: string;
  company: string;
  start: string; // "YYYY-MM"
  end: string | null;
  summary: string;
}

export type RemotePreference = 'remote' | 'hybrid' | 'onsite';

export interface Candidate {
  id: string;
  slug: string;
  full_name: string;
  initials: string;
  headline: string;
  city: string;
  country: string;
  utc_offset: number;
  remote_preference: RemotePreference;
  open_to_relocate: boolean;
  work_authorization: string;
  skills: string[];
  experience: Experience[];
  education: string;
  summary: string;
  email: string;
}

export interface RoleSpec {
  title: string;
  must_have: string[];
  nice_to_have: string[];
  seniority: 'junior' | 'mid' | 'senior' | 'staff';
  seniority_description: string;
  min_years: number | null;
  location: {
    text: string;
    accepted_countries: string[];
    remote: 'remote' | 'hybrid' | 'onsite';
    overlap_window: { start_utc_hour: number; end_utc_hour: number } | null;
  };
  domain: string;
}

export type Retriever = 'bm25' | 'embeddings' | 'hybrid';
export type LlmMode = 'live' | 'mock';

export interface RetrievalHit {
  candidate_id: string;
  retrieval_rank: number;
  retrieval_score: number;
  candidate: Candidate;
}

export interface SearchRequest {
  query_spec: RoleSpec;
  query_text: string;
  retriever: Retriever;
  k: number;
}

export interface SearchResponse {
  hits: RetrievalHit[];
  retriever_used: Retriever;
  fallback_reason: string | null;
  latency_ms: number;
}

export interface JevQuestions {
  [key: string]: { type: 'noul' | 'choice' | 'score'; instructions: string; criteria: unknown };
}

export interface JevState {
  role: {
    title: string;
    must_have: string[];
    nice_to_have: string[];
    seniority: string;
    location: string;
    domain: string;
  };
  candidate: {
    headline: string;
    skills: string[];
    experience: { title: string; company: string; duration_years: number; summary: string }[];
    location: string;
    remote_preference: string;
    open_to_relocate: boolean;
    summary: string;
  };
}

export interface JevCandidateResult {
  answers: Record<string, JevAnswer>;
  model: string;
  usage: { input_tokens: number };
  latency_ms: number;
  cost_usd: number;
  jev_request: unknown;
}

export type JevAnswer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: 'score'; score: number; confidence: number; legend: string[]; probabilities: Record<string, number> };

export interface Weights {
  skills: number;
  seniority: number;
  location: number;
  domain: number;
  retrieval_prior: number;
}

export interface RankSettings {
  must_have_gate: boolean;
  show_flagged_in_place: boolean;
  seniority_ev: { below: number; matches: number; above: number; uncertain: number };
}

export interface SubScores {
  skills: number;
  seniority: number;
  location: number;
  domain: number;
  total_years: number;
}

export interface RankFlags {
  gate_skills: string[]; // missing must-haves
  timezone: boolean;
  uncertain: string[]; // question keys with uncertain answers
  flagged: boolean;
}

export interface RankedCandidate {
  candidate: Candidate;
  retrieval_rank: number;
  retrieval_score: number;
  answers: Record<string, JevAnswer>;
  model: string;
  usage: { input_tokens: number };
  latency_ms: number;
  cost_usd: number;
  subscores: SubScores;
  composite: number;
  final_rank: number;
  rank_delta: number; // positive = promoted
  flags: RankFlags;
  heuristic: boolean;
}
