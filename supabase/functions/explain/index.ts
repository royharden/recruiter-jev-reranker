import type { SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { z } from "npm:zod@3.23.8";
import type { RoleSpec, SubScores } from "./types.ts";
import { checkUsage, HttpError, readJsonBody, serviceClient } from "./guards.ts";
import { invalidField, roleSpecSchema } from "./spec.ts";

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

// Bounded request body: every field that reaches the prompt has an item and character cap.
const probabilitiesSchema = z.record(z.string().max(300), z.number())
  .refine((p) => Object.keys(p).length <= 16, "too many probabilities");
const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number() }),
  z.object({
    type: z.literal("choice"),
    choice: z.string().max(40),
    confidence: z.number().optional(),
    probabilities: probabilitiesSchema.optional(),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    confidence: z.number().optional(),
    legend: z.array(z.string().max(300)).max(16).optional(),
    probabilities: probabilitiesSchema.optional(),
  }),
]);
type Answer = z.infer<typeof answerSchema>;

const bodySchema = z.object({
  query_spec: roleSpecSchema,
  candidate: z.object({
    headline: z.string().max(300),
    skills: z.array(z.string().max(80)).max(60),
    experience: z.array(z.object({
      title: z.string().max(200),
      company: z.string().max(200),
      summary: z.string().max(2000),
    })).max(20),
    location: z.string().max(200).optional(),
    remote_preference: z.string().max(20).optional(),
    summary: z.string().max(4000).optional(),
  }),
  subscores: z.object({
    skills: z.number(),
    seniority: z.number(),
    location: z.number(),
    domain: z.number(),
    total_years: z.number(),
  }),
  composite: z.number(),
  answers: z.record(z.string().max(40), answerSchema)
    .refine((a) => Object.keys(a).length <= 32, "too many answers")
    .default({}),
  llm_mode: z.enum(["live", "mock"]).default("live"),
});

const explanationSchema = z.object({
  why: z.string(),
  strengths: z.array(z.string()).max(6),
  gaps: z.array(z.string()).max(6),
});

const SYSTEM_PROMPT = `You explain a candidate's ranking to a recruiter in 2-3 sentences. You are given the role spec, the candidate's code-built profile (no name, no email), computed sub-scores, and the composite. Cite ONLY facts from the profile and the sub-scores — never invent experience. Return ONLY JSON: {"why": string (2-3 sentences), "strengths": string[] (max 4), "gaps": string[] (max 4)}.`;

// The daily cap is checked right before the paid fetch; a cap hit or failed usage check
// throws HttpError so the request stops instead of falling back.
async function callOpenAi(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
): Promise<{ why: string; strengths: string[]; gaps: string[] } | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const base = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
  const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-6-luna";
  await checkUsage(supabase, FN_NAME);
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
    if (!res.ok) {
      console.error(`[${FN_NAME}] OpenAI error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
      return null;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = explanationSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch (e) {
    console.error(`[${FN_NAME}] OpenAI request failed:`, e);
    return null;
  }
}

function mockExplain(
  spec: RoleSpec,
  candidate: { headline: string; skills: string[]; experience: { title: string; summary: string }[] },
  subscores: SubScores,
  answers: Record<string, Answer>,
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
  const supabase = serviceClient();
  if (!supabase) return err("server_not_configured", 503);
  try {
    const raw = await readJsonBody(req);
    const r = raw as Record<string, unknown> | null;
    if (!r?.query_spec || !r.candidate || !r.subscores) return err("query_spec, candidate, and subscores are required", 422);
    const body = bodySchema.safeParse(raw);
    if (!body.success) return err(invalidField(body.error), 422);
    const { query_spec, candidate, subscores, composite, answers, llm_mode } = body.data;

    if (llm_mode === "mock") {
      return json({ explanation: mockExplain(query_spec, candidate, subscores, answers, composite), mode: "mock" });
    }

    const live = await callOpenAi(supabase, { query_spec, candidate, subscores, composite, answers });
    if (!live) {
      return json({ explanation: mockExplain(query_spec, candidate, subscores, answers, composite), mode: "mock_fallback" });
    }
    return json({ explanation: live, mode: "live" });
  } catch (e) {
    if (e instanceof HttpError) return err(e.message, e.status);
    console.error(`[${FN_NAME}] unhandled error:`, e);
    return err("internal_error");
  }
});
