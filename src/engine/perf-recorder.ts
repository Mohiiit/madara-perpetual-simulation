import type {
  ExecutionBackend,
  PerfSample,
  PerfSummary,
  PercentileSummary,
  RpcClass,
} from "../config/run-config.js";

const RPC_CLASSES: RpcClass[] = [
  "read",
  "write_submit",
  "write_finalize",
  "trace",
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarizeSamples(samples: PerfSample[]): PercentileSummary {
  if (samples.length === 0) {
    return {
      count: 0,
      errorRate: 0,
      p50: 0,
      p90: 0,
      p99: 0,
    };
  }

  const durations = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const failures = samples.filter((sample) => !sample.ok).length;

  return {
    count: samples.length,
    errorRate: failures / samples.length,
    p50: percentile(durations, 50),
    p90: percentile(durations, 90),
    p99: percentile(durations, 99),
  };
}

export function emptyPerfSummary(): PerfSummary {
  return {
    read: summarizeSamples([]),
    write_submit: summarizeSamples([]),
    write_finalize: summarizeSamples([]),
    trace: summarizeSamples([]),
  };
}

export class PerfRecorder {
  private readonly samples: PerfSample[] = [];

  constructor(private readonly backend: ExecutionBackend) {}

  record(sample: Omit<PerfSample, "backend">): void {
    this.samples.push({ ...sample, backend: this.backend });
  }

  async measure<T>(
    rpcClass: RpcClass,
    method: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    try {
      const result = await operation();
      this.record({
        method,
        rpcClass,
        latencyMs: Date.now() - started,
        ok: true,
      });
      return result;
    } catch (error) {
      this.record({
        method,
        rpcClass,
        latencyMs: Date.now() - started,
        ok: false,
      });
      throw error;
    }
  }

  summarizeByClass(): PerfSummary {
    const buckets = new Map<RpcClass, PerfSample[]>();
    for (const key of RPC_CLASSES) {
      buckets.set(key, []);
    }

    for (const sample of this.samples) {
      buckets.get(sample.rpcClass)!.push(sample);
    }

    return {
      read: summarizeSamples(buckets.get("read")!),
      write_submit: summarizeSamples(buckets.get("write_submit")!),
      write_finalize: summarizeSamples(buckets.get("write_finalize")!),
      trace: summarizeSamples(buckets.get("trace")!),
    };
  }

  samplesForMethod(method: string): PerfSample[] {
    return this.samples.filter((sample) => sample.method === method);
  }

  allSamples(): PerfSample[] {
    return [...this.samples];
  }
}
