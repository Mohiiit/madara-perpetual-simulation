import type {
  PercentileSummary,
  PerfSummary,
  RpcClass,
  SloGateResult,
} from "../config/run-config.js";

interface AbsoluteCap {
  p50?: number;
  p90?: number;
  p99?: number;
  errorRate?: number;
}

const ABSOLUTE_CAPS: Record<RpcClass, AbsoluteCap> = {
  read: {
    p50: 250,
    p90: 800,
    p99: 2500,
    errorRate: 0.005,
  },
  write_submit: {
    p50: 400,
    p90: 1200,
    p99: 3500,
    errorRate: 0.005,
  },
  write_finalize: {
    p50: 8000,
    p90: 30000,
    p99: 90000,
  },
  trace: {
    p50: 500,
    p90: 2000,
    p99: 6000,
    errorRate: 0.01,
  },
};

function compareCap(
  summary: PercentileSummary,
  cap: AbsoluteCap,
): Array<string> {
  const failures: string[] = [];
  if (cap.p50 !== undefined && summary.p50 > cap.p50) {
    failures.push(`p50 ${summary.p50.toFixed(2)}ms > ${cap.p50}ms`);
  }
  if (cap.p90 !== undefined && summary.p90 > cap.p90) {
    failures.push(`p90 ${summary.p90.toFixed(2)}ms > ${cap.p90}ms`);
  }
  if (cap.p99 !== undefined && summary.p99 > cap.p99) {
    failures.push(`p99 ${summary.p99.toFixed(2)}ms > ${cap.p99}ms`);
  }
  if (cap.errorRate !== undefined && summary.errorRate > cap.errorRate) {
    failures.push(
      `errorRate ${(summary.errorRate * 100).toFixed(2)}% > ${(cap.errorRate * 100).toFixed(2)}%`,
    );
  }
  return failures;
}

function compareRegression(current: number, baseline: number): number {
  if (baseline <= 0) {
    return 0;
  }
  return (current - baseline) / baseline;
}

export function evaluateSloGates(options: {
  perf: PerfSummary;
  baselinePerf?: PerfSummary;
  regressionLimit?: number;
}): SloGateResult[] {
  const regressionLimit = options.regressionLimit ?? 0.2;
  const results: SloGateResult[] = [];

  for (const rpcClass of Object.keys(ABSOLUTE_CAPS) as RpcClass[]) {
    const summary = options.perf[rpcClass];
    const capFailures = compareCap(summary, ABSOLUTE_CAPS[rpcClass]);

    results.push({
      id: `perf_gate_absolute.${rpcClass}`,
      status: capFailures.length === 0 ? "pass" : "fail",
      details:
        capFailures.length === 0
          ? `Absolute SLO met for ${rpcClass}`
          : `Absolute SLO violated for ${rpcClass}: ${capFailures.join("; ")}`,
      evidence: {
        summary,
        cap: ABSOLUTE_CAPS[rpcClass],
      },
    });

    const baseline = options.baselinePerf?.[rpcClass];
    if (!baseline || baseline.count === 0 || summary.count === 0) {
      results.push({
        id: `perf_gate_regression.${rpcClass}`,
        status: "pass",
        details: `No baseline comparison for ${rpcClass}`,
        evidence: { baselineCount: baseline?.count ?? 0, currentCount: summary.count },
      });
      continue;
    }

    const p90Regression = compareRegression(summary.p90, baseline.p90);
    const p99Regression = compareRegression(summary.p99, baseline.p99);
    const fails = p90Regression > regressionLimit || p99Regression > regressionLimit;

    results.push({
      id: `perf_gate_regression.${rpcClass}`,
      status: fails ? "fail" : "pass",
      details: fails
        ? `Regression exceeded for ${rpcClass}: p90=${(p90Regression * 100).toFixed(2)}%, p99=${(p99Regression * 100).toFixed(2)}%`
        : `Regression within limit for ${rpcClass}`,
      evidence: {
        current: summary,
        baseline,
        p90Regression,
        p99Regression,
        regressionLimit,
      },
    });
  }

  return results;
}
