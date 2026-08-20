import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RECORDING_SCHEMA_VERSION = 1;
export const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
export const LOCAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_READ_BYTES = 128 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RecordingError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'RecordingError';
    this.code = code;
    this.status = status;
  }
}

export function validRecordingId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function recordingDirectory(root, sessionId) {
  if (!validRecordingId(sessionId)) throw new RecordingError('invalid_session_id', 'Support session ID is invalid.', 400);
  const base = path.resolve(root);
  const directory = path.resolve(base, sessionId);
  if (!directory.startsWith(`${base}${path.sep}`)) throw new RecordingError('invalid_recording_path', 'Recording path is invalid.', 400);
  return directory;
}

function secureMkdir(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function appendFsync(file, bytes) {
  const handle = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeSync(handle, bytes);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.chmodSync(file, 0o600);
}

export class RecordingSegment {
  constructor({ root, sessionId, segmentId = crypto.randomUUID(), width = 120, height = 40, now = () => new Date() }) {
    this.root = recordingDirectory(root, sessionId);
    this.sessionId = sessionId;
    this.segmentId = segmentId;
    this.now = now;
    if (!validRecordingId(segmentId)) throw new RecordingError('invalid_segment_id', 'Recording segment ID is invalid.', 400);
    secureMkdir(this.root);
    this.file = path.join(this.root, `segment-${segmentId}.cast`);
    this.digest = crypto.createHash('sha256');
    this.bytes = 0;
    this.sequence = 0;
    this.closed = false;
    const header = {
      schema: RECORDING_SCHEMA_VERSION,
      version: 2,
      sessionId,
      segmentId,
      width,
      height,
      timestamp: Math.floor(this.now().getTime() / 1000),
      events: 'input,output,resize,marker,exit',
    };
    this._appendRaw(`${JSON.stringify(header)}\n`);
  }

  _appendRaw(text) {
    const bytes = Buffer.from(text, 'utf8');
    if (this.bytes + bytes.length > MAX_RECORDING_BYTES) throw new RecordingError('recording_full', 'The local recording limit was reached.', 507);
    appendFsync(this.file, bytes);
    this.digest.update(bytes);
    this.bytes += bytes.length;
  }

  append(type, data = {}) {
    if (this.closed) throw new RecordingError('recording_closed', 'The recording segment is closed.', 409);
    if (!['input', 'output', 'resize', 'marker', 'exit', 'reconnect', 'reboot', 'stop'].includes(type)) {
      throw new RecordingError('invalid_recording_event', 'Recording event type is invalid.', 400);
    }
    const event = { schema: RECORDING_SCHEMA_VERSION, seq: this.sequence++, type, at: this.now().toISOString(), ...data };
    if (typeof event.data === 'string' && event.data.length > 0 && event.encoding !== 'base64') event.data = Buffer.from(event.data, 'utf8').toString('base64');
    this._appendRaw(`${JSON.stringify(event)}\n`);
    return event;
  }

  finalize({ receipt = null, previousDigest = null } = {}) {
    if (this.closed) throw new RecordingError('recording_closed', 'The recording segment is closed.', 409);
    this.closed = true;
    const digest = this.digest.digest('hex');
    const metadata = {
      schema: RECORDING_SCHEMA_VERSION,
      sessionId: this.sessionId,
      segmentId: this.segmentId,
      bytes: this.bytes,
      digest,
      previousDigest,
      closedAt: this.now().toISOString(),
      receipt: receipt ? { ...receipt } : null,
    };
    writeAtomicJson(path.join(this.root, `receipt-${this.segmentId}.json`), metadata);
    return metadata;
  }
}

export function writeAtomicJson(file, value) {
  const directory = path.dirname(file);
  secureMkdir(directory);
  const temp = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const handle = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeSync(handle, bytes);
    fs.fsyncSync(handle);
  } finally { fs.closeSync(handle); }
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
  try {
    const dirHandle = fs.openSync(directory, 'r');
    fs.fsyncSync(dirHandle);
    fs.closeSync(dirHandle);
  } catch { /* directory fsync is unavailable on some test filesystems */ }
}

export function verifyRecordingReceipt(metadata, receipt, publicKey) {
  if (!metadata || !receipt || typeof publicKey !== 'string' || !publicKey.trim()) return { valid: false, reason: 'receipt_unavailable' };
  if (metadata.sessionId !== receipt.sessionId || metadata.segmentId !== receipt.segmentId || metadata.bytes !== receipt.bytes || metadata.digest !== receipt.digest) {
    return { valid: false, reason: 'receipt_mismatch' };
  }
  const signed = JSON.stringify({ sessionId: receipt.sessionId, segmentId: receipt.segmentId, bytes: receipt.bytes, digest: receipt.digest, closedAt: receipt.closedAt, keyId: receipt.keyId });
  try {
    const valid = crypto.verify(null, Buffer.from(signed), publicKey, Buffer.from(String(receipt.signature || ''), 'base64url'));
    return { valid, reason: valid ? null : 'invalid_signature' };
  } catch { return { valid: false, reason: 'invalid_signature' }; }
}

export function readBoundedFile(file, maxBytes = MAX_READ_BYTES) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > maxBytes) throw new RecordingError('recording_too_large', 'Recording exceeds the bounded read limit.', 413);
  return fs.readFileSync(file);
}

export function listRecordingMetadata(root, sessionId) {
  const directory = recordingDirectory(root, sessionId);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => /^receipt-[0-9a-f-]+\.json$/i.test(name)).sort().slice(0, 256).map((name) => {
    try { return JSON.parse(readBoundedFile(path.join(directory, name), 64 * 1024)); } catch { return null; }
  }).filter(Boolean);
}

export function pruneRecordings(root, { nowMs = Date.now(), retentionMs = LOCAL_RETENTION_MS, activeSessionIds = [] } = {}) {
  const base = path.resolve(root);
  if (!fs.existsSync(base)) return { removed: 0 };
  let removed = 0;
  for (const id of fs.readdirSync(base)) {
    if (!validRecordingId(id)) continue;
    if (activeSessionIds.includes(id)) continue;
    const directory = recordingDirectory(base, id);
    const metadata = listRecordingMetadata(base, id);
    if (!metadata.length) continue;
    const newest = Math.max(...metadata.map((item) => Date.parse(item.closedAt || '')).filter(Number.isFinite));
    if (Number.isFinite(newest) && nowMs - newest >= retentionMs) {
      fs.rmSync(directory, { recursive: true, force: true });
      removed += 1;
    }
  }
  return { removed };
}

export const _private = { MAX_READ_BYTES, appendFsync };
