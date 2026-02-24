import { cairo } from "starknet";
import type { Account } from "starknet";
import type { ScenarioContext } from "../engine/scenario-runner.js";
import { reconcileSubmittedTxs } from "../engine/receipt-reconciler.js";
import type { DispatchResult, SubmittedTx } from "../engine/tx-dispatcher.js";
import { STRK_TOKEN_ADDRESS } from "../perpetual/deployer.js";
import type { BigNumberish } from "starknet";

export function toUint256Calldata(amount: bigint): { low: BigNumberish; high: BigNumberish } {
  return cairo.uint256(amount);
}

export async function submitStrict(
  ctx: ScenarioContext,
  options: {
    account: Account;
    label: string;
    calls: Parameters<Account["execute"]>[0];
  },
): Promise<SubmittedTx> {
  const dispatch = await ctx.dispatcher.submit({
    account: options.account,
    label: options.label,
    calls: options.calls,
  });

  if (!dispatch.submitted) {
    throw new Error(`Strict submission failed for ${options.label}: ${dispatch.expectedError?.error}`);
  }

  const reconciled = await reconcileSubmittedTxs({
    rpc: ctx.rpc,
    perfRecorder: ctx.perfRecorder,
    pending: [dispatch.submitted],
    timeoutMs: 180_000,
    intervalMs: 1_000,
  });

  if (reconciled.unresolved.length > 0) {
    throw new Error(`Unresolved strict tx ${dispatch.submitted.txHash}`);
  }

  const resolved = reconciled.resolved[0];
  if (!resolved || resolved.status !== "accepted") {
    throw new Error(`Strict tx ${dispatch.submitted.txHash} not accepted`);
  }

  ctx.runtimeArtifacts.submitted.push(dispatch.submitted);
  ctx.runtimeArtifacts.reconciled.push(resolved);
  if (typeof resolved.blockNumber === "number") {
    ctx.runtimeArtifacts.touchedBlocks.add(resolved.blockNumber);
  }

  return dispatch.submitted;
}

export function expectExpectedError(
  result: DispatchResult,
  label: string,
): string {
  if (!result.expectedError) {
    throw new Error(`Expected failure for ${label} but submission succeeded`);
  }
  return result.expectedError.error;
}

export async function getStrkBalance(
  ctx: ScenarioContext,
  address: string,
): Promise<bigint> {
  const raw = await (ctx.deployCtx.provider as any).callContract({
    contractAddress: STRK_TOKEN_ADDRESS,
    entrypoint: "balance_of",
    calldata: [address],
  });

  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error(`Unexpected balance_of response shape: ${JSON.stringify(raw)}`);
  }

  const low = BigInt(raw[0]);
  const high = BigInt(raw[1]);
  return low + (high << 128n);
}

export async function getPositionTotalValue(
  ctx: ScenarioContext,
  positionId: number,
): Promise<bigint> {
  const raw = await (ctx.deployCtx.provider as any).callContract({
    contractAddress: ctx.deployCtx.artifacts.coreAddress,
    entrypoint: "get_position_tv_tr",
    calldata: [positionId],
  });

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Unexpected get_position_tv_tr response shape: ${JSON.stringify(raw)}`);
  }

  return BigInt(raw[0]);
}

export async function getAccountNonce(
  ctx: ScenarioContext,
  address: string,
): Promise<bigint> {
  const nonce = await ctx.rpc.requireResult<string>(
    "starknet_getNonce",
    ["latest", address],
    "read",
  );
  return BigInt(nonce);
}
