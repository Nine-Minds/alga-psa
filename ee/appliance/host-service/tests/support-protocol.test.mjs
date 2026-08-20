import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeControlFrame, decodeTerminalFrame, encodeControlFrame, encodeTerminalFrame, MAX_FRAME_BYTES, SUPPORT_PROTOCOL_VERSION } from '../../support-agent/protocol.mjs';

test('terminal protocol preserves opaque bytes and monotonic sequence metadata', () => {
  const payload = Buffer.from([0, 1, 2, 0xf0, 0x9f, 0x92, 0xa1, 0xff]);
  const encoded = encodeTerminalFrame({ type: 'input', seq: 42, data: payload });
  const decoded = decodeTerminalFrame(encoded);
  assert.equal(decoded.version, SUPPORT_PROTOCOL_VERSION);
  assert.equal(decoded.type, 'input');
  assert.equal(decoded.seq, 42);
  assert.deepEqual(decoded.data, payload);
});

test('terminal protocol rejects malformed, oversized, and unsupported frames', () => {
  assert.throws(() => encodeTerminalFrame({ type: 'unknown', seq: 1, data: 'x' }), /type/);
  assert.throws(() => encodeTerminalFrame({ type: 'output', seq: 0, data: 'x' }), /sequence/);
  assert.throws(() => encodeTerminalFrame({ type: 'output', seq: 1, data: Buffer.alloc(MAX_FRAME_BYTES) }), /payload/);
  const valid = encodeTerminalFrame({ type: 'output', seq: 1, data: 'x' });
  valid[0] = 99;
  assert.throws(() => decodeTerminalFrame(valid), /version/);
});

test('control protocol requires the version, sequence, and named type envelope', () => {
  const encoded = encodeControlFrame({ type: 'heartbeat', at: '2026-08-20T00:00:00.000Z' }, 7);
  assert.deepEqual(decodeControlFrame(encoded), { type: 'heartbeat', at: '2026-08-20T00:00:00.000Z', version: SUPPORT_PROTOCOL_VERSION, seq: 7 });
  assert.throws(() => decodeControlFrame(Buffer.from(JSON.stringify({ version: SUPPORT_PROTOCOL_VERSION, type: 'ready' }))), /sequence/);
  assert.throws(() => decodeControlFrame(Buffer.from(JSON.stringify({ version: 99, seq: 1, type: 'ready' }))), /version/);
});
