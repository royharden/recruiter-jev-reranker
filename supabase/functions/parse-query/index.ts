import { z } from "npm:zod@3.23.8";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { parseQueryMock } from "./mockParse.ts";

const DAILY_LIMIT = 200;
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

async function checkUsage(supabase: ReturnType<typeof createClient>): Promise<Response | null> {
  const { data, error } = await supabase.rpc("increment_usage", { fn_name: FN_NAME });
  if (error || typeof data !== "number") return json({ error: "usage_check_failed" }, 503);
  if (data > DAILY_LIMIT) return json({ error: "daily_limit" }, 429);
  return null;
}

const roleSpecSchema = z.object({
  title: z.string(),
  must_have: z.array(z.string()).max(6),
  nice_to_have: z.array(z.string()).max(4),
  seniority: z.enum(["junior", "mid", "senior", "staff"]),
  seniority_description: z.string().default(""),
  min_years: z.number().nullable().default(null),
  location: z.object({
    text: z.string().default(""),
    accepted_countries: z.array(z.string()).default([]),
    remote: z.enum(["remote", "hybrid", "onsite"]).default("remote"),
    overlap_window: z.object({ start_utc_hour: z.number(), end_utc_hour: z.number() }).nullable().default(null),
  }).default({ text: "", accepted_countries: [], remote: "remote", overlap_window: null }),
  domain: z.string().default("General software"),
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

async function callOpenAi(queryText: string): Promise<RoleSpec | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const base = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
  const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-6-luna";
  try {
    const res = await fetch(`${base}/chat/completions`, {
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
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = roleSpecSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const { query_text, queryText: queryTextAlias, llm_mode = "live" } = await req.json();
    const queryText = query_text ?? queryTextAlias;
    if (!queryText) return err("query_text is required", 422);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const usageResponse = await checkUsage(supabase);
    if (usageResponse) return usageResponse;

    if (llm_mode === "mock") {
      return json({ spec: parseQueryMock(queryText), mode: "mock" });
    }

    let spec = await callOpenAi(queryText);
    if (!spec) spec = await callOpenAi(queryText);
    if (!spec) {
      return json({ spec: parseQueryMock(queryText), mode: "mock_fallback" });
    }
    return json({ spec, mode: "live" });
  } catch (e) {
    return err(e instanceof Error ? e.message : "unknown error");
  }
});
