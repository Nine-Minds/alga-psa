import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { buildHmrCaptureSource } from '../capture-next-hmr-reloads.mjs';

class SyntheticWebSocket extends EventTarget {
  constructor(url, protocols) {
    super();
    this.url = url;
    this.protocols = protocols;
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
