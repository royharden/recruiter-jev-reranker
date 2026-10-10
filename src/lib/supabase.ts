import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;

export class DailyLimitError extends Error {
  constructor() {
    super('daily_limit');
    this.name = 'DailyLimitError';
  }
}

export class FunctionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FunctionError';
  }
}

export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabase) {
    throw new FunctionError('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.');
  }
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let errMsg = error.message;
    try {
      const errBody = await error.context.json();
      if (errBody?.error === 'daily_limit') throw new DailyLimitError();
      if (errBody?.error) errMsg = errBody.error;
    } catch (e) {
      if (e instanceof DailyLimitError) throw e;
    }
    throw new FunctionError(errMsg);
  }
  if (data && typeof data === 'object' && 'error' in data) {
    const errMsg = String((data as { error: unknown }).error);
    if (errMsg === 'daily_limit') throw new DailyLimitError();
    throw new FunctionError(errMsg);
  }
  return data as T;
}
