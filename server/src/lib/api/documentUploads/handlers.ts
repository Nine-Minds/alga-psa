/**
 * HTTP handlers for resumable document uploads (`/api/documents/uploads`). The route files are
 * thin wrappers so tests can drive these directly with a Request.
 *
 * Authentication follows the other `app/api/documents/*` routes: a browser session, or an API key
 * resolved to an API principal. Middleware lets these paths through to here (see
 * `shouldSkipApiKeyAuth`), so every handler authenticates itself. The tenant comes from the
 * authenticated principal, never from the request.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Knex } from 'knex';
import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import type { IUser } from '@alga-psa/types';
import { AuthenticationError, withAuth } from '@alga-psa/auth';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { buildAuthenticatedApiContext } from '@/lib/api/middleware/apiMiddleware';
import { coManagedWorkspaceDenial } from '@/lib/api/coManagedWorkspaceDenial';
import {
  UploadSessionError,
  abortUploadSession,
  completeUploadSession,
  createUploadSession,
  findUploadSession,
  receiveChunk,
} from '@alga-psa/documents/lib/documentUploadSessions';

interface Authenticated {
  tenant: string;
  user: IUser;
  knex: Knex;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
  details: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: { code, message, ...details } }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/**
 * A browser session, else an API key. Both resolve through the authentication boundary
 * (`withAuth` from @alga-psa/auth, `buildAuthenticatedApiContext` in the API middleware), the same
 * primitives every other session/API-key route uses, so a revoked session or a non-interactive key
 * is refused exactly as elsewhere.
 */
// LEVERAGE: pattern session-or-api-key-principal — documents/[documentId]/content and the other dual-auth routes each re-derive 'session user, else x-api-key principal'; a single resolver beside buildAuthenticatedApiContext would serve them all.
async function resolvePrincipal(request: NextRequest): Promise<{ tenant: string; user: IUser } | null> {
  try {
    const fromSession = await withAuth(async (user, { tenant }) => ({ user: user as unknown as IUser, tenant }))();
    if (fromSession.tenant) return fromSession;
  } catch (error) {
    if (!(error instanceof AuthenticationError)) throw error;
  }

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) return null;
  const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
  if (!keyRecord?.tenant) return null;
  try {
    const context = await buildAuthenticatedApiContext(keyRecord, request);
    return { tenant: context.tenant, user: context.user as unknown as IUser };
  } catch {
    return null;
  }
}

async function authenticated(
  request: NextRequest,
  run: (auth: Authenticated) => Promise<Response>,
): Promise<Response> {
  try {
    const principal = await resolvePrincipal(request);
    if (!principal) return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized');
    // Refuse before any read while the workspace awaits co-managed acceptance (session and API key alike).
    const denial = await coManagedWorkspaceDenial(principal.tenant);
    if (denial) return denial;
    return await runWithTenant(principal.tenant, async () => {
      const { knex } = await createTenantKnex(principal.tenant);
      return run({ ...principal, knex });
    });
  } catch (error) {
    if (error instanceof UploadSessionError) {
      return errorResponse(error.status, error.code, error.message, error.headers, error.details);
    }
    console.error('[document-uploads] Unexpected error', error);
    return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

/** POST /api/documents/uploads */
export function createUploadHandler(request: NextRequest): Promise<Response> {
  return authenticated(request, async ({ tenant, user, knex }) => {
    let body: Record<string, any>;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, 'INVALID_REQUEST', 'Request body must be JSON');
    }
    if (!body || typeof body !== 'object') return errorResponse(400, 'INVALID_REQUEST', 'Request body must be JSON');
    const created = await createUploadSession({
      knex,
      tenant,
      user,
      fileName: body.fileName,
      mimeType: body.mimeType,
      size: body.size,
      entityType: body.entityType,
      entityId: body.entityId,
      options: {
        commentAttachmentDraft: body.commentAttachmentDraft === true,
        folder_path: body.folderPath,
        isClientVisible: body.isClientVisible,
      },
    });
    return NextResponse.json(
      { sessionId: created.sessionId, chunkSize: created.chunkSize, maxFileSize: created.maxFileSize, expiresAt: created.expiresAt },
      { status: 201, headers: { Location: `/api/documents/uploads/${created.sessionId}`, 'Cache-Control': 'no-store' } },
    );
  });
}

/** PUT /api/documents/uploads/:id — one chunk, raw body, `Content-Range: bytes start-end/total`. */
export function putChunkHandler(request: NextRequest, sessionId: string): Promise<Response> {
  return authenticated(request, async ({ tenant, user, knex }) => {
    const receipt = await receiveChunk({
      knex,
      tenant,
      userId: user.user_id,
      sessionId,
      contentRange: request.headers.get('content-range'),
      contentLength: request.headers.get('content-length'),
      // Streamed, never read into memory here: the chunk flows through the ingest stages into storage.
      body: request.body,
    });
    return NextResponse.json(
      { committedOffset: receipt.committedOffset, complete: receipt.complete },
      { status: 200, headers: { 'Upload-Offset': String(receipt.committedOffset), 'Cache-Control': 'no-store' } },
    );
  });
}

/** HEAD and GET /api/documents/uploads/:id — the committed offset. */
export function getUploadHandler(request: NextRequest, sessionId: string, options: { head: boolean }): Promise<Response> {
  return authenticated(request, async ({ tenant, user, knex }) => {
    const session = await findUploadSession(knex, tenant, user.user_id, sessionId);
    if (!session) return errorResponse(404, 'UPLOAD_NOT_FOUND', 'Upload session not found');
    const gone = session.status === 'expired' || session.status === 'aborted'
      || (session.status === 'active' && session.expires_at.getTime() < Date.now());
    const headers = {
      'Upload-Offset': String(session.committed_offset),
      'Upload-Length': String(session.declared_size),
      'Cache-Control': 'no-store',
    };
    if (gone) {
      return options.head
        ? new NextResponse(null, { status: 410, headers })
        : errorResponse(410, session.status === 'aborted' ? 'UPLOAD_ABORTED' : 'UPLOAD_EXPIRED', 'Upload session is no longer available', headers);
    }
    if (options.head) return new NextResponse(null, { status: 200, headers });
    return NextResponse.json({
      sessionId: session.session_id,
      status: session.status,
      committedOffset: session.committed_offset,
      declaredSize: session.declared_size,
      chunkSize: session.chunk_size,
      expiresAt: session.expires_at.toISOString(),
      documentId: session.document_id,
    }, { status: 200, headers });
  });
}

/** POST /api/documents/uploads/:id/complete */
export function completeUploadHandler(request: NextRequest, sessionId: string): Promise<Response> {
  return authenticated(request, async ({ tenant, user, knex }) => {
    const completed = await completeUploadSession({ knex, tenant, user, sessionId });
    return NextResponse.json(
      { document: completed.document, alreadyCompleted: completed.alreadyCompleted },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  });
}

/** DELETE /api/documents/uploads/:id */
export function abortUploadHandler(request: NextRequest, sessionId: string): Promise<Response> {
  return authenticated(request, async ({ tenant, user, knex }) => {
    await abortUploadSession({ knex, tenant, userId: user.user_id, sessionId });
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  });
}
