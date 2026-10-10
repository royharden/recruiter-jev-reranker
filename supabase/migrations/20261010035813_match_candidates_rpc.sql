/*
# Add match_candidates RPC for pgvector cosine search

1. Functions
- `match_candidates(query_embedding vector(1536), match_count int)`: returns candidate ids ranked by cosine
  distance to the query embedding, used by the `search` Edge Function in "embeddings" retriever mode.

2. Security
- SECURITY DEFINER so the anon-key Edge Function call can read candidates regardless of RLS evaluation order;
  it only exposes ids and cosine distance for embedding search.
*/

CREATE OR REPLACE FUNCTION match_candidates(query_embedding vector(1536), match_count int)
RETURNS TABLE (id uuid, distance double precision)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.embedding <=> query_embedding AS distance
  FROM candidates c
  WHERE c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;