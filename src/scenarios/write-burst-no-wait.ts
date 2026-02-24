import { CallData } from "starknet";
import type { SimulationScenario } from "../engine/scenario-runner.js";
import { STRK_TOKEN_ADDRESS } from "../perpetual/deployer.js";
import { reconcileSubmittedTxs } from "../engine/receipt-reconciler.js";
import { getStrkBalance } from "./common.js";

interface PendingTag {
  recipient: string;
  amount: bigint;
}

export const writeBurstNoWaitScenario: SimulationScenario = {
  id: "write_burst_no_wait",
  dispatchMode: "windowed_burst",
  async run(ctx) {
    const account = ctx.deployCtx.governanceAccount;
    const recipients = [ctx.deployCtx.userA.address, ctx.deployCtx.userB.address];
    const transferAmount = 1n;

    const balanceBefore = new Map<string, bigint>();
    for (const recipient of recipients) {
      balanceBefore.set(recipient.toLowerCase(), await getStrkBalance(ctx, recipient));
    }

    const pending: Array<ReturnType<typeof createPendingRecord>> = [];
    const acceptedByRecipient = new Map<string, bigint>();
    const pendingTagByHash = new Map<string, PendingTag>();

    const pushAccepted = (recipient: string, amount: bigint): void => {
      const key = recipient.toLowerCase();
      acceptedByRecipient.set(key, (acceptedByRecipient.get(key) ?? 0n) + amount);
    };

    let remaining = ctx.profile.writeTargetCount;
    let burstIndex = 0;

    while (remaining > 0) {
      const currentBatchSize = Math.min(ctx.profile.burstSize, remaining);
      remaining -= currentBatchSize;

      const batchEntries = new Array(currentBatchSize).fill(0).map((_, idx) => {
        const recipient = recipients[(burstIndex + idx) % recipients.length];
        return {
          account,
          label: `write_burst_no_wait.transfer.${burstIndex}.${idx}`,
          calls: {
            contractAddress: STRK_TOKEN_ADDRESS,
            entrypoint: "transfer",
            calldata: CallData.compile({
              recipient,
              amount: { low: transferAmount, high: 0 },
            }),
          },
          recipient,
          amount: transferAmount,
        };
      });

      burstIndex += currentBatchSize;

      const dispatchResults = await ctx.dispatcher.submitBurst(
        batchEntries.map((entry) => ({
          account: entry.account,
          calls: entry.calls,
          label: entry.label,
        })),
      );

      for (let idx = 0; idx < dispatchResults.length; idx += 1) {
        const entry = batchEntries[idx];
        const result = dispatchResults[idx];

        if (result.expectedError) {
          ctx.checks.push({
            id: `write_burst_no_wait.unexpected_submit_error.${entry.label}`,
            status: "fail",
            details: "Unexpected submit-time error during write burst",
            evidence: { label: entry.label, error: result.expectedError.error },
          });
          continue;
        }

        if (!result.submitted) {
          ctx.checks.push({
            id: `write_burst_no_wait.missing_submission.${entry.label}`,
            status: "fail",
            details: "Missing submission result during write burst",
          });
          continue;
        }

        const record = createPendingRecord(result.submitted, entry.recipient, entry.amount);
        pending.push(record);
        pendingTagByHash.set(result.submitted.txHash, {
          recipient: entry.recipient,
          amount: entry.amount,
        });
        ctx.runtimeArtifacts.submitted.push(result.submitted);
      }

      if (pending.length >= ctx.profile.maxInFlight) {
        const reconcile = await reconcileSubmittedTxs({
          rpc: ctx.rpc,
          perfRecorder: ctx.perfRecorder,
          pending: pending.map((entry) => entry.submitted),
          timeoutMs: ctx.profile.reconcileTimeoutMs,
          intervalMs: 1_000,
        });

        pending.length = 0;
        for (const unresolved of reconcile.unresolved) {
          const tag = pendingTagByHash.get(unresolved.txHash);
          if (!tag) {
            continue;
          }
          pending.push(createPendingRecord(unresolved, tag.recipient, tag.amount));
        }

        for (const resolved of reconcile.resolved) {
          ctx.runtimeArtifacts.reconciled.push(resolved);
          if (typeof resolved.blockNumber === "number") {
            ctx.runtimeArtifacts.touchedBlocks.add(resolved.blockNumber);
          }

          const tag = pendingTagByHash.get(resolved.txHash);
          if (tag && resolved.status === "accepted") {
            pushAccepted(tag.recipient, tag.amount);
          }
        }
      }
    }

    const finalReconcile = await reconcileSubmittedTxs({
      rpc: ctx.rpc,
      perfRecorder: ctx.perfRecorder,
      pending: pending.map((entry) => entry.submitted),
      timeoutMs: ctx.profile.reconcileTimeoutMs,
      intervalMs: 1_000,
    });

    for (const resolved of finalReconcile.resolved) {
      ctx.runtimeArtifacts.reconciled.push(resolved);
      if (typeof resolved.blockNumber === "number") {
        ctx.runtimeArtifacts.touchedBlocks.add(resolved.blockNumber);
      }

      const tag = pendingTagByHash.get(resolved.txHash);
      if (tag && resolved.status === "accepted") {
        pushAccepted(tag.recipient, tag.amount);
      }
    }

    ctx.checks.push({
      id: "write_burst_no_wait.reconciliation_completeness",
      status:
        finalReconcile.unresolved.length === 0 &&
        finalReconcile.resolved.every((entry) => entry.status === "accepted")
          ? "pass"
          : "fail",
      details:
        "All burst-submitted write transactions should resolve to accepted status by window boundary",
      evidence: {
        unresolvedCount: finalReconcile.unresolved.length,
        unresolved: finalReconcile.unresolved.map((entry) => entry.txHash),
        resolvedCount: finalReconcile.resolved.length,
      },
    });

    const balanceAfter = new Map<string, bigint>();
    for (const recipient of recipients) {
      balanceAfter.set(recipient.toLowerCase(), await getStrkBalance(ctx, recipient));
    }

    for (const recipient of recipients) {
      const key = recipient.toLowerCase();
      const before = balanceBefore.get(key) ?? 0n;
      const after = balanceAfter.get(key) ?? 0n;
      const expectedDelta = acceptedByRecipient.get(key) ?? 0n;

      ctx.stateModel.assertEqual({
        checks: ctx.checks,
        id: `write_burst_no_wait.balance_delta.${key}`,
        details:
          "Recipient STRK balance delta should match accepted transfer count under no-wait burst dispatch",
        expected: before + expectedDelta,
        actual: after,
        evidence: {
          recipient,
          before: before.toString(),
          acceptedDelta: expectedDelta.toString(),
        },
      });
    }
  },
};

function createPendingRecord(
  submitted: {
    txHash: string;
    label: string;
    accountAddress: string;
    submittedAtMs: number;
  },
  recipient: string,
  amount: bigint,
): { submitted: typeof submitted; recipient: string; amount: bigint } {
  return { submitted, recipient, amount };
}
