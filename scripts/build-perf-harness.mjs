#!/usr/bin/env node
/**
 * Build-perf harness for the optimization loop.
 *
 * Pipeline (each stage is independently timed + reported):
 *   1. clear     — remove server/.next + server/tsconfig.tsbuildinfo
 *   2. build     — `npm run build` (or configured cmd) from repo root, captured + timed
 *   3. start     — `next start -p <port>` from server/, wait for "Ready"
 *   4. password  — tail server stdout/stderr for the "Password is -> [ ... ]" line
 *   5. smoke     — drive puppeteer through:
 *                    a. signin  (POST /auth/msp/signin with glinda creds)
 *                    b. /msp/dashboard  (wait for it to render)
 *                    c. /msp/clients    (wait for client-link-* row)
 *                    d. click first row → /msp/clients/<id>
 *
 * Output is intentionally machine-parseable. Every stage emits:
 *     [HARNESS] stage=<name> status=start|done|fail [duration_ms=N] [extra=...]
 * Plus a single final line:
 *     [HARNESS RESULT] {<json summary>}
 *
 * Exit code is 0 only if every stage succeeds. Non-zero on any failure so the
 * loop driver can detect regressions cleanly.
 *
 * Required: a running dev infrastructure (postgres, redis) reachable via the
 * env in server/.env. Use the alga-local-wirein skill if you haven't wired the
 * worktree to a running stack.
 *
 * Usage:
 *   node scripts/build-perf-harness.mjs              # full pipeline, port 3010
 *   node scripts/build-perf-harness.mjs --port 4001  # custom port
 *   node scripts/build-perf-harness.mjs --skip-build # reuse existing .next
 *   node scripts/build-perf-harness.mjs --headed     # show puppeteer browser
 *   node scripts/build-perf-harness.mjs --keep-running  # leave server up on success
 */

import { spawn } from 'node:child_process';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const SERVER_DIR = resolve(REPO_ROOT, 'server');
const NEXT_CACHE = resolve(SERVER_DIR, '.next');
const TSBUILDINFO = resolve(SERVER_DIR, 'tsconfig.tsbuildinfo');
const ARTIFACT_DIR = resolve(REPO_ROOT, '.build-perf');

const ARGS = parseArgs(process.argv.slice(2));
const PORT = ARGS.port ?? 4011;
const HEADED = !!ARGS.headed;
const SKIP_BUILD = !!ARGS['skip-build'];
const SKIP_CLEAR = !!ARGS['skip-clear'];
const KEEP_RUNNING = !!ARGS['keep-running'];
const BUILD_CMD = ARGS['build-cmd'] ?? 'npm run build';
const START_TIMEOUT_MS = Number(ARGS['start-timeout-ms'] ?? 180_000);
const PASSWORD_TIMEOUT_MS = Number(ARGS['password-timeout-ms'] ?? 120_000);
const SMOKE_TIMEOUT_MS = Number(ARGS['smoke-timeout-ms'] ?? 90_000);
const ADMIN_EMAIL = ARGS.email ?? 'glinda@emeraldcity.oz';

const stages = {};
let serverProc = null;
let serverLog = '';
let serverLogPath = null;
let buildLogPath = null;

process.on('SIGINT', () => shutdown('sigint').then(() => process.exit(130)));
process.on('SIGTERM', () => shutdown('sigterm').then(() => process.exit(143)));

main().then(
  async (summary) => {
    emitResult(summary);
    if (!KEEP_RUNNING) await shutdown('done');
    process.exit(summary.ok ? 0 : 1);
  },
  async (err) => {
    const summary = finalizeSummary({ ok: false, error: errToObj(err) });
    emitResult(summary);
    await shutdown('error');
    process.exit(1);
  }
);

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  serverLogPath = resolve(ARTIFACT_DIR, `server-${ts}.log`);
  buildLogPath = resolve(ARTIFACT_DIR, `build-${ts}.log`);

  log(`harness starting | port=${PORT} headed=${HEADED} skip_build=${SKIP_BUILD}`);
  log(`artifacts: ${ARTIFACT_DIR}`);

  if (!SKIP_CLEAR) {
    await runStage('clear', clearCache);
  } else {
    log('clear skipped (--skip-clear)');
  }

  if (!SKIP_BUILD) {
    await runStage('build', () => runBuild(BUILD_CMD));
  } else {
    log('build skipped (--skip-build)');
    if (!existsSync(NEXT_CACHE)) {
      throw new Error('--skip-build set but server/.next does not exist; nothing to start');
    }
  }

  await runStage('start', () => startServer(PORT));
  await runStage('password', () => waitForPassword(PASSWORD_TIMEOUT_MS));
  await runStage('smoke', () => runSmoke(PORT, ADMIN_EMAIL, stages.password.password));

  return finalizeSummary({ ok: true });
}

