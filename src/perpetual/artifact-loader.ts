import fs from "node:fs/promises";
import path from "node:path";

export interface PerpetualContractArtifacts {
  sierraPath: string;
  casmPath: string;
  sierra: unknown;
  casm: unknown;
}

async function findFileRecursive(root: string, fileName: string): Promise<string | null> {
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const fullPath = path.join(root, entry.name);
    const found = await findFileRecursive(fullPath, fileName);
    if (found) {
      return found;
    }
  }

  return null;
}

export async function loadPerpetualArtifact(
  releaseRoot: string,
  contractName: string,
): Promise<PerpetualContractArtifacts> {
  const sierraFile = `${contractName}.contract_class.json`;
  const casmFile = `${contractName}.compiled_contract_class.json`;

  const sierraPath = await findFileRecursive(releaseRoot, sierraFile);
  const casmPath = await findFileRecursive(releaseRoot, casmFile);

  if (!sierraPath || !casmPath) {
    throw new Error(
      `Missing artifacts for ${contractName}. sierra=${sierraPath ?? "not found"}, casm=${casmPath ?? "not found"}`,
    );
  }

  const [sierraRaw, casmRaw] = await Promise.all([
    fs.readFile(sierraPath, "utf8"),
    fs.readFile(casmPath, "utf8"),
  ]);

  return {
    sierraPath,
    casmPath,
    sierra: JSON.parse(sierraRaw),
    casm: JSON.parse(casmRaw),
  };
}
