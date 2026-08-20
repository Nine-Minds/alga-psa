import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { RecordingSegment, writeAtomicJson } from './support-recordings.mjs';

const sessionId = String(process.env.SUPPORT_SESSION_ID || '');
const relayUrl = String(process.env.SUPPORT_RELAY_URL || '');
const connectorTokenFile = process.env.SUPPORT_CONNECTOR_TOKEN_FILE || '/run/support-connector/connector-token';
const reconnectTokenFile = process.env.SUPPORT_RECONNECT_TOKEN_FILE || '/run/support-reconnect/token';
const recordingDir = process.env.SUPPORT_RECORDING_DIR || '/host/var/lib/alga-appliance/support-sessions/history';
const expiresAt = Date.parse(process.env.SUPPORT_EXPIRES_AT || '');
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_BUFFERED_BYTES = 256 * 1024;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DETACHED_GRACE_MS = 2 * 60 * 1000;

if (!sessionId || !relayUrl || !Number.isFinite(expiresAt)) throw new Error('Support agent configuration is incomplete.');

function readAndConsume(file) {
  const token = fs.readFileSync(file, 'utf8').trim();
  if (token.length < 16 || token.length > 4096) throw new Error('Support connector token is invalid.');
  try { fs.rmSync(file, { force: true }); } catch { /* Secret volumes are read-only; the host removes the Secret after readiness. */ }
  return token;
}

function send(ws, message) {
  const bytes = Buffer.byteLength(JSON.stringify(message));
  if (bytes > MAX_FRAME_BYTES) throw new Error('Support control frame exceeds the bounded size.');
  if (ws.readyState !== WebSocket.OPEN) throw new Error('Support relay is not connected.');
  if (ws.bufferedAmount > MAX_BUFFERED_BYTES) throw new Error('Support relay backpressure limit exceeded.');
  ws.send(JSON.stringify(message));
}

let socket;
let child;
let recorder;
let detachedTimer;
let idleTimer;
let reconnectTimer;
let relayToken;
let closed = false;
let lastCheckpointBytes = 0;

function checkpoint(force = false) {
  if (!recorder || (!force && recorder.bytes - lastCheckpointBytes < 64 * 1024)) return;
  lastCheckpointBytes = recorder.bytes;
  send(socket, { version: 1, type: 'recording-checkpoint', segmentId: recorder.segmentId, bytes: recorder.bytes, digest: recorder.digest.copy().digest('hex') });
}

function finalizeRecorder() {
  if (!recorder || recorder.closed) return null;
  const metadata = recorder.finalize();
  try { send(socket, { version: 1, type: 'recording-finalize', segmentId: metadata.segmentId, bytes: metadata.bytes, digest: metadata.digest, closedAt: metadata.closedAt }); } catch { /* relay may already be down */ }
  return metadata;
}

function stop(reason) {
  if (closed) return;
  closed = true;
  clearTimeout(detachedTimer);
  clearTimeout(idleTimer);
  clearTimeout(reconnectTimer);
  try { recorder?.append('stop', { reason }); finalizeRecorder(); } catch { /* fail closed below */ }
  try { child?.kill('SIGHUP'); } catch {}
  try { socket?.close(1000, String(reason).slice(0, 120)); } catch {}
}

function failClosed(reason) {
  try { send(socket, { version: 1, type: 'error', reason }); } catch {}
  stop(reason);
}

function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => failClosed('idle-timeout'), IDLE_TIMEOUT_MS);
  idleTimer.unref?.();
}

function record(type, data) {
  if (!recorder) throw new Error('Recorder is not ready.');
  recorder.append(type, data);
}

