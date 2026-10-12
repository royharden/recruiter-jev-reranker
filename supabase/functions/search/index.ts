import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { z } from "npm:zod@3.23.8";
import type { Candidate, RetrievalHit } from "./types.ts";
import { Bm25Index } from "./bm25.ts";
import { checkUsage, HttpError, MAX_QUERY_CHARS, readJsonBody, serviceClient } from "./guards.ts";
import { invalidField, roleSpecSchema } from "./spec.ts";

const FN_NAME = "search";
const EMBEDDING_DIMS = 1536;

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

const bodySchema = z.object({
  query_spec: roleSpecSchema,
  query_text: z.string().min(1).max(MAX_QUERY_CHARS),
  retriever: z.enum(["bm25", "embeddings", "hybrid"]).default("bm25"),
  k: z.number().int().min(1).max(40).default(20),
});

// Counts the call against the daily cap right before the paid fetch; a cap hit or failed
// usage check throws HttpError so the caller stops immediately.
async function embed(supabase: SupabaseClient, text: string): Promise<number[] | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const base = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
  const model = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
  await checkUsage(supabase, FN_NAME);
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text }),
    });
    if (!res.ok) {
      console.error(`[${FN_NAME}] embeddings error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
      return null;
    }
    const data = await res.json();
    const vec = data?.data?.[0]?.embedding;
    return Array.isArray(vec) && vec.length === EMBEDDING_DIMS && vec.every(Number.isFinite) ? vec : null;
  } catch (e) {
    console.error(`[${FN_NAME}] embeddings request failed:`, e);
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
  const supabase = serviceClient();
  if (!supabase) return err("server_not_configured", 503);
  try {
    const raw = await readJsonBody(req);
    const queryText = (raw as { query_text?: unknown } | null)?.query_text;
    if (typeof queryText === "string" && queryText.length > MAX_QUERY_CHARS) return err("query_text_too_long", 413);
    const body = bodySchema.safeParse(raw);
    if (!body.success) return err(invalidField(body.error), 422);
    const { query_spec, query_text, retriever, k } = body.data;

    const { data: rows, error } = await supabase.from("candidates").select("*");
    if (error) {
      console.error(`[${FN_NAME}] candidates query failed: ${error.message}`);
      return err("database_error", 500);
    }
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
      const vec = await embed(supabase, doc);
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
          if (rpcError) console.error(`[${FN_NAME}] match_candidates failed: ${rpcError.message}`);
          fallback_reason = "Embedding search failed — fell back to BM25.";
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
    if (e instanceof HttpError) return err(e.message, e.status);
    console.error(`[${FN_NAME}] unhandled error:`, e);
    return err("internal_error");
  }
});
