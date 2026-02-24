import { CallData, hash } from "starknet";
import type { SimulationScenario } from "../engine/scenario-runner.js";
import { STRK_TOKEN_ADDRESS } from "../perpetual/deployer.js";
import {
  getAccountNonce,
  getPositionTotalValue,
  getStrkBalance,
  submitStrict,
  toUint256Calldata,
} from "./common.js";
import {
  COLLATERAL_ASSET_ID,
  TRADE_BASE_AMOUNT_A,
  TRADE_BASE_ASSET_ID,
  TRADE_QUOTE_AMOUNT_A,
  USER_A_DEPOSIT_SALT,
  USER_A_POSITION_ID,
  USER_A_TRANSFER_SALT,
  USER_A_WITHDRAW_SALT,
  USER_B_DEPOSIT_SALT,
  USER_B_POSITION_ID,
} from "./perpetual-fixture.js";
import {
  nowInSeconds,
  signTradeOrder,
  signTransferRequest,
  signWithdrawRequest,
  toFeltFromSigned,
  type TradeOrderLike,
} from "./perpetual-signing.js";

async function getOperatorNonce(ctx: Parameters<SimulationScenario["run"]>[0]): Promise<bigint> {
  const raw = await (ctx.deployCtx.provider as any).callContract({
    contractAddress: ctx.deployCtx.artifacts.coreAddress,
    entrypoint: "get_operator_nonce",
    calldata: [],
  });

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Unexpected get_operator_nonce return shape: ${JSON.stringify(raw)}`);
  }

  return BigInt(raw[0]);
}

function tradeOrderSalt(seed: string): bigint {
  return BigInt(hash.getSelectorFromName(seed)) % 10_000_000n;
}

export const correctnessExactValuesScenario: SimulationScenario = {
  id: "correctness_exact_values",
  dispatchMode: "strict",
  async run(ctx) {
    const coreAddress = ctx.deployCtx.artifacts.coreAddress;

    const senderBalanceBefore = await getStrkBalance(
      ctx,
      ctx.deployCtx.governanceAccount.address,
    );
    const receiverBalanceBefore = await getStrkBalance(
      ctx,
      ctx.deployCtx.userA.address,
    );

    const governanceNonceBefore = await getAccountNonce(
      ctx,
      ctx.deployCtx.governanceAccount.address,
    );
    const userANonceBefore = await getAccountNonce(ctx, ctx.deployCtx.userA.address);

    const opNonce0 = await getOperatorNonce(ctx);
    await submitStrict(ctx, {
      account: ctx.deployCtx.governanceAccount,
      label: "correctness.new_position_a",
      calls: {
        contractAddress: coreAddress,
        entrypoint: "new_position",
        calldata: [
          opNonce0,
          USER_A_POSITION_ID,
          ctx.deployCtx.userAPublicKey,
          ctx.deployCtx.userA.address,
          1,
        ],
      },
    });

    const opNonce1 = await getOperatorNonce(ctx);
    await submitStrict(ctx, {
      account: ctx.deployCtx.governanceAccount,
      label: "correctness.new_position_b",
      calls: {
        contractAddress: coreAddress,
        entrypoint: "new_position",
        calldata: [
          opNonce1,
          USER_B_POSITION_ID,
          ctx.deployCtx.userBPublicKey,
          ctx.deployCtx.userB.address,
          1,
        ],
      },
    });

    const approveAmount = 20_000_000n;
    await submitStrict(ctx, {
      account: ctx.deployCtx.userA,
      label: "correctness.approve_user_a",
      calls: {
        contractAddress: STRK_TOKEN_ADDRESS,
        entrypoint: "approve",
        calldata: [
          coreAddress,
          toUint256Calldata(approveAmount).low,
          toUint256Calldata(approveAmount).high,
        ],
      },
    });

    await submitStrict(ctx, {
      account: ctx.deployCtx.userB,
      label: "correctness.approve_user_b",
      calls: {
        contractAddress: STRK_TOKEN_ADDRESS,
        entrypoint: "approve",
        calldata: [
          coreAddress,
          toUint256Calldata(approveAmount).low,
          toUint256Calldata(approveAmount).high,
        ],
      },
    });

    const depositAmount = 10_000_000n;
    await submitStrict(ctx, {
      account: ctx.deployCtx.userA,
      label: "correctness.deposit_request_a",
      calls: {
        contractAddress: coreAddress,
        entrypoint: "deposit_asset",
        calldata: [COLLATERAL_ASSET_ID, USER_A_POSITION_ID, depositAmount, USER_A_DEPOSIT_SALT],
      },
    });

    const opNonce2 = await getOperatorNonce(ctx);
    await submitStrict(ctx, {
      account: ctx.deployCtx.governanceAccount,
      label: "correctness.process_deposit_a",
      calls: {
        contractAddress: coreAddress,
        entrypoint: "process_deposit",
        calldata: [
          opNonce2,
          ctx.deployCtx.userA.address,
          COLLATERAL_ASSET_ID,
          USER_A_POSITION_ID,
          depositAmount,
          USER_A_DEPOSIT_SALT,
          0,
        ],
      },
    });

    await submitStrict(ctx, {
      account: ctx.deployCtx.userB,
      label: "correctness.deposit_request_b",
      calls: {
        contractAddress: coreAddress,
        entrypoint: "deposit_asset",
        calldata: [COLLATERAL_ASSET_ID, USER_B_POSITION_ID, depositAmount, USER_B_DEPOSIT_SALT],
      },
    });

    const opNonce3 = await getOperatorNonce(ctx);
    await submitStrict(ctx, {
      account: ctx.deployCtx.governanceAccount,
      label: "correctness.process_deposit_b",
      calls: {
        contractAddress: coreAddress,
        entrypoint: "process_deposit",
        calldata: [
          opNonce3,
          ctx.deployCtx.userB.address,
          COLLATERAL_ASSET_ID,
          USER_B_POSITION_ID,
          depositAmount,
          USER_B_DEPOSIT_SALT,
          0,
        ],
      },
    });

    const posAAfterDeposit = await getPositionTotalValue(ctx, USER_A_POSITION_ID);
    const posBAfterDeposit = await getPositionTotalValue(ctx, USER_B_POSITION_ID);

    ctx.stateModel.assertEqual({
      checks: ctx.checks,
      id: "correctness_exact_values.position_a_after_deposit",
      details: "Position A total value should equal deposit amount after processing",
      expected: depositAmount,
      actual: posAAfterDeposit,
    });

    ctx.stateModel.assertEqual({
      checks: ctx.checks,
      id: "correctness_exact_values.position_b_after_deposit",
      details: "Position B total value should equal deposit amount after processing",
      expected: depositAmount,
      actual: posBAfterDeposit,
    });

    const transferAmountInternal = 25_000n;
    const transferExpiration = nowInSeconds() + 7n * 24n * 60n * 60n;
    const transferSig = signTransferRequest({
      privateKey: ctx.deployCtx.userAPrivateKey,
      publicKey: ctx.deployCtx.userAPublicKey,
      recipientPositionId: USER_B_POSITION_ID,
      positionId: USER_A_POSITION_ID,
      collateralAssetId: BigInt(COLLATERAL_ASSET_ID),
      amount: transferAmountInternal,
      expiration: transferExpiration,
      salt: BigInt(USER_A_TRANSFER_SALT),
    });

    await submitStrict(ctx, {
      account: ctx.deployCtx.userA,
      label: "correctness.transfer_request_internal",
      calls: {
        contractAddress: coreAddress,
        entrypoint: "transfer_request",
        calldata: [
          transferSig[0],
          transferSig[1],
          COLLATERAL_ASSET_ID,
          USER_B_POSITION_ID,
          USER_A_POSITION_ID,
          transferAmountInternal,
          transferExpiration,
          USER_A_TRANSFER_SALT,
        ],
      },
    });

    const opNonce4 = await getOperatorNonce(ctx);
    await submitStrict(ctx, {
      account: ctx.deployCtx.governanceAccount,
      label: "correctness.transfer_internal",
      calls: {
        contractAddress: coreAddress,
        entrypoint: "transfer",
        calldata: [
          opNonce4,
          COLLATERAL_ASSET_ID,
          USER_B_POSITION_ID,
          USER_A_POSITION_ID,
          transferAmountInternal,
          transferExpiration,
          USER_A_TRANSFER_SALT,
          0,
          0,
        ],
      },
    });

    const posAAfterTransfer = await getPositionTotalValue(ctx, USER_A_POSITION_ID);
    const posBAfterTransfer = await getPositionTotalValue(ctx, USER_B_POSITION_ID);

    ctx.stateModel.assertEqual({
      checks: ctx.checks,
      id: "correctness_exact_values.position_a_after_transfer",
      details: "Position A should decrease by exact internal transfer amount",
      expected: depositAmount - transferAmountInternal,
      actual: posAAfterTransfer,
    });

    ctx.stateModel.assertEqual({
      checks: ctx.checks,
      id: "correctness_exact_values.position_b_after_transfer",
      details: "Position B should increase by exact internal transfer amount",
      expected: depositAmount + transferAmountInternal,
      actual: posBAfterTransfer,
    });

    const withdrawAmount = 100_000n;
    const withdrawExpiration = nowInSeconds() + 7n * 24n * 60n * 60n;
    const withdrawSig = signWithdrawRequest({
      privateKey: ctx.deployCtx.userAPrivateKey,
      publicKey: ctx.deployCtx.userAPublicKey,
      recipientAddress: ctx.deployCtx.userA.address,
      positionId: USER_A_POSITION_ID,
      collateralAssetId: BigInt(COLLATERAL_ASSET_ID),
      amount: withdrawAmount,
      expiration: withdrawExpiration,
      salt: BigInt(USER_A_WITHDRAW_SALT),
    });

    await submitStrict(ctx, {
      account: ctx.deployCtx.userA,
      label: "correctness.withdraw_request",
      calls: {
        contractAddress: coreAddress,
        entrypoint: "withdraw_request",
        calldata: [
          withdrawSig[0],
          withdrawSig[1],
          COLLATERAL_ASSET_ID,
          ctx.deployCtx.userA.address,
          USER_A_POSITION_ID,
          withdrawAmount,
          withdrawExpiration,
          USER_A_WITHDRAW_SALT,
        ],
      },
    });

    const opNonce5 = await getOperatorNonce(ctx);
    await submitStrict(ctx, {
      account: ctx.deployCtx.governanceAccount,
      label: "correctness.withdraw",
      calls: {
        contractAddress: coreAddress,
        entrypoint: "withdraw",
        calldata: [
          opNonce5,
          COLLATERAL_ASSET_ID,
          ctx.deployCtx.userA.address,
          USER_A_POSITION_ID,
          withdrawAmount,
          withdrawExpiration,
          USER_A_WITHDRAW_SALT,
          0,
        ],
      },
    });

    const posAAfterWithdraw = await getPositionTotalValue(ctx, USER_A_POSITION_ID);
    ctx.stateModel.assertEqual({
      checks: ctx.checks,
      id: "correctness_exact_values.position_a_after_withdraw",
      details: "Position A should decrease by exact withdraw amount",
      expected: depositAmount - transferAmountInternal - withdrawAmount,
      actual: posAAfterWithdraw,
    });

    const tradeExpiration = nowInSeconds() + 1_000_000n;
    const orderA: TradeOrderLike = {
      positionId: BigInt(USER_A_POSITION_ID),
      baseAssetId: BigInt(TRADE_BASE_ASSET_ID),
      baseAmount: TRADE_BASE_AMOUNT_A,
      quoteAssetId: BigInt(COLLATERAL_ASSET_ID),
      quoteAmount: TRADE_QUOTE_AMOUNT_A,
      feeAssetId: BigInt(COLLATERAL_ASSET_ID),
      feeAmount: 0n,
      expiration: tradeExpiration,
      salt: tradeOrderSalt("IZANAGI_ORDER_A"),
    };

    const orderB: TradeOrderLike = {
      positionId: BigInt(USER_B_POSITION_ID),
      baseAssetId: BigInt(TRADE_BASE_ASSET_ID),
      baseAmount: -TRADE_BASE_AMOUNT_A,
      quoteAssetId: BigInt(COLLATERAL_ASSET_ID),
      quoteAmount: -TRADE_QUOTE_AMOUNT_A,
      feeAssetId: BigInt(COLLATERAL_ASSET_ID),
      feeAmount: 0n,
      expiration: tradeExpiration,
      salt: tradeOrderSalt("IZANAGI_ORDER_B"),
    };

    const signatureA = signTradeOrder({
      privateKey: ctx.deployCtx.userAPrivateKey,
      publicKey: ctx.deployCtx.userAPublicKey,
      order: orderA,
    });

    const signatureB = signTradeOrder({
      privateKey: ctx.deployCtx.userBPrivateKey,
      publicKey: ctx.deployCtx.userBPublicKey,
      order: orderB,
    });

    const beforeTradeA = await getPositionTotalValue(ctx, USER_A_POSITION_ID);
    const beforeTradeB = await getPositionTotalValue(ctx, USER_B_POSITION_ID);

    const opNonce6 = await getOperatorNonce(ctx);
    await submitStrict(ctx, {
      account: ctx.deployCtx.governanceAccount,
      label: "correctness.trade",
      calls: {
        contractAddress: coreAddress,
        entrypoint: "trade",
        calldata: [
          opNonce6,
          signatureA[0],
          signatureA[1],
          signatureB[0],
          signatureB[1],
          orderA.positionId,
          orderA.baseAssetId,
          toFeltFromSigned(orderA.baseAmount),
          orderA.quoteAssetId,
          toFeltFromSigned(orderA.quoteAmount),
          orderA.feeAssetId,
          orderA.feeAmount,
          orderA.expiration,
          orderA.salt,
          orderB.positionId,
          orderB.baseAssetId,
          toFeltFromSigned(orderB.baseAmount),
          orderB.quoteAssetId,
          toFeltFromSigned(orderB.quoteAmount),
          orderB.feeAssetId,
          orderB.feeAmount,
          orderB.expiration,
          orderB.salt,
          toFeltFromSigned(TRADE_BASE_AMOUNT_A),
          toFeltFromSigned(TRADE_QUOTE_AMOUNT_A),
          0,
          0,
        ],
      },
    });

    const afterTradeA = await getPositionTotalValue(ctx, USER_A_POSITION_ID);
    const afterTradeB = await getPositionTotalValue(ctx, USER_B_POSITION_ID);

    ctx.checks.push({
      id: "correctness_exact_values.trade_nontrivial_effect",
      status:
        afterTradeA !== beforeTradeA && afterTradeB !== beforeTradeB
          ? "pass"
          : "fail",
      details: "Trade should produce non-trivial position total value updates for both traders",
      evidence: {
        beforeTradeA: beforeTradeA.toString(),
        afterTradeA: afterTradeA.toString(),
        beforeTradeB: beforeTradeB.toString(),
        afterTradeB: afterTradeB.toString(),
      },
    });

    const transferAmount = 42n;
    await submitStrict(ctx, {
      account: ctx.deployCtx.governanceAccount,
      label: "correctness.transfer_strk",
      calls: {
        contractAddress: STRK_TOKEN_ADDRESS,
        entrypoint: "transfer",
        calldata: CallData.compile({
          recipient: ctx.deployCtx.userA.address,
          amount: toUint256Calldata(transferAmount),
        }),
      },
    });

    const senderBalanceAfter = await getStrkBalance(
      ctx,
      ctx.deployCtx.governanceAccount.address,
    );
    const receiverBalanceAfter = await getStrkBalance(
      ctx,
      ctx.deployCtx.userA.address,
    );

    const governanceNonceAfter = await getAccountNonce(
      ctx,
      ctx.deployCtx.governanceAccount.address,
    );
    const userANonceAfter = await getAccountNonce(ctx, ctx.deployCtx.userA.address);

    ctx.stateModel.assertEqual({
      checks: ctx.checks,
      id: "correctness_exact_values.receiver_balance_delta",
      details: "Receiver STRK balance should increase by exact transfer amount",
      expected: receiverBalanceBefore + transferAmount,
      actual: receiverBalanceAfter,
    });

    ctx.checks.push({
      id: "correctness_exact_values.sender_balance_delta",
      status:
        senderBalanceAfter <= senderBalanceBefore - transferAmount
          ? "pass"
          : "fail",
      details:
        "Sender STRK balance should decrease by at least transfer amount (plus fees)",
      evidence: {
        before: senderBalanceBefore.toString(),
        after: senderBalanceAfter.toString(),
        transferAmount: transferAmount.toString(),
      },
    });

    ctx.checks.push({
      id: "correctness_exact_values.governance_nonce_bump",
      status: governanceNonceAfter > governanceNonceBefore ? "pass" : "fail",
      details: "Governance account nonce should increase after strict flow",
      evidence: {
        before: governanceNonceBefore.toString(),
        after: governanceNonceAfter.toString(),
      },
    });

    ctx.checks.push({
      id: "correctness_exact_values.user_a_nonce_bump",
      status: userANonceAfter > userANonceBefore ? "pass" : "fail",
      details: "User A nonce should increase after strict flow",
      evidence: {
        before: userANonceBefore.toString(),
        after: userANonceAfter.toString(),
      },
    });
  },
};
