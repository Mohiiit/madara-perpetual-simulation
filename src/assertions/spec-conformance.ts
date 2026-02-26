import type { CheckResult } from "../config/run-config.js";
import type { SpecRegistry } from "../spec/spec-registry.js";

export interface SpecConformanceRecord {
  method: string;
  source?: string;
  hasResult: boolean;
  paramsValid: boolean;
  resultValid: boolean;
  paramsErrors?: unknown;
  resultErrors?: unknown;
  rpcErrorCode?: number;
}

export function validateSpecConformance(options: {
  registry: SpecRegistry;
  method: string;
  params: unknown;
  result?: unknown;
  hasResult: boolean;
  rpcErrorCode?: number;
}): SpecConformanceRecord {
  if (!options.registry.hasMethod(options.method)) {
    return {
      method: options.method,
      hasResult: options.hasResult,
      paramsValid: true,
      resultValid: true,
      rpcErrorCode: options.rpcErrorCode,
    };
  }

  const params = options.registry.validateParams(options.method, options.params);
  const result = options.hasResult
    ? options.registry.validateResult(options.method, options.result)
    : { ok: true, errors: undefined };

  return {
    method: options.method,
    source: options.registry.getMethodSource(options.method),
    hasResult: options.hasResult,
    paramsValid: params.ok,
    resultValid: result.ok,
    paramsErrors: params.errors,
    resultErrors: result.errors,
    rpcErrorCode: options.rpcErrorCode,
  };
}

export function pushSpecConformanceCheck(options: {
  checks: CheckResult[];
  id: string;
  records: SpecConformanceRecord[];
}): void {
  const failing = options.records.filter((record) => !record.paramsValid || !record.resultValid);
  options.checks.push({
    id: options.id,
    status: failing.length === 0 ? "pass" : "fail",
    details:
      failing.length === 0
        ? `Spec conformance passed for ${options.records.length} RPC calls`
        : `Spec conformance failed for ${failing.length}/${options.records.length} RPC calls`,
    evidence:
      failing.length === 0
        ? { count: options.records.length }
        : {
            count: options.records.length,
            failing: failing.slice(0, 20),
          },
  });
}
