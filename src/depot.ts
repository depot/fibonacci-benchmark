import { WORKFLOWS, type Provider, type ProviderOptions, type Run } from "./types.ts";
import { earliestTimestamp, fetchJson, latestTimestamp, requireEnv } from "./util.ts";

const TERMINAL_STATUSES = new Set(["finished", "failed", "cancelled"]);
const FAILED_STATUSES = new Set(["failed", "cancelled"]);

interface DispatchWorkflowResponse {
  runId: string;
}

interface WorkflowSummary {
  runId: string;
  workflowId: string;
  workflowPath?: string;
  status: string;
  createdAt: string;
}

interface ListWorkflowsResponse {
  workflows?: WorkflowSummary[];
}

interface WorkflowJob {
  startedAt?: string;
  finishedAt?: string;
}

interface GetWorkflowResponse {
  runCreatedAt: string;
  runFinishedAt?: string;
  workflowStatus: string;
  workflowStartedAt?: string;
  workflowFinishedAt?: string;
  jobs?: WorkflowJob[];
}

/**
 * Depot CI provider, speaking the Connect protocol (JSON over POST) against
 * depot.ci.v1.CIService — the same RPCs the depot CLI uses.
 *
 * Requires DEPOT_TOKEN (an org-scoped API token); honors DEPOT_API_URL.
 */
export function createDepotProvider(options: ProviderOptions): Provider {
  const { repo, ref, variant } = options;
  const token = requireEnv("DEPOT_TOKEN");
  const baseUrl = process.env.DEPOT_API_URL ?? "https://api.depot.dev";
  const workflow = WORKFLOWS[variant];

  const rpc = <T>(method: string, body: unknown): Promise<T> =>
    fetchJson(`${baseUrl}/depot.ci.v1.CIService/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  // Workflow IDs by run ID, learned while polling and needed by runDetail.
  const workflowIds = new Map<string, string>();

  const toRun = (summary: WorkflowSummary): Run => ({
    id: summary.runId,
    createdAt: summary.createdAt,
    done: TERMINAL_STATUSES.has(summary.status),
    ok: !FAILED_STATUSES.has(summary.status),
  });

  return {
    name: "depot",
    workflow,

    async dispatch() {
      if (variant === "chain") {
        const { runId } = await rpc<DispatchWorkflowResponse>("DispatchWorkflow", {
          repo,
          workflow,
          ref,
          inputs: { n: String(options.firstN), depth: String(options.lastN) },
        });
        console.log(`seed run: ${runId}`);
        return;
      }
      // Concurrent: dispatch every run upfront. Each run receives its
      // predecessor's run ID so it can await that run's result artifact.
      let prevRunId = "";
      for (let n = options.firstN; n <= options.lastN; n++) {
        const { runId } = await rpc<DispatchWorkflowResponse>("DispatchWorkflow", {
          repo,
          workflow,
          ref,
          inputs: { n: String(n), prev_run_id: prevRunId },
        });
        prevRunId = runId;
      }
    },

    async listRuns() {
      const { workflows = [] } = await rpc<ListWorkflowsResponse>("ListWorkflows", { repo, pageSize: 100 });
      const runs = workflows.filter((w) => w.workflowPath?.endsWith(workflow));
      for (const w of runs) workflowIds.set(w.runId, w.workflowId);
      return runs.map(toRun);
    },

    /**
     * run creation precedes workflow creation (a dispatch returns a
     * run id, and the workflow record appears once the run is expanded), so
     * anchoring on the workflow would hide that startup latency. Job
     * timestamps, already present in this response, give execution time.
     */
    async runDetail(id) {
      const w = await rpc<GetWorkflowResponse>("GetWorkflow", { workflowId: workflowIds.get(id) });
      const jobs = w.jobs ?? [];
      return {
        id,
        createdAt: w.runCreatedAt,
        runFinishedAt: w.runFinishedAt,
        jobStartedAt: earliestTimestamp(jobs.map((job) => job.startedAt)) ?? w.workflowStartedAt,
        jobFinishedAt: latestTimestamp(jobs.map((job) => job.finishedAt)) ?? w.workflowFinishedAt,
        done: TERMINAL_STATUSES.has(w.workflowStatus),
        ok: !FAILED_STATUSES.has(w.workflowStatus),
      };
    },
  };
}