function launchShell(width = 120, height = 40) {
  if (child) return;
  recorder = new RecordingSegment({ root: recordingDir, sessionId, width, height });
  if (process.env.SUPPORT_RESUMED === '1') record('reboot', { marker: 'control-plane-resume' });
  record('marker', { marker: 'shell-start' });
  // The privileged pod has host PID/mount/network namespaces. nsenter reaches
  // the host init namespaces, while script supplies a real PTY to the shell.
  child = spawn('nsenter', ['-t', '1', '-m', '-p', '-n', '--', 'script', '-qfec', '/bin/bash -l', '/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { try { record('output', { encoding: 'base64', data: chunk.toString('base64') }); checkpoint(); send(socket, { version: 1, type: 'output', data: chunk.toString('base64') }); resetIdle(); } catch { failClosed('recording-output-failure'); } });
  child.stderr.on('data', (chunk) => { try { record('output', { stream: 'stderr', encoding: 'base64', data: chunk.toString('base64') }); checkpoint(); send(socket, { version: 1, type: 'output', stream: 'stderr', data: chunk.toString('base64') }); resetIdle(); } catch { failClosed('recording-output-failure'); } });
  child.on('exit', (code, signal) => { try { record('exit', { code, signal }); finalizeRecorder(); } catch { failClosed('recording-exit-failure'); } try { send(socket, { version: 1, type: 'exit', code, signal }); } catch {} });
  resetIdle();
}

function connect(token) {
  socket = new WebSocket(relayUrl, { maxPayload: MAX_FRAME_BYTES });
  socket.on('open', () => { try { send(socket, { version: 1, role: 'appliance', sessionId, token }); } catch { failClosed('relay-auth-failure'); } });
  socket.on('message', (raw) => {
    if (closed || raw.length > MAX_FRAME_BYTES) return failClosed('oversized-frame');
    let message;
    try { message = JSON.parse(raw.toString('utf8')); } catch { return failClosed('invalid-control-frame'); }
    try {
      if (message.type === 'ready') {
        if (message.reconnectToken) { relayToken = message.reconnectToken; fs.mkdirSync(path.dirname(reconnectTokenFile), { recursive: true, mode: 0o700 }); fs.writeFileSync(reconnectTokenFile, `${message.reconnectToken}\n`, { mode: 0o600 }); }
        send(socket, { version: 1, type: 'recorder-ready', sessionId });
      } else if (message.type === 'attach') {
        launchShell(Number(message.width) || 120, Number(message.height) || 40);
        send(socket, { version: 1, type: 'attached' });
      } else if (message.type === 'input') {
        if (!child || typeof message.data !== 'string') throw new Error('Shell is not attached.');
        const data = Buffer.from(message.data, 'base64');
        if (data.length > MAX_FRAME_BYTES) throw new Error('Input frame is too large.');
        record('input', { encoding: 'base64', data: data.toString('base64') });
        if (!child.stdin.write(data)) throw new Error('Support shell input backpressure limit exceeded.');
        checkpoint();
        resetIdle();
      } else if (message.type === 'resize') {
        record('resize', { width: Number(message.width), height: Number(message.height) }); checkpoint(); resetIdle();
      } else if (message.type === 'recording-receipt') {
        if (!recorder || typeof message.segmentId !== 'string' || message.segmentId !== recorder.segmentId) throw new Error('Recording receipt does not match the active segment.');
        writeAtomicJson(`${recordingDir}/receipt-${message.segmentId}.json`, { schema: 1, sessionId, segmentId: message.segmentId, bytes: message.bytes, digest: message.digest, closedAt: message.closedAt, receipt: message });
      } else if (message.type === 'close') stop(message.reason || 'relay-closed');
    } catch { failClosed('recording-input-failure'); }
  });
  socket.on('close', () => {
    if (!closed && child) {
      clearTimeout(detachedTimer);
      detachedTimer = setTimeout(() => stop('operator-detached-timeout'), DETACHED_GRACE_MS);
      detachedTimer.unref?.();
      if (relayToken && Date.now() < expiresAt) {
        reconnectTimer = setTimeout(() => connect(relayToken), 1000);
        reconnectTimer.unref?.();
      }
    }
  });
  socket.on('error', () => { if (!closed && !child) failClosed('relay-error'); });
}

process.on('SIGTERM', () => stop('agent-terminated'));
process.on('SIGINT', () => stop('agent-interrupted'));

connect(readAndConsume(connectorTokenFile));
setTimeout(() => stop('session-expired'), Math.max(1, expiresAt - Date.now())).unref?.();
