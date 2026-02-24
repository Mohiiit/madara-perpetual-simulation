import type { CheckResult, DeploymentArtifacts } from "../config/run-config.js";
import { rawRpcCall } from "../infra/rpc-client.js";

export async function runBusinessInvariants(options: {
  rpcUrl: string;
  artifacts: DeploymentArtifacts;
  txHashes: string[];
  checks: CheckResult[];
}): Promise<void> {
  const classHashAt = await rawRpcCall<string>(options.rpcUrl, "starknet_getClassHashAt", [
    { block_id: "latest" },
    { contract_address: options.artifacts.coreAddress },
  ]);

  if (!("result" in classHashAt)) {
    options.checks.push({
      id: "business_invariants.core_class_hash_at",
      status: "fail",
      details: "Could not query class hash at deployed core address",
      evidence: { error: (classHashAt as any).error },
    });
  } else {
    options.checks.push({
      id: "business_invariants.core_class_hash_at",
      status:
        classHashAt.result.toLowerCase() === options.artifacts.coreClassHash.toLowerCase()
          ? "pass"
          : "fail",
      details: "Class hash at deployed address must equal declared core class hash",
      evidence: {
        expected: options.artifacts.coreClassHash,
        actual: classHashAt.result,
      },
    });
  }

  const events = await rawRpcCall<any>(options.rpcUrl, "starknet_getEvents", [
    {
      filter: {
        from_block: "latest",
        to_block: "latest",
        address: options.artifacts.coreAddress,
        keys: [],
        chunk_size: 100,
      },
    },
  ]);

  if (!("result" in events)) {
    options.checks.push({
      id: "business_invariants.events_available",
      status: "warn",
      details: "Could not fetch events for core contract",
      evidence: { error: (events as any).error },
    });
  } else {
    options.checks.push({
      id: "business_invariants.events_available",
      status: "pass",
      details: "Events endpoint responded for core contract",
      evidence: { txCount: options.txHashes.length },
    });
  }

  const estimateFee = await rawRpcCall<any>(options.rpcUrl, "starknet_estimateFee", [
    {
      request: [],
      simulation_flags: [],
      block_id: "latest",
    },
  ]);

  if (!("result" in estimateFee)) {
    options.checks.push({
      id: "business_invariants.estimate_fee_placeholder",
      status: "warn",
      details: "Estimate fee placeholder check returned RPC error (expected in V1 for empty requests)",
      evidence: { error: (estimateFee as any).error },
    });
  } else {
    options.checks.push({
      id: "business_invariants.estimate_fee_placeholder",
      status: "pass",
      details: "Estimate fee endpoint responded",
    });
  }
}