// ─── stages ────────────────────────────────────────────────────────────────

async function clearCache() {
  await rm(NEXT_CACHE, { recursive: true, force: true });
  await rm(TSBUILDINFO, { force: true });
  return { cleared: ['server/.next', 'server/tsconfig.tsbuildinfo'] };
}

async function runBuild(cmd) {
  log(`build cmd: ${cmd}`);
  // Next's webpack build worker forks a TS type-check process that inherits
  // NODE_OPTIONS. The repo's 8 GB default OOMs on this monorepo. Always
  // override unless caller passed --node-options explicitly. Inheriting the
  // shell's NODE_OPTIONS is unsafe — that's how we OOM'd the first two runs.
  const nodeOptions = ARGS['node-options'] ?? '--max-old-space-size=16384';
  const buildEnv = { ...process.env, NODE_OPTIONS: nodeOptions };
  log(`NODE_OPTIONS=${buildEnv.NODE_OPTIONS}`);
  // Use shell mode so `--build-cmd` accepts chained commands (`a && b`).
  const child = spawn(cmd, {
    cwd: REPO_ROOT,
    env: buildEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  let out = '';
  child.stdout.on('data', (d) => {
    const s = d.toString();
    out += s;
    process.stdout.write(s);
  });
  child.stderr.on('data', (d) => {
    const s = d.toString();
    out += s;
    process.stderr.write(s);
  });

  const exitCode = await new Promise((res, rej) => {
    child.on('error', rej);
    child.on('close', res);
  });

  await writeFile(buildLogPath, out, 'utf8');

  if (exitCode !== 0) {
    const tail = out.split('\n').slice(-40).join('\n');
    throw new Error(`build failed (exit ${exitCode})\n${tail}`);
  }

  const sizeBytes = await dirSize(NEXT_CACHE).catch(() => null);
  return { exit_code: exitCode, log_path: buildLogPath, next_size_bytes: sizeBytes };
}

async function startServer(port) {
  if (!(await portFree(port))) {
    throw new Error(`port ${port} already in use — pick another via --port`);
  }

  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'production',
    NEXTAUTH_URL: `http://localhost:${port}`,
  };

  serverProc = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: SERVER_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout.on('data', (d) => onServerData(d));
  serverProc.stderr.on('data', (d) => onServerData(d));
  let serverExited = null;
  serverProc.on('exit', (code, sig) => {
    serverExited = { code, sig };
    log(`next start exited code=${code} sig=${sig}`);
    failPendingWaiters(new Error(`next start exited prematurely code=${code} sig=${sig}`));
  });

  // Only match "Ready in" — Next prints the "- Local: http://…" banner BEFORE
  // it actually binds, so matching that races EADDRINUSE.
  const readyRe = /Ready in /;
  await waitForLog(readyRe, START_TIMEOUT_MS, 'next-start-ready');
  if (serverExited) {
    throw new Error(`next start exited code=${serverExited.code} sig=${serverExited.sig}`);
  }

  // Touch / to ensure instrumentation runs and initializeApp fires (which
  // generates + logs the glinda password). On modern Next the register hook
  // runs at boot, but a request guarantees it across versions.
  try {
    await fetch(`http://localhost:${port}/api/auth/csrf`, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    log(`warmup fetch failed (continuing): ${e.message}`);
  }

  return { port, pid: serverProc.pid };
}

async function waitForPassword(timeoutMs) {
  const re = /Password is -> \[ (.+?) \]/;
  const line = await waitForLog(re, timeoutMs, 'password-line');
  const match = line.match(re);
  if (!match) throw new Error('password regex matched waitForLog but capture failed');
  // Returned data is merged into stages.password by runStage; emitResult redacts.
  return { found: true, length: match[1].length, password: match[1] };
}

async function runSmoke(port, email, password) {
  if (!password) throw new Error('no password captured; cannot run smoke');

  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    // try server-local install
    const serverPup = resolve(SERVER_DIR, 'node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js');
    puppeteer = (await import(serverPup)).default;
  }

  const browser = await puppeteer.launch({
    headless: HEADED ? false : 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const result = { steps: {} };
  let page;
  const pageErrors = [];

  const runStep = async (name, fn) => {
    const t = Date.now();
    try {
      const data = (await fn()) ?? {};
      result.steps[name] = { ok: true, duration_ms: Date.now() - t, ...data };
    } catch (err) {
      result.steps[name] = {
        ok: false,
        duration_ms: Date.now() - t,
        error: err.message,
        url: page ? page.url() : null,
        title: page ? await page.title().catch(() => null) : null,
      };
      // snapshot failing page so we can see what rendered
      if (page) {
        const shot = resolve(ARTIFACT_DIR, `smoke-fail-${name}-${Date.now()}.png`);
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        const html = await page.content().catch(() => null);
        if (html) {
          const htmlPath = resolve(ARTIFACT_DIR, `smoke-fail-${name}-${Date.now()}.html`);
          await writeFile(htmlPath, html, 'utf8').catch(() => {});
          result.steps[name].html_path = htmlPath;
        }
        result.steps[name].screenshot = shot;
      }
      throw err;
    }
  };

  let topErr;
  try {
    page = await browser.newPage();
    // Default viewport (800x600) hides table columns on /msp/clients; use a
    // realistic desktop size so the client-name column (and its links) renders.
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    page.setDefaultTimeout(SMOKE_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(SMOKE_TIMEOUT_MS);
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(`console.error: ${msg.text()}`);
    });

    await runStep('signin', async () => {
      await page.goto(`http://localhost:${port}/auth/msp/signin`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#msp-email-field');
      await page.type('#msp-email-field', email);
      await page.type('#msp-password-field', password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: SMOKE_TIMEOUT_MS }),
        page.click('#msp-sign-in-button'),
      ]);
      const url = page.url();
      if (!url.includes('/msp/')) {
        // sign-in failed → still on /auth/msp/signin or error page
        throw new Error(`signin did not redirect to /msp/* (now at ${url})`);
      }
      return { url };
    });

    await runStep('dashboard', async () => {
      if (!page.url().includes('/msp/dashboard')) {
        await page.goto(`http://localhost:${port}/msp/dashboard`, { waitUntil: 'domcontentloaded' });
      }
      // Wait for an element that's specifically dashboard (not just any layout)
      await page.waitForSelector('[data-automation-id*="dashboard"], h1, [data-testid*="dashboard"]', {
        timeout: SMOKE_TIMEOUT_MS,
      });
      return { url: page.url() };
    });

    await runStep('clients_list', async () => {
      await page.goto(`http://localhost:${port}/msp/clients`, { waitUntil: 'domcontentloaded' });
      // Wait for either client rows OR a clear empty state, then assert there are rows
      await page.waitForFunction(
        () =>
          document.querySelector('a[data-automation-id^="client-link-"]') ||
          document.body.innerText.toLowerCase().includes('no clients') ||
          document.body.innerText.toLowerCase().includes('add your first'),
        { timeout: SMOKE_TIMEOUT_MS },
      );
      const clientCount = await page.$$eval('a[data-automation-id^="client-link-"]', (els) => els.length);
      if (clientCount === 0) {
        const sample = await page.evaluate(() => document.body.innerText.slice(0, 500));
        throw new Error(`no client rows visible on /msp/clients (page text sample: ${sample.replace(/\s+/g, ' ')})`);
      }
      return { url: page.url(), client_count: clientCount };
    });

    await runStep('client_detail', async () => {
      // Read href first (cheap), then navigate directly. Clicking the anchor
      // races React table re-renders ("Node is detached from document").
      const targetHref = await page.$eval(
        'a[data-automation-id^="client-link-"]',
        (el) => el.getAttribute('href'),
      );
      if (!targetHref) throw new Error('first client row link has no href');
      await page.goto(`http://localhost:${port}${targetHref}`, { waitUntil: 'domcontentloaded' });
      if (!/\/msp\/clients\/[^/?#]+/.test(page.url())) {
        throw new Error(`expected to land on a client detail page, got ${page.url()}`);
      }
      // Confirm the detail view actually rendered (not just navigated)
      await page.waitForSelector('h1, [data-automation-id*="client"], [role="tablist"]', {
        timeout: SMOKE_TIMEOUT_MS,
      });
      return { target_href: targetHref, url: page.url() };
    });

    if (pageErrors.length) result.page_errors = pageErrors.slice(0, 20);
  } catch (err) {
    topErr = err;
  } finally {
    if (pageErrors.length && !result.page_errors) result.page_errors = pageErrors.slice(0, 20);
    await browser.close().catch(() => {});
  }

  if (topErr) {
    // Surface partial step results alongside the top-level smoke failure.
    topErr.partial = result;
    throw topErr;
  }
  return result;
}

// ─── plumbing ─────────────────────────────────────────────────────────────

function onServerData(buf) {
  const s = buf.toString();
  serverLog += s;
  process.stdout.write(s.replace(/^/gm, '[server] '));
  // best-effort log persistence (fire-and-forget)
  if (serverLogPath) {
    import('node:fs').then((fs) => fs.appendFile(serverLogPath, s, () => {}));
  }
  flushWaiters();
}

const logWaiters = [];
function waitForLog(regex, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = logWaiters.findIndex((w) => w.timer === timer);
      if (idx >= 0) logWaiters.splice(idx, 1);
      const tail = serverLog.split('\n').slice(-30).join('\n');
      reject(new Error(`timeout waiting for ${label} (${timeoutMs}ms)\nlast server output:\n${tail}`));
    }, timeoutMs);

    const check = () => {
      const lines = serverLog.split('\n');
      for (const line of lines) {
        if (regex.test(line)) {
          clearTimeout(timer);
          return resolve(line);
        }
      }
      return null;
    };

    if (check()) return;
    logWaiters.push({ regex, resolve, reject, timer, check });
  });
}

