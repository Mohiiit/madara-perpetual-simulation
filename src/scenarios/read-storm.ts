import type { SimulationScenario } from "../engine/scenario-runner.js";

function pickAt<T>(items: T[], index: number): T {
  return items[index % items.length];
}

export const readStormScenario: SimulationScenario = {
  id: "read_storm",
  dispatchMode: "windowed_burst",
  async run(ctx) {
    const acceptedTxs = ctx.runtimeArtifacts.reconciled.filter(
      (entry) => entry.status === "accepted",
    );
    const touchedBlocks = [...ctx.runtimeArtifacts.touchedBlocks].sort((a, b) => a - b);

    if (acceptedTxs.length === 0) {
      throw new Error("read_storm requires at least one accepted transaction");
    }
    if (touchedBlocks.length === 0) {
      throw new Error("read_storm requires at least one touched block");
    }

    let failures = 0;

    const runOne = async (index: number): Promise<void> => {
      const tx = pickAt(acceptedTxs, index);
      const blockNumber = pickAt(touchedBlocks, index);
      const blockId = { block_number: blockNumber };

      switch (index % 10) {
        case 0: {
          const res = await ctx.rpc.rawCall("starknet_getTransactionByHash", [tx.txHash], "read");
          if (!("result" in res)) {
            failures += 1;
          }
          return;
        }
        case 1: {
          const res = await ctx.rpc.rawCall("starknet_getTransactionReceipt", [tx.txHash], "read");
          if (!("result" in res)) {
            failures += 1;
          }
          return;
        }
        case 2: {
          const res = await ctx.rpc.rawCall("starknet_getTransactionStatus", [tx.txHash], "read");
          if (!("result" in res)) {
            failures += 1;
          }
          return;
        }
        case 3: {
          const res = await ctx.rpc.rawCall("starknet_getBlockWithTxHashes", [blockId], "read");
          if (!("result" in res)) {
            failures += 1;
          }
          return;
        }
        case 4: {
          const res = await ctx.rpc.rawCall("starknet_getBlockWithTxs", [blockId], "read");
          if (!("result" in res)) {
            failures += 1;
          }
          return;
        }
        case 5: {
          const res = await ctx.rpc.rawCall("starknet_getBlockWithReceipts", [blockId], "read");
          if (!("result" in res)) {
            failures += 1;
          }
          return;
        }
        case 6: {
          const res = await ctx.rpc.rawCall("starknet_getStateUpdate", [blockId], "read");
          if (!("result" in res)) {
            failures += 1;
          }
          return;
        }
        case 7: {
          const res = await ctx.rpc.rawCall(
            "starknet_getClassHashAt",
            ["latest", ctx.deployCtx.artifacts.coreAddress],
            "read",
          );
          if (!("result" in res)) {
            failures += 1;
          }
          return;
        }
        case 8: {
          const res = await ctx.rpc.rawCall(
            "starknet_getEvents",
            [
              {
                from_block: blockId,
                to_block: blockId,
                address: ctx.deployCtx.artifacts.coreAddress,
                keys: [],
                chunk_size: 256,
              },
            ],
            "read",
          );
          if (!("result" in res)) {
            failures += 1;
          }
          return;
        }
        default: {
          const res = await ctx.rpc.rawCall(
            "starknet_getNonce",
            ["latest", ctx.deployCtx.userA.address],
            "read",
          );
          if (!("result" in res)) {
            failures += 1;
          }
        }
      }
    };

    const parallel = 25;
    let cursor = 0;
    while (cursor < ctx.profile.readTargetCount) {
      const end = Math.min(cursor + parallel, ctx.profile.readTargetCount);
      const tasks: Promise<void>[] = [];
      for (let i = cursor; i < end; i += 1) {
        tasks.push(runOne(i));
      }
      await Promise.all(tasks);
      cursor = end;
    }

    const errorRate = failures / ctx.profile.readTargetCount;
    ctx.checks.push({
      id: "read_storm.error_rate",
      status: errorRate <= 0.005 ? "pass" : "fail",
      details: "Read storm should keep read error rate within target threshold",
      evidence: {
        totalReads: ctx.profile.readTargetCount,
        failures,
        errorRate,
      },
    });
  },
};
