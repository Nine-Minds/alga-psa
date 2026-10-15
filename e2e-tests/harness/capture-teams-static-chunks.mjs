import { ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, writeSync, closeSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Opt-in diagnostic observer only. Never persist request query, cookies, auth
// headers or arbitrary bodies. Capture the exact layout chunk's wire bytes.
export function installTeamsStaticChunkCapture({ env = process.env, maxBytes = 24 * 1024 * 1024, maxResponses = 2 } = {}) {
  const directory = env.E2E_STATIC_CHUNK_DIAGNOSTICS_DIR;
  if (env.NODE_ENV !== 'development' || env.E2E_TEAMS_DEVELOPMENT !== 'true'
    || env.E2E_DATABASE_ISOLATED !== 'true' || typeof directory !== 'string' || !path.isAbsolute(directory)) return () => {};
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 24 * 1024 * 1024
    || !Number.isSafeInteger(maxResponses) || maxResponses < 1 || maxResponses > 2) return () => {};
  const originalWrite = ServerResponse.prototype.write, originalEnd = ServerResponse.prototype.end;
  const states = new WeakMap();
  let responses = 0;
  function state(response) {
    if (states.has(response)) return states.get(response);
    states.set(response, null);
    if (responses >= maxResponses || response.req?.url?.split('?')[0] !== '/_next/static/chunks/app/msp/layout.js') return null;
    responses++;
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const name = `layout-${randomUUID()}`;
      const fd = openSync(path.join(directory, `${name}.bin`), 'wx', 0o600);
      const value = { fd, name, hash: createHash('sha256'), bytes: 0, observedBytes: 0, truncated: false, failed: false, done: false };
      states.set(response, value);
      const finish = complete => {
        if (value.done) return;
        value.done = true;
        try { closeSync(fd); } catch { value.failed = true; }
        try {
          const header = key => { const v = response.getHeader(key); return typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 256) : null; };
          writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({ schemaVersion: 1,
            path: '/_next/static/chunks/app/msp/layout.js', status: response.statusCode,
            contentType: header('content-type'), contentEncoding: header('content-encoding'), contentLength: header('content-length'),
            bytes: value.bytes, observedBytes: value.observedBytes, complete, truncated: value.truncated,
            captureFailed: value.failed, sha256: value.hash.digest('hex') }) + '\n', { mode: 0o600, flag: 'wx' });
        } catch { /* Diagnostics cannot fail the application response. */ }
      };
      response.once('finish', () => finish(true));
      response.once('close', () => finish(response.writableFinished));
      return value;
    } catch { return null; }
  }
  function observe(response, chunk, encoding) {
    try {
      const value = state(response);
      if (!value || value.done || chunk == null || typeof chunk === 'function') return;
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined)
        : ArrayBuffer.isView(chunk) ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength) : null;
      if (!bytes) return;
      value.observedBytes += bytes.length;
      const part = bytes.subarray(0, Math.max(0, maxBytes - value.bytes));
      if (part.length < bytes.length) value.truncated = true;
      if (part.length && !value.failed) {
        let offset = 0;
        while (offset < part.length) {
          const written = writeSync(value.fd, part, offset, part.length - offset);
          if (written <= 0) throw new Error('Diagnostic write made no progress');
          offset += written;
        }
        value.hash.update(part); value.bytes += part.length;
      }
    } catch { const value = states.get(response); if (value) value.failed = true; }
  }
  function write(...args) { observe(this, args[0], args[1]); return Reflect.apply(originalWrite, this, args); }
  function end(...args) { observe(this, args[0], args[1]); return Reflect.apply(originalEnd, this, args); }
  ServerResponse.prototype.write = write;
  ServerResponse.prototype.end = end;
  return () => {
    if (ServerResponse.prototype.write === write) ServerResponse.prototype.write = originalWrite;
    if (ServerResponse.prototype.end === end) ServerResponse.prototype.end = originalEnd;
  };
}
installTeamsStaticChunkCapture();
