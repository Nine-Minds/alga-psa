/* eslint-env node */

import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const localHosts = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]']);

const utilDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(utilDir, '../../../../');

let apiServerProcess: ChildProcess | null = null;
let serverStartedByTests = false;
let currentBaseUrl: string | null = null;

function sanitizeBaseUrl(rawUrl?: string): string {
  const url = rawUrl && rawUrl.length > 0 ? rawUrl : 'http://127.0.0.1:3000';
  return url.replace(/\/$/, '');
}

async function isApiServerRunning(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export function resolveApiBaseUrl(rawUrl?: string): string {
  return sanitizeBaseUrl(rawUrl);
}

export async function ensureApiServerRunning(baseUrl: string): Promise<void> {
  const sanitizedBaseUrl = sanitizeBaseUrl(baseUrl);
  currentBaseUrl = sanitizedBaseUrl;

  if (await isApiServerRunning(sanitizedBaseUrl)) {
    return;
  }

  const parsedBaseUrl = new URL(sanitizedBaseUrl);

  if (!localHosts.has(parsedBaseUrl.hostname)) {
    throw new Error(
      `API server not reachable at ${sanitizedBaseUrl} and hostname is not local; cannot auto-start.`
    );
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  apiServerProcess = spawn(npmCommand, ['run', 'start:express'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'test'
    },
    stdio: 'inherit'
  });

  serverStartedByTests = true;

  apiServerProcess.once('error', (error) => {
    console.error('API server process error:', error);
  });

  const maxAttempts = 60;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (apiServerProcess && apiServerProcess.exitCode !== null) {
      const exitCode = apiServerProcess.exitCode;
      apiServerProcess = null;
      serverStartedByTests = false;

      if (await isApiServerRunning(sanitizedBaseUrl)) {
        return;
      }

      throw new Error(`API server exited early with code ${exitCode}`);
    }

    if (await isApiServerRunning(sanitizedBaseUrl)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Timed out waiting for API server at ${sanitizedBaseUrl} to become ready.`);
}

export async function stopApiServerIfStarted(): Promise<void> {
  if (!serverStartedByTests || !apiServerProcess) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = apiServerProcess;
    if (!child) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, 5000);

    const cleanup = () => {
      clearTimeout(timeout);
      resolve();
    };

    child.once('exit', cleanup);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    if (!child.kill('SIGTERM')) {
      cleanup();
    }
  }).catch((error) => {
    console.warn('Failed to stop API server cleanly:', error);
  });

  apiServerProcess = null;
  serverStartedByTests = false;
}

process.on('exit', () => {
  if (serverStartedByTests && apiServerProcess) {
    apiServerProcess.kill('SIGTERM');
  }
});

export function getCurrentApiBaseUrl(): string | null {
  return currentBaseUrl;
}
