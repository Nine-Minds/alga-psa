import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import { listRecordingMetadata, RecordingSegment, recordingDirectory, SUPPORT_RECORDING_OWNER_GID, SUPPORT_RECORDING_OWNER_UID, writeAtomicJson } from '../host-service/support-recordings.mjs';
import { decodeControlFrame, decodeTerminalFrame, encodeControlFrame, encodeTerminalFrame, MAX_FRAME_BYTES, SUPPORT_PROTOCOL_VERSION } from './protocol.mjs';

const require = createRequire(import.meta.url);

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
  // The memory-backed token is the only restart-safe authority. The projected
  // Secret can remain visible after the host has consumed/deleted it.
  if (fs.existsSync(reconnectFile)) return { token: boundedToken(reconnectFile, false), reconnect: true };
  if (fs.existsSync(connectorFile)) return { token: boundedToken(connectorFile, true), reconnect: false };
  throw new Error('No support connector or reconnect token is available.');
}

function existingRecordingState(recordingDir, sessionId) {
  const directory = recordingDirectory(recordingDir, sessionId);
  if (!fs.existsSync(directory)) return { bytes: 0, previousDigest: null };
  const bytes = fs.readdirSync(directory).filter((name) => /^segment-[0-9a-f-]+\.cast$/i.test(name)).reduce((sum, name) => {
    const stat = fs.statSync(path.join(directory, name));
    if (!stat.isFile() || stat.size > 100 * 1024 * 1024 || sum + stat.size > 100 * 1024 * 1024) throw new Error('The local recording limit was already exceeded.');
    return sum + stat.size;
  }, 0);
  const metadata = listRecordingMetadata(recordingDir, sessionId).sort((a, b) => String(a.closedAt).localeCompare(String(b.closedAt)));
  const metadataIds = new Set(metadata.map((item) => item.segmentId));
  for (const name of fs.readdirSync(directory).filter((item) => /^segment-[0-9a-f-]+\.cast$/i.test(item))) {
    const segmentId = name.slice('segment-'.length, -'.cast'.length);
    if (!metadataIds.has(segmentId)) throw new Error('A previous recording segment was not durably finalized.');
  }
  return { bytes, previousDigest: metadata.at(-1)?.digest || null, metadata };
}

function protocolFailureReason(error, isBinary) {
  const message = String(error?.message || '');
  if (message.includes('sequence')) return 'invalid-frame-sequence';
  if (message.includes('version')) return 'invalid-frame-version';
  return isBinary ? 'invalid-terminal-frame' : 'invalid-control-frame';
}

