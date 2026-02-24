import type { CheckResult } from "../config/run-config.js";

function toKey(parts: Array<string | number>): string {
  return parts.join("::");
}

export class StateModel {
  private readonly expectedBalances = new Map<string, bigint>();

  private readonly expectedNonces = new Map<string, bigint>();

  private readonly expectedPositionTotalValue = new Map<number, bigint>();

  setBalance(scope: string, address: string, value: bigint): void {
    this.expectedBalances.set(toKey([scope, address.toLowerCase()]), value);
  }

  applyBalanceDelta(scope: string, address: string, delta: bigint): void {
    const key = toKey([scope, address.toLowerCase()]);
    const current = this.expectedBalances.get(key) ?? 0n;
    this.expectedBalances.set(key, current + delta);
  }

  expectedBalance(scope: string, address: string): bigint | undefined {
    return this.expectedBalances.get(toKey([scope, address.toLowerCase()]));
  }

  setNonce(address: string, value: bigint): void {
    this.expectedNonces.set(address.toLowerCase(), value);
  }

  bumpNonce(address: string, amount: bigint = 1n): void {
    const key = address.toLowerCase();
    const current = this.expectedNonces.get(key) ?? 0n;
    this.expectedNonces.set(key, current + amount);
  }

  expectedNonce(address: string): bigint | undefined {
    return this.expectedNonces.get(address.toLowerCase());
  }

  setPositionTotalValue(positionId: number, value: bigint): void {
    this.expectedPositionTotalValue.set(positionId, value);
  }

  applyPositionTotalValueDelta(positionId: number, delta: bigint): void {
    const current = this.expectedPositionTotalValue.get(positionId) ?? 0n;
    this.expectedPositionTotalValue.set(positionId, current + delta);
  }

  expectedPositionValue(positionId: number): bigint | undefined {
    return this.expectedPositionTotalValue.get(positionId);
  }

  assertEqual(options: {
    checks: CheckResult[];
    id: string;
    details: string;
    expected: bigint;
    actual: bigint;
    evidence?: Record<string, unknown>;
  }): void {
    options.checks.push({
      id: options.id,
      status: options.expected === options.actual ? "pass" : "fail",
      details: options.details,
      evidence: {
        ...(options.evidence || {}),
        expected: options.expected.toString(),
        actual: options.actual.toString(),
      },
    });
  }
}
