import type { Provider, Run, RunDetail } from "./types.ts";
import { earliestTimestamp, formatDuration, latestTimestamp, parseTimestamp, sleep } from "./util.ts";

export interface BenchmarkOptions {
  expectedRuns: number;
  pollMs: number;
  timeoutMs: number;
}

/**
 * Dispatch the chain and measure until the final run completes.
 *
 * Reports two totals plus a per-run breakdown:
 *
 * - local wall-clock: the dispatch call to observed completion, so it includes
 *   client latency and up to one poll interval of slack.
 * - server-side: from the earliest run creation to the
 *   last run's completion, entirely from provider timestamps. It includes the
 *   queue gaps between runs and each provider's own scheduling and
 *   finalization overhead, so neither side can hide work outside it.
 */
export async function runBenchmark(provider: Provider, options: BenchmarkOptions): Promise<void> {
  // Snapshot pre-existing runs so only the new chain is counted.
  const before = new Set((await provider.listRuns()).map((run) => run.id));

  const startedAt = Date.now();
  await provider.dispatch();
  console.log(`dispatched ${provider.workflow} via ${provider.name}, waiting for ${options.expectedRuns} runs...`);

  const chain = await awaitCompletion(provider, before, options, startedAt);
  const wallClockMs = Date.now() - startedAt;
  console.log("\n");

  const details = await fetchDetails(provider, chain, options.pollMs);
  report(provider, details, wallClockMs, options.pollMs);
}

/** Poll until every expected run reaches a terminal state, failing fast. */
async function awaitCompletion(
  provider: Provider,
  before: ReadonlySet<string>,
  options: BenchmarkOptions,
  startedAt: number,
): Promise<Run[]> {
  for (;;) {
    const runs = (await provider.listRuns()).filter((run) => !before.has(run.id));

    const failed = runs.filter((run) => run.done && !run.ok);
    if (failed.length > 0) {
      throw new Error(`run(s) failed: ${failed.map((run) => run.id).join(", ")}`);
    }

    const finished = runs.filter((run) => run.done).length;
    const elapsed = Date.now() - startedAt;
    process.stdout.write(
      `\r  ${runs.length}/${options.expectedRuns} created, ${finished} finished (${formatDuration(elapsed)}) `,
    );

    if (runs.length >= options.expectedRuns && finished >= options.expectedRuns) return runs;
    if (elapsed > options.timeoutMs) throw new Error(`timed out after ${formatDuration(options.timeoutMs)}`);
    await sleep(options.pollMs);
  }
}

/**
 * Fetch timing details for every run. A run can report done before its
 * finished timestamp is persisted, so retry briefly while any is missing.
 */
async function fetchDetails(provider: Provider, chain: Run[], pollMs: number): Promise<RunDetail[]> {
  const incomplete = (details: RunDetail[]) =>
    details.some(
      (d) => parseTimestamp(d.runFinishedAt) === undefined || parseTimestamp(d.jobFinishedAt) === undefined,
    );

  let details = await Promise.all(chain.map((run) => provider.runDetail(run.id)));
  for (let retry = 0; retry < 5 && incomplete(details); retry++) {
    await sleep(pollMs);
    details = await Promise.all(chain.map((run) => provider.runDetail(run.id)));
  }
  // Order by parsed time: timestamp formats vary by provider, so a
  // lexicographic sort is not reliably chronological.
  return details.sort((a, b) => (parseTimestamp(a.createdAt) ?? 0) - (parseTimestamp(b.createdAt) ?? 0));
}

function report(provider: Provider, details: RunDetail[], wallClockMs: number, pollMs: number): void {
  // The total spans the whole run: earliest run creation (the initial
  // dispatch) to the last run's completion, so no provider-side overhead
  // falls outside it.
  const dispatchedAt = earliestTimestamp(details.map((d) => d.createdAt));
  const lastFinishedAt = latestTimestamp(details.map((d) => d.runFinishedAt));
  const start = parseTimestamp(dispatchedAt);
  const end = parseTimestamp(lastFinishedAt);
  const missingFinish = details.filter((d) => parseTimestamp(d.runFinishedAt) === undefined).length;

  console.log(`${provider.name} chain complete (${details.length} runs)`);
  console.log(`  local wall-clock : ${formatDuration(wallClockMs)} (${pollMs / 1000}s poll granularity)`);

  if (start !== undefined && end !== undefined) {
    if (missingFinish > 0) {
      console.log(
        `  warning: ${missingFinish} run(s) missing a finished timestamp; server-side total may be understated`,
      );
    }
    console.log(`  server-side      : ${formatDuration(end - start)} (${dispatchedAt} -> ${lastFinishedAt})`);
  } else {
    console.log("  server-side      : unavailable (timestamps missing or unparseable; see breakdown below)");
  }

  // Durations are job-level execution time, excluding queue wait and
  // finalization, which is what each provider's UI reports.
  console.log("\nper-run breakdown (duration is job execution time):");
  for (const d of details) {
    const jobStart = parseTimestamp(d.jobStartedAt);
    const jobEnd = parseTimestamp(d.jobFinishedAt);
    const duration = jobStart !== undefined && jobEnd !== undefined ? formatDuration(jobEnd - jobStart) : "n/a";
    console.log(
      `  ${d.id}  created ${d.createdAt}  started ${d.jobStartedAt ?? "-"}  finished ${d.jobFinishedAt ?? "-"}  run-finished ${d.runFinishedAt ?? "-"}  duration ${duration}`,
    );
  }
}
