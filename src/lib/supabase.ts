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

export class FunctionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FunctionError';
  }
}

export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let errMsg = error.message;
    try {
      const body = await error.context.json();
      if (body?.error === 'daily_limit') throw new DailyLimitError();
      if (body?.error) errMsg = body.error;
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
