import type { Account, AllowArray, Call } from "starknet";
import type { PerfRecorder } from "./perf-recorder.js";

export interface SubmittedTx {
  txHash: string;
  label: string;
  accountAddress: string;
  submittedAtMs: number;
}

export interface ExpectedSubmissionError {
  label: string;
  error: string;
}

export interface DispatchResult {
  submitted?: SubmittedTx;
  expectedError?: ExpectedSubmissionError;
}

function addOne(hexValue: string): string {
  return `0x${(BigInt(hexValue) + 1n).toString(16)}`;
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export class TxDispatcher {
  private readonly nonceByAddress = new Map<string, string>();

  private readonly nonceLocks = new Map<string, Promise<void>>();

  constructor(private readonly perfRecorder: PerfRecorder) {}

  private async withNonceLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
    const key = normalizeAddress(address);
    const previous = this.nonceLocks.get(key) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.nonceLocks.set(
      key,
      previous.then(() => current),
    );

    await previous;

    try {
      return await fn();
    } finally {
      release();
      if (this.nonceLocks.get(key) === current) {
        this.nonceLocks.delete(key);
      }
    }
  }

  private async nextNonce(account: Account): Promise<string> {
    return this.withNonceLock(account.address, async () => {
      const key = normalizeAddress(account.address);
      const cached = this.nonceByAddress.get(key);
      if (cached) {
        this.nonceByAddress.set(key, addOne(cached));
        return cached;
      }

      let currentNonce = "0x0";
      try {
        currentNonce = await account.getNonce("latest");
      } catch {
        currentNonce = "0x0";
      }

      this.nonceByAddress.set(key, addOne(currentNonce));
      return currentNonce;
    });
  }

  async submit(options: {
    account: Account;
    calls: AllowArray<Call>;
    label: string;
    expectedFailure?: boolean;
    explicitNonce?: string;
  }): Promise<DispatchResult> {
    const nonce = options.explicitNonce ?? (await this.nextNonce(options.account));
    const started = Date.now();

    try {
      const response = await options.account.execute(options.calls, { nonce });
      this.perfRecorder.record({
        method: "starknet_addInvokeTransaction",
        rpcClass: "write_submit",
        latencyMs: Date.now() - started,
        ok: true,
      });

      if (options.expectedFailure) {
        return {
          expectedError: {
            label: options.label,
            error: `Expected submission failure but got tx hash ${response.transaction_hash}`,
          },
        };
      }

      return {
        submitted: {
          txHash: response.transaction_hash,
          label: options.label,
          accountAddress: options.account.address,
          submittedAtMs: started,
        },
      };
    } catch (error) {
      this.perfRecorder.record({
        method: "starknet_addInvokeTransaction",
        rpcClass: "write_submit",
        latencyMs: Date.now() - started,
        ok: false,
      });

      if (options.expectedFailure) {
        return {
          expectedError: {
            label: options.label,
            error: String((error as Error)?.message ?? error),
          },
        };
      }

      throw error;
    }
  }

  async submitBurst(
    entries: Array<{
      account: Account;
      calls: AllowArray<Call>;
      label: string;
      expectedFailure?: boolean;
      explicitNonce?: string;
    }>,
  ): Promise<DispatchResult[]> {
    return Promise.all(entries.map((entry) => this.submit(entry)));
  }
}
