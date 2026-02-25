import { CallData } from "starknet";
import type { SimulationScenario } from "../engine/scenario-runner.js";
import { STRK_TOKEN_ADDRESS } from "../perpetual/deployer.js";
import { reconcileSubmittedTxs } from "../engine/receipt-reconciler.js";

function addHex(hexValue: string, increment: bigint): string {
  return `0x${(BigInt(hexValue) + increment).toString(16)}`;
}

export const edgeHotAccountMixedScenario: SimulationScenario = {
  id: "edge_hot_account_mixed",
  dispatchMode: "windowed_burst",
  async run(ctx) {
    const account = ctx.deployCtx.userA;
    const coreAddress = ctx.deployCtx.artifacts.coreAddress;

    const latestNonce = await account.getNonce("latest");

    const sendOneCall = {
      contractAddress: STRK_TOKEN_ADDRESS,
      entrypoint: "transfer",
      calldata: CallData.compile({
        recipient: ctx.deployCtx.userB.address,
        amount: { low: 1, high: 0 },
      }),
    };

    const approveCall = {
      contractAddress: STRK_TOKEN_ADDRESS,
      entrypoint: "approve",
      calldata: [coreAddress, 1234, 0],
    };

    const burst = await ctx.dispatcher.submitBurst([
      {
        account,
        label: "edge_hot_account_mixed.valid_transfer_n",
        calls: sendOneCall,
        explicitNonce: latestNonce,
      },
      {
        account,
        label: "edge_hot_account_mixed.duplicate_nonce_transfer",
        calls: sendOneCall,
        explicitNonce: latestNonce,
        expectedFailure: true,
      },
      {
        account,
        label: "edge_hot_account_mixed.optimistic_approve_n_plus_1",
        calls: approveCall,
        explicitNonce: addHex(latestNonce, 1n),
        expectedFailure: true,
      },
      {
        account,
        label: "edge_hot_account_mixed.stale_nonce_approve",
        calls: approveCall,
        explicitNonce: latestNonce,
        expectedFailure: true,
      },
    ]);

    const expectedErrors = burst
      .map((result) => result.expectedError)
      .filter((error): error is NonNullable<typeof error> => Boolean(error));

    const submitted = burst
      .map((result) => result.submitted)
      .filter((tx): tx is NonNullable<typeof tx> => Boolean(tx));

    const reconcileResult = await reconcileSubmittedTxs({
      rpc: ctx.rpc,
      perfRecorder: ctx.perfRecorder,
      pending: submitted,
      timeoutMs: 120_000,
      intervalMs: 1_000,
    });

    for (const tx of submitted) {
      ctx.runtimeArtifacts.submitted.push(tx);
    }

    for (const tx of reconcileResult.resolved) {
      ctx.runtimeArtifacts.reconciled.push(tx);
      if (typeof tx.blockNumber === "number") {
        ctx.runtimeArtifacts.touchedBlocks.add(tx.blockNumber);
      }
    }

    ctx.checks.push({
      id: "edge_hot_account_mixed.expected_nonce_errors",
      status: expectedErrors.length >= 1 ? "pass" : "fail",
      details: "Hot-account mixed flow should produce expected stale/duplicate nonce submission errors",
      evidence: {
        expectedErrorCount: expectedErrors.length,
        expectedErrors,
      },
    });

    ctx.checks.push({
      id: "edge_hot_account_mixed.reconcile_submitted",
      status:
        reconcileResult.unresolved.length === 0 &&
        reconcileResult.resolved.some((entry) => entry.status === "accepted")
          ? "pass"
          : "fail",
      details: "Submitted hot-account transactions should reconcile with no orphan hashes",
      evidence: {
        unresolved: reconcileResult.unresolved.map((entry) => entry.txHash),
        resolved: reconcileResult.resolved,
      },
    });
  },
};
