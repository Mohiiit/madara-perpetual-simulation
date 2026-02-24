import fs from "node:fs/promises";
import path from "node:path";
import type { ScenarioReport } from "../config/run-config.js";

export interface WrittenReport {
  jsonPath: string;
  mdPath: string;
}

function toMarkdown(report: ScenarioReport): string {
  const perf = report.perf;
  const lines: string[] = [];
  lines.push(`# Izanagi Simulation Report`);
  lines.push("");
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Backend: \`${report.backend}\``);
  lines.push(`- Profile: \`${report.profile}\``);
  lines.push(`- Madara commit: \`${report.madaraCommit}\``);
  lines.push(`- Perpetual SHA: \`${report.perpetualSha}\``);
  if (report.baselineStatus) {
    lines.push(`- Baseline status: \`${report.baselineStatus}\``);
  }
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push("");
  lines.push("## Performance");
  lines.push("");
  lines.push("| Class | Count | Error Rate | P50 (ms) | P90 (ms) | P99 (ms) |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  lines.push(
    `| read | ${perf.read.count} | ${(perf.read.errorRate * 100).toFixed(2)}% | ${perf.read.p50.toFixed(2)} | ${perf.read.p90.toFixed(2)} | ${perf.read.p99.toFixed(2)} |`,
  );
  lines.push(
    `| write_submit | ${perf.write_submit.count} | ${(perf.write_submit.errorRate * 100).toFixed(2)}% | ${perf.write_submit.p50.toFixed(2)} | ${perf.write_submit.p90.toFixed(2)} | ${perf.write_submit.p99.toFixed(2)} |`,
  );
  lines.push(
    `| write_finalize | ${perf.write_finalize.count} | ${(perf.write_finalize.errorRate * 100).toFixed(2)}% | ${perf.write_finalize.p50.toFixed(2)} | ${perf.write_finalize.p90.toFixed(2)} | ${perf.write_finalize.p99.toFixed(2)} |`,
  );
  lines.push(
    `| trace | ${perf.trace.count} | ${(perf.trace.errorRate * 100).toFixed(2)}% | ${perf.trace.p50.toFixed(2)} | ${perf.trace.p90.toFixed(2)} | ${perf.trace.p99.toFixed(2)} |`,
  );
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
