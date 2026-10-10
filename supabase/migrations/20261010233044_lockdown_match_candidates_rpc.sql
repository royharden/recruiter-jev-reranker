-- match_candidates: revoke execute from public/anon/authenticated, grant to service_role only
REVOKE EXECUTE ON FUNCTION match_candidates(vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_candidates(vector, integer) TO service_role;