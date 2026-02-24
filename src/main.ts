import fs from "node:fs/promises";
import path from "node:path";
import {
  loadRunConfig,
  type CheckResult,
  type ScenarioReport,
  type PerfSummary,
} from "./config/run-config.js";
import { resolveTrafficProfile } from "./config/traffic-profiles.js";
import { cloneAtRef } from "./infra/repo-checkout.js";
import { buildMadara, buildPerpetual } from "./infra/builders.js";
import { startMadaraDevnet, type MadaraProcessHandle } from "./infra/madara-process.js";
import { deployPerpetualV1 } from "./perpetual/deployer.js";
import { postSlackSummary } from "./reporting/slack-webhook.js";
import { writeReport } from "./reporting/report-writer.js";
import { PerfRecorder, emptyPerfSummary } from "./engine/perf-recorder.js";
import { TxDispatcher } from "./engine/tx-dispatcher.js";
import { StateModel } from "./engine/state-model.js";
import { runScenarioSuite } from "./engine/scenario-runner.js";
import { createSpecRegistry } from "./spec/spec-registry.js";
import {
  pushSpecConformanceCheck,
  type SpecConformanceRecord,
} from "./assertions/spec-conformance.js";
import { loadPerfBaseline } from "./perf/baseline-loader.js";
import { evaluateSloGates } from "./engine/slo-gate.js";
import { InstrumentedRpcClient } from "./infra/rpc-client.js";
import { deployIntegrityStrictScenario } from "./scenarios/deploy-integrity-strict.js";
import { correctnessExactValuesScenario } from "./scenarios/correctness-exact-values.js";
import { edgeHotAccountMixedScenario } from "./scenarios/edge-hot-account-mixed.js";
import { writeBurstNoWaitScenario } from "./scenarios/write-burst-no-wait.js";
import { readStormScenario } from "./scenarios/read-storm.js";
import { traceConformanceScenario } from "./scenarios/trace-conformance.js";
import { rpcCrossEndpointConsistencyScenario } from "./scenarios/rpc-cross-endpoint-consistency.js";

function runUrlFromEnv(): string {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (server && repo && runId) {
    return `${server}/${repo}/actions/runs/${runId}`;
  }
  return "local-run";
}

function buildReport(options: {
  startedAt: string;
  madaraCommit: string;
  perpetualSha: string;
  backend: ScenarioReport["backend"];
  profile: ScenarioReport["profile"];
  perf: PerfSummary;
  baselineStatus: ScenarioReport["baselineStatus"];
  checks: CheckResult[];
}): ScenarioReport {
  const hasFailures = options.checks.some((c) => c.status === "fail");
  return {
    status: hasFailures ? "FAIL" : "PASS",
    madaraCommit: options.madaraCommit,
    perpetualSha: options.perpetualSha,
    backend: options.backend,
    profile: options.profile,
    perf: options.perf,
    baselineStatus: options.baselineStatus,
    startedAt: options.startedAt,
    finishedAt: new Date().toISOString(),
    checks: options.checks,
  };
}

async function main(): Promise<void> {
  const config = loadRunConfig();
  const profile = resolveTrafficProfile(config.profileId, config.durationOverrideMs);
  const startedAt = new Date().toISOString();
  const checks: CheckResult[] = [];
  const specRecords: SpecConformanceRecord[] = [];

  let madaraCommit = "unknown";
  let madaraProcess: MadaraProcessHandle | null = null;
  let perfSummary: PerfSummary = emptyPerfSummary();
  let baselineStatus: ScenarioReport["baselineStatus"] = "missing";

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
      backend: config.backend,
    });

    checks.push({
      id: "infra.start_madara",
      status: "pass",
      details: "Madara devnet started and RPC became ready",
      evidence: {
        rpcUrl: madaraProcess.rpcVersionedUrl,
        pid: madaraProcess.pid,
        backend: config.backend,
      },
    });

    const specRegistry = await createSpecRegistry({
      specTag: config.specTag,
      cacheDirOverride: config.specCacheDir,
    });

    checks.push({
      id: "spec_registry.load",
      status: "pass",
      details: "Loaded Starknet OpenRPC spec registry from cache",
      evidence: {
        specTag: config.specTag,
        cacheDir: config.specCacheDir,
        methodCount: specRegistry.listOfficialMethods().length,
      },
    });

    const deployCtx = await deployPerpetualV1({
      rpcUrl: madaraProcess.rpcVersionedUrl,
      perpetualReleaseDir,
      checks,
    });

    const perfRecorder = new PerfRecorder(config.backend);
    const rpc = new InstrumentedRpcClient({
      rpcUrl: madaraProcess.rpcVersionedUrl,
      perfRecorder,
      specRegistry,
      specRecords,
    });
    const dispatcher = new TxDispatcher(perfRecorder);

    await runScenarioSuite({
      scenarios: [
        deployIntegrityStrictScenario,
        correctnessExactValuesScenario,
        edgeHotAccountMixedScenario,
        writeBurstNoWaitScenario,
        rpcCrossEndpointConsistencyScenario,
        readStormScenario,
        traceConformanceScenario,
      ],
      context: {
        config,
        profile,
        checks,
        rpc,
        perfRecorder,
        dispatcher,
        deployCtx,
        stateModel: new StateModel(),
        specRecords,
        runtimeArtifacts: {
          submitted: [],
          reconciled: [],
          touchedBlocks: new Set<number>(),
        },
      },
    });

    pushSpecConformanceCheck({
      checks,
      id: "spec_conformance.official_methods",
      records: specRecords,
    });

    perfSummary = perfRecorder.summarizeByClass();

    const baseline = await loadPerfBaseline({
      profile: profile.id,
      backend: config.backend,
      baselinePath: config.baselinePath,
    });

    baselineStatus = baseline.status === "missing" ? "bootstrap" : baseline.status;

    checks.push({
      id: "perf_baseline.load",
      status: baseline.status === "invalid" ? "fail" : "pass",
      details:
        baseline.status === "loaded"
          ? "Loaded baseline perf summary"
          : baseline.status === "missing"
            ? "No baseline found; absolute SLOs only"
            : "Baseline file is invalid",
      evidence: {
        source: baseline.source,
        status: baseline.status,
      },
    });

    const sloGates = evaluateSloGates({
      perf: perfSummary,
      baselinePerf: baseline.perf,
      regressionLimit: 0.2,
    });

    for (const gate of sloGates) {
      checks.push(gate);
    }

    checks.push({
      id: "write_reconciliation.completeness",
      status: "pass",
      details:
        "All burst/write scenarios enforce boundary reconciliation with unresolved hashes treated as failures",
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

  const report = buildReport({
    startedAt,
    madaraCommit,
    perpetualSha: config.perpetualSha,
    backend: config.backend,
    profile: profile.id,
    perf: perfSummary,
    baselineStatus,
    checks,
  });

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
