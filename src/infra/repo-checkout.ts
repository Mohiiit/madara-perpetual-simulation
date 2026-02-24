import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./command.js";

function looksLikeCommit(ref: string): boolean {
  return /^[a-f0-9]{7,40}$/i.test(ref);
}

export async function resolveRemoteBranchHead(
  repoUrl: string,
  branch: string,
): Promise<string> {
  const { stdout } = await runCommand("git", ["ls-remote", repoUrl, `refs/heads/${branch}`], {
    silent: true,
  });

  const line = stdout.trim().split("\n").find(Boolean);
  if (!line) {
    throw new Error(`Unable to resolve remote branch head: ${repoUrl} ${branch}`);
  }

  const sha = line.split(/\s+/)[0];
  if (!sha) {
    throw new Error(`Unable to parse ls-remote output for ${repoUrl} ${branch}`);
  }

  return sha;
}

export async function cloneAtRef(options: {
  repoUrl: string;
  ref: string;
  destDir: string;
}): Promise<{ repoDir: string; commit: string }> {
  const { repoUrl, ref, destDir } = options;
  await fs.mkdir(path.dirname(destDir), { recursive: true });

  if (looksLikeCommit(ref)) {
    await runCommand("git", ["clone", "--filter=blob:none", repoUrl, destDir]);
    await runCommand("git", ["fetch", "--depth", "1", "origin", ref], { cwd: destDir });
    await runCommand("git", ["checkout", ref], { cwd: destDir });
    return { repoDir: destDir, commit: ref };
  }

  const commit = await resolveRemoteBranchHead(repoUrl, ref);
  await runCommand("git", ["clone", "--filter=blob:none", "--depth", "1", "--branch", ref, repoUrl, destDir]);
  return { repoDir: destDir, commit };
}
