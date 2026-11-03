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

    class CapturedWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        super(url, protocols);
        const connectionUrl = String(url);
        this.addEventListener('message', (event) => {
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
        });
      }
    }

    globalThis.WebSocket = CapturedWebSocket;
    globalThis.__codexNextHmrCaptureInstalled = true;
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

async function listPageTargets(cdpUrl) {
  const endpoint = new URL('/json/list', cdpUrl);
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`DevTools target listing returned HTTP ${response.status}`);
  const targets = await response.json();
  return targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await once(socket, 'open');
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  return {
    socket,
    onEvent(listener) { listeners.add(listener); },
    send(method, params = {}) {
      const id = ++nextId;
      const response = new Promise((resolvePromise, rejectPromise) => {
        pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
  };
}

export async function startCapture(options) {
  const targets = await listPageTargets(options.cdpUrl);
  const target = targets.find((candidate) =>
    options.targetId
      ? candidate.id === options.targetId
      : candidate.url.includes(options.targetUrl),
  );
  if (!target) {
    const available = targets.map(({ id, url }) => `${id} ${url}`).join('\n');
    throw new Error(`No matching page target. Available pages:\n${available || '(none)'}`);
  }

  const output = createWriteStream(resolve(options.output), { flags: 'a' });
  await once(output, 'open');
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
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
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: buildHmrCaptureSource(),
  });
  await cdp.send('Runtime.evaluate', { expression: buildHmrCaptureSource() });

  process.stdout.write(`[next-hmr-capture] attached to ${target.url} (${target.id})\n`);
  process.stdout.write(`[next-hmr-capture] writing JSONL to ${resolve(options.output)}; Ctrl-C to stop\n`);

  const close = async () => {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => undefined);
    cdp.socket.close();
    output.end();
    await once(output, 'close').catch(() => undefined);
  };
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
