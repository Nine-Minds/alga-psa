import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { AddressInfo } from 'node:net';

// Regression guard for the Xero OAuth callback access-log leak: Next's dev
// access logger prints an incoming-request line containing the full request
// URL, which would write the opaque state nonce, provider `error_description`,
// and authorization code to alga.log. next.config.mjs suppresses that line for
// callback paths. This suite spawns a real `next dev` server, issues real HTTP
// requests carrying sensitive query parameters, captures what the process
// logs, and asserts the material never appears while normal request logging
// and the route's own coarse diagnostics still work.

const appDir = path.resolve(__dirname, '../../../../../server');
const nextBin = path.resolve(appDir, '../node_modules/next/dist/bin/next');
const CALLBACK_PATH = '/api/integrations/xero/callback';

let child: ChildProcess | null = null;
let baseUrl = '';
let port = 0;
let distDir = '';
let childOutput: string[] = [];
let originalSkipAppInit: string | undefined;
let originalNextPublicEdition: string | undefined;
let originalNextDistDir: string | undefined;
let originalPort: string | undefined;

function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const allocated = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(allocated));
    });
  });
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status !== 404) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`next dev server did not become ready on ${url}`);
}

describe('Xero callback access-log redaction (real Next server)', () => {
  beforeAll(async () => {
    originalSkipAppInit = process.env.E2E_SKIP_APP_INIT;
    originalNextPublicEdition = process.env.NEXT_PUBLIC_EDITION;
    originalNextDistDir = process.env.NEXT_DIST_DIR;
    originalPort = process.env.PORT;

    // Use a throwaway .next dir so this server never touches the shared
    // .next/dev cache used by the worktree's own running server.
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xero-accesslog-dist-'));
    port = await allocatePort();
    baseUrl = `http://127.0.0.1:${port}`;

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      NEXT_DIST_DIR: distDir,
      E2E_SKIP_APP_INIT: 'true',
      NEXT_PUBLIC_EDITION: 'enterprise',
      NEXT_TELEMETRY_DISABLED: '1',
      // The callback paths exercised here never reach the attempt store, so
      // no Redis/DB dependency is needed; keep the store's lazy client from
      // connecting to anything the environment happens to serve.
      REDIS_PORT: '59999',
    };

    child = spawn(process.execPath, [nextBin, 'dev', '--webpack', '-p', String(port), '-H', '127.0.0.1'], {
      cwd: appDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    child.stdout!.on('data', (chunk) => childOutput.push(String(chunk)));
    child.stderr!.on('data', (chunk) => childOutput.push(String(chunk)));
    child.on('error', (error) => {
      throw error;
    });

    await waitForServer(baseUrl + '/api/integrations/xero/connect', 180_000);
  }, 240_000);

  afterAll(async () => {
    if (child) {
      const pid = child.pid;
      const exited = new Promise<void>((resolve) => {
        child!.once('exit', () => resolve());
      });
      if (pid !== undefined) {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          // Process group already gone.
        }
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
      child = null;
    }
    if (originalSkipAppInit === undefined) {
      delete process.env.E2E_SKIP_APP_INIT;
    } else {
      process.env.E2E_SKIP_APP_INIT = originalSkipAppInit;
    }
    if (originalNextPublicEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalNextPublicEdition;
    }
    if (originalNextDistDir === undefined) {
      delete process.env.NEXT_DIST_DIR;
    } else {
      process.env.NEXT_DIST_DIR = originalNextDistDir;
    }
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
    if (distDir) {
      fs.rmSync(distDir, { recursive: true, force: true });
    }
  });

  it('never writes callback query material (state, error_description, code) to the process log', async () => {
    // The live repro: provider denial callback carrying opaque state and
    // provider-controlled error text on the query string.
    const errorNonce = `NONCE_LEAK_MARKER_${Date.now()}`;
    const providerText = `PROVIDER_DESCRIPTION_LEAK_MARKER_${Date.now()}`;
    const errorRes = await getWithWarmup(
      `${CALLBACK_PATH}?error=access_denied&error_description=${encodeURIComponent(
        providerText
      )}&state=${errorNonce}`
    );
    expect(errorRes.status).toBe(307);
    const errorLocation = errorRes.headers.get('location') ?? '';
    expect(errorLocation).toContain('xero_error=access_denied');
    expect(errorLocation).not.toContain(errorNonce);
    expect(errorLocation).not.toContain(providerText);

    // A success-shaped callback would equally expose `code`; without the CSRF
    // cookie the route rejects early but the request still flows through the
    // access logger.
    const codeMarker = `CODE_LEAK_MARKER_${Date.now()}`;
    const codeNonce = `NONCE_LEAK_MARKER_2_${Date.now()}`;
    const codeRes = await getWithWarmup(`${CALLBACK_PATH}?code=${codeMarker}&state=${codeNonce}`);
    expect(codeRes.status).toBe(307);
    expect(codeRes.headers.get('location') ?? '').toContain('xero_error=csrf_mismatch');

    // Control: a matched, middleware-exempted non-callback route must still
    // get a normal access-log line (suppression is callback-scoped, not global).
    const controlRes = await getWithWarmup('/api/integrations/xero/connect');
    expect(controlRes.status).toBe(401);

    // Allow the process stdout/stderr pipes to flush before asserting.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const captured = childOutput.join('');

    expect(captured).not.toContain(errorNonce);
    expect(captured).not.toContain(providerText);
    expect(captured).not.toContain(codeMarker);
    expect(captured).not.toContain(codeNonce);
    // No framework request line may carry the callback query string.
    expect(captured).not.toMatch(/GET \/api\/integrations\/xero\/callback\?/);
    // The route's own coarse diagnostics still fire (CSRF rejection above).
    expect(captured).toContain('CSRF cookie missing on callback');
    // Method/path/status-level diagnostics remain visible for the callback via
    // the route's own coarse access line (the framework line is suppressed).
    expect(captured).toMatch(/\[xeroOAuth\] Callback handled/);
    expect(captured).toMatch(/path: '\/api\/integrations\/xero\/callback'/);
    expect(captured).toMatch(/status: 307/);
    expect(captured).toMatch(/xeroError: 'access_denied'/);
    expect(captured).toMatch(/xeroError: 'csrf_mismatch'/);
    // Ordinary request logging is unaffected.
    expect(captured).toMatch(/GET \/api\/integrations\/xero\/connect\s+401/);
  });

  // The dev server compiles a route on first hit; a cold request can 404
  // before compilation finishes. Retry a few times so the assertion runs
  // against the real handler, not the warm-up fallback.
  async function getWithWarmup(url: string): Promise<Response> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(baseUrl + url, { redirect: 'manual' });
      if (res.status !== 404 || attempt === 7) {
        return res;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('warmup retries exhausted');
  }
});
