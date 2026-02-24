import type { ScenarioReport } from "../config/run-config.js";

function summarizeChecks(report: ScenarioReport): { pass: number; fail: number } {
  const summary = { pass: 0, fail: 0 };
  for (const check of report.checks) {
    summary[check.status] += 1;
  }
  return summary;
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
    text: `Madara Perpetual Simulation ${options.report.status}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Madara Perpetual Simulation*: *${options.report.status}*`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `• Madara commit: \`${options.report.madaraCommit}\`\n` +
            `• Perpetual SHA: \`${options.report.perpetualSha}\`\n` +
            `• Checks: pass=${pass}, fail=${fail}\n` +
            `• Run: ${options.runUrl}`,
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
