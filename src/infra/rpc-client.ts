import type { RpcClass } from "../config/run-config.js";
import type { PerfRecorder } from "../engine/perf-recorder.js";
import {
  type SpecConformanceRecord,
  validateSpecConformance,
} from "../assertions/spec-conformance.js";
import type { SpecRegistry } from "../spec/spec-registry.js";

export interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: string | number;
  result: T;
}

export interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcError;

function isJsonRpcError(value: unknown): value is JsonRpcError {
  return Boolean(
    value &&
      typeof value === "object" &&
      "error" in value &&
      (value as any).error &&
      typeof (value as any).error.code === "number",
  );
}

export async function rawRpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown,
  id: string | number = 1,
): Promise<JsonRpcResponse<T>> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP error ${response.status} for method ${method}`);
  }

  return (await response.json()) as JsonRpcResponse<T>;
}

export class InstrumentedRpcClient {
  private nextId = 1;

  constructor(private readonly options: {
    rpcUrl: string;
    perfRecorder: PerfRecorder;
    specRegistry?: SpecRegistry;
    specRecords?: SpecConformanceRecord[];
  }) {}

  async rawCall<T>(
    method: string,
    params: unknown,
    rpcClass: RpcClass = "read",
    runtimeOptions?: {
      trackPerf?: boolean;
      trackSpec?: boolean;
    },
  ): Promise<JsonRpcResponse<T>> {
    const trackPerf = runtimeOptions?.trackPerf !== false;
    const trackSpec = runtimeOptions?.trackSpec !== false;
    const started = Date.now();
    let response: JsonRpcResponse<T>;
    try {
      response = await rawRpcCall<T>(
        this.options.rpcUrl,
        method,
        params,
        this.nextId++,
      );
    } catch (error) {
      if (trackPerf) {
        this.options.perfRecorder.record({
          method,
          rpcClass,
          latencyMs: Date.now() - started,
          ok: false,
        });
      }
      throw error;
    }

    const isSuccess = "result" in response;
    const responseResult = isSuccess
      ? (response as JsonRpcSuccess<T>).result
      : undefined;
    const rpcErrorCode = isJsonRpcError(response)
      ? response.error.code
      : undefined;

    if (trackPerf) {
      this.options.perfRecorder.record({
        method,
        rpcClass,
        latencyMs: Date.now() - started,
        ok: isSuccess,
        rpcErrorCode,
      });
    }

    if (trackSpec && this.options.specRegistry) {
      this.options.specRecords?.push(
        validateSpecConformance({
          registry: this.options.specRegistry,
          method,
          params,
          result: responseResult,
          hasResult: isSuccess,
          rpcErrorCode,
        }),
      );
    }

    return response;
  }

  async requireResult<T>(
    method: string,
    params: unknown,
    rpcClass: RpcClass = "read",
  ): Promise<T> {
    const response = await this.rawCall<T>(method, params, rpcClass);
    if (!("result" in response)) {
      throw new Error(
        `${method} failed with JSON-RPC error ${response.error.code}: ${response.error.message}`,
      );
    }
    return response.result;
  }
}

export async function waitForRpcReady(options: {
  rpcUrl: string;
  timeoutMs: number;
  intervalMs?: number;
}): Promise<void> {
  const started = Date.now();
  const intervalMs = options.intervalMs ?? 1000;

  while (Date.now() - started < options.timeoutMs) {
    try {
      const result = await rawRpcCall<string>(options.rpcUrl, "starknet_chainId", []);
      if ("result" in result || "error" in result) {
        return;
      }
    } catch {
      // retry
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Madara RPC did not become ready within ${options.timeoutMs}ms`);
}
