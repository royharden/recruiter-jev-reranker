export interface Job {
  id: string;
  title: string;
  company: string;
  description: string;
  location: string;
}

export type { RoleSpec, Retriever, LlmMode, Weights, RankSettings, RankedCandidate } from './types';
