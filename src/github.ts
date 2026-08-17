import { WORKFLOWS, type Provider, type ProviderOptions, type Run } from "./types.ts";
import { earliestTimestamp, fetchJson, latestTimestamp, requireEnv } from "./util.ts";

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at?: string;
  updated_at: string;
  run_attempt?: number;
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

  const fetchJobs = async (runId: string, attempt: number): Promise<WorkflowJob[]> => {
    try {
      const { jobs = [] } = await api<ListJobsResponse>(
        `/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,
      );
      return jobs;
    } catch (error) {
      console.warn(`\nwarning: could not read jobs for run ${runId}: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  };

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
     * GitHub has no dedicated run completion field, so `updated_at` on a completed run
     * stands in for it. Job timestamps give execution time.
     */
    async runDetail(id) {
      const run = await api<WorkflowRun>(`/actions/runs/${id}`);
      const jobs = await fetchJobs(id, run.run_attempt ?? 1);
      return {
        ...toRun(run),
        runFinishedAt: run.status === "completed" ? run.updated_at : undefined,
        jobStartedAt: earliestTimestamp(jobs.map((job) => job.started_at)) ?? run.run_started_at,
        jobFinishedAt: latestTimestamp(jobs.map((job) => job.completed_at ?? undefined)),
      };
    },
  };
}