export function createSupportAgent({ sessionId, relayUrl, connectorTokenFile, reconnectTokenFile, recordingDir, expiresAt, resumed = false, WebSocketImpl = WebSocket, ptySpawn = null, now = () => Date.now(), detachedGraceMs = DETACHED_GRACE_MS, reconnectDelayMs = 1000, idleTimeoutMs = IDLE_TIMEOUT_MS, recordingOwnerUid = SUPPORT_RECORDING_OWNER_UID, recordingOwnerGid = SUPPORT_RECORDING_OWNER_GID } = {}) {
  if (!sessionId || !relayUrl || !Number.isFinite(expiresAt)) throw new Error('Support agent configuration is incomplete.');
  const existing = existingRecordingState(recordingDir, sessionId);
  const quota = { bytes: existing.bytes, limit: 100 * 1024 * 1024 };
  let socket = null; let child = null; let recorder = null; let detachedTimer = null; let idleTimer = null; let reconnectTimer = null;
  let relayToken = null; let closed = false; let outgoingSeq = 0; let incomingSeq = 0; let lastCheckpointBytes = 0; let previousDigest = existing.previousDigest; let stopReason = null; let reconnectAttempts = 0; let pendingResumeMarker = resumed;
  const pendingFinalized = new Map();
  const finalizedSegments = new Map();

  for (const metadata of existing.metadata || []) {
    finalizedSegments.set(metadata.segmentId, metadata);
    if (!metadata.receipt) {
      pendingFinalized.set(metadata.segmentId, {
        segmentId: metadata.segmentId,
        checkpointFrame: null,
        finalizeFrame: {
          type: 'recording-finalize',
          segmentId: metadata.segmentId,
          bytes: metadata.bytes,
          digest: metadata.digest,
          previousDigest: metadata.previousDigest || null,
          closedAt: metadata.closedAt,
        },
      });
    }
  }

  function send(message) {
    if (!socket || socket.readyState !== WebSocketImpl.OPEN) return false;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) throw new Error('Support relay backpressure limit exceeded.');
    socket.send(encodeControlFrame(message, ++outgoingSeq), { binary: false }); return true;
  }
  function sendTerminal(type, data) {
    if (!socket || socket.readyState !== WebSocketImpl.OPEN) return false;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) throw new Error('Support relay backpressure limit exceeded.');
    socket.send(encodeTerminalFrame({ type, seq: ++outgoingSeq, data })); return true;
  }
  function sendControl(message, { failOnBackpressure = false } = {}) {
    try { return send(message); } catch (error) {
      if (failOnBackpressure && error?.message === 'Support relay backpressure limit exceeded.') failClosed('relay-backpressure');
      throw error;
    }
  }
  function flushPending() {
    // Receipt is the acknowledgement. Re-send the latest checkpoint and final
    // metadata on every authenticated connection until that receipt arrives;
    // a successful socket.send alone does not prove the central side committed it.
    for (const checkpoint of pendingFinalized.values()) if (checkpoint.checkpointFrame) sendControl(checkpoint.checkpointFrame, { failOnBackpressure: true });
    for (const pending of pendingFinalized.values()) {
      if (pending.finalizeFrame) sendControl(pending.finalizeFrame, { failOnBackpressure: true });
    }
  }
  function checkpoint(force = false) {
    if (!recorder || (!force && recorder.bytes - lastCheckpointBytes < 64 * 1024)) return;
    lastCheckpointBytes = recorder.bytes;
    const frame = { type: 'recording-checkpoint', segmentId: recorder.segmentId, bytes: recorder.bytes, digest: recorder.digest.copy().digest('hex') };
    const pending = pendingFinalized.get(recorder.segmentId) || { segmentId: recorder.segmentId, checkpointFrame: null, finalizeFrame: null };
    pending.checkpointFrame = frame; pendingFinalized.set(recorder.segmentId, pending);
    try { sendControl(frame, { failOnBackpressure: true }); } catch { /* queued for reconnect unless backpressure closed the session */ }
  }
  function finalizeRecorder() {
    if (!recorder || recorder.closed) return null;
    const metadata = recorder.finalize({ previousDigest });
    previousDigest = metadata.digest;
    finalizedSegments.set(metadata.segmentId, metadata);
    const pending = pendingFinalized.get(metadata.segmentId) || { segmentId: metadata.segmentId, checkpointFrame: null, finalizeFrame: null };
    pending.finalizeFrame = { type: 'recording-finalize', segmentId: metadata.segmentId, bytes: metadata.bytes, digest: metadata.digest, previousDigest: metadata.previousDigest, closedAt: metadata.closedAt };
    pendingFinalized.set(metadata.segmentId, pending);
    recorder = null; lastCheckpointBytes = 0;
    try { sendControl(pending.finalizeFrame, { failOnBackpressure: true }); } catch {}
    return metadata;
  }
  function clearIdle() { clearTimeout(idleTimer); idleTimer = null; }
  function resetIdle() {
    if (!child || closed) return clearIdle();
    clearIdle(); idleTimer = setTimeout(() => closeShell('idle-timeout'), idleTimeoutMs); idleTimer.unref?.();
  }
  function record(type, data = {}) { if (!recorder) throw new Error('Recorder is not ready.'); return recorder.append(type, data); }
  function onOutput(data, stream) {
    if (!recorder) return;
    try {
      const encoded = Buffer.from(data, 'utf8').toString('base64');
      record('output', { ...(stream ? { stream } : {}), encoding: 'base64', data: encoded }); checkpoint();
      try { sendTerminal('output', Buffer.from(data, 'utf8')); }
      catch (error) { failClosed(error?.message === 'Support relay backpressure limit exceeded.' ? 'relay-backpressure' : 'relay-send-failure'); }
      resetIdle();
    } catch { stop('recording-output-failure'); }
  }
  function launchShell(width = 120, height = 40) {
    if (child || closed || now() >= expiresAt) return false;
    if (![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= 1000)) throw new Error('Invalid terminal size.');
    recorder = new RecordingSegment({ root: recordingDir, sessionId, width, height, quota, ownerUid: recordingOwnerUid, ownerGid: recordingOwnerGid });
    if (pendingResumeMarker) { record('reboot', { marker: 'control-plane-resume' }); pendingResumeMarker = false; }
    record('marker', { marker: 'shell-start' });
    const spawn = ptySpawn || require('node-pty').spawn;
    child = spawn('nsenter', ['-t', '1', '-m', '-p', '-n', '--', '/usr/bin/chroot', '/proc/1/root', '/bin/bash', '-l'], { name: 'xterm-256color', cols: width, rows: height, cwd: '/', env: process.env });
    child.onData((data) => onOutput(data));
    child.onExit(({ exitCode, signal }) => {
      try { if (recorder) { record('exit', { code: exitCode, signal }); finalizeRecorder(); } } catch { stop('recording-exit-failure'); }
      child = null; clearIdle(); try { send({ type: 'exit', code: exitCode, signal }); } catch {}
    });
    resetIdle(); return true;
  }
  function closeShell(reason) {
    clearIdle();
    const current = child;
    child = null;
    let recordingFailure = false;
    try { if (recorder) { record('stop', { reason }); finalizeRecorder(); } } catch { recordingFailure = true; recorder = null; }
    try { current?.kill('SIGHUP'); } catch {}
    if (recordingFailure && !closed) return failClosed('recording-finalization-failure');
    try { send({ type: 'shell-closed', reason }); } catch {}
  }
  function beginDetachedGrace(reason = 'operator-detached') {
    clearTimeout(detachedTimer);
    if (!child) return;
    try { record('reconnect', { marker: reason }); checkpoint(true); } catch { return failClosed('recording-detach-failure'); }
    detachedTimer = setTimeout(() => closeShell('operator-detached-timeout'), detachedGraceMs);
    detachedTimer.unref?.();
  }
  function stop(reason) {
    if (closed) return; closed = true; stopReason = reason; clearTimeout(detachedTimer); clearTimeout(reconnectTimer); closeShell(reason); try { socket?.close(1000, String(reason).slice(0, 120)); } catch {}
  }
  function failClosed(reason) { try { send({ type: 'error', reason }); } catch {} stop(reason); }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer); if (!relayToken || now() >= expiresAt || closed) return;
    const delay = Math.min(30_000, reconnectDelayMs * 2 ** Math.min(reconnectAttempts++, 8));
    reconnectTimer = setTimeout(() => connect(relayToken), delay); reconnectTimer.unref?.();
  }
  function connect(token) {
    if (closed || now() >= expiresAt) return;
    incomingSeq = 0;
    const connection = new WebSocketImpl(relayUrl, { maxPayload: MAX_FRAME_BYTES });
    socket = connection;
    connection.on('open', () => { if (socket !== connection) return; try { send({ type: 'authenticate', role: 'appliance', sessionId, token }); } catch { failClosed('relay-auth-failure'); } });
    connection.on('message', (raw, isBinary = false) => {
      if (closed || socket !== connection || raw.length > MAX_FRAME_BYTES) return failClosed('oversized-frame');
      let message;
      try { message = isBinary ? decodeTerminalFrame(raw) : decodeControlFrame(raw); } catch (error) { return failClosed(protocolFailureReason(error, isBinary)); }
      if (message.seq <= incomingSeq) return failClosed('out-of-order-frame');
      incomingSeq = message.seq;
      try {
        if (isBinary) {
          if (message.type !== 'input' || !child) throw new Error('Shell is not attached.');
          record('input', { encoding: 'base64', data: message.data.toString('base64') });
          child.write(message.data.toString('utf8')); checkpoint(); resetIdle();
        } else if (message.type === 'ready') {
          if (message.reconnectToken !== undefined) {
            try { writeReconnectToken(reconnectTokenFile, message.reconnectToken); relayToken = message.reconnectToken; }
            catch { return failClosed('invalid-reconnect-token'); }
          }
          if (!relayToken) return failClosed('missing-reconnect-token');
          reconnectAttempts = 0;
          if (child) { record('reconnect', { marker: 'relay-reattached' }); checkpoint(true); }
          send({ type: child ? 'reattached' : 'recorder-ready', sessionId }); flushPending();
        } else if (message.type === 'attach') {
          const attached = launchShell(Number(message.width) || 120, Number(message.height) || 40); send({ type: attached ? 'attached' : 'shell-unavailable' });
        } else if (message.type === 'reattach') {
          if (!child) { send({ type: 'shell-unavailable' }); }
          else { clearTimeout(detachedTimer); detachedTimer = null; record('reconnect', { marker: 'operator-reattached' }); checkpoint(true); send({ type: 'reattached' }); resetIdle(); }
        } else if (message.type === 'detach') {
          beginDetachedGrace('operator-detached'); send({ type: 'detached' });
        } else if (message.type === 'resize') {
          const width = Number(message.width); const height = Number(message.height);
          if (![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= 1000)) throw new Error('Invalid terminal size.');
          record('resize', { width, height }); child?.resize(width, height); checkpoint(); resetIdle();
        } else if (message.type === 'signal') {
          if (!child || !['SIGINT', 'SIGTERM', 'SIGHUP'].includes(message.signal)) throw new Error('Invalid terminal signal.');
          record('marker', { marker: 'signal', signal: message.signal }); child.kill(message.signal); checkpoint(); resetIdle();
        } else if (message.type === 'heartbeat') {
          send({ type: 'heartbeat', at: new Date(now()).toISOString() });
        } else if (message.type === 'recording-receipt') {
          const finalized = finalizedSegments.get(message.segmentId);
          if (!finalized || finalized.bytes !== message.bytes || finalized.digest !== message.digest || finalized.closedAt !== message.closedAt) throw new Error('Recording receipt does not match a finalized segment.');
          writeAtomicJson(path.join(recordingDirectory(recordingDir, sessionId), `receipt-${message.segmentId}.json`), { schema: 1, sessionId, segmentId: message.segmentId, bytes: message.bytes, digest: message.digest, closedAt: message.closedAt, previousDigest: finalized.previousDigest, receipt: message }, { ownerUid: recordingOwnerUid, ownerGid: recordingOwnerGid });
          pendingFinalized.delete(message.segmentId);
        } else if (message.type === 'close') stop(message.reason || 'relay-closed');
      } catch { failClosed('recording-input-failure'); }
    });
    connection.on('close', () => {
      if (closed || socket !== connection) return;
      beginDetachedGrace('relay-disconnected');
      scheduleReconnect();
    });
    connection.on('error', () => { if (!closed && socket === connection) scheduleReconnect(); });
  }
  return {
    start() {
      const initial = readInitialToken(connectorTokenFile, reconnectTokenFile);
      if (initial.reconnect) relayToken = initial.token;
      connect(initial.token);
      setTimeout(() => stop('session-expired'), Math.max(1, expiresAt - now())).unref?.();
    },
    stop,
    launchShell,
    getState: () => ({ closed, hasChild: Boolean(child), hasRecorder: Boolean(recorder), relayToken, quotaBytes: quota.bytes, stopReason, pendingFinalized: pendingFinalized.size }),
  };
}

const sessionId = String(process.env.SUPPORT_SESSION_ID || '');
if (sessionId && process.env.SUPPORT_RELAY_URL) {
  const agent = createSupportAgent({ sessionId, relayUrl: String(process.env.SUPPORT_RELAY_URL), connectorTokenFile: process.env.SUPPORT_CONNECTOR_TOKEN_FILE || '/run/support-connector/connector-token', reconnectTokenFile: process.env.SUPPORT_RECONNECT_TOKEN_FILE || '/run/support-reconnect/token', recordingDir: process.env.SUPPORT_RECORDING_DIR || '/host/var/lib/alga-appliance/support-sessions/history', expiresAt: Date.parse(process.env.SUPPORT_EXPIRES_AT || ''), resumed: process.env.SUPPORT_RESUMED === '1', recordingOwnerUid: Number(process.env.SUPPORT_RECORDING_OWNER_UID || SUPPORT_RECORDING_OWNER_UID), recordingOwnerGid: Number(process.env.SUPPORT_RECORDING_OWNER_GID || SUPPORT_RECORDING_OWNER_GID) });
  process.on('SIGTERM', () => agent.stop('agent-terminated')); process.on('SIGINT', () => agent.stop('agent-interrupted')); agent.start();
}
