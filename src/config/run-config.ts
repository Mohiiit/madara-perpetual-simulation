import path from "node:path";

export interface RunConfig {
  madaraRepo: string;
  madaraRef: string;
  madaraBinaryPath?: string;
  madaraCommitOverride?: string;
  requireMadaraArtifact: boolean;
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
