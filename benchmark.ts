#!/usr/bin/env node
// Benchmark a fibonacci calculation spread across CI workflow runs.
//
// Usage:
//   DEPOT_TOKEN=...  node benchmark.ts depot  owner/repo [ref] [chain|concurrent]
//   GITHUB_TOKEN=... node benchmark.ts github owner/repo [ref] [chain|concurrent]
//
// Variants:
//   chain      (default) one seed run is dispatched; each run dispatches the
//              next with its result as inputs.
//   concurrent all runs are dispatched upfront and execute concurrently; each
//              run blocks until its predecessor publishes a result artifact.
//
// Environment: DEPTH (20), POLL_MS (3000), TIMEOUT_MS (1800000).

import { runBenchmark } from "./src/benchmark.ts";
import { createDepotProvider } from "./src/depot.ts";
import { createGithubProvider } from "./src/github.ts";
import { WORKFLOWS, type Variant } from "./src/types.ts";

const FIRST_N = 3;

const PROVIDERS = {
  depot: createDepotProvider,
  github: createGithubProvider,
} as const;

function isVariant(value: string): value is Variant {
  return value in WORKFLOWS;
}

const [providerName = "", repo = "", ref = "main", variant = "chain"] = process.argv.slice(2);
const createProvider = PROVIDERS[providerName as keyof typeof PROVIDERS];
if (!createProvider || !repo || !isVariant(variant)) {
  console.error("usage: benchmark.ts depot|github owner/repo [ref] [chain|concurrent]");
  process.exit(1);
}

// The chain computes fib(FIRST_N)..fib(depth); fib(1) and fib(2) are the
// seed values every run starts from, so they cost no runs.
const depth = Number(process.env.DEPTH ?? 20);
if (!Number.isInteger(depth) || depth < FIRST_N) {
  console.error(`error: DEPTH must be an integer >= ${FIRST_N}, got ${process.env.DEPTH}`);
  process.exit(1);
}

try {
  const provider = createProvider({ repo, ref, variant, firstN: FIRST_N, lastN: depth });
  await runBenchmark(provider, {
    expectedRuns: depth - FIRST_N + 1,
    pollMs: Number(process.env.POLL_MS ?? 3000),
    timeoutMs: Number(process.env.TIMEOUT_MS ?? 30 * 60 * 1000),
  });
} catch (error) {
  console.error(`\nerror: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
