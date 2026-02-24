import fs from "node:fs/promises";
import path from "node:path";
import { loadRunConfig, type CheckResult, type ScenarioReport } from "./config/run-config.js";
import { cloneAtRef } from "./infra/repo-checkout.js";
import { buildMadara, buildPerpetual } from "./infra/builders.js";
import { startMadaraDevnet, type MadaraProcessHandle } from "./infra/madara-process.js";
import { deployPerpetualV1 } from "./perpetual/deployer.js";
import { runPerpetualV1Scenario } from "./scenarios/perpetual-v1.js";
import { runRpcConsistencySuite } from "./assertions/rpc-invariants.js";
import { runBusinessInvariants } from "./assertions/business-invariants.js";
import { postSlackSummary } from "./reporting/slack-webhook.js";
import { writeReport } from "./reporting/report-writer.js";

function runUrlFromEnv(): string {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (server && repo && runId) {
    return `${server}/${repo}/actions/runs/${runId}`;
  }
  return "local-run";
}

function buildReport(
  startedAt: string,
  madaraCommit: string,
  perpetualSha: string,
  checks: CheckResult[],
): ScenarioReport {
  const hasFailures = checks.some((c) => c.status === "fail");
  return {
    status: hasFailures ? "FAIL" : "PASS",
    madaraCommit,
    perpetualSha,
    startedAt,
    finishedAt: new Date().toISOString(),
    checks,
  };
}

async function main(): Promise<void> {
  const config = loadRunConfig();
  const startedAt = new Date().toISOString();
  const checks: CheckResult[] = [];

  let madaraCommit = "unknown";
  let madaraProcess: MadaraProcessHandle | null = null;

  await fs.mkdir(config.workDir, { recursive: true });

  try {
    const madaraDir = path.resolve(config.workDir, "madara");
    const perpetualDir = path.resolve(config.workDir, "starknet-perpetual");

    const perpetualCheckout = await cloneAtRef({
      repoUrl: config.perpetualRepo,
      ref: config.perpetualSha,
      destDir: perpetualDir,
    });

    checks.push({
      id: "infra.checkout_perpetual",
      status: "pass",
      details: "Checked out Starknet Perpetual repository",
      evidence: { sha: perpetualCheckout.commit },
    });

    let madaraBinary: string;
    if (config.madaraBinaryPath) {
      await fs.access(config.madaraBinaryPath);
      madaraBinary = config.madaraBinaryPath;
      madaraCommit = config.madaraCommitOverride ?? "artifact-unknown";
      checks.push({
        id: "infra.use_madara_artifact",
        status: "pass",
        details: "Using prebuilt Madara binary artifact",
        evidence: {
          madaraBinaryPath: madaraBinary,
          madaraCommit,
        },
      });
    } else if (config.requireMadaraArtifact) {
      throw new Error(
        "SIM_REQUIRE_MADARA_ARTIFACT=1 but MADARA_BINARY_PATH is not set. CI must provide a downloaded Madara artifact.",
      );
    } else {
      const madaraCheckout = await cloneAtRef({
        repoUrl: config.madaraRepo,
        ref: config.madaraRef,
        destDir: madaraDir,
      });
      madaraCommit = madaraCheckout.commit;
      checks.push({
        id: "infra.checkout_madara",
        status: "pass",
        details: "Checked out Madara repository",
        evidence: { ref: config.madaraRef, commit: madaraCommit },
      });

      madaraBinary = await buildMadara(madaraDir);
      checks.push({
        id: "infra.build_madara",
        status: "pass",
        details: "Built Madara binary",
        evidence: { madaraBinary },
      });
    }

    const perpetualReleaseDir = await buildPerpetual(perpetualDir);
    checks.push({
      id: "infra.build_perpetual",
      status: "pass",
      details: "Built Perpetual artifacts",
      evidence: { perpetualReleaseDir },
    });

    madaraProcess = await startMadaraDevnet({
      madaraBinaryPath: madaraBinary,
      workDir: config.workDir,
      timeoutMs: config.timeoutMs,
    });

    checks.push({
      id: "infra.start_madara",
      status: "pass",
      details: "Madara devnet started and RPC became ready",
      evidence: { rpcUrl: madaraProcess.rpcVersionedUrl, pid: madaraProcess.pid },
    });

    const deployCtx = await deployPerpetualV1({
      rpcUrl: madaraProcess.rpcVersionedUrl,
      perpetualReleaseDir,
      checks,
    });

    const txHashes = await runPerpetualV1Scenario({
      ctx: deployCtx,
      checks,
    });

    await runRpcConsistencySuite({
      rpcUrl: madaraProcess.rpcVersionedUrl,
      txHashes,
      checks,
    });

    await runBusinessInvariants({
      rpcUrl: madaraProcess.rpcVersionedUrl,
      artifacts: deployCtx.artifacts,
      txHashes,
      checks,
    });

    if (config.forceFailureSuite) {
      checks.push({
        id: "failure_report_suite.intentional_failure",
        status: "fail",
        details: "Intentional failure injected via SIM_FORCE_FAILURE_SUITE=1",
      });
    } else {
      checks.push({
        id: "failure_report_suite.intentional_failure",
        status: "pass",
        details: "Failure suite hook available; no forced failure requested",
      });
    }
  } catch (error) {
    checks.push({
      id: "infra.unhandled_exception",
      status: "fail",
      details: "Unhandled exception during simulation execution",
      evidence: { error: String((error as Error)?.stack ?? error) },
    });
  } finally {
    if (madaraProcess) {
      await madaraProcess.stop();
    }
  }

  const report = buildReport(startedAt, madaraCommit, config.perpetualSha, checks);
  const outputDir = path.resolve(process.cwd(), "reports");
  const written = await writeReport({ outputDir, report });

  const runUrl = runUrlFromEnv();

  try {
    const slackStatus = await postSlackSummary({
      webhookUrl: config.slackWebhookUrl,
      report,
      runUrl,
    });

    if (slackStatus === "skipped") {
      console.log("Slack webhook skipped (missing or placeholder URL).");
    }
  } catch (error) {
    console.error(`Slack notification failed: ${String(error)}`);
    if (report.status === "PASS") {
      report.status = "FAIL";
      report.checks.push({
        id: "reporting.slack_post",
        status: "fail",
        details: "Slack webhook delivery failed",
        evidence: { error: String(error) },
      });
      await writeReport({ outputDir, report });
    }
  }

  console.log(`Report JSON: ${written.jsonPath}`);
  console.log(`Report MD: ${written.mdPath}`);

  if (report.status === "FAIL") {
    process.exitCode = 1;
  }
}

await main();
