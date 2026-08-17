import { WORKFLOWS, type Provider, type ProviderOptions, type RunDetail } from "./types.ts";
import { fetchJson, requireEnv } from "./util.ts";

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

  const toDetail = (run: WorkflowRun): RunDetail => ({
    id: String(run.id),
    createdAt: run.created_at,
    done: run.status === "completed",
    ok: run.conclusion === null || run.conclusion === "success",
    startedAt: run.run_started_at,
    finishedAt: run.status === "completed" ? run.updated_at : undefined,
  });

  return {
    name: "github",
    workflow,

    async dispatch() {
      if (variant === "chain") {
        await dispatchOne();
        return;
      }
      // Concurrent: dispatch every run upfront. GitHub's dispatch API returns
      // no run ID, so runs locate their predecessor via artifact names tagged
      // with a chain ID unique to this invocation.
      const chain = Math.random().toString(36).slice(2, 8);
      console.log(`chain id: ${chain}`);
      for (let n = options.firstN; n <= options.lastN; n++) {
        await dispatchOne({ n: String(n), chain });
      }
    },

    async listRuns() {
      const { workflow_runs = [] } = await api<ListRunsResponse>(`/actions/workflows/${workflow}/runs?per_page=100`);
      return workflow_runs.map(toDetail);
    },

    async runDetail(id) {
      return toDetail(await api<WorkflowRun>(`/actions/runs/${id}`));
    },
  };
}
