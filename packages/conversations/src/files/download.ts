import type { Knex } from 'knex';
import { isConversationFileError } from './errors';
import { readConversationFile } from './read';
import type { ConversationFileActor, ConversationFileStorage } from './types';

export interface ConversationFileDownloadDeps {
  /** The capability route guard, supplied by the mounting card. Returns a Response (the 404) to
   * stop the request, or null to continue. It runs FIRST: a closed capability costs no query. */
  guard: (request: Request) => Promise<Response | null> | Response | null;
  /** Session → internal-user actor, or null. No API-key override. */
  resolveActor: (request: Request) => Promise<ConversationFileActor | null>;
  getDb: () => Promise<Knex>;
  storage: (tenant: string) => ConversationFileStorage;
}
export interface ConversationFileDownloadContext { params: Promise<{ fileId: string }> | { fileId: string } }

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store, private' } });

// LEVERAGE: pattern conversation-file-engine — copy of the hardened download headers in server/src/lib/co-managed/attachmentResponse.ts (a package cannot import server/); converge when co-managed attachments move onto this engine.
export function conversationFileResponseHeaders(fileName: string, size: number): Record<string, string> {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\;]/g, '_');
  return {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(size),
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
}

/** Returns a GET handler. Order: guard, session, owner `canRead` + published-or-own-pending
 * (inside readConversationFile), verified bytes. Any denial is 404; storage failure is 503. */
export function createConversationFileDownloadHandler(deps: ConversationFileDownloadDeps) {
  return async function GET(request: Request, context: ConversationFileDownloadContext): Promise<Response> {
    const closed = await deps.guard(request);
    if (closed) return closed;
    const actor = await deps.resolveActor(request);
    if (!actor) return notFound();
    const { fileId } = await context.params;
    try {
      const { file, content } = await readConversationFile(await deps.getDb(), actor, fileId, deps.storage(actor.tenant));
      return new Response(Buffer.from(content), { status: 200, headers: conversationFileResponseHeaders(file.fileName, content.length) });
    } catch (error) {
      if (isConversationFileError(error)) return error.code === 'FILE_CONTENT_MISMATCH' ? new Response('Unavailable', { status: 503, headers: { 'Cache-Control': 'no-store, private' } }) : notFound();
      return new Response('Unavailable', { status: 503, headers: { 'Cache-Control': 'no-store, private' } });
    }
  };
}
