import type { SimulationScenario } from "../engine/scenario-runner.js";

export const traceConformanceScenario: SimulationScenario = {
  id: "trace_conformance",
  dispatchMode: "strict",
  async run(ctx) {
    const acceptedTxs = ctx.runtimeArtifacts.reconciled.filter(
      (entry) => entry.status === "accepted",
    );

    if (acceptedTxs.length === 0) {
      throw new Error("trace_conformance requires accepted transactions");
    }

    const traceTxCount = Math.max(
      1,
      Math.floor(acceptedTxs.length * ctx.profile.traceSampleRate),
    );

    let traceTransactionFailures = 0;
    for (let i = 0; i < traceTxCount; i += 1) {
      const tx = acceptedTxs[i % acceptedTxs.length];
      const traceTx = await ctx.rpc.rawCall(
        "starknet_traceTransaction",
        [tx.txHash],
        "trace",
      );

      if (!("result" in traceTx)) {
        traceTransactionFailures += 1;
      }
    }

    const touchedBlocks = [...ctx.runtimeArtifacts.touchedBlocks].sort((a, b) => a - b);
    const blockSamples = touchedBlocks.slice(0, 5);

    let traceBlockFailures = 0;
    for (const blockNumber of blockSamples) {
      const traceBlock = await ctx.rpc.rawCall(
        "starknet_traceBlockTransactions",
        [{ block_number: blockNumber }],
        "trace",
      );

      if (!("result" in traceBlock)) {
        traceBlockFailures += 1;
      }
    }

    ctx.checks.push({
      id: "trace_conformance.trace_transaction_success_rate",
      status: traceTransactionFailures === 0 ? "pass" : "fail",
      details: "TraceTransaction responses should match schema and succeed on sampled accepted tx hashes",
      evidence: {
        sampled: traceTxCount,
        failures: traceTransactionFailures,
      },
    });

    ctx.checks.push({
      id: "trace_conformance.trace_block_success_rate",
      status: traceBlockFailures === 0 ? "pass" : "fail",
      details: "TraceBlockTransactions responses should match schema and succeed on sampled touched blocks",
      evidence: {
        sampled: blockSamples.length,
        failures: traceBlockFailures,
        blocks: blockSamples,
      },
    });
  },
};
