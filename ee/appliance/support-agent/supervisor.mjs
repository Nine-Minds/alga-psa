import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import { RecordingSegment, recordingDirectory, writeAtomicJson } from '../host-service/support-recordings.mjs';

const require = createRequire(import.meta.url);

export const SUPPORT_PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 64 * 1024;
export const MAX_BUFFERED_BYTES = 256 * 1024;
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const DETACHED_GRACE_MS = 2 * 60 * 1000;

function boundedToken(file, consume) {
  const token = fs.readFileSync(file, 'utf8').trim();
  if (token.length < 16 || token.length > 4096) throw new Error('Support connector token is invalid.');
  if (consume) { try { fs.rmSync(file, { force: true }); } catch { /* Secret volumes may be read-only. */ } }
  return token;
}

function writeReconnectToken(file, token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 4096) throw new Error('Support reconnect token is invalid.');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  const temp = `${file}.${process.pid}.tmp`;
  const handle = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeSync(handle, `${token}\n`); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

function readInitialToken(connectorFile, reconnectFile) {
  if (fs.existsSync(connectorFile)) return boundedToken(connectorFile, true);
  if (fs.existsSync(reconnectFile)) return boundedToken(reconnectFile, false);
  throw new Error('No support connector or reconnect token is available.');
}

function existingBytes(recordingDir, sessionId) {
  const directory = recordingDirectory(recordingDir, sessionId);
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory).filter((name) => /^segment-[0-9a-f-]+\.cast$/i.test(name)).reduce((sum, name) => {
    const stat = fs.statSync(path.join(directory, name));
    if (!stat.isFile() || stat.size > 100 * 1024 * 1024 || sum + stat.size > 100 * 1024 * 1024) throw new Error('The local recording limit was already exceeded.');
    return sum + stat.size;
  }, 0);
}

