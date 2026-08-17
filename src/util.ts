/** Read a required environment variable, failing loudly when absent. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

/** Perform an HTTP request, returning the parsed JSON body (null on 204). */
export async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${url}: ${response.status} ${await response.text()}`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Format a millisecond duration as e.g. "4m07s". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  return `${minutes}m${seconds}s`;
}

/** Parse an RFC 3339 timestamp; undefined for missing or malformed input. */
export function parseTimestamp(value?: string): number | undefined {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? undefined : ms;
}

/** Select one timestamp by parsed value, preserving the original string. */
function pickTimestamp(
  values: ReadonlyArray<string | undefined>,
  isBetter: (candidate: number, incumbent: number) => boolean,
): string | undefined {
  let best: { value: string; ms: number } | undefined;
  for (const value of values) {
    const ms = parseTimestamp(value);
    if (value === undefined || ms === undefined) continue;
    if (best === undefined || isBetter(ms, best.ms)) best = { value, ms };
  }
  return best?.value;
}

/** Earliest of the given timestamps, ignoring missing ones. */
export const earliestTimestamp = (values: ReadonlyArray<string | undefined>): string | undefined =>
  pickTimestamp(values, (candidate, incumbent) => candidate < incumbent);

/** Latest of the given timestamps, ignoring missing ones. */
export const latestTimestamp = (values: ReadonlyArray<string | undefined>): string | undefined =>
  pickTimestamp(values, (candidate, incumbent) => candidate > incumbent);
