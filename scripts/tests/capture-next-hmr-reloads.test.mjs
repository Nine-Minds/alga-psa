import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import vm from 'node:vm';
import { createWriteStream } from 'node:fs';
import { buildHmrCaptureSource, connectCdp, shutdownCapture, startCapture } from '../capture-next-hmr-reloads.mjs';

class SyntheticWebSocket extends EventTarget {
  constructor(url, protocols) {
    super();
    this.url = url;
    this.protocols = protocols;
  }
}

class SyntheticCdpSocket extends EventTarget {
  static OPEN = 1;

  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
    SyntheticCdpSocket.latest = this;
    queueMicrotask(() => {
      this.readyState = SyntheticCdpSocket.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(message) {
    this.sent.push(JSON.parse(message));
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

class SetupFailureCdpSocket extends SyntheticCdpSocket {
  send(message) {
    const command = JSON.parse(message);
    this.sent.push(command);
    if (command.method === 'Runtime.evaluate') return;
    const result = command.method === 'Page.addScriptToEvaluateOnNewDocument'
      ? { identifier: 'fixture-script' }
      : {};
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ id: command.id, result }),
    })));
  }
}

test('captures the actual reloadPage payload and connection metadata before page handlers run', () => {
  const records = [];
  const context = {
    WebSocket: SyntheticWebSocket,
    location: { href: 'http://msp.example.test/msp/interactions' },
    performance: { timeOrigin: 123456789 },
    __codexCaptureNextHmrReload: (record) => records.push(JSON.parse(record)),
  };
  vm.runInNewContext(buildHmrCaptureSource(), context);

  const socket = new context.WebSocket('ws://msp.example.test/_next/hmr?session=fixture');
  const order = [];
  socket.addEventListener('message', () => order.push(`next-handler:${records.length}`));
  socket.dispatchEvent(new MessageEvent('message', {
    data: JSON.stringify({ type: 'reloadPage', data: '_document has changed' }),
  }));
  socket.dispatchEvent(new MessageEvent('message', {
    data: JSON.stringify({ type: 'built', hash: 'fixture-hash' }),
  }));

  assert.equal(records.length, 1);
  assert.match(records[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(records[0].performanceTimeOrigin, 123456789);
  assert.equal(records[0].pageUrl, 'http://msp.example.test/msp/interactions');
  assert.equal(records[0].connectionUrl, 'ws://msp.example.test/_next/hmr?session=fixture');
  assert.equal(records[0].payload, '_document has changed');
  assert.equal(records[0].rawMessage, '{"type":"reloadPage","data":"_document has changed"}');
  assert.deepEqual(order, ['next-handler:1', 'next-handler:1']);
});

test('ignores malformed and non-reload HMR messages without changing message delivery', () => {
  const records = [];
  const context = {
    WebSocket: SyntheticWebSocket,
    location: { href: 'http://msp.example.test/auth/msp/signin' },
    performance: { timeOrigin: 99 },
    __codexCaptureNextHmrReload: (record) => records.push(JSON.parse(record)),
  };
  vm.runInNewContext(buildHmrCaptureSource(), context);
  const socket = new context.WebSocket('ws://msp.example.test/_next/hmr');
  let delivered = 0;
  socket.addEventListener('message', () => { delivered += 1; });

  socket.dispatchEvent(new MessageEvent('message', { data: 'not json' }));
  socket.dispatchEvent(new MessageEvent('message', {
    data: JSON.stringify({ type: 'serverComponentChanges' }),
  }));

  assert.equal(records.length, 0);
  assert.equal(delivered, 2);
});

test('rejects an in-flight CDP command when the browser disconnects', async () => {
  const cdp = await connectCdp('ws://fixture/devtools/page/1', {
    WebSocketImpl: SyntheticCdpSocket,
    commandTimeoutMs: 5_000,
  });
  const pendingCommand = cdp.send('Runtime.enable');
  assert.equal(SyntheticCdpSocket.latest.sent[0].method, 'Runtime.enable');

  SyntheticCdpSocket.latest.close();

  await assert.rejects(pendingCommand, /CDP WebSocket disconnected/);
  assert.equal(cdp.isOpen(), false);
});

test('shutdown after a browser disconnect completes and closes the output stream', async () => {
  const cdp = await connectCdp('ws://fixture/devtools/page/2', {
    WebSocketImpl: SyntheticCdpSocket,
    commandTimeoutMs: 5_000,
  });
  const output = new PassThrough();
  output.resume();
  SyntheticCdpSocket.latest.close();

  await Promise.race([
    shutdownCapture({ cdp, output, scriptIdentifier: 'fixture-script', cleanupTimeoutMs: 100 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown hung')), 500)),
  ]);

  assert.equal(output.closed, true);
  assert.equal(cdp.isOpen(), false);
});

test('closes the output stream when CDP setup fails', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'next-hmr-capture-setup-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let output;
  const target = {
    id: 'fixture-page',
    type: 'page',
    url: 'about:blank',
    webSocketDebuggerUrl: 'ws://fixture/devtools/page/setup-failure',
  };

  await assert.rejects(startCapture({
    cdpUrl: 'http://fixture',
    targetId: target.id,
    output: join(directory, 'capture.jsonl'),
  }, {
    fetchImpl: async () => new Response(JSON.stringify([target]), { status: 200 }),
    WebSocketImpl: SetupFailureCdpSocket,
    commandTimeoutMs: 30,
    outputFactory: (path, options) => (output = createWriteStream(path, options)),
  }), /CDP command Runtime\.evaluate timed out/);

  assert.equal(output.closed, true);
  assert.equal(SetupFailureCdpSocket.latest.readyState, 3);
});
