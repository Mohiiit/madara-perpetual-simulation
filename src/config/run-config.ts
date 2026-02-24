import path from "node:path";

export type ExecutionBackend = "vm" | "native";
export type DispatchMode = "strict" | "windowed_burst";
export type RpcClass = "read" | "write_submit" | "write_finalize" | "trace";

export interface TrafficProfile {
  id: "balanced_soak";
  maxRuntimeMs: number;
  burstSize: number;
  maxInFlight: number;
  windowMs: number;
  reconcileTimeoutMs: number;
  writeTargetCount: number;
  readTargetCount: number;
  traceSampleRate: number;
}

export interface PerfSample {
  method: string;
  rpcClass: RpcClass;
  latencyMs: number;
  ok: boolean;
  rpcErrorCode?: number;
  backend: ExecutionBackend;
}

export interface PercentileSummary {
  count: number;
  errorRate: number;
  p50: number;
  p90: number;
  p99: number;
}

export type PerfSummary = Record<RpcClass, PercentileSummary>;

export interface SloGateResult {
  id: string;
  status: "pass" | "fail";
  details: string;
  evidence?: Record<string, unknown>;
}

export interface RunConfig {
  madaraRepo: string;
  madaraRef: string;
  madaraBinaryPath?: string;
  madaraCommitOverride?: string;
  requireMadaraArtifact: boolean;
  backend: ExecutionBackend;
  profileId: TrafficProfile["id"];
  durationOverrideMs?: number;
  baselinePath?: string;
  specTag: string;
  specCacheDir: string;
  perpetualRepo: string;
  perpetualSha: string;
  rpcUrl: string;
  slackWebhookUrl?: string;
  timeoutMs: number;
  workDir: string;
  forceFailureSuite: boolean;
}

export interface DeploymentArtifacts {
  coreClassHash: string;
  coreAddress: string;
  components: Record<string, string>;
}

export interface CheckResult {
  id: string;
  status: "pass" | "fail";
  details: string;
  evidence?: Record<string, unknown>;
}

export interface ScenarioReport {
  status: "PASS" | "FAIL";
  madaraCommit: string;
  perpetualSha: string;
  backend: ExecutionBackend;
  profile: TrafficProfile["id"];
  perf: PerfSummary;
  baselineStatus?: "loaded" | "bootstrap" | "missing" | "invalid";
  startedAt: string;
  finishedAt: string;
  checks: CheckResult[];
}

function parseTimeoutMs(raw: string | undefined): number {
  if (!raw) {
    return 20 * 60 * 1000;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid SIM_TIMEOUT_MS: ${raw}`);
  }

  return parsed;
}

function parseBackend(raw: string | undefined): ExecutionBackend {
  const normalized = (raw || "vm").trim().toLowerCase();
  if (normalized === "vm" || normalized === "native") {
    return normalized;
  }
  throw new Error(`Invalid SIM_BACKEND: ${raw}`);
}

function parseDurationOverrideMs(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid SIM_DURATION_OVERRIDE_MS: ${raw}`);
  }

  return parsed;
}

function parseProfile(raw: string | undefined): TrafficProfile["id"] {
  const normalized = (raw || "balanced_soak").trim().toLowerCase();
  if (normalized === "balanced_soak") {
    return "balanced_soak";
  }
  throw new Error(`Invalid SIM_PROFILE: ${raw}`);
}

export function loadRunConfig(): RunConfig {
  const perpetualSha = process.env.PERPETUAL_SHA ?? process.env.PERPETUAL_PINNED_SHA;
  if (!perpetualSha) {
    throw new Error("PERPETUAL_SHA or PERPETUAL_PINNED_SHA must be set");
  }

  return {
    madaraRepo: process.env.MADARA_REPO ?? "https://github.com/madara-alliance/madara.git",
    madaraRef: process.env.MADARA_REF ?? process.env.MADARA_MAIN_BRANCH ?? "main",
    madaraBinaryPath: process.env.MADARA_BINARY_PATH,
    madaraCommitOverride: process.env.MADARA_COMMIT_OVERRIDE,
    requireMadaraArtifact: process.env.SIM_REQUIRE_MADARA_ARTIFACT === "1",
    backend: parseBackend(process.env.SIM_BACKEND),
    profileId: parseProfile(process.env.SIM_PROFILE),
    durationOverrideMs: parseDurationOverrideMs(process.env.SIM_DURATION_OVERRIDE_MS),
    baselinePath: process.env.SIM_BASELINE_PATH,
    specTag: process.env.STARKNET_SPEC_TAG ?? "v0.10.0",
    specCacheDir:
      process.env.STARKNET_SPEC_CACHE_DIR ??
      path.resolve(process.cwd(), ".cache", "specs", "starknet"),
    perpetualRepo:
      process.env.PERPETUAL_REPO ?? "https://github.com/starkware-libs/starknet-perpetual.git",
    perpetualSha,
    rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:9944/rpc/v0_10_0",
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    timeoutMs: parseTimeoutMs(process.env.SIM_TIMEOUT_MS),
    workDir:
      process.env.SIM_WORKDIR ??
      path.resolve(process.cwd(), ".workdir", `run-${Date.now()}`),
    forceFailureSuite: process.env.SIM_FORCE_FAILURE_SUITE === "1",
  };
}
