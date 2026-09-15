import { createSign } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { parseServiceAccountKey } from './record-test-metrics.mjs';
import { collectBrowserMetricExecutions } from './lib/collect-browser-metric-executions.mjs';

// The existing writer token helper requests write scope and has no deadline.
// This collector uses a bounded OAuth exchange with read-only Sheets scope.
async function readOnlySheetsToken(raw) {
  const account = parseServiceAccountKey(raw);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error',
    signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }) });
  if (response.status !== 200) throw new Error('Token exchange failed');
  const token = (await response.json()).access_token;
  if (typeof token !== 'string' || !token) throw new Error('Token missing');
  return token;
}
try {
  if (process.argv.length !== 3) throw new Error('Expected output path');
  const output = process.argv[2];
  await rm(output, { force: true });
  const env = process.env;
  const result = await collectBrowserMetricExecutions({ repository: env.GITHUB_REPOSITORY,
    revisionMode: env.RECONCILE_REVISION_MODE || 'operator',
    runId: env.RECONCILE_RUN_ID, revision: env.RECONCILE_TESTED_REVISION, sheetId: env.TEST_METRICS_SHEET_ID,
    githubToken: env.GITHUB_TOKEN, sheetsToken: await readOnlySheetsToken(env.GOOGLE_SA_KEY) });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
} catch {
  console.error('Browser metric execution collection failed');
  process.exitCode = 1;
}
