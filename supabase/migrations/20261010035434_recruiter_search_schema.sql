/*
# Recruiter Search: schema (candidates, jobs, searches, labels)

1. New Tables
- `candidates`: 40 fictional people. No photos; names are fictional. `embedding` is a pgvector column (1536 dims) filled by the "Build embeddings" admin action.
- `jobs`: 6 fictional seed job postings usable as one-click queries.
- `searches`: one row per past search (query, preset, role spec, retriever, k, weights).
- `search_results`: per-candidate rows for each search, including the Jev request/response for the raw JSON viewer.
- `relevance_labels`: hand-written graded labels (0-3) per preset x candidate for the evaluation view.

2. Security
- RLS enabled on all tables; permissive anon policies because this is a single-tenant public demo (no sign-in).

3. Notes
- pgvector extension enabled so `candidates.embedding vector(1536)` works.
*/

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  full_name text NOT NULL,
  initials text NOT NULL,
  headline text NOT NULL,
  city text NOT NULL,
  country text NOT NULL,
  utc_offset numeric NOT NULL,
  remote_preference text NOT NULL CHECK (remote_preference IN ('remote','hybrid','onsite')),
  open_to_relocate boolean NOT NULL DEFAULT false,
  work_authorization text NOT NULL DEFAULT 'authorized',
  skills text[] NOT NULL DEFAULT '{}',
  experience jsonb NOT NULL DEFAULT '[]',
  education text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  email text NOT NULL,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  company text NOT NULL,
  description text NOT NULL,
  location text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text text NOT NULL,
  preset text,
  role_spec jsonb NOT NULL,
  retriever text NOT NULL,
  k int NOT NULL,
  llm_mode text NOT NULL,
  weights jsonb NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}',
  jev_cost_usd numeric,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS search_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  retrieval_rank int NOT NULL,
  retrieval_score numeric NOT NULL,
  jev_request jsonb,
  jev_response jsonb,
  model text,
  latency_ms int,
  input_tokens int,
  cost_usd numeric,
  subscores jsonb,
  composite numeric,
  final_rank int,
  flags jsonb,
  explanation jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relevance_labels (
  preset text NOT NULL,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  grade int NOT NULL DEFAULT 0,
  PRIMARY KEY (preset, candidate_id)
);

CREATE INDEX IF NOT EXISTS search_results_search_idx ON search_results(search_id);

ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE relevance_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_candidates" ON candidates;
CREATE POLICY "anon_read_candidates" ON candidates FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_read_jobs" ON jobs;
CREATE POLICY "anon_read_jobs" ON jobs FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_read_searches" ON searches;
CREATE POLICY "anon_read_searches" ON searches FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_write_searches" ON searches;
CREATE POLICY "anon_write_searches" ON searches FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_searches" ON searches;
CREATE POLICY "anon_delete_searches" ON searches FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_read_results" ON search_results;
CREATE POLICY "anon_read_results" ON search_results FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_write_results" ON search_results;
CREATE POLICY "anon_write_results" ON search_results FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_results" ON search_results;
CREATE POLICY "anon_delete_results" ON search_results FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_read_labels" ON relevance_labels;
CREATE POLICY "anon_read_labels" ON relevance_labels FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_update_embeddings" ON candidates;
CREATE POLICY "anon_update_embeddings" ON candidates FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);