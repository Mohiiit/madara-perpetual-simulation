import { hash } from "starknet";

function deterministicId(seed: string, offset: bigint): number {
  const base = BigInt(hash.getSelectorFromName(seed));
  return Number((base % 10_000_000n) + offset);
}

export const COLLATERAL_ASSET_ID = hash.getSelectorFromName("COLLATERAL_ASSET_ID");

export const USER_A_POSITION_ID = deterministicId("IZANAGI_POS_A", 11_111n);
export const USER_B_POSITION_ID = deterministicId("IZANAGI_POS_B", 22_222n);

export const USER_A_DEPOSIT_SALT = deterministicId("IZANAGI_DEPOSIT_A", 1n);
export const USER_B_DEPOSIT_SALT = deterministicId("IZANAGI_DEPOSIT_B", 2n);

export const USER_A_WITHDRAW_SALT = deterministicId("IZANAGI_WITHDRAW_A", 3n);
export const USER_A_TRANSFER_SALT = deterministicId("IZANAGI_TRANSFER_A", 4n);

export const TRADE_BASE_ASSET_ID = "0x47524153532D310000000000000000";
export const TRADE_BASE_AMOUNT_A = 37n;
export const TRADE_QUOTE_AMOUNT_A = -5_303_580n;
