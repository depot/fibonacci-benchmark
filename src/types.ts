/** Workflow file dispatched for each benchmark variant. */
export const WORKFLOWS = {
  /** One seed run; each run dispatches the next with its result as inputs. */
  chain: "fibonacci.yml",
  /**
   * Every run is dispatched upfront and executes concurrently; each run
   * blocks until its predecessor publishes a result artifact.
   */
  concurrent: "fibonacci-concurrent.yml",
} as const;

export type Variant = keyof typeof WORKFLOWS;

/** A workflow run in the fibonacci chain, as observed while polling. */
export interface Run {
  id: string;
  createdAt: string;
  /** The run has reached a terminal state. */
  done: boolean;
  /** The run has not failed or been cancelled (also true while in progress). */
  ok: boolean;
}

/**
 * Timing detail for a run, fetched once the chain completes.
 *
 *
 * - The run-level total (`createdAt` to `runFinishedAt`) is what the
 *   benchmark total measures. It hides nothing: no dispatch, scheduling, or
 *   finalization overhead falls outside it.
 * - The job-level boundaries (`jobStartedAt` to `jobFinishedAt`) are
 *   execution duration, which is what per-run durations report and what each
 *   provider's UI shows.
 */
export interface RunDetail extends Run {
  /** Run-level completion, including any provider-side finalization. */
  runFinishedAt?: string;
  /** Execution boundaries of the run's jobs. */
  jobStartedAt?: string;
  jobFinishedAt?: string;
}

/** A CI provider that can dispatch and observe benchmark runs. */
export interface Provider {
  readonly name: string;
  readonly workflow: string;
  /** Trigger the benchmark: the seed run (chain) or every run (concurrent). */
  dispatch(): Promise<void>;
  /** List recent runs of the benchmark workflow. */
  listRuns(): Promise<Run[]>;
  /** Fetch precise timing for a single run. */
  runDetail(id: string): Promise<RunDetail>;
}

export interface ProviderOptions {
  /** Target repository in `owner/repo` form. */
  repo: string;
  /** Branch or tag the workflow is dispatched on. */
  ref: string;
  variant: Variant;
  /** First fibonacci index computed by the chain (inclusive). */
  firstN: number;
  /** Last fibonacci index computed by the chain (inclusive). */
  lastN: number;
}