function flushWaiters() {
  for (let i = logWaiters.length - 1; i >= 0; i--) {
    const w = logWaiters[i];
    const lines = serverLog.split('\n');
    for (const line of lines) {
      if (w.regex.test(line)) {
        clearTimeout(w.timer);
        logWaiters.splice(i, 1);
        w.resolve(line);
        break;
      }
    }
  }
}

function failPendingWaiters(err) {
  while (logWaiters.length) {
    const w = logWaiters.pop();
    clearTimeout(w.timer);
    w.reject(err);
  }
}

async function runStage(name, fn) {
  emit(`stage=${name} status=start`);
  const t = Date.now();
  try {
    const data = (await fn()) ?? {};
    const duration_ms = Date.now() - t;
    stages[name] = { ok: true, duration_ms, ...data };
    emit(`stage=${name} status=done duration_ms=${duration_ms}`);
  } catch (err) {
    const duration_ms = Date.now() - t;
    const partial = err.partial && typeof err.partial === 'object' ? err.partial : {};
    stages[name] = { ok: false, duration_ms, error: errToObj(err), ...partial };
    emit(`stage=${name} status=fail duration_ms=${duration_ms} error=${JSON.stringify(err.message)}`);
    throw err;
  }
}

function finalizeSummary(extra) {
  const total_ms = Object.values(stages).reduce((s, st) => s + (st.duration_ms ?? 0), 0);
  return {
    ok: extra.ok ?? Object.values(stages).every((s) => s.ok),
    timestamp: new Date().toISOString(),
    port: PORT,
    total_ms,
    stages,
    build_log_path: buildLogPath,
    server_log_path: serverLogPath,
    ...extra,
  };
}

