import type { SimulationScenario } from "../engine/scenario-runner.js";

function toHashSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase()));
}

function setEquals(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

function extractTxHashesFromWithTxs(result: any): string[] {
  const txs = Array.isArray(result?.transactions) ? result.transactions : [];
  return txs
    .map((tx: any) => tx?.transaction_hash)
    .filter((hash: unknown): hash is string => typeof hash === "string");
}

function extractTxHashesFromWithReceipts(result: any): string[] {
  const txs = Array.isArray(result?.transactions) ? result.transactions : [];
  return txs
    .map((entry: any) => entry?.transaction?.transaction_hash ?? entry?.receipt?.transaction_hash)
    .filter((hash: unknown): hash is string => typeof hash === "string");
}

export const rpcCrossEndpointConsistencyScenario: SimulationScenario = {
  id: "rpc_cross_endpoint_consistency",
  dispatchMode: "strict",
  async run(ctx) {
    const touchedBlocks = [...ctx.runtimeArtifacts.touchedBlocks].sort((a, b) => a - b);
    if (touchedBlocks.length === 0) {
      throw new Error("rpc_cross_endpoint_consistency requires touched blocks");
    }

    let failures = 0;
    for (const blockNumber of touchedBlocks.slice(0, 20)) {
      const blockId = { block_number: blockNumber };

      const withHashes = await ctx.rpc.rawCall<any>(
        "starknet_getBlockWithTxHashes",
        [blockId],
        "read",
      );
      const withTxs = await ctx.rpc.rawCall<any>("starknet_getBlockWithTxs", [blockId], "read");
      const withReceipts = await ctx.rpc.rawCall<any>(
        "starknet_getBlockWithReceipts",
        [blockId],
        "read",
      );
      const stateUpdate = await ctx.rpc.rawCall<any>("starknet_getStateUpdate", [blockId], "read");

      if (
        !("result" in withHashes) ||
        !("result" in withTxs) ||
        !("result" in withReceipts) ||
        !("result" in stateUpdate)
      ) {
        failures += 1;
        continue;
      }

      const hashesA = toHashSet(
        Array.isArray(withHashes.result?.transactions)
          ? withHashes.result.transactions
          : [],
      );
      const hashesB = toHashSet(extractTxHashesFromWithTxs(withTxs.result));
      const hashesC = toHashSet(extractTxHashesFromWithReceipts(withReceipts.result));

      if (!setEquals(hashesA, hashesB) || !setEquals(hashesA, hashesC)) {
        failures += 1;
        continue;
      }

      const blockHash = withHashes.result?.block_hash;
      const stateBlockHash = stateUpdate.result?.block_hash;
      if (
        typeof blockHash === "string" &&
        typeof stateBlockHash === "string" &&
        blockHash.toLowerCase() !== stateBlockHash.toLowerCase()
      ) {
        failures += 1;
      }
    }

    ctx.checks.push({
      id: "rpc_cross_endpoint_consistency.block_tx_state_alignment",
      status: failures === 0 ? "pass" : "fail",
      details:
        "Block endpoints and state update should agree on tx hash sets and block identity for touched blocks",
      evidence: {
        checkedBlocks: touchedBlocks.slice(0, 20),
        failures,
      },
    });
  },
};
