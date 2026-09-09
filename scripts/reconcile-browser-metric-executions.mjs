import { readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { reconcileBrowserMetricExecutions } from './lib/reconcile-browser-metric-executions.mjs';
const [input, output] = process.argv.slice(2);
const safeOutput = output && (!input || path.resolve(input) !== path.resolve(output));
try {
  if (process.argv.length !== 4 || !safeOutput) throw Error('Expected distinct input and output paths');
  await rm(output, { force: true });
  const result = reconcileBrowserMetricExecutions(JSON.parse(await readFile(input, 'utf8')));
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `\nBrowser metric export reconciliation: **${result.status}**. Scope: observed executions only; not release readiness.\n\n`
    + result.records.map(record => `- ${record.edition}, attempt ${record.runAttempt}: ${record.status}; export=${record.exportStatus}; recorder=${record.recorderStatus ?? 'unknown'}/${record.recorderConclusion ?? 'unknown'}; reasons=${record.issues.join(',') || 'none'}\n`).join(''));
  process.exitCode = result.status === 'passed' ? 0 : 1;
} catch {
  if (safeOutput) await rm(output, { force: true }).catch(() => {});
  console.error('Browser metric execution reconciliation failed'); process.exitCode = 1;
}
