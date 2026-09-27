#!/usr/bin/env node

import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const has = name => args.includes(name);

function evidenceDirectory() {
  const path = option('--evidence-dir', `/tmp/alga-2585-isolated-smoke-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}`);
  return resolve(path);
}

async function prepareEvidence(dir) {
  await mkdir(dir, { recursive: false });
  await mkdir(join(dir, 'downloads'));
  await mkdir(join(dir, 'responses'));
}

async function isolationSelfTest(dir) {
  await mkdir(dir, { recursive: false });
  let seenCookies = [];
  const server = createServer((req, res) => {
    seenCookies.push(req.headers.cookie ?? '');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>isolated context probe</title><main>local probe</main>');
  });
  await new Promise((ok, fail) => server.listen(0, '127.0.0.1', ok).once('error', fail));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const unrelated = await browser.newContext();
    await unrelated.addCookies([{ name: 'unrelated_session_sentinel', value: 'keep-this-context', url: origin }]);
    const before = await unrelated.cookies(origin);
    if (before.length !== 1 || before[0].name !== 'unrelated_session_sentinel') throw new Error('Failed to seed unrelated-context sentinel.');

    const isolated = await browser.newContext({ acceptDownloads: true });
    const isolatedBefore = await isolated.cookies(origin);
    const page = await isolated.newPage();
    const requestCookieHeaders = [];
    page.on('request', async request => {
      if (request.url().startsWith(origin)) requestCookieHeaders.push((await request.allHeaders()).cookie ?? '');
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const isolatedAfter = await isolated.cookies(origin);
    const unrelatedAfter = await unrelated.cookies(origin);
    const proof = {
      kind: 'cookie-isolation-self-test',
      passed: isolatedBefore.length === 0
        && requestCookieHeaders.every(cookie => cookie === '')
        && isolatedAfter.length === 0
        && unrelatedAfter.length === 1
        && unrelatedAfter[0].value === 'keep-this-context'
        && seenCookies.every(cookie => cookie === ''),
      isolatedCookieCountBefore: isolatedBefore.length,
      isolatedCookieCountAfter: isolatedAfter.length,
      isolatedRequestCookieBytes: requestCookieHeaders.map(cookie => Buffer.byteLength(cookie)),
      localServerCookieBytes: seenCookies.map(cookie => Buffer.byteLength(cookie)),
      unrelatedSentinelPreserved: unrelatedAfter.length === 1 && unrelatedAfter[0].value === 'keep-this-context',
      browserProfile: 'Playwright-owned ephemeral BrowserContext; no persistent user-data directory',
      appServerUsed: false,
    };
    if (!proof.passed) throw new Error(`Isolation assertion failed: ${JSON.stringify(proof)}`);
    await page.screenshot({ path: join(dir, 'isolation-self-test.png'), fullPage: true });
    await writeFile(join(dir, 'isolation-self-test.json'), `${JSON.stringify(proof, null, 2)}\n`);
    await isolated.close();
    await unrelated.close();
    process.stdout.write(`${JSON.stringify({ ...proof, evidenceDir: dir }, null, 2)}\n`);
  } finally {
    await browser.close();
    await new Promise(ok => server.close(ok));
  }
}

function safeUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

async function liveSmoke(dir) {
  const baseUrl = option('--base-url');
  if (!baseUrl) throw new Error('Pass --base-url for live smoke or --self-test for the offline isolation proof.');
  const startPath = option('--start-path', '/auth/client-portal/signin');
  const origin = new URL(baseUrl).origin;
  await prepareEvidence(dir);
  const browser = await chromium.launch({ headless: !has('--headed') });
  const context = await browser.newContext({ acceptDownloads: true });
  const initialCookies = await context.cookies(origin);
  if (initialCookies.length) throw new Error('Fresh Playwright context unexpectedly contains cookies before navigation.');

  const page = await context.newPage();
  const evidence = {
    kind: 'client-portal-isolated-browser-smoke',
    startedAt: new Date().toISOString(),
    origin,
    startPath,
    browserContext: 'fresh Playwright BrowserContext in a separately launched Chromium process',
    appServerStartedByScript: false,
    initialCookieCount: initialCookies.length,
    requests: [],
    downloads: [],
    failures: [],
    checkpoints: [],
  };
  let responseIndex = 0;
  const captureTasks = [];
  page.on('request', request => captureTasks.push((async () => {
    if (new URL(request.url()).origin !== origin) return;
    const headers = await request.allHeaders();
    const cookie = headers.cookie ?? '';
    evidence.requests.push({
      at: new Date().toISOString(),
      method: request.method(),
      url: safeUrl(request.url()),
      cookiePresent: cookie.length > 0,
      cookieBytes: Buffer.byteLength(cookie),
    });
  })()));
  page.on('requestfailed', request => evidence.failures.push({ url: safeUrl(request.url()), error: request.failure()?.errorText ?? 'request failed' }));
  page.on('response', response => captureTasks.push((async () => {
    const request = response.request();
    if (new URL(response.url()).origin !== origin) return;
    const headers = await response.allHeaders();
    const pathname = new URL(response.url()).pathname;
    const record = {
      at: new Date().toISOString(),
      method: request.method(),
      url: safeUrl(response.url()),
      status: response.status(),
      contentType: headers['content-type'] ?? null,
      contentDisposition: headers['content-disposition'] ?? null,
    };
    if (!pathname.includes('/api/client-portal/documents/')) {
      evidence.requests.push({ ...record, kind: 'response' });
      return;
    }
    const ext = (headers['content-type'] ?? '').includes('json') ? 'json' : 'bin';
    const filename = `${String(++responseIndex).padStart(3, '0')}-${response.status()}.${ext}`;
    try {
      const body = await response.body();
      await writeFile(join(dir, 'responses', filename), body);
      record.bodyBytes = body.byteLength;
      record.bodyEvidence = `responses/${filename}`;
    } catch (error) {
      record.bodyCaptureError = error.message;
    }
    evidence.requests.push({ ...record, kind: 'response' });
  })()));
  page.on('download', download => captureTasks.push((async () => {
    const name = basename(download.suggestedFilename()).replace(/[^\p{L}\p{N}._ -]/gu, '_');
    const path = join(dir, 'downloads', `${String(evidence.downloads.length + 1).padStart(2, '0')}-${name || 'download'}`);
    try {
      await download.saveAs(path);
      evidence.downloads.push({ filename: download.suggestedFilename(), evidence: `downloads/${basename(path)}`, failure: await download.failure() });
    } catch (error) {
      evidence.downloads.push({ filename: download.suggestedFilename(), failure: error.message });
    }
  })()));

  try {
    await page.goto(new URL(startPath, baseUrl).href, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    evidence.failures.push({ url: safeUrl(new URL(startPath, baseUrl).href), error: error.message });
    await writeFile(join(dir, 'run.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    await context.close();
    await browser.close();
    throw error;
  }
  await page.screenshot({ path: join(dir, '01-start.png'), fullPage: true });
  await writeFile(join(dir, 'run.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`Isolated browser ready at ${page.url()}\nEvidence: ${dir}\nCookie values are never written. Requests record only Cookie byte counts.\n`);

  if (has('--headed')) {
    process.stdout.write('In the dedicated Chromium window, run the smoke. Here enter "shot LABEL" to save a screenshot, "mark RESULT" to record a manual result, "probe SAME_ORIGIN_PATH" to fetch with this session and save status/headers/body, or "done" to finish.\n');
    const input = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    let checkpointIndex = 0;
    for await (const line of input) {
      const [command, ...rest] = line.trim().split(/\s+/);
      const label = rest.join(' ').trim();
      if (command === 'done') break;
      if (command === 'probe' && label) {
        const probeUrl = new URL(label, origin);
        if (probeUrl.origin !== origin) {
          process.stdout.write('Probe accepts only same-origin URLs so the isolated session is not sent elsewhere.\n');
          continue;
        }
        const result = await page.evaluate(async url => {
          const response = await fetch(url, { credentials: 'include' });
          const bytes = new Uint8Array(await response.arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return {
            status: response.status,
            contentType: response.headers.get('content-type'),
            contentDisposition: response.headers.get('content-disposition'),
            bodyBase64: btoa(binary),
          };
        }, probeUrl.href);
        const filename = `${String(++responseIndex).padStart(3, '0')}-probe-${result.status}.${(result.contentType ?? '').includes('json') ? 'json' : 'bin'}`;
        await writeFile(join(dir, 'responses', filename), Buffer.from(result.bodyBase64, 'base64'));
        const checkpoint = { label: `probe ${label}`, at: new Date().toISOString(), url: safeUrl(probeUrl.href), status: result.status, contentType: result.contentType, contentDisposition: result.contentDisposition, bodyEvidence: `responses/${filename}` };
        evidence.checkpoints.push(checkpoint);
        await writeFile(join(dir, 'run.json'), `${JSON.stringify(evidence, null, 2)}\n`);
        process.stdout.write(`${JSON.stringify(checkpoint)}\n`);
        continue;
      }
      if (!label || !['shot', 'mark'].includes(command)) {
        process.stdout.write('Use: shot LABEL | mark RESULT | probe SAME_ORIGIN_PATH | done\n');
        continue;
      }
      const safeLabel = label.normalize('NFKD').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 64) || `checkpoint-${checkpointIndex + 1}`;
      const checkpoint = { label, at: new Date().toISOString(), url: safeUrl(page.url()) };
      if (command === 'shot') {
        checkpoint.screenshot = `screenshots/${String(++checkpointIndex).padStart(2, '0')}-${safeLabel}.png`;
        await mkdir(join(dir, 'screenshots'), { recursive: true });
        await page.screenshot({ path: join(dir, checkpoint.screenshot), fullPage: true });
      }
      evidence.checkpoints.push(checkpoint);
      await writeFile(join(dir, 'run.json'), `${JSON.stringify(evidence, null, 2)}\n`);
      process.stdout.write(`Recorded ${command}: ${label}\n`);
    }
    input.close();
  }
  await page.screenshot({ path: join(dir, '99-final.png'), fullPage: true });
  await Promise.allSettled(captureTasks);
  evidence.finishedAt = new Date().toISOString();
  evidence.finalUrl = safeUrl(page.url());
  evidence.finalCookieCount = (await context.cookies(origin)).length;
  await writeFile(join(dir, 'run.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  await context.close();
  await browser.close();
  process.stdout.write(`${JSON.stringify({ evidenceDir: dir, requestCount: evidence.requests.length, documentDownloads: evidence.downloads.length, failures: evidence.failures.length, finalUrl: evidence.finalUrl }, null, 2)}\n`);
}

const dir = evidenceDirectory();
try {
  if (has('--self-test')) await isolationSelfTest(dir);
  else await liveSmoke(dir);
} catch (error) {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
}
