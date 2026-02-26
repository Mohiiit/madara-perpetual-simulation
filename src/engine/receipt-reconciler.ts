import type { CheckResult } from "../config/run-config.js";
import { type JsonRpcResponse } from "../infra/rpc-client.js";
import type { InstrumentedRpcClient } from "../infra/rpc-client.js";
import type { SubmittedTx } from "./tx-dispatcher.js";
import type { PerfRecorder } from "./perf-recorder.js";

export type ReconciledStatus = "accepted" | "reverted" | "rejected";

export interface ReconciledTx {
  txHash: string;
  label: string;
  status: ReconciledStatus;
  blockNumber?: number;
  latencyMs: number;
}

export interface ReconcileResult {
  resolved: ReconciledTx[];
  unresolved: SubmittedTx[];
}

function isTxNotFound(response: JsonRpcResponse<unknown>): boolean {
  if ("result" in response) {
    return false;
  }

  return (
    response.error.code === 29 ||
    /not\s*found/i.test(response.error.message) ||
    /TRANSACTION_HASH_NOT_FOUND/.test(response.error.message)
  );
}

function normalizeFinality(receipt: any): ReconciledStatus | null {
  const finality = receipt?.finality_status ?? receipt?.status;
  const execution = receipt?.execution_status;

  if (finality === "REJECTED") {
    return "rejected";
  }

  if (execution === "REVERTED") {
    return "reverted";
  }

  if (
    finality === "ACCEPTED_ON_L2" ||
    finality === "ACCEPTED_ON_L1" ||
    finality === "ACCEPTED_ONCHAIN"
  ) {
    return "accepted";
  }

  return null;
}

export async function reconcileSubmittedTxs(options: {
  rpc: InstrumentedRpcClient;
  perfRecorder: PerfRecorder;
  pending: SubmittedTx[];
  timeoutMs: number;
  intervalMs?: number;
}): Promise<ReconcileResult> {
  const started = Date.now();
  const intervalMs = options.intervalMs ?? 1000;

  const unresolved = new Map<string, SubmittedTx>();
  for (const tx of options.pending) {
    unresolved.set(tx.txHash, tx);
  }

  const resolved: ReconciledTx[] = [];

  while (Date.now() - started < options.timeoutMs && unresolved.size > 0) {
    const batch = [...unresolved.values()];

    await Promise.all(
      batch.map(async (tx) => {
        const envelope = await options.rpc.rawCall<any>(
          "starknet_getTransactionReceipt",
          [tx.txHash],
          "write_finalize",
          {
            trackPerf: false,
            trackSpec: false,
          },
        );

        if (!("result" in envelope)) {
          if (isTxNotFound(envelope)) {
            return;
          }

          return;
        }

        const status = normalizeFinality(envelope.result);
        if (!status) {
          return;
        }

        unresolved.delete(tx.txHash);

        const finalizedAt = Date.now();
        const latencyMs = finalizedAt - tx.submittedAtMs;
        options.perfRecorder.record({
          method: "starknet_getTransactionReceipt",
          rpcClass: "write_finalize",
          latencyMs,
          ok: status === "accepted",
        });

        resolved.push({
          txHash: tx.txHash,
          label: tx.label,
          status,
          blockNumber:
            typeof envelope.result?.block_number === "number"
              ? envelope.result.block_number
              : undefined,
          latencyMs,
        });
      }),
    );

    if (unresolved.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return {
    resolved,
    unresolved: [...unresolved.values()],
  };
}

export function pushReconciliationCheck(options: {
  checks: CheckResult[];
  reconcileResult: ReconcileResult;
  acceptedOnly?: boolean;
}): void {
  const unresolvedCount = options.reconcileResult.unresolved.length;
  const rejected = options.reconcileResult.resolved.filter(
    (tx) => tx.status !== "accepted",
  );

  const failed =
    unresolvedCount > 0 ||
    (options.acceptedOnly !== false && rejected.length > 0);

  options.checks.push({
    id: "write_reconciliation.window",
    status: failed ? "fail" : "pass",
    details: failed
      ? `Reconciliation failed: unresolved=${unresolvedCount}, non_accepted=${rejected.length}`
      : `Reconciliation succeeded for ${options.reconcileResult.resolved.length} transactions`,
    evidence: {
      unresolvedCount,
      rejected: rejected.slice(0, 20),
      resolvedCount: options.reconcileResult.resolved.length,
    },
  });
}
