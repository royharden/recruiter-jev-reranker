import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import type { Candidate } from "./types.ts";
import { candidateDocument } from "./bm25.ts";

const DAILY_LIMIT = 200;
const FN_NAME = "embed-candidates";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const usageResponse = await checkUsage(supabase);
    if (usageResponse) return usageResponse;

    const { data: rows, error } = await supabase.from("candidates").select("*");
    if (error) return err(`database error: ${error.message}`, 500);
    const candidates = rows as Candidate[];

    const toEmbed = candidates.filter((c) => !c.embedding);
    if (toEmbed.length === 0) {
      return json({ embedded: 0, skipped: candidates.length, message: "All candidates already have embeddings." });
    }

    let embedded = 0;
    const failures: string[] = [];
    // Embed sequentially to keep the OpenAI call simple and rate-limit friendly at 40 rows.
    for (const c of toEmbed) {
      const vec = await embed(candidateDocument(c));
      if (!vec) {
        failures.push(c.slug);
        continue;
      }
      const { error: upErr } = await supabase
        .from("candidates")
        .update({ embedding: JSON.stringify(vec) })
        .eq("id", c.id);
      if (upErr) failures.push(c.slug);
      else embedded++;
    }

    if (embedded === 0) {
      return err(
        "Could not embed any candidates. Check that OPENAI_API_KEY is configured and has access to the embeddings model.",
        502,
      );
    }

    return json({ embedded, skipped: candidates.length - toEmbed.length, failures });
  } catch (e) {
    return err(e instanceof Error ? e.message : "unknown error");
  }
});