function emit(line) {
  process.stdout.write(`[HARNESS] ${line}\n`);
}
function emitResult(summary) {
  // Drop password before printing summary
  const safe = JSON.parse(JSON.stringify(summary));
  if (safe.stages?.password?.password) safe.stages.password.password = '<redacted>';
  process.stdout.write(`[HARNESS RESULT] ${JSON.stringify(safe)}\n`);
}
function log(msg) {
  process.stdout.write(`[HARNESS] ${msg}\n`);
}
function errToObj(err) {
  return { message: err?.message ?? String(err), stack: err?.stack };
}

async function shutdown(reason) {
  if (!serverProc) return;
  if (serverProc.exitCode !== null) return;
  log(`shutting down server (reason=${reason})`);
  serverProc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  if (serverProc.exitCode === null) serverProc.kill('SIGKILL');
}

function portFree(port) {
  // Next binds to `::` (IPv6 ANY) by default. Test that exact bind to catch
  // existing IPv6 listeners that an IPv4-loopback check would miss.
  return new Promise((res) => {
    const srv = createServer();
    srv.once('error', () => res(false));
    srv.once('listening', () => srv.close(() => res(true)));
    srv.listen(port, '::');
  });
}

async function dirSize(dir) {
  const { readdir, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');
  let total = 0;
  async function walk(p) {
    const entries = await readdir(p, { withFileTypes: true });
    for (const e of entries) {
      const full = join(p, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) total += (await stat(full)).size;
    }
  }
  await walk(dir);
  return total;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = isNaN(Number(next)) ? next : Number(next);
      i++;
    }
  }
  return out;
}
