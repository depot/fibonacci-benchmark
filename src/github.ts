import { WORKFLOWS, type Provider, type ProviderOptions, type Run } from "./types.ts";
import { earliestTimestamp, fetchJson, latestTimestamp, requireEnv } from "./util.ts";

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at?: string;
  updated_at: string;
}

interface ListRunsResponse {
  workflow_runs?: WorkflowRun[];
}

interface WorkflowJob {
  started_at?: string;
  completed_at?: string | null;
}

interface ListJobsResponse {
  jobs?: WorkflowJob[];
}

/**
 * GitHub Actions provider, using the REST API.
 *
 * Requires GITHUB_TOKEN with `actions` read/write on the target repository
 * (e.g. `GITHUB_TOKEN=$(gh auth token)`).
 */
export function createGithubProvider(options: ProviderOptions): Provider {
  const { repo, ref, variant } = options;
  const token = requireEnv("GITHUB_TOKEN");
  const workflow = WORKFLOWS[variant];

  const api = <T>(path: string, init: RequestInit = {}): Promise<T> =>
    fetchJson(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });

  const dispatchOne = (inputs?: Record<string, string>): Promise<null> =>
    api(`/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref, inputs }),
    });

  const toRun = (run: WorkflowRun): Run => ({
    id: String(run.id),
    createdAt: run.created_at,
    done: run.status === "completed",
    ok: run.conclusion === null || run.conclusion === "success",
  });

  return {
    name: "github",
    workflow,

    async dispatch() {
      if (variant === "chain") {
        await dispatchOne({ n: String(options.firstN), depth: String(options.lastN) });
        return;
      }
      // Concurrent: dispatch every run upfront. GitHub's dispatch API returns
      // no run ID, so runs locate their predecessor via artifact names tagged
      // with a chain ID unique to this invocation.
      const chain = Math.random().toString(36).slice(2, 8);
      console.log(`chain id: ${chain}`);
      for (let n = options.firstN; n <= options.lastN; n++) {
        const prevArtifact = n === options.firstN ? "" : `fib-${chain}-${n - 1}`;
        await dispatchOne({ n: String(n), chain, prev_artifact: prevArtifact });
      }
    },

    async listRuns() {
      const { workflow_runs = [] } = await api<ListRunsResponse>(`/actions/workflows/${workflow}/runs?per_page=100`);
      return workflow_runs.map(toRun);
    },

    /**
     * Timing comes from the run's jobs, which expose real execution
     * boundaries. The run object has no completion timestamp, only
     * `updated_at`, which is merely the last write to the record, so job
     * timings are what make this comparable to the Depot provider.
     */
    async runDetail(id) {
      const [run, { jobs = [] }] = await Promise.all([
        api<WorkflowRun>(`/actions/runs/${id}`),
        api<ListJobsResponse>(`/actions/runs/${id}/jobs?per_page=100`),
      ]);
      return {
        ...toRun(run),
        startedAt: earliestTimestamp(jobs.map((job) => job.started_at)) ?? run.run_started_at,
        finishedAt: latestTimestamp(jobs.map((job) => job.completed_at ?? undefined)),
      };
    },
  };
}
