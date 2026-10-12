import { z } from "npm:zod@3.23.8";

// Bounded role spec accepted from clients: caps item counts and characters per field
// before anything reaches a prompt or a paid call. Identical copy in search, jev-rerank
// and explain.
export const roleSpecSchema = z.object({
  title: z.string().max(200),
  must_have: z.array(z.string().max(80)).max(10),
  nice_to_have: z.array(z.string().max(80)).max(10),
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

// Short "invalid <field>" message for a failed parse, without echoing the input.
export function invalidField(error: z.ZodError): string {
  const path = error.issues[0]?.path.join(".");
  return path ? `invalid ${path}` : "invalid request body";
}
