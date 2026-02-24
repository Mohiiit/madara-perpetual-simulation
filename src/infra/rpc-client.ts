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
