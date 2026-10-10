/*
# Security lockdown: usage_counters + app data table policy cleanup

1. usage_counters: confirm RLS on, no policies, REVOKE ALL from anon/authenticated
2. increment_usage: REVOKE EXECUTE from PUBLIC/anon/authenticated, GRANT to service_role
3. App data tables: drop all anon/authenticated UPDATE and DELETE policies
   - candidates: drop anon_update_embeddings (UPDATE)
   - search_results: drop anon_delete_results (DELETE)
   - searches: drop anon_delete_searches (DELETE)
   - INSERT only where the UI truly needs it (searches, search_results)
   - anon keeps SELECT everywhere
*/

-- usage_counters: RLS already enabled, no policies exist. Revoke table-level access.
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON usage_counters FROM anon, authenticated;

-- increment_usage: already SECURITY DEFINER. Lock down execution.
REVOKE EXECUTE ON FUNCTION increment_usage(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_usage(text) TO service_role;

-- candidates: remove UPDATE policy (embeddings now written by service role in edge functions)
DROP POLICY IF EXISTS anon_update_embeddings ON candidates;

-- search_results: remove DELETE policy
DROP POLICY IF EXISTS anon_delete_results ON search_results;

-- searches: remove DELETE policy
DROP POLICY IF EXISTS anon_delete_searches ON searches;