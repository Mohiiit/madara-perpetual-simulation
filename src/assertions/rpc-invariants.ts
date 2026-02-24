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
  let txEndpointFailures = false;
  let blockEndpointFailures = false;

  for (const txHash of options.txHashes) {
    const byHash = await rawRpcCall<any>(options.rpcUrl, "starknet_getTransactionByHash", [txHash]);
    if (!("result" in byHash)) {
      txEndpointFailures = true;
      pushFailure(options.checks, "rpc_consistency_suite.tx_by_hash", "Failed getTransactionByHash", {
        txHash,
        error: (byHash as any).error,
      });
      continue;
    }

    const receipt = await rawRpcCall<ReceiptLike>(options.rpcUrl, "starknet_getTransactionReceipt", [txHash]);
    if (!("result" in receipt)) {
      txEndpointFailures = true;
      pushFailure(options.checks, "rpc_consistency_suite.tx_receipt", "Failed getTransactionReceipt", {
        txHash,
        error: (receipt as any).error,
      });
      continue;
    }

    const status = await rawRpcCall<any>(options.rpcUrl, "starknet_getTransactionStatus", [txHash]);
    if (!("result" in status)) {
      txEndpointFailures = true;
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
    status: txEndpointFailures ? "fail" : "pass",
    details: "Queried tx/hash/receipt/status for produced scenario txs",
    evidence: { txCount: options.txHashes.length, touchedBlocks: [...touchedBlocks] },
  });

  for (const blockNumber of touchedBlocks) {
    const blockId = { block_number: blockNumber };

    const withHashes = await rawRpcCall<any>(options.rpcUrl, "starknet_getBlockWithTxHashes", [blockId]);
    const withTxs = await rawRpcCall<any>(options.rpcUrl, "starknet_getBlockWithTxs", [blockId]);
    const withReceipts = await rawRpcCall<any>(options.rpcUrl, "starknet_getBlockWithReceipts", [blockId]);
    const stateUpdate = await rawRpcCall<any>(options.rpcUrl, "starknet_getStateUpdate", [blockId]);

    const failed = [withHashes, withTxs, withReceipts, stateUpdate].find((v) => !("result" in v));
    if (failed) {
      blockEndpointFailures = true;
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
    status: blockEndpointFailures ? "fail" : "pass",
    details: "Queried block and state update endpoints for all touched blocks",
    evidence: { touchedBlockCount: touchedBlocks.size },
  });
}
