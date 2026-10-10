import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, anonKey);

export class DailyLimitError extends Error {
  constructor() {
    super('daily_limit');
    this.name = 'DailyLimitError';
  }
}

export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(error.message);
  if (data && typeof data === 'object' && 'error' in data) {
    const errMsg = String((data as { error: unknown }).error);
    if (errMsg === 'daily_limit') throw new DailyLimitError();
    throw new Error(errMsg);
  }
  return data as T;
}
