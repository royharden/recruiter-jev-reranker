/*
# Daily usage cap: usage_counters table + atomic increment function

1. New Tables
- `usage_counters(fn text, day date, count int, primary key fn+day)`: tracks calls per Edge Function per UTC day.

2. Functions
- `increment_usage(fn_name text) RETURNS int`: SECURITY DEFINER, atomic upsert that increments the counter
  for the given function name on the current UTC date and returns the new count.
  Only `service_role` may execute it (revoked from PUBLIC, anon, authenticated).

3. Security
- RLS enabled on `usage_counters` with NO policies for anon or authenticated.
  Only the service role (used inside Edge Functions) can read or write, via the SECURITY DEFINER function.
*/

CREATE TABLE IF NOT EXISTS usage_counters (
  fn text NOT NULL,
  day date NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (fn, day)
);

ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION increment_usage(fn_name text)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO usage_counters (fn, day, count)
  VALUES (fn_name, (now() AT TIME ZONE 'UTC')::date, 1)
  ON CONFLICT (fn, day) DO UPDATE SET count = usage_counters.count + 1
  RETURNING count;
$$;

REVOKE ALL ON FUNCTION increment_usage(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_usage(text) TO service_role;