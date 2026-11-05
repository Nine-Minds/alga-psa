#!/usr/bin/env node

import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_CDP_URL = process.env.NEXT_HMR_CDP_URL ?? 'http://127.0.0.1:9222';
const BINDING_NAME = '__codexCaptureNextHmrReload';

/** Install before Next's own WebSocket message handler so reloadPage is saved before navigation. */
export function buildHmrCaptureSource(bindingName = BINDING_NAME) {
  return `(() => {
    if (globalThis.__codexNextHmrCaptureInstalled) return;
    const NativeWebSocket = globalThis.WebSocket;
    if (!NativeWebSocket) throw new Error('WebSocket is unavailable in this page');
    const capture = globalThis[${JSON.stringify(bindingName)}];
    if (typeof capture !== 'function') throw new Error('CDP capture binding is unavailable');
    const observedSockets = new Map();

    class CapturedWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        const connectionUrl = String(url);
        const observer = (event) => {
          if (typeof event.data !== 'string') return;
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message?.type !== 'reloadPage') return;
          capture(JSON.stringify({
            timestamp: new Date().toISOString(),
            performanceTimeOrigin: globalThis.performance?.timeOrigin ?? null,
            pageUrl: globalThis.location?.href ?? null,
            connectionUrl,
            payload: message.data ?? null,
            rawMessage: event.data,
          }));
        };
        observedSockets.set(this, observer);
        this.addEventListener('message', observer);
        this.addEventListener('close', () => {
          this.removeEventListener('message', observer);
          observedSockets.delete(this);
        }, { once: true });
      }
    }

    globalThis.WebSocket = CapturedWebSocket;
    globalThis.__codexNextHmrCaptureInstalled = true;
    globalThis.__codexNextHmrCaptureCleanup = () => {
      for (const [socket, observer] of observedSockets) {
        socket.removeEventListener('message', observer);
      }
      observedSockets.clear();
      if (globalThis.WebSocket === CapturedWebSocket) globalThis.WebSocket = NativeWebSocket;
      delete globalThis.__codexNextHmrCaptureInstalled;
      delete globalThis.__codexNextHmrCaptureCleanup;
    };
  })();`;
}

function parseArgs(argv) {
  const options = { cdpUrl: DEFAULT_CDP_URL, output: '/tmp/next-hmr-reloads.jsonl' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    const [key, inlineValue] = argument.split('=', 2);
    const value = inlineValue ?? argv[++index];
    if (key === '--cdp-url') options.cdpUrl = value;
    else if (key === '--target-url') options.targetUrl = value;
    else if (key === '--target-id') options.targetId = value;
    else if (key === '--output') options.output = value;
    else throw new Error(`Unknown option: ${key}`);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
  }
  if (!options.help && !options.targetUrl && !options.targetId) {
    throw new Error('Specify --target-url or --target-id; the harness never navigates the browser.');
  }
  return options;
}

function usage() {
  return `Capture Next.js development HMR reloadPage messages from an existing Chrome DevTools Protocol target.

Usage:
  node scripts/capture-next-hmr-reloads.mjs --target-url <url> [options]
  node scripts/capture-next-hmr-reloads.mjs --target-id <id> [options]

Options:
  --cdp-url <url>   Chrome DevTools HTTP endpoint (default: ${DEFAULT_CDP_URL})
  --output <path>   Append JSONL records (default: /tmp/next-hmr-reloads.jsonl)
  --help            Show this help

Attach this before navigating/reloading the target. It does not start, stop, or navigate the app.`;
}

async function listPageTargets(cdpUrl, fetchImpl = fetch) {
  const endpoint = new URL('/json/list', cdpUrl);
  const response = await fetchImpl(endpoint);
  if (!response.ok) throw new Error(`DevTools target listing returned HTTP ${response.status}`);
  const targets = await response.json();
  return targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
}

function waitForSocketOpen(socket, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (socket.readyState === 1) {
      resolvePromise();
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
    };
    const onOpen = () => { cleanup(); resolvePromise(); };
    const onError = () => { cleanup(); rejectPromise(new Error('CDP WebSocket connection failed')); };
    const onClose = () => { cleanup(); rejectPromise(new Error('CDP WebSocket closed before connecting')); };
    const timer = setTimeout(() => {
      cleanup();
      rejectPromise(new Error(`CDP WebSocket connection timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('error', onError, { once: true });
    socket.addEventListener('close', onClose, { once: true });
  });
}

export async function connectCdp(
  webSocketUrl,
  { WebSocketImpl = WebSocket, connectTimeoutMs = 5_000, commandTimeoutMs = 5_000 } = {},
) {
  const socket = new WebSocketImpl(webSocketUrl);
  try {
    await waitForSocketOpen(socket, connectTimeoutMs);
  } catch (error) {
    socket.close();
    throw error;
  }
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  let disconnectedError;
  const rejectPending = (error) => {
    if (disconnectedError) return;
    disconnectedError = error;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  socket.addEventListener('close', () => {
    rejectPending(new Error('CDP WebSocket disconnected'));
  }, { once: true });
  socket.addEventListener('error', () => {
    rejectPending(new Error('CDP WebSocket errored'));
  }, { once: true });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  return {
    socket,
    onEvent(listener) { listeners.add(listener); },
    isOpen() { return !disconnectedError && socket.readyState === 1; },
    send(method, params = {}) {
      if (disconnectedError || socket.readyState !== 1) {
        return Promise.reject(disconnectedError ?? new Error('CDP WebSocket is not open'));
      }
      const id = ++nextId;
      const response = new Promise((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectPromise(new Error(`CDP command ${method} timed out after ${commandTimeoutMs} ms`));
        }, commandTimeoutMs);
        pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          rejectPromise(error);
        }
      });
      return response;
    },
  };
}

async function finishOutput(output, timeoutMs) {
  if (output.closed || output.destroyed) return;
  output.end();
  if (output.closed) return;
  if (timeoutMs <= 0) return;
  await once(output, 'close').catch(() => undefined);
}

async function settleWithin(promise, timeoutMs) {
  if (timeoutMs <= 0) return;
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((resolvePromise) => { timer = setTimeout(resolvePromise, timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function removeInjectedCapture(cdp, scriptIdentifier, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  if (!cdp.isOpen()) return;
  if (scriptIdentifier) {
    await settleWithin(
      cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptIdentifier }).catch(() => undefined),
      deadline - Date.now(),
    );
  }
  if (cdp.isOpen()) {
    await settleWithin(
      cdp.send('Runtime.evaluate', { expression: 'globalThis.__codexNextHmrCaptureCleanup?.()' }).catch(() => undefined),
      deadline - Date.now(),
    );
  }
}

export async function shutdownCapture({ cdp, output, scriptIdentifier, cleanupTimeoutMs = 1_000 }) {
  const deadline = Date.now() + cleanupTimeoutMs;
  try {
    await removeInjectedCapture(cdp, scriptIdentifier, deadline - Date.now());
  } finally {
    cdp.socket.close();
    await settleWithin(finishOutput(output, deadline - Date.now()), deadline - Date.now());
    if (!output.closed && !output.destroyed) output.destroy();
  }
}

export async function startCapture(options, {
  fetchImpl = fetch,
  WebSocketImpl = WebSocket,
  connectTimeoutMs,
  commandTimeoutMs,
  outputFactory = createWriteStream,
} = {}) {
  const targets = await listPageTargets(options.cdpUrl, fetchImpl);
  const target = targets.find((candidate) =>
    options.targetId
      ? candidate.id === options.targetId
      : candidate.url.includes(options.targetUrl),
  );
  if (!target) {
    const available = targets.map(({ id, url }) => `${id} ${url}`).join('\n');
    throw new Error(`No matching page target. Available pages:\n${available || '(none)'}`);
  }

  const output = outputFactory(resolve(options.output), { flags: 'a' });
  output.on('error', (error) => {
    process.stderr.write(`[next-hmr-capture] output stream error: ${String(error)}\n`);
  });
  let cdp;
  let identifier;
  try {
    await once(output, 'open');
    cdp = await connectCdp(target.webSocketDebuggerUrl, { WebSocketImpl, connectTimeoutMs, commandTimeoutMs });
    cdp.onEvent((message) => {
      if (message.method !== 'Runtime.bindingCalled' || message.params.name !== BINDING_NAME) return;
      try {
        const record = JSON.parse(message.params.payload);
        output.write(`${JSON.stringify({ targetId: target.id, ...record })}\n`);
        process.stdout.write(`[next-hmr-capture] ${record.timestamp} reloadPage ${JSON.stringify(record.payload)}\n`);
      } catch (error) {
        process.stderr.write(`[next-hmr-capture] discarded malformed capture: ${String(error)}\n`);
      }
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Runtime.addBinding', { name: BINDING_NAME });
    await cdp.send('Page.enable');
    ({ identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: buildHmrCaptureSource(),
    }));
    await cdp.send('Runtime.evaluate', { expression: buildHmrCaptureSource() });
  } catch (error) {
    if (cdp) await removeInjectedCapture(cdp, identifier, 300);
    if (cdp) cdp.socket.close();
    if (!output.destroyed) output.destroy();
    if (!output.closed) {
      await settleWithin(once(output, 'close').catch(() => undefined), 500);
    }
    throw error;
  }

  process.stdout.write(`[next-hmr-capture] attached to ${target.url} (${target.id})\n`);
  process.stdout.write(`[next-hmr-capture] writing JSONL to ${resolve(options.output)}; Ctrl-C to stop\n`);

  const close = () => shutdownCapture({ cdp, output, scriptIdentifier: identifier });
  return { close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    const capture = await startCapture(options);
    process.once('SIGINT', () => capture.close().finally(() => process.exit(0)));
    process.once('SIGTERM', () => capture.close().finally(() => process.exit(0)));
  } catch (error) {
    process.stderr.write(`${String(error)}\n\n${usage()}\n`);
    process.exitCode = 1;
  }
}
