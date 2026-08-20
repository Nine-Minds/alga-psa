import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportAgent } from '../../support-agent/supervisor.mjs';
import { listRecordingMetadata, recordingDirectory } from '../support-recordings.mjs';

const SESSION_ID = '33333333-3333-4333-8333-333333333333';

class MockSocket extends EventEmitter {
  static OPEN = 1;
  static last = null;
  constructor() { super(); this.readyState = 0; this.bufferedAmount = 0; this.sent = []; MockSocket.last = this; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.emit('close'); }
}

function fakePtyFactory() {
  const pty = { writes: [], sizes: [], onData(handler) { this.data = handler; }, onExit(handler) { this.exit = handler; }, write(value) { this.writes.push(value); }, resize(width, height) { this.sizes.push([width, height]); }, kill() { this.killed = true; }, emitOutput(value) { this.data?.(value); }, emitExit() { this.exit?.({ exitCode: 0, signal: 0 }); } };
  fakePtyFactory.last = pty;
  return pty;
}

test('support agent resumes from memory token, preserves PTY across relay loss, resizes, and opens a fresh shell', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'support-agent-'));
  const reconnect = path.join(root, 'reconnect', 'token');
  fs.mkdirSync(path.dirname(reconnect), { recursive: true, mode: 0o700 });
  fs.writeFileSync(reconnect, 'memory-reconnect-token-1234\n', { mode: 0o600 });
  const connector = path.join(root, 'missing-connector');
  const agent = createSupportAgent({ sessionId: SESSION_ID, relayUrl: 'wss://relay.example/session', connectorTokenFile: connector, reconnectTokenFile: reconnect, recordingDir: root, expiresAt: Date.now() + 3600000, WebSocketImpl: MockSocket, ptySpawn: fakePtyFactory, detachedGraceMs: 25, reconnectDelayMs: 100000, recordingOwnerUid: process.getuid(), recordingOwnerGid: process.getgid() });
  agent.start();
  const socket = MockSocket.last;
  socket.readyState = MockSocket.OPEN;
  socket.emit('open');
  socket.emit('message', Buffer.from(JSON.stringify({ version: 1, seq: 1, type: 'ready', reconnectToken: 'new-memory-token-1234' })));
  socket.emit('message', Buffer.from(JSON.stringify({ version: 1, seq: 2, type: 'attach', width: 100, height: 30 })));
  const pty = fakePtyFactory.last;
  pty.emitOutput('output while attached');
  socket.readyState = 3;
  socket.emit('close');
  pty.emitOutput('output during relay loss');
  assert.equal(agent.getState().hasChild, true);
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(agent.getState().hasChild, false);
  assert.equal(agent.launchShell(), true);
  const reconnecting = listRecordingMetadata(root, SESSION_ID);
  assert.equal(reconnecting.length, 1);
  // A resize is applied to the real PTY, not merely recorded.
  socket.readyState = MockSocket.OPEN;
  socket.emit('message', Buffer.from(JSON.stringify({ version: 1, seq: 3, type: 'resize', width: 140, height: 45 })));
  assert.deepEqual(fakePtyFactory.last.sizes.at(-1), [140, 45]);
  fakePtyFactory.last.emitExit();
  assert.equal(agent.getState().hasChild, false);
  assert.equal(agent.launchShell(), true);
  assert.equal(agent.getState().hasChild, true);
  agent.stop('test');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fs.existsSync(recordingDirectory(root, SESSION_ID)), true);
});

test('support agent prefers the memory reconnect token when the projected connector file remains', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'support-agent-token-order-'));
  const reconnect = path.join(root, 'reconnect-token');
  const connector = path.join(root, 'connector-token');
  fs.writeFileSync(reconnect, 'memory-token-preferred-1234\n', { mode: 0o600 });
  fs.writeFileSync(connector, 'already-consumed-token-1234\n', { mode: 0o600 });
  const agent = createSupportAgent({ sessionId: SESSION_ID, relayUrl: 'wss://relay.example/session', connectorTokenFile: connector, reconnectTokenFile: reconnect, recordingDir: root, expiresAt: Date.now() + 3600000, WebSocketImpl: MockSocket, ptySpawn: fakePtyFactory, recordingOwnerUid: process.getuid(), recordingOwnerGid: process.getgid() });
  agent.start();
  const socket = MockSocket.last;
  socket.readyState = MockSocket.OPEN;
  socket.emit('open');
  assert.equal(socket.sent[0].token, 'memory-token-preferred-1234');
  assert.equal(fs.existsSync(connector), true);
  agent.stop('test');
});

