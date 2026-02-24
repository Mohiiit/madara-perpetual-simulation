import type { CheckResult } from "../config/run-config.js";
import { rawRpcCall } from "../infra/rpc-client.js";

interface ReceiptLike {
  block_number?: number;
}

function pushFailure(checks: CheckResult[], id: string, details: string, evidence?: Record<string, unknown>) {
  checks.push({ id, status: "fail", details, evidence });
}

export async function runRpcConsistencySuite(options: {
  rpcUrl: string;
  txHashes: string[];
  checks: CheckResult[];
}): Promise<void> {
  const touchedBlocks = new Set<number>();

  for (const txHash of options.txHashes) {
    const byHash = await rawRpcCall<any>(options.rpcUrl, "starknet_getTransactionByHash", [
      { transaction_hash: txHash },
    ]);
    if (!("result" in byHash)) {
      pushFailure(options.checks, "rpc_consistency_suite.tx_by_hash", "Failed getTransactionByHash", {
        txHash,
        error: (byHash as any).error,
      });
      continue;
    }

    const receipt = await rawRpcCall<ReceiptLike>(options.rpcUrl, "starknet_getTransactionReceipt", [
      { transaction_hash: txHash },
    ]);
    if (!("result" in receipt)) {
      pushFailure(options.checks, "rpc_consistency_suite.tx_receipt", "Failed getTransactionReceipt", {
        txHash,
        error: (receipt as any).error,
      });
      continue;
    }

    const status = await rawRpcCall<any>(options.rpcUrl, "starknet_getTransactionStatus", [
      { transaction_hash: txHash },
    ]);
    if (!("result" in status)) {
      pushFailure(options.checks, "rpc_consistency_suite.tx_status", "Failed getTransactionStatus", {
        txHash,
        error: (status as any).error,
      });
      continue;
    }

    if (typeof receipt.result.block_number === "number") {
      touchedBlocks.add(receipt.result.block_number);
    }
  }

  options.checks.push({
    id: "rpc_consistency_suite.tx_endpoints",
    status: "pass",
    details: "Queried tx/hash/receipt/status for produced scenario txs",
    evidence: { txCount: options.txHashes.length, touchedBlocks: [...touchedBlocks] },
  });

  for (const blockNumber of touchedBlocks) {
    const blockId = { block_number: blockNumber };

    const withHashes = await rawRpcCall<any>(options.rpcUrl, "starknet_getBlockWithTxHashes", [
      { block_id: blockId },
    ]);
    const withTxs = await rawRpcCall<any>(options.rpcUrl, "starknet_getBlockWithTxs", [
      { block_id: blockId },
    ]);
    const withReceipts = await rawRpcCall<any>(options.rpcUrl, "starknet_getBlockWithReceipts", [
      { block_id: blockId },
    ]);
    const stateUpdate = await rawRpcCall<any>(options.rpcUrl, "starknet_getStateUpdate", [
      { block_id: blockId },
    ]);

    const failed = [withHashes, withTxs, withReceipts, stateUpdate].find((v) => !("result" in v));
    if (failed) {
      pushFailure(
        options.checks,
        "rpc_consistency_suite.block_endpoints",
        `Failed one of block/state endpoints for block ${blockNumber}`,
        { blockNumber },
      );
      continue;
    }
  }

  options.checks.push({
    id: "rpc_consistency_suite.block_endpoints",
    status: "pass",
    details: "Queried block and state update endpoints for all touched blocks",
    evidence: { touchedBlockCount: touchedBlocks.size },
  });
}
