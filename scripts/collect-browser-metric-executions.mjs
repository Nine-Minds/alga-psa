import { createSign } from 'node:crypto';
import { appendFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseServiceAccountKey } from './record-test-metrics.mjs';
import { BrowserMetricCollectionError, collectBrowserMetricExecutions } from './lib/collect-browser-metric-executions.mjs';

// The existing writer token helper requests write scope and has no deadline.
// This collector uses a bounded OAuth exchange with read-only Sheets scope.
async function readOnlySheetsToken(raw, request) {
  const fail = (code, details) => new BrowserMetricCollectionError('sheets-authentication', code, details);
  if (!raw) throw fail('service-account-missing');
  let account;
  try {
    account = parseServiceAccountKey(raw);
    if (typeof account?.client_email !== 'string' || !account.client_email
      || typeof account.private_key !== 'string' || !account.private_key) throw new Error();
  } catch { throw fail('invalid-service-account'); }
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  let signature;
  try { signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url'); }
  catch { throw fail('invalid-signing-key'); }
  const signal = AbortSignal.timeout(15_000);
  let response;
  try {
    response = await request('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error',
      signal, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }) });
  } catch { throw fail(signal.aborted ? 'request-timeout' : 'request-failed'); }
  if (response.status !== 200) throw fail('http-error', { httpStatus: response.status });
  let body;
  try { body = await response.json(); }
  catch { throw fail(signal.aborted ? 'request-timeout' : 'invalid-token-response'); }
  const token = body?.access_token;
  if (typeof token !== 'string' || !token) throw fail('token-missing');
  return token;
}

export async function runBrowserMetricCollection({ output, diagnostics, env = process.env, request = fetch }) {
  if (!output || !diagnostics || path.resolve(output) === path.resolve(diagnostics)) {
    throw new BrowserMetricCollectionError('configuration', 'expected-distinct-output-paths');
  }
  let phase = 'output-cleanup';
  const report = { schemaVersion: 1, scope: 'browser-metric-execution-collection', status: 'failed' };
  try {
    await rm(output, { force: true });
    await rm(diagnostics, { force: true });
    phase = 'sheets-authentication';
    const sheetsToken = await readOnlySheetsToken(env.GOOGLE_SA_KEY, request);
    phase = 'collection';
    const result = await collectBrowserMetricExecutions({ repository: env.GITHUB_REPOSITORY,
      revisionMode: env.RECONCILE_REVISION_MODE || 'operator',
      runId: env.RECONCILE_RUN_ID, revision: env.RECONCILE_TESTED_REVISION, sheetId: env.TEST_METRICS_SHEET_ID,
      githubToken: env.GITHUB_TOKEN, sheetsToken, request });
    phase = 'output-write';
    await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    report.status = 'collected';
    report.executionCount = result.expectedExecutions.length;
    report.exportedRowCount = result.exportedRows.rows.length;
  } catch (error) {
    report.diagnostic = (error instanceof BrowserMetricCollectionError ? error
      : new BrowserMetricCollectionError(phase, 'unexpected-error')).diagnostic;
  }
  try {
    await writeFile(diagnostics, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch {
    // The original diagnostic must remain visible even if artifact storage fails.
    if (report.diagnostic) console.error(JSON.stringify(report.diagnostic));
    throw new BrowserMetricCollectionError('diagnostics-write', 'report-write-failed');
  }
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      await appendFile(env.GITHUB_STEP_SUMMARY, `\nBrowser metric collection: **${report.status}**.\n`
        + (report.diagnostic ? `\n\`\`\`json\n${JSON.stringify(report.diagnostic, null, 2)}\n\`\`\`\n` : ''));
    } catch { throw new BrowserMetricCollectionError('summary-write', 'summary-write-failed'); }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (![3, 4].includes(process.argv.length)) throw new BrowserMetricCollectionError('configuration', 'expected-output-path');
    const output = process.argv[2];
    const diagnostics = process.argv[3] ?? path.join(path.dirname(output), 'browser-metric-collection.json');
    const report = await runBrowserMetricCollection({ output, diagnostics });
    if (report.status === 'failed') {
      console.error(`Browser metric execution collection failed: ${JSON.stringify(report.diagnostic)}`);
      process.exitCode = 1;
    }
  } catch (error) {
    const diagnostic = (error instanceof BrowserMetricCollectionError ? error
      : new BrowserMetricCollectionError('collection', 'unexpected-error')).diagnostic;
    console.error(`Browser metric execution collection failed: ${JSON.stringify(diagnostic)}`);
    process.exitCode = 1;
  }
}