test('idle expiry closes only the PTY and mandatory frame sequencing/backpressure fail closed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'support-agent-idle-'));
  const reconnect = path.join(root, 'reconnect-token');
  fs.writeFileSync(reconnect, 'memory-token-idle-1234\n', { mode: 0o600 });
  const agent = createSupportAgent({ sessionId: SESSION_ID, relayUrl: 'wss://relay.example/session', connectorTokenFile: path.join(root, 'missing'), reconnectTokenFile: reconnect, recordingDir: root, expiresAt: Date.now() + 3600000, WebSocketImpl: MockSocket, ptySpawn: fakePtyFactory, idleTimeoutMs: 20, recordingOwnerUid: process.getuid(), recordingOwnerGid: process.getgid() });
  agent.start();
  const socket = MockSocket.last; socket.readyState = MockSocket.OPEN; socket.emit('open');
  socket.emit('message', Buffer.from(JSON.stringify({ version: 1, seq: 1, type: 'ready' })));
  socket.emit('message', Buffer.from(JSON.stringify({ version: 1, seq: 2, type: 'attach' })));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(agent.getState().closed, false);
  assert.equal(agent.getState().hasChild, false);
  assert.equal(agent.launchShell(), true);
  agent.stop('test');

  const missingSequence = createSupportAgent({ sessionId: SESSION_ID, relayUrl: 'wss://relay.example/session', connectorTokenFile: path.join(root, 'missing-2'), reconnectTokenFile: reconnect, recordingDir: root, expiresAt: Date.now() + 3600000, WebSocketImpl: MockSocket, ptySpawn: fakePtyFactory, recordingOwnerUid: process.getuid(), recordingOwnerGid: process.getgid() });
  missingSequence.start();
  const missingSocket = MockSocket.last; missingSocket.readyState = MockSocket.OPEN; missingSocket.emit('open');
  missingSocket.emit('message', Buffer.from(JSON.stringify({ version: 1, type: 'ready' })));
  assert.equal(missingSequence.getState().closed, true);
  assert.equal(missingSequence.getState().stopReason, 'invalid-frame-sequence');

  const backpressure = createSupportAgent({ sessionId: SESSION_ID, relayUrl: 'wss://relay.example/session', connectorTokenFile: path.join(root, 'missing-3'), reconnectTokenFile: reconnect, recordingDir: root, expiresAt: Date.now() + 3600000, WebSocketImpl: MockSocket, ptySpawn: fakePtyFactory, recordingOwnerUid: process.getuid(), recordingOwnerGid: process.getgid() });
  backpressure.start();
  const pressureSocket = MockSocket.last; pressureSocket.readyState = MockSocket.OPEN; pressureSocket.emit('open');
  pressureSocket.emit('message', Buffer.from(JSON.stringify({ version: 1, seq: 1, type: 'ready' })));
  pressureSocket.emit('message', Buffer.from(JSON.stringify({ version: 1, seq: 2, type: 'attach' })));
  pressureSocket.bufferedAmount = 256 * 1024 + 1;
  fakePtyFactory.last.emitOutput('must fail closed');
  assert.equal(backpressure.getState().closed, true);
  assert.equal(backpressure.getState().stopReason, 'relay-backpressure');
});

test('finalized segments queue across disconnect and resend in digest-chain order', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'support-agent-queue-'));
  const reconnect = path.join(root, 'reconnect-token');
  fs.writeFileSync(reconnect, 'memory-token-queue-1234\n', { mode: 0o600 });
  const agent = createSupportAgent({ sessionId: SESSION_ID, relayUrl: 'wss://relay.example/session', connectorTokenFile: path.join(root, 'missing'), reconnectTokenFile: reconnect, recordingDir: root, expiresAt: Date.now() + 3600000, WebSocketImpl: MockSocket, ptySpawn: fakePtyFactory, detachedGraceMs: 10, reconnectDelayMs: 10, recordingOwnerUid: process.getuid(), recordingOwnerGid: process.getgid() });
  agent.start();
  const firstSocket = MockSocket.last; firstSocket.readyState = MockSocket.OPEN; firstSocket.emit('open');
  firstSocket.emit('message', Buffer.from(JSON.stringify({ version: 1, seq: 1, type: 'ready', reconnectToken: 'memory-token-queue-5678' })));
  firstSocket.emit('message', Buffer.from(JSON.stringify({ version: 1, seq: 2, type: 'attach' })));
  firstSocket.readyState = 3; firstSocket.emit('close');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(agent.launchShell(), true);
  fakePtyFactory.last.emitExit();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const secondSocket = MockSocket.last; secondSocket.readyState = MockSocket.OPEN; secondSocket.emit('open');
  secondSocket.emit('message', Buffer.from(JSON.stringify({ version: 1, seq: 1, type: 'ready' })));
  const finalizes = secondSocket.sent.filter((frame) => frame.type === 'recording-finalize');
  assert.equal(finalizes.length, 2);
  assert.equal(finalizes[1].segmentId !== finalizes[0].segmentId, true);
  agent.stop('test');
});
