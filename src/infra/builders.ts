import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./command.js";

export async function buildMadara(madaraRepoDir: string): Promise<string> {
  await runCommand(
    "cargo",
    ["build", "--manifest-path", "madara/Cargo.toml", "--bin", "madara", "--release"],
    {
      cwd: madaraRepoDir,
      timeoutMs: 60 * 60 * 1000,
    },
  );

  const cargoTargetDir = process.env.CARGO_TARGET_DIR;
  const candidatePaths = cargoTargetDir
    ? [path.resolve(cargoTargetDir, "release", "madara")]
    : [
        // Default when target is rooted at cloned repo.
        path.resolve(madaraRepoDir, "target", "release", "madara"),
        // Default when manifest-path points to nested ./madara workspace.
        path.resolve(madaraRepoDir, "madara", "target", "release", "madara"),
      ];

  for (const candidate of candidatePaths) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(`Madara binary not found. Checked: ${candidatePaths.join(", ")}`);
}

export async function buildPerpetual(perpetualRepoDir: string): Promise<string> {
  await runCommand("scarb", ["--release", "build"], {
    cwd: perpetualRepoDir,
    timeoutMs: 25 * 60 * 1000,
  });

  const releaseDir = path.resolve(perpetualRepoDir, "target", "release");
  await fs.access(releaseDir);
  return releaseDir;
}
