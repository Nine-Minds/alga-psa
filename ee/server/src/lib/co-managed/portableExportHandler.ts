import { getSession, getApiKeyUserOverride } from '@alga-psa/auth';
import { getConnection } from '@alga-psa/db';
import { CoManagedSharedWorkError } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import { prepareCoManagedPortableWorkspaceExport } from './portableWorkspaceExport';

const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "sandbox; default-src 'none'" };

async function readPassphrase(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid request');
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 4096) throw new Error('Invalid request'); parts.push(part.value);
    }
    const bytes = Buffer.concat(parts), type = request.headers.get('content-type')?.split(';')[0].trim();
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      let value: unknown;
      if (type === 'application/json') {
        const body = JSON.parse(text);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'passphrase')) throw new Error('Invalid request');
        value = body.passphrase;
      } else if (type === 'application/x-www-form-urlencoded') {
        const body = new URLSearchParams(text), entries = [...body.entries()];
        if (entries.length !== 1 || entries[0][0] !== 'passphrase') throw new Error('Invalid request'); value = entries[0][1];
      } else throw new Error('Invalid request');
      if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 16 || Buffer.byteLength(value, 'utf8') > 1024) throw new Error('Invalid request');
      return value;
    } finally { bytes.fill(0); }
  } finally { for (const part of parts) part.fill(0); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Browser session export. The passphrase exists only in this request and the
 * awaited preparation; never in query strings, jobs or persisted records.
 * Native form navigation streams the file without a browser-sized Blob. */
export async function handleCoManagedPortableExport(request: Request): Promise<Response> {
  const failure = (status: number, code: string) => Response.json({ error: code }, { status, headers });
  let prepared: Awaited<ReturnType<typeof prepareCoManagedPortableWorkspaceExport>> | undefined;
  let download: Awaited<ReturnType<NonNullable<typeof prepared>['acquireDownload']>> | undefined;
  try {
    const origin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    const expectedOrigin = new URL(process.env.NEXTAUTH_URL || request.url).origin;
    // This screen's own form submits with target="_blank" rel="noopener" (so the
    // download tab can never reach window.opener). That makes the browser send
    // Origin: null for the otherwise same-origin navigation, so an Origin-equality
    // check alone rejects the legitimate export. Sec-Fetch-Site is set by the
    // browser and unforgeable by a cross-site page, so it is the authoritative
    // same-origin signal here: a present, non-null Origin must still match exactly,
    // but a null/absent Origin is accepted only when Sec-Fetch-Site proves the
    // request originated same-origin (or from a direct user navigation). A
    // cross-site request is always refused.
    const originAcceptable = origin && origin !== 'null'
      ? origin === expectedOrigin
      : site === 'same-origin' || site === 'none';
    if (!originAcceptable || site === 'cross-site') return failure(403, 'Export requires a same-origin request.');
    const session = await getSession();
    if (getApiKeyUserOverride() || !session?.session_id || session.user?.user_type !== 'internal' || !session.user.tenant || !session.user.id)
      return failure(401, 'Sign in to your customer workspace to export.');
    let passphrase: string;
    try { passphrase = await readPassphrase(request); } catch { return failure(400, 'Use a recovery passphrase between 16 and 1024 UTF-8 bytes.'); }
    try {
      prepared = await prepareCoManagedPortableWorkspaceExport(await getConnection(session.user.tenant),
        { kind: 'session', tenant: session.user.tenant, userId: session.user.id, sessionId: session.session_id }, passphrase, { signal: request.signal });
    } finally { passphrase = ''; }
    download = await prepared.acquireDownload(request.signal);
    return new Response(download.stream, { headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(download.size),
      'Content-Disposition': `attachment; filename="alga-workspace-${download.packageId}.alga-backup"` } });
  } catch (error) {
    await download?.dispose(); await prepared?.dispose();
    return failure(error instanceof CoManagedSharedWorkError ? 403 : 503,
      error instanceof CoManagedSharedWorkError ? 'Export access or workspace content changed. Refresh your workspace and try again.' : 'The backup could not be prepared. Try again from your workspace.');
  }
}
