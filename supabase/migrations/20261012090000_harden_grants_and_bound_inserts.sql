/*
# Harden table grants and bound the anon INSERTs

1. usage_counters: RLS on, every policy for anon/authenticated/public dropped,
   REVOKE ALL from PUBLIC, anon, authenticated.
2. increment_usage: SECURITY DEFINER with search_path = public. increment_usage and
   match_candidates: EXECUTE only for service_role.
3. App data tables (candidates, jobs, relevance_labels, searches, search_results):
   - every INSERT/UPDATE/DELETE/ALL policy for anon/authenticated/public is dropped; anon keeps SELECT
   - table privileges for anon/authenticated are SELECT only, plus INSERT on a column whitelist for
     searches and search_results (the UI saves search history from the browser)
4. The two INSERT policies the UI needs are recreated with bounded payloads: capped text and jsonb
   sizes, enum checks, and results may only attach to a search created in the last hour.

Server-side writes (candidate embeddings) go through the service-role client in Edge Functions.
*/

-- 1 + 3a. Drop write policies for client roles (and every client policy on usage_counters).
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('usage_counters', 'candidates', 'jobs', 'relevance_labels', 'searches', 'search_results')
      AND (tablename = 'usage_counters' OR cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
      AND roles && ARRAY['anon', 'authenticated', 'public']::name[]
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON usage_counters FROM PUBLIC, anon, authenticated;

-- 2. RPCs callable only by the service role.
ALTER FUNCTION increment_usage(text) SECURITY DEFINER;
ALTER FUNCTION increment_usage(text) SET search_path = public;
REVOKE ALL ON FUNCTION increment_usage(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_usage(text) TO service_role;

REVOKE ALL ON FUNCTION match_candidates(vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_candidates(vector, integer) TO service_role;

-- 3b. Table privileges: SELECT for client roles; INSERT only on whitelisted columns.
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE relevance_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_results ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON candidates, jobs, relevance_labels, searches, search_results
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON candidates, jobs, relevance_labels, searches, search_results TO anon, authenticated;

GRANT INSERT (query_text, preset, role_spec, retriever, k, llm_mode, weights, settings, jev_cost_usd)
  ON searches TO anon, authenticated;
GRANT INSERT (search_id, candidate_id, retrieval_rank, retrieval_score, jev_request, jev_response,
              model, latency_ms, input_tokens, cost_usd, subscores, composite, final_rank, flags)
  ON search_results TO anon, authenticated;

-- 4. Bounded INSERT policies for search history.
CREATE POLICY "anon_write_searches" ON searches FOR INSERT TO anon, authenticated
WITH CHECK (
  char_length(query_text) <= 2000
  AND (preset IS NULL OR char_length(preset) <= 64)
  AND retriever IN ('bm25', 'embeddings', 'hybrid')
  AND llm_mode IN ('live', 'mock')
  AND k BETWEEN 1 AND 40
  AND octet_length(role_spec::text) <= 16384
  AND octet_length(weights::text) <= 2048
  AND octet_length(settings::text) <= 4096
  AND (jev_cost_usd IS NULL OR octet_length(jev_cost_usd::text) <= 100)
);

CREATE POLICY "anon_write_results" ON search_results FOR INSERT TO anon, authenticated
WITH CHECK (
  octet_length(retrieval_score::text) <= 100
  AND (cost_usd IS NULL OR octet_length(cost_usd::text) <= 100)
  AND (composite IS NULL OR octet_length(composite::text) <= 100)
  AND (model IS NULL OR char_length(model) <= 100)
  AND (jev_request IS NULL OR octet_length(jev_request::text) <= 32768)
  AND (jev_response IS NULL OR octet_length(jev_response::text) <= 16384)
  AND (subscores IS NULL OR octet_length(subscores::text) <= 2048)
  AND (flags IS NULL OR octet_length(flags::text) <= 4096)
  AND EXISTS (
    SELECT 1 FROM searches s
    WHERE s.id = search_results.search_id AND s.created_at > now() - interval '1 hour'
  )
);
