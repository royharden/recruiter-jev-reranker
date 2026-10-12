import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

// Request guards shared by every Edge Function. Each function folder keeps an
// identical copy of this file so it deploys on its own.

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_QUERY_CHARS = 2000;
const DEFAULT_DAILY_LIMIT = 200;

export class HttpError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.name = "HttpError";
    this.status = status;
  }
}

// Service-role client built only from env. Null when either variable is missing.
export function serviceClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

// Reads the body with a hard byte cap (413 above MAX_BODY_BYTES), then parses JSON (400 if invalid).
export async function readJsonBody(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) throw new HttpError(413, "payload_too_large");
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new HttpError(413, "payload_too_large");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

function dailyLimit(): number {
  const raw = Deno.env.get("DAILY_CALL_LIMIT")?.trim();
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_LIMIT;
}

// Counts one paid upstream call against today's cap for `fnName`. Call it right before
// every paid fetch, retries included. Fails closed: an RPC error or a missing/non-integer
// count throws 503 usage_check_failed; over the cap throws 429 daily_limit.
export async function checkUsage(supabase: SupabaseClient, fnName: string): Promise<void> {
  let count: unknown = null;
  try {
    const { data, error } = await supabase.rpc("increment_usage", { fn_name: fnName });
    if (error) console.error(`[${fnName}] increment_usage failed: ${error.message}`);
    else count = data;
  } catch (e) {
    console.error(`[${fnName}] increment_usage threw:`, e);
  }
  if (typeof count !== "number" || !Number.isInteger(count)) throw new HttpError(503, "usage_check_failed");
  if (count > dailyLimit()) throw new HttpError(429, "daily_limit");
}
