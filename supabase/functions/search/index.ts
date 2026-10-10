import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { Candidate, RoleSpec, RetrievalHit } from "./types.ts";
import { Bm25Index } from "./bm25.ts";

const DAILY_LIMIT = 200;
const FN_NAME = "search";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function err(message: string, status = 500) {
  return json({ error: message }, status);
}

async function checkUsage(supabase: ReturnType<typeof createClient>): Promise<Response | null> {
  const { data, error } = await supabase.rpc("increment_usage", { fn_name: FN_NAME });
  if (error || typeof data !== "number") return json({ error: "usage_check_failed" }, 503);
  if (data > DAILY_LIMIT) return json({ error: "daily_limit" }, 429);
  return null;
}

async function embed(text: string): Promise<number[] | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const base = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
  const model = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

function rrf(lists: { candidate_id: string }[][], k: number): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, i) => {
      scores.set(item.candidate_id, (scores.get(item.candidate_id) ?? 0) + 1 / (60 + i + 1));
    });
  }
  return scores;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const { query_spec, query_text, retriever = "bm25", k = 20 } = await req.json();
    if (!query_text || !query_spec) return err("query_text and query_spec are required", 422);
    if (!["bm25", "embeddings", "hybrid"].includes(retriever)) return err("retriever must be bm25 | embeddings | hybrid", 422);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const usageResponse = await checkUsage(supabase);
    if (usageResponse) return usageResponse;

    const { data: rows, error } = await supabase.from("candidates").select("*");
    if (error) return err(`database error: ${error.message}`, 500);
    const candidates = rows as Candidate[];

    const started = performance.now();
    let fallback_reason: string | null = null;
    let retriever_used = retriever;

    let bm25Hits: { candidate_id: string; score: number }[] = [];
    let embedHits: { candidate_id: string; score: number }[] = [];

    const wantsBm25 = retriever === "bm25" || retriever === "hybrid";
    const wantsEmbed = retriever === "embeddings" || retriever === "hybrid";

    if (wantsBm25) {
      const index = new Bm25Index(candidates);
      const docBoost = query_spec.must_have.join(" ");
      bm25Hits = index.search(`${query_text} ${docBoost}`, candidates.length);
    }

    if (wantsEmbed) {
      const doc = `${query_text} ${query_spec.must_have.join(" ")} ${query_spec.nice_to_have.join(" ")}`;
      const vec = await embed(doc);
      if (!vec) {
        fallback_reason = "Embeddings unavailable (missing OPENAI_API_KEY, no stored vectors, or embedding call failed) — fell back to BM25.";
        if (retriever === "embeddings") retriever_used = "bm25";
        if (!bm25Hits.length) {
          const index = new Bm25Index(candidates);
          bm25Hits = index.search(query_text, candidates.length);
        }
      } else {
        const { data: matches, error: rpcError } = await supabase.rpc("match_candidates", {
          query_embedding: vec,
          match_count: Math.min(candidates.length, 40),
        });
        if (rpcError || !matches) {
          fallback_reason = `Embedding search failed: ${rpcError?.message ?? "no matches"} — fell back to BM25.`;
          if (retriever === "embeddings") retriever_used = "bm25";
        } else {
          // cosine distance (0 = identical) -> similarity score
          embedHits = (matches as { id: string; distance: number }[]).map((m) => ({
            candidate_id: m.id,
            score: 1 - m.distance,
          }));
        }
      }
    }

    let hits: RetrievalHit[];
    if (retriever === "hybrid" && bm25Hits.length && embedHits.length) {
      const fused = rrf([bm25Hits, embedHits], k);
      hits = [...fused.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, k)
        .map(([candidate_id, score], i) => ({
          candidate_id,
          retrieval_rank: i + 1,
          retrieval_score: score,
          candidate: candidates.find((c) => c.id === candidate_id)!,
        }));
    } else {
      const primary = embedHits.length && retriever_used !== "bm25" ? embedHits : bm25Hits;
      hits = primary.slice(0, k).map((h, i) => ({
        candidate_id: h.candidate_id,
        retrieval_rank: i + 1,
        retrieval_score: h.score,
        candidate: candidates.find((c) => c.id === h.candidate_id)!,
      }));
    }

    return json({
      hits,
      retriever_used,
      fallback_reason,
      latency_ms: Math.round(performance.now() - started),
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : "unknown error");
  }
});

