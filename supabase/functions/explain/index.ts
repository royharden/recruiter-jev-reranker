import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { z } from "npm:zod@3.23.8";
import type { JevAnswer, RoleSpec, SubScores } from "./types.ts";

const DAILY_LIMIT = 200;
const FN_NAME = "explain";

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

async function checkUsage(supabase: ReturnType<typeof createClient>): Promise<boolean> {
  const { data, error } = await supabase.rpc("increment_usage", { fn_name: FN_NAME });
  if (error) return true;
  return (data as number) <= DAILY_LIMIT;
}

const explanationSchema = z.object({
  why: z.string(),
  strengths: z.array(z.string()).max(6),
  gaps: z.array(z.string()).max(6),
});

const SYSTEM_PROMPT = `You explain a candidate's ranking to a recruiter in 2-3 sentences. You are given the role spec, the candidate's code-built profile (no name, no email), computed sub-scores, and the composite. Cite ONLY facts from the profile and the sub-scores — never invent experience. Return ONLY JSON: {"why": string (2-3 sentences), "strengths": string[] (max 4), "gaps": string[] (max 4)}.`;

async function callOpenAi(body: Record<string, unknown>): Promise<{ why: string; strengths: string[]; gaps: string[] } | null> {
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
          { role: "user", content: JSON.stringify(body) },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = explanationSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function mockExplain(
  spec: RoleSpec,
  candidate: { headline: string; skills: string[]; experience: { title: string; summary: string }[] },
  subscores: SubScores,
  answers: Record<string, JevAnswer>,
  composite: number,
): { why: string; strengths: string[]; gaps: string[] } {
  const strengths: string[] = [];
  const gaps: string[] = [];
  const matched: string[] = [];
  const missing: string[] = [];
  spec.must_have.forEach((s, i) => {
    const a = answers[`must_${i}`];
    if (a?.type === "noul" && a.noul >= 0.5) matched.push(s);
    else missing.push(s);
  });
  spec.nice_to_have.forEach((s, i) => {
    const a = answers[`nice_${i}`];
    if (a?.type === "noul" && a.noul >= 0.5) strengths.push(`Hands-on ${s}`);
  });
  if (matched.length) strengths.unshift(`Strong evidence for ${matched.slice(0, 3).join(", ")}`);
  if (missing.length) gaps.push(`No evidence of hands-on ${missing.slice(0, 3).join(", ")}`);

  const seniority = answers["seniority"];
  if (seniority?.type === "choice") {
    if (seniority.choice === "matches") strengths.push(`Seniority matches (${spec.seniority})`);
    else if (seniority.choice === "above") gaps.push(`More senior than the ${spec.seniority} bar`);
    else if (seniority.choice === "below") gaps.push(`More junior than the ${spec.seniority} bar`);
  }
  const location = answers["location"];
  if (location?.type === "choice") {
    if (location.choice === "works_now") strengths.push("Location and work arrangement already fit");
    else if (location.choice === "relocate") gaps.push("Would need to relocate or adjust arrangement");
    else if (location.choice === "mismatch") gaps.push("Location or arrangement conflicts with the role");
  }
  if (answers["injection"]?.type === "noul" && answers["injection"].noul >= 0.5) {
    gaps.push("Profile text contains instructions addressed to AI screening tools (flagged, treated as untrusted)");
  }

  const why =
    `Composite ${composite.toFixed(0)}/100 driven by skills ${subscores.skills.toFixed(2)}, seniority ${subscores.seniority.toFixed(2)}, ` +
    `location ${subscores.location.toFixed(2)}, domain ${subscores.domain.toFixed(2)}. ` +
    `${candidate.headline} with ${subscores.total_years} years of experience. ` +
    (missing.length ? `Main gap: ${missing[0]}.` : `All must-have skills show evidence of use.`);

  return { why, strengths: strengths.slice(0, 4), gaps: gaps.slice(0, 4) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const { query_spec, candidate, subscores, composite, answers, llm_mode = "live" } = await req.json();
    if (!query_spec || !candidate || !subscores) return err("query_spec, candidate, and subscores are required", 422);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const allowed = await checkUsage(supabase);
    if (!allowed) return json({ error: "daily_limit" }, 429);

    if (llm_mode === "mock") {
      return json({ explanation: mockExplain(query_spec, candidate, subscores, answers ?? {}, composite), mode: "mock" });
    }

    const live = await callOpenAi({ query_spec, candidate, subscores, composite, answers });
    if (!live) {
      return json({ explanation: mockExplain(query_spec, candidate, subscores, answers ?? {}, composite), mode: "mock_fallback" });
    }
    return json({ explanation: live, mode: "live" });
  } catch (e) {
    return err(e instanceof Error ? e.message : "unknown error");
  }
});