import { z } from "npm:zod@3.23.8";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { parseQueryMock } from "./mockParse.ts";
import type { RoleSpec } from "./types.ts";
import { checkUsage, HttpError, MAX_QUERY_CHARS, readJsonBody, serviceClient } from "./guards.ts";

const FN_NAME = "parse-query";

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
  query_text: z.string().optional(),
  queryText: z.string().optional(),
  llm_mode: z.enum(["live", "mock"]).default("live"),
});

const roleSpecSchema = z.object({
  title: z.string().max(200),
  must_have: z.array(z.string().max(80)).max(6),
  nice_to_have: z.array(z.string().max(80)).max(4),
  seniority: z.enum(["junior", "mid", "senior", "staff"]),
  seniority_description: z.string().max(500).default(""),
  min_years: z.number().finite().nullable().default(null),
  location: z.object({
    text: z.string().max(2000).default(""),
    accepted_countries: z.array(z.string().max(80)).max(30).default([]),
    remote: z.enum(["remote", "hybrid", "onsite"]).default("remote"),
    overlap_window: z.object({ start_utc_hour: z.number().finite(), end_utc_hour: z.number().finite() }).nullable().default(null),
  }).default({ text: "", accepted_countries: [], remote: "remote", overlap_window: null }),
  domain: z.string().max(200).default("General software"),
});

const SYSTEM_PROMPT = `You parse recruiter queries into a structured role spec for a candidate search demo. Return ONLY JSON matching this shape:
{
  "title": string,
  "must_have": string[] (max 6 concrete skills, e.g. "React", "TypeScript", "Node.js"),
  "nice_to_have": string[] (max 4),
  "seniority": "junior" | "mid" | "senior" | "staff",
  "seniority_description": one short sentence describing the responsibility level,
  "min_years": number | null,
  "location": {
    "text": string,
    "accepted_countries": string[] (country names, empty if any),
    "remote": "remote" | "hybrid" | "onsite",
    "overlap_window": { "start_utc_hour": number, "end_utc_hour": number } | null
  },
  "domain": string (e.g. "B2B SaaS", "Fintech", "ML infrastructure", "Consumer apps")
}
Use common canonical skill names. If the query mentions a US city or "US", include "USA" in accepted_countries. If a timezone window is implied (e.g. "ET overlap 9am-3pm"), set overlap_window in UTC hours. Never invent skills not implied by the query.`;

// `retryable` is set only for upstream 429/529 or a network error. The daily cap is
// checked right before the paid fetch; a cap hit or failed usage check throws HttpError.
async function callOpenAi(
  supabase: SupabaseClient,
  queryText: string,
): Promise<{ spec: RoleSpec | null; retryable: boolean }> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { spec: null, retryable: false };
  const base = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
  const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-6-luna";
  await checkUsage(supabase, FN_NAME);
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: queryText },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch (e) {
    console.error(`[${FN_NAME}] OpenAI request failed:`, e);
    return { spec: null, retryable: true };
  }
  if (!res.ok) {
    console.error(`[${FN_NAME}] OpenAI error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
    return { spec: null, retryable: res.status === 429 || res.status === 529 };
  }
  try {
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return { spec: null, retryable: false };
    const parsed = roleSpecSchema.safeParse(JSON.parse(content));
    return { spec: parsed.success ? parsed.data : null, retryable: false };
  } catch {
    return { spec: null, retryable: false };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const supabase = serviceClient();
  if (!supabase) return err("server_not_configured", 503);
  try {
    const body = bodySchema.safeParse(await readJsonBody(req));
    if (!body.success) return err("invalid request body", 422);
    const { query_text, queryText: queryTextAlias, llm_mode } = body.data;
    const queryText = query_text ?? queryTextAlias;
    if (!queryText) return err("query_text is required", 422);
    if (queryText.length > MAX_QUERY_CHARS) return err("query_text_too_long", 413);

    if (llm_mode === "mock") {
      return json({ spec: parseQueryMock(queryText), mode: "mock" });
    }

    // At most 2 attempts, retrying only on 429/529 or a network error.
    let result = await callOpenAi(supabase, queryText);
    if (!result.spec && result.retryable) {
      await new Promise((r) => setTimeout(r, 500));
      result = await callOpenAi(supabase, queryText);
    }
    if (!result.spec) {
      return json({ spec: parseQueryMock(queryText), mode: "mock_fallback" });
    }
    return json({ spec: result.spec, mode: "live" });
  } catch (e) {
    if (e instanceof HttpError) return err(e.message, e.status);
    console.error(`[${FN_NAME}] unhandled error:`, e);
    return err("internal_error");
  }
});
