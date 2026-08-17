import type { Provider, Run, RunDetail } from "./types.ts";
import { formatDuration, parseTimestamp, sleep } from "./util.ts";

export interface BenchmarkOptions {
  expectedRuns: number;
  pollMs: number;
  timeoutMs: number;
}

/**
 * Dispatch the chain and measure until the final run completes.
 *
 * Reports two totals: local wall-clock (dispatch to observed completion,
 * subject to poll granularity) and server-side (first run created to last
 * run finished, from provider timestamps), plus a per-run breakdown.
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
  let details = await Promise.all(chain.map((run) => provider.runDetail(run.id)));
  for (let retry = 0; retry < 5 && details.some((d) => parseTimestamp(d.finishedAt) === undefined); retry++) {
    await sleep(pollMs);
    details = await Promise.all(chain.map((run) => provider.runDetail(run.id)));
  }
  return details.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function report(provider: Provider, details: RunDetail[], wallClockMs: number, pollMs: number): void {
  const firstDetail = details[0];
  const first = parseTimestamp(firstDetail?.createdAt);
  const finishTimes = details
    .map((d) => parseTimestamp(d.finishedAt))
    .filter((t): t is number => t !== undefined);

  console.log(`${provider.name} chain complete (${details.length} runs)`);
  console.log(`  local wall-clock : ${formatDuration(wallClockMs)} (${pollMs / 1000}s poll granularity)`);

  if (firstDetail !== undefined && first !== undefined && finishTimes.length > 0) {
    if (finishTimes.length < details.length) {
      console.log(
        `  warning: ${details.length - finishTimes.length} run(s) missing a finished timestamp; server-side total may be understated`,
      );
    }
    const last = Math.max(...finishTimes);
    console.log(
      `  server-side      : ${formatDuration(last - first)} (${firstDetail.createdAt} -> ${new Date(last).toISOString()})`,
    );
  } else {
    console.log("  server-side      : unavailable (timestamps missing or unparseable; see breakdown below)");
  }

  console.log("\nper-run breakdown:");
  for (const d of details) {
    const start = parseTimestamp(d.startedAt);
    const end = parseTimestamp(d.finishedAt);
    const duration = start !== undefined && end !== undefined ? formatDuration(end - start) : "n/a";
    console.log(
      `  ${d.id}  created ${d.createdAt}  started ${d.startedAt ?? "-"}  finished ${d.finishedAt ?? "-"}  duration ${duration}`,
    );
  }
}
