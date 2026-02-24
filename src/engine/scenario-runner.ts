import type {
  CheckResult,
  DispatchMode,
  RunConfig,
  TrafficProfile,
} from "../config/run-config.js";
import type { PerfRecorder } from "./perf-recorder.js";
import type { TxDispatcher } from "./tx-dispatcher.js";
import type { InstrumentedRpcClient } from "../infra/rpc-client.js";
import type { DeployerContext } from "../perpetual/deployer.js";
import type { StateModel } from "./state-model.js";
import type { SpecConformanceRecord } from "../assertions/spec-conformance.js";
import type { ReconciledTx } from "./receipt-reconciler.js";
import type { SubmittedTx } from "./tx-dispatcher.js";

export interface RuntimeArtifacts {
  submitted: SubmittedTx[];
  reconciled: ReconciledTx[];
  touchedBlocks: Set<number>;
}

export interface ScenarioContext {
  config: RunConfig;
  profile: TrafficProfile;
  checks: CheckResult[];
  rpc: InstrumentedRpcClient;
  perfRecorder: PerfRecorder;
  dispatcher: TxDispatcher;
  deployCtx: DeployerContext;
  stateModel: StateModel;
  specRecords: SpecConformanceRecord[];
  runtimeArtifacts: RuntimeArtifacts;
}

export interface SimulationScenario {
  id: string;
  dispatchMode: DispatchMode;
  run(ctx: ScenarioContext): Promise<void>;
}

export async function runScenarioSuite(options: {
  scenarios: SimulationScenario[];
  context: ScenarioContext;
}): Promise<void> {
  const suiteStarted = Date.now();
  for (const scenario of options.scenarios) {
    if (Date.now() - suiteStarted > options.context.profile.maxRuntimeMs) {
      throw new Error(
        `Simulation runtime exceeded profile budget (${options.context.profile.maxRuntimeMs}ms) before scenario ${scenario.id}`,
      );
    }

    const started = Date.now();

    try {
      await scenario.run(options.context);
      options.context.checks.push({
        id: `scenario.${scenario.id}`,
        status: "pass",
        details: `Scenario ${scenario.id} completed in ${Date.now() - started}ms`,
        evidence: {
          dispatchMode: scenario.dispatchMode,
        },
      });
    } catch (error) {
      options.context.checks.push({
        id: `scenario.${scenario.id}`,
        status: "fail",
        details: `Scenario ${scenario.id} failed`,
        evidence: {
          dispatchMode: scenario.dispatchMode,
          error: String((error as Error)?.stack ?? error),
        },
      });
      throw error;
    }
  }
}
