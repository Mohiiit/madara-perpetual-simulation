import type { ScenarioReport } from "../config/run-config.js";

function summarizeChecks(report: ScenarioReport): { pass: number; fail: number } {
  const summary = { pass: 0, fail: 0 };
  for (const check of report.checks) {
    summary[check.status] += 1;
  }
  return summary;
}

function perfLine(report: ScenarioReport): string {
  const read = report.perf.read;
  const submit = report.perf.write_submit;
  const finalize = report.perf.write_finalize;
  const trace = report.perf.trace;
  return (
    `• read p50/p90/p99: ${read.p50.toFixed(0)}/${read.p90.toFixed(0)}/${read.p99.toFixed(0)} ms\n` +
    `• submit p50/p90/p99: ${submit.p50.toFixed(0)}/${submit.p90.toFixed(0)}/${submit.p99.toFixed(0)} ms\n` +
    `• finalize p50/p90/p99: ${finalize.p50.toFixed(0)}/${finalize.p90.toFixed(0)}/${finalize.p99.toFixed(0)} ms\n` +
    `• trace p50/p90/p99: ${trace.p50.toFixed(0)}/${trace.p90.toFixed(0)}/${trace.p99.toFixed(0)} ms`
  );
}

export async function postSlackSummary(options: {
  webhookUrl?: string;
  report: ScenarioReport;
  runUrl: string;
}): Promise<"posted" | "skipped"> {
  if (!options.webhookUrl || options.webhookUrl === "REPLACE_ME") {
    return "skipped";
  }

  const { pass, fail } = summarizeChecks(options.report);
  const failedChecks = options.report.checks
    .filter((c) => c.status === "fail")
    .slice(0, 5)
    .map((c) => `• ${c.id}`)
    .join("\n");

  const payload = {
    text: `Izanagi Simulation ${options.report.status}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Izanagi Simulation*: *${options.report.status}*`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `• Backend: \`${options.report.backend}\`\n` +
            `• Profile: \`${options.report.profile}\`\n` +
            `• Madara commit: \`${options.report.madaraCommit}\`\n` +
            `• Perpetual SHA: \`${options.report.perpetualSha}\`\n` +
            `• Baseline: \`${options.report.baselineStatus ?? "n/a"}\`\n` +
            `• Checks: pass=${pass}, fail=${fail}\n` +
            `• Run: ${options.runUrl}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: perfLine(options.report),
        },
      },
      ...(failedChecks
        ? [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Top failing checks*\n${failedChecks}`,
              },
            },
          ]
        : []),
    ],
  };

  const response = await fetch(options.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed posting Slack webhook: ${response.status} ${body}`);
  }

  return "posted";
}
