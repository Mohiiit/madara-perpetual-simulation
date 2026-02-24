import fs from "node:fs/promises";
import path from "node:path";
import type { ScenarioReport } from "../config/run-config.js";

export interface WrittenReport {
  jsonPath: string;
  mdPath: string;
}

function toMarkdown(report: ScenarioReport): string {
  const lines: string[] = [];
  lines.push(`# Madara Perpetual Simulation Report`);
  lines.push("");
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Madara commit: \`${report.madaraCommit}\``);
  lines.push(`- Perpetual SHA: \`${report.perpetualSha}\``);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push("");
  lines.push("## Checks");
  lines.push("");

  for (const check of report.checks) {
    lines.push(`- [${check.status.toUpperCase()}] \`${check.id}\` - ${check.details}`);
  }

  return lines.join("\n");
}

export async function writeReport(options: {
  outputDir: string;
  report: ScenarioReport;
}): Promise<WrittenReport> {
  await fs.mkdir(options.outputDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.resolve(options.outputDir, `run-${stamp}.json`);
  const mdPath = path.resolve(options.outputDir, `run-${stamp}.md`);

  await fs.writeFile(jsonPath, JSON.stringify(options.report, null, 2));
  await fs.writeFile(mdPath, toMarkdown(options.report));

  await fs.writeFile(path.resolve(options.outputDir, "latest.json"), JSON.stringify(options.report, null, 2));
  await fs.writeFile(path.resolve(options.outputDir, "latest.md"), toMarkdown(options.report));

  return { jsonPath, mdPath };
}
