import { spawn } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export async function runCommand(
  cmd: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    silent?: boolean;
  },
): Promise<CommandResult> {
  const timeoutMs = options?.timeoutMs;

  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const onDone = (err?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (err) {
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!options?.silent) {
        process.stdout.write(text);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (!options?.silent) {
        process.stderr.write(text);
      }
    });

    child.on("error", (error) => {
      onDone(error);
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        onDone();
        return;
      }

      onDone(
        new Error(
          `Command failed: ${cmd} ${args.join(" ")} (code=${code}, signal=${signal ?? "none"})`,
        ),
      );
    });

    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            onDone(
              new Error(
                `Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(" ")}`,
              ),
            );
          }, timeoutMs)
        : null;
  });
}
