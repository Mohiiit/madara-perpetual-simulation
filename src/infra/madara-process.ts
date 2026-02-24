import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { waitForRpcReady } from "./rpc-client.js";

export interface MadaraProcessHandle {
  rpcRootUrl: string;
  rpcVersionedUrl: string;
  pid: number;
  stop: () => Promise<void>;
}

export async function startMadaraDevnet(options: {
  madaraBinaryPath: string;
  workDir: string;
  timeoutMs: number;
}): Promise<MadaraProcessHandle> {
  const dbPath = path.resolve(options.workDir, "madara_db");
  const logsDir = path.resolve(options.workDir, "logs");
  await fs.mkdir(dbPath, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  const args = [
    "--name",
    "madara-sim",
    "--base-path",
    dbPath,
    "--rpc-port",
    "9944",
    "--rpc-cors",
    "*",
    "--rpc-external",
    "--devnet",
    "--preset",
    "devnet",
    "--l1-gas-price",
    "0",
    "--blob-gas-price",
    "0",
    "--strk-per-eth",
    "1",
    "--no-l1-sync",
    "--rpc-pre-v0-9-preconfirmed-as-pending",
  ];

  const child: ChildProcess = spawn(options.madaraBinaryPath, args, {
    cwd: options.workDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (!child.pid) {
    throw new Error("Failed to start Madara process");
  }

  child.stdout?.on("data", (chunk) => process.stdout.write(chunk.toString()));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk.toString()));

  const rpcRootUrl = "http://127.0.0.1:9944";
  const rpcVersionedUrl = `${rpcRootUrl}/rpc/v0_10_0`;

  await waitForRpcReady({
    rpcUrl: rpcRootUrl,
    timeoutMs: options.timeoutMs,
    intervalMs: 1000,
  });

  return {
    rpcRootUrl,
    rpcVersionedUrl,
    pid: child.pid,
    stop: async () => {
      if (child.killed) {
        return;
      }

      child.kill("SIGTERM");

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 10_000);

        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}
