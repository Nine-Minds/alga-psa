#!/usr/bin/env node
/**
 * Live check of the resumable document upload API against a running stack: creates an upload
 * session on a ticket, sends a generated file in chunks (HEAD after each one), completes it and
 * prints the timings. Watch the server's memory while it runs (see the usage below).
 *
 *   node scripts/live-chunked-upload.mjs \
 *     --base http://feature-uploads-4-7-resumable-chunked-upload-session-api.localhost:3509 \
 *     --email qa@emeraldcity.oz --password 'NineMinds1234!' \
 *     --ticket <ticket-uuid> --size-mib 600
 *
 * Instead of --email/--password you may pass --api-key <key> (an MSP user's API key) or
 * --cookie '<name=value; ...>' copied from a signed-in browser.
 *
 * The provider limit is configuration: the stack's STORAGE_S3_MAX_FILE_SIZE (or
 * STORAGE_LOCAL_MAX_FILE_SIZE) must be at least the size sent. The default is 500 MiB, so 600 MiB
 * is refused with 413 at session creation until it is raised and the server restarted.
 */
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({
  options: {
    base: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    'api-key': { type: 'string' },
    cookie: { type: 'string' },
    ticket: { type: 'string' },
    'size-mib': { type: 'string', default: '600' },
    name: { type: 'string', default: 'live-upload.bin' },
  },
});
const MiB = 1024 * 1024;
if (!a.base || !a.ticket) {
  console.error('usage: --base <url> --ticket <uuid> (--email/--password | --api-key | --cookie) [--size-mib 600]');
  process.exit(2);
}
const base = a.base.replace(/\/$/, '');
const total = Number(a['size-mib']) * MiB;
const auth = {};

/** NextAuth credentials sign-in: csrf token, then the credentials callback; keeps the session cookie. */
async function signIn() {
  const jar = new Map();
  const remember = (res) => { for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); const [k, ...v] = pair.split('='); jar.set(k, v.join('=')); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  remember(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email: a.email, password: a.password, userType: 'internal', callbackUrl: `${base}/msp/dashboard`, json: 'true' }),
  });
  remember(res);
  if (!/session-token/.test(cookie())) throw new Error(`sign-in did not produce a session (HTTP ${res.status}); pass --cookie or --api-key instead`);
  return cookie();
}

if (a['api-key']) auth['x-api-key'] = a['api-key'];
else if (a.cookie) auth.cookie = a.cookie;
else if (a.email && a.password) auth.cookie = await signIn();
else { console.error('provide --email/--password, --api-key or --cookie'); process.exit(2); }

const call = async (method, path, init = {}) => {
  const res = await fetch(`${base}${path}`, { method, ...init, headers: { ...auth, ...init.headers } });
  return res;
};
const fail = async (what, res) => { throw new Error(`${what}: HTTP ${res.status} ${await res.text()}`); };

const created = await call('POST', '/api/documents/uploads', {
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fileName: a.name, mimeType: 'application/octet-stream', size: total, entityType: 'ticket', entityId: a.ticket }),
});
if (created.status !== 201) await fail('create', created);
const { sessionId, chunkSize, maxFileSize } = await created.json();
console.log(`session ${sessionId}: chunk ${chunkSize / MiB} MiB, server limit ${maxFileSize / MiB} MiB`);

const block = Buffer.alloc(chunkSize);
for (let i = 0; i < block.length; i++) block[i] = i & 255;
const started = Date.now();
let offset = 0;
while (offset < total) {
  const length = Math.min(chunkSize, total - offset);
  const res = await call('PUT', `/api/documents/uploads/${sessionId}`, {
    headers: { 'content-range': `bytes ${offset}-${offset + length - 1}/${total}`, 'content-type': 'application/octet-stream' },
    body: length === block.length ? block : block.subarray(0, length),
  });
  if (res.status !== 200) await fail(`chunk at ${offset}`, res);
  offset += length;
  const head = await call('HEAD', `/api/documents/uploads/${sessionId}`);
  if (head.headers.get('upload-offset') !== String(offset)) throw new Error(`HEAD offset ${head.headers.get('upload-offset')} != ${offset}`);
  if ((offset / chunkSize) % 10 === 0 || offset === total) console.log(`  ${(offset / MiB).toFixed(0)} / ${(total / MiB).toFixed(0)} MiB`);
}
const done = await call('POST', `/api/documents/uploads/${sessionId}/complete`);
if (done.status !== 200) await fail('complete', done);
const { document } = await done.json();
console.log(`complete in ${((Date.now() - started) / 1000).toFixed(1)}s: document ${document.document_id} (${document.file_size} bytes)`);