export function createSupportAgent({ sessionId, relayUrl, connectorTokenFile, reconnectTokenFile, recordingDir, expiresAt, resumed = false, WebSocketImpl = WebSocket, ptySpawn = null, now = () => Date.now(), detachedGraceMs = DETACHED_GRACE_MS, reconnectDelayMs = 1000, idleTimeoutMs = IDLE_TIMEOUT_MS } = {}) {
  if (!sessionId || !relayUrl || !Number.isFinite(expiresAt)) throw new Error('Support agent configuration is incomplete.');
  const quota = { bytes: existingBytes(recordingDir, sessionId), limit: 100 * 1024 * 1024 };
  let socket = null; let child = null; let recorder = null; let detachedTimer = null; let idleTimer = null; let reconnectTimer = null;
  let relayToken = null; let closed = false; let outgoingSeq = 0; let incomingSeq = 0; let lastCheckpointBytes = 0; let lastFinalized = null;

  function frame(message) {
    const result = { version: SUPPORT_PROTOCOL_VERSION, seq: ++outgoingSeq, ...message };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_FRAME_BYTES) throw new Error('Support control frame exceeds the bounded size.');
    return result;
  }
  function send(message) {
    if (!socket || socket.readyState !== WebSocketImpl.OPEN) return false;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) throw new Error('Support relay backpressure limit exceeded.');
    socket.send(JSON.stringify(frame(message))); return true;
  }
  function checkpoint(force = false) {
    if (!recorder || (!force && recorder.bytes - lastCheckpointBytes < 64 * 1024)) return;
    lastCheckpointBytes = recorder.bytes;
    try { send({ type: 'recording-checkpoint', segmentId: recorder.segmentId, bytes: recorder.bytes, digest: recorder.digest.copy().digest('hex') }); } catch {}
  }
  function finalizeRecorder() {
    if (!recorder || recorder.closed) return lastFinalized;
    const metadata = recorder.finalize(); lastFinalized = metadata; recorder = null; lastCheckpointBytes = 0;
    try { send({ type: 'recording-finalize', segmentId: metadata.segmentId, bytes: metadata.bytes, digest: metadata.digest, closedAt: metadata.closedAt }); } catch {}
    return metadata;
  }
  function resetIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => stop('idle-timeout'), idleTimeoutMs); idleTimer.unref?.(); }
  function record(type, data = {}) { if (!recorder) throw new Error('Recorder is not ready.'); return recorder.append(type, data); }
  function onOutput(data, stream) {
    if (!recorder) return;
    try {
      const encoded = Buffer.from(data, 'utf8').toString('base64');
      record('output', { ...(stream ? { stream } : {}), encoding: 'base64', data: encoded }); checkpoint();
      try { send({ type: 'output', ...(stream ? { stream } : {}), data: encoded }); } catch {}
      resetIdle();
    } catch { stop('recording-output-failure'); }
  }
  function launchShell(width = 120, height = 40) {
    if (child || closed || now() >= expiresAt) return false;
    if (![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= 1000)) throw new Error('Invalid terminal size.');
    recorder = new RecordingSegment({ root: recordingDir, sessionId, width, height, quota });
    if (resumed) record('reboot', { marker: 'control-plane-resume' });
    record('marker', { marker: 'shell-start' });
    const spawn = ptySpawn || require('node-pty').spawn;
    child = spawn('nsenter', ['-t', '1', '-m', '-p', '-n', '--', '/bin/bash', '-l'], { name: 'xterm-256color', cols: width, rows: height, cwd: '/', env: process.env });
    child.onData((data) => onOutput(data));
    child.onExit(({ exitCode, signal }) => {
      try { if (recorder) { record('exit', { code: exitCode, signal }); finalizeRecorder(); } } catch { stop('recording-exit-failure'); }
      child = null; try { send({ type: 'exit', code: exitCode, signal }); } catch {} resetIdle();
    });
    resetIdle(); return true;
  }
  function stop(reason) {
    if (closed) return; closed = true; clearTimeout(detachedTimer); clearTimeout(idleTimer); clearTimeout(reconnectTimer);
    try { if (recorder) { record('stop', { reason }); finalizeRecorder(); } } catch {}
    try { child?.kill('SIGHUP'); } catch {} child = null; try { socket?.close(1000, String(reason).slice(0, 120)); } catch {}
  }
  function failClosed(reason) { try { send({ type: 'error', reason }); } catch {} stop(reason); }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer); if (!relayToken || now() >= expiresAt || closed) return;
    reconnectTimer = setTimeout(() => connect(relayToken), reconnectDelayMs); reconnectTimer.unref?.();
  }
  function connect(token) {
    if (closed || now() >= expiresAt) return;
    incomingSeq = 0;
    socket = new WebSocketImpl(relayUrl, { maxPayload: MAX_FRAME_BYTES });
    socket.on('open', () => { try { send({ role: 'appliance', sessionId, token }); } catch { failClosed('relay-auth-failure'); } });
    socket.on('message', (raw) => {
      if (closed || raw.length > MAX_FRAME_BYTES) return failClosed('oversized-frame');
      let message; try { message = JSON.parse(raw.toString('utf8')); } catch { return failClosed('invalid-control-frame'); }
      if (message.version !== SUPPORT_PROTOCOL_VERSION || (Number.isInteger(message.seq) && message.seq <= incomingSeq)) return failClosed('out-of-order-frame');
      if (Number.isInteger(message.seq)) incomingSeq = message.seq;
      try {
        if (message.type === 'ready') {
          if (message.reconnectToken) { relayToken = message.reconnectToken; writeReconnectToken(reconnectTokenFile, relayToken); }
          clearTimeout(detachedTimer); detachedTimer = null; send({ type: child ? 'reattached' : 'recorder-ready', sessionId });
        } else if (message.type === 'attach' || message.type === 'reattach') {
          const attached = launchShell(Number(message.width) || 120, Number(message.height) || 40); send({ type: attached ? 'attached' : 'shell-unavailable' });
        } else if (message.type === 'input') {
          if (!child || typeof message.data !== 'string') throw new Error('Shell is not attached.');
          const data = Buffer.from(message.data, 'base64'); if (!data.length || data.length > MAX_FRAME_BYTES) throw new Error('Input frame is too large.');
          record('input', { encoding: 'base64', data: data.toString('base64') }); child.write(data.toString('utf8')); checkpoint(); resetIdle();
        } else if (message.type === 'resize') {
          const width = Number(message.width); const height = Number(message.height);
          if (![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= 1000)) throw new Error('Invalid terminal size.');
          record('resize', { width, height }); child?.resize(width, height); checkpoint(); resetIdle();
        } else if (message.type === 'recording-receipt') {
          if (!lastFinalized || message.segmentId !== lastFinalized.segmentId) throw new Error('Recording receipt does not match a finalized segment.');
          writeAtomicJson(path.join(recordingDirectory(recordingDir, sessionId), `receipt-${message.segmentId}.json`), { schema: 1, sessionId, segmentId: message.segmentId, bytes: message.bytes, digest: message.digest, closedAt: message.closedAt, receipt: message });
        } else if (message.type === 'close') stop(message.reason || 'relay-closed');
      } catch { failClosed('recording-input-failure'); }
    });
    socket.on('close', () => {
      if (closed) return; clearTimeout(detachedTimer);
      if (child) { detachedTimer = setTimeout(() => { try { child?.kill('SIGHUP'); } catch {} child = null; try { finalizeRecorder(); } catch {} }, detachedGraceMs); detachedTimer.unref?.(); }
      scheduleReconnect();
    });
    socket.on('error', () => { if (!closed) scheduleReconnect(); });
  }
  return { start() { connect(readInitialToken(connectorTokenFile, reconnectTokenFile)); setTimeout(() => stop('session-expired'), Math.max(1, expiresAt - now())).unref?.(); }, stop, launchShell, getState: () => ({ closed, hasChild: Boolean(child), hasRecorder: Boolean(recorder), relayToken, quotaBytes: quota.bytes }) };
}

const sessionId = String(process.env.SUPPORT_SESSION_ID || '');
if (sessionId && process.env.SUPPORT_RELAY_URL) {
  const agent = createSupportAgent({ sessionId, relayUrl: String(process.env.SUPPORT_RELAY_URL), connectorTokenFile: process.env.SUPPORT_CONNECTOR_TOKEN_FILE || '/run/support-connector/connector-token', reconnectTokenFile: process.env.SUPPORT_RECONNECT_TOKEN_FILE || '/run/support-reconnect/token', recordingDir: process.env.SUPPORT_RECORDING_DIR || '/host/var/lib/alga-appliance/support-sessions/history', expiresAt: Date.parse(process.env.SUPPORT_EXPIRES_AT || ''), resumed: process.env.SUPPORT_RESUMED === '1' });
  process.on('SIGTERM', () => agent.stop('agent-terminated')); process.on('SIGINT', () => agent.stop('agent-interrupted')); agent.start();
}
