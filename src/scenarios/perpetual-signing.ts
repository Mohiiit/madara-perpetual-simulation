import { constants, ec, hash, shortString, stark } from "starknet";

const ORDER_ARGS_HASH = BigInt(
  "0x36DA8D51815527CABFAA9C982F564C80FA7429616739306036F1F9B608DD112",
);
const WITHDRAW_ARGS_HASH = BigInt(
  "0x250A5FA378E8B771654BD43DCB34844534F9D1E29E16B14760D7936EA7F4B1D",
);
const TRANSFER_ARGS_HASH = BigInt(
  "0x1DB88E2709FDF2C59E651D141C3296A42B209CE770871B40413EA109846A3B4",
);
const STARKNET_DOMAIN_HASH = BigInt(
  "0x1FF2F602E42168014D405A94F75E8A93D640751D71D16311266E140D8B0A210",
);

const PERPETUALS_NAME = shortString.encodeShortString("Perpetuals");
const PERPETUALS_VERSION = shortString.encodeShortString("v0");
const STARKNET_MESSAGE = shortString.encodeShortString("StarkNet Message");
const STARKNET_CHAIN_ID_MAINNET = constants.StarknetChainId.SN_MAIN;
const REVISION = 1n;

const FELT_PRIME = constants.PRIME;

export type PerpetualSignatureType = [string, string];

export interface TradeOrderLike {
  positionId: bigint;
  baseAssetId: bigint;
  baseAmount: bigint;
  quoteAssetId: bigint;
  quoteAmount: bigint;
  feeAssetId: bigint;
  feeAmount: bigint;
  expiration: bigint;
  salt: bigint;
}

function normalizeSignedFelt(value: bigint): bigint {
  if (value >= 0n) {
    return value;
  }

  return FELT_PRIME + value;
}

function toPoseidonFieldElements(values: bigint[]): bigint[] {
  return values.map(normalizeSignedFelt);
}

function poseidonMany(values: bigint[]): bigint {
  return BigInt(hash.computePoseidonHashOnElements(values));
}

export function toFeltFromSigned(value: bigint): bigint {
  return normalizeSignedFelt(value);
}

export function signPerpetualMessage(options: {
  privateKey: string;
  publicKey: string;
  argsHashConstant: bigint;
  argsValues: bigint[];
}): PerpetualSignatureType {
  const argsHash = poseidonMany(
    toPoseidonFieldElements([options.argsHashConstant, ...options.argsValues]),
  );

  const starknetDomainHash = poseidonMany([
    STARKNET_DOMAIN_HASH,
    BigInt(PERPETUALS_NAME),
    BigInt(PERPETUALS_VERSION),
    BigInt(STARKNET_CHAIN_ID_MAINNET),
    REVISION,
  ]);

  const messageHash = poseidonMany([
    BigInt(STARKNET_MESSAGE),
    starknetDomainHash,
    BigInt(options.publicKey),
    argsHash,
  ]);

  const messageHashHex = `0x${messageHash.toString(16)}`;
  const signature = ec.starkCurve.sign(messageHashHex, options.privateKey);
  return stark.signatureToHexArray(signature) as PerpetualSignatureType;
}

export function signWithdrawRequest(options: {
  privateKey: string;
  publicKey: string;
  recipientAddress: string;
  positionId: number;
  collateralAssetId: bigint;
  amount: bigint;
  expiration: bigint;
  salt: bigint;
}): PerpetualSignatureType {
  return signPerpetualMessage({
    privateKey: options.privateKey,
    publicKey: options.publicKey,
    argsHashConstant: WITHDRAW_ARGS_HASH,
    argsValues: [
      BigInt(options.recipientAddress),
      BigInt(options.positionId),
      options.collateralAssetId,
      options.amount,
      options.expiration,
      options.salt,
    ],
  });
}

export function signTransferRequest(options: {
  privateKey: string;
  publicKey: string;
  recipientPositionId: number;
  positionId: number;
  collateralAssetId: bigint;
  amount: bigint;
  expiration: bigint;
  salt: bigint;
}): PerpetualSignatureType {
  return signPerpetualMessage({
    privateKey: options.privateKey,
    publicKey: options.publicKey,
    argsHashConstant: TRANSFER_ARGS_HASH,
    argsValues: [
      BigInt(options.recipientPositionId),
      BigInt(options.positionId),
      options.collateralAssetId,
      options.amount,
      options.expiration,
      options.salt,
    ],
  });
}

export function signTradeOrder(options: {
  privateKey: string;
  publicKey: string;
  order: TradeOrderLike;
}): PerpetualSignatureType {
  const order = options.order;
  return signPerpetualMessage({
    privateKey: options.privateKey,
    publicKey: options.publicKey,
    argsHashConstant: ORDER_ARGS_HASH,
    argsValues: [
      order.positionId,
      order.baseAssetId,
      order.baseAmount,
      order.quoteAssetId,
      order.quoteAmount,
      order.feeAssetId,
      order.feeAmount,
      order.expiration,
      order.salt,
    ],
  });
}

export function nowInSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}
