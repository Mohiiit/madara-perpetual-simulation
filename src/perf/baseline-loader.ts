import fs from "node:fs/promises";
import path from "node:path";
import type {
  ExecutionBackend,
  PerfSummary,
  ScenarioReport,
  TrafficProfile,
} from "../config/run-config.js";

export interface LoadedBaseline {
  status: "loaded" | "missing" | "invalid";
  source: string;
  perf?: PerfSummary;
}

function defaultBaselinePath(
  profile: TrafficProfile["id"],
  backend: ExecutionBackend,
): string {
  return path.resolve(
    process.cwd(),
    ".baseline",
    `${profile}-${backend}.json`,
  );
}

export async function loadPerfBaseline(options: {
  profile: TrafficProfile["id"];
  backend: ExecutionBackend;
  baselinePath?: string;
}): Promise<LoadedBaseline> {
  const source = options.baselinePath || defaultBaselinePath(options.profile, options.backend);

  try {
    const raw = await fs.readFile(source, "utf8");
    const parsed = JSON.parse(raw) as Partial<ScenarioReport>;
    if (!parsed.perf || typeof parsed.perf !== "object") {
      return { status: "invalid", source };
    }

    return {
      status: "loaded",
      source,
      perf: parsed.perf as PerfSummary,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { status: "missing", source };
    }
    return { status: "invalid", source };
  }
}
