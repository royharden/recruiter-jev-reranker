import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import type { Candidate } from "./types.ts";
import { candidateDocument } from "./bm25.ts";
import { checkUsage, HttpError, readJsonBody, serviceClient } from "./guards.ts";

const FN_NAME = "embed-candidates";
const EMBEDDING_DIMS = 1536;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-admin-token",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function err(message: string, status = 500) {
  return json({ error: message }, status);
}

// Constant-time comparison of the x-admin-token header against the ADMIN_TOKEN secret.
async function adminTokenMatches(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// One paid call per candidate: the daily cap is checked right before each fetch, and a cap
// hit or failed usage check throws HttpError so the loop stops immediately.
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const supabase = serviceClient();
  if (!supabase) return err("server_not_configured", 503);
  let embedded = 0;
  try {
    const adminToken = Deno.env.get("ADMIN_TOKEN");
    if (!adminToken) console.error(`[${FN_NAME}] ADMIN_TOKEN secret is not configured`);
    const provided = req.headers.get("x-admin-token");
    if (!adminToken || !provided || !(await adminTokenMatches(provided, adminToken))) return err("unauthorized", 401);

    await readJsonBody(req);

    const { data: rows, error } = await supabase.from("candidates").select("*");
    if (error) {
      console.error(`[${FN_NAME}] candidates query failed: ${error.message}`);
      return err("database_error", 500);
    }
    const candidates = rows as Candidate[];

    const toEmbed = candidates.filter((c) => !c.embedding);
    if (toEmbed.length === 0) {
      return json({ embedded: 0, skipped: candidates.length, message: "All candidates already have embeddings." });
    }

    const failures: string[] = [];
    for (const c of toEmbed) {
      const vec = await embed(supabase, candidateDocument(c));
      if (!vec) {
        failures.push(c.slug);
        continue;
      }
      const { error: upErr } = await supabase
        .from("candidates")
        .update({ embedding: JSON.stringify(vec) })
        .eq("id", c.id);
      if (upErr) {
        console.error(`[${FN_NAME}] embedding update failed for ${c.slug}: ${upErr.message}`);
        failures.push(c.slug);
      } else embedded++;
    }

    if (embedded === 0) {
      return err(
        "Could not embed any candidates. Check that OPENAI_API_KEY is configured and has access to the embeddings model.",
        502,
      );
    }

    return json({ embedded, skipped: candidates.length - toEmbed.length, failures });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, embedded }, e.status);
    console.error(`[${FN_NAME}] unhandled error:`, e);
    return err("internal_error");
  }
});
