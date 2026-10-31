import { NextResponse } from 'next/server';
import { getSession } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { capabilityRouteGuard, notFoundResponse } from '@alga-psa/core/capability/server';
import { readCoManagedArchiveFile } from '@alga-psa/co-managed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bytes of one archived file. Session-authenticated and 404 by default: every refusal (no session,
 * capability closed, id not named by this workspace's sealed manifest, no registered file source)
 * is the same 404, so the route discloses nothing about which condition failed. File content is empty
 * until a retained-file source registers (none does in production yet; L4a/L5 own that), so every
 * request currently 404s. No blob is copied.
 *
 * NOTE: the middleware owned by L0a must declare this path as a session-authenticated API route
 * (`/api/co-management/archive-files/*`); until it does, the middleware answers before this handler.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ archiveFileId: string }> }): Promise<Response> {
  const session = await getSession();
  const user = session?.user;
  if (!session?.session_id || !user?.id || !user.tenant || user.user_type !== 'internal') return notFoundResponse();
  const denied = await capabilityRouteGuard('co-managed', user.tenant, 'serves');
  if (denied) return denied;
  const { archiveFileId } = await params;
  try {
    const { knex } = await createTenantKnex(user.tenant);
    const file = await readCoManagedArchiveFile(knex, { kind: 'session', tenant: user.tenant, userId: user.id, sessionId: session.session_id }, archiveFileId);
    if (!file) return notFoundResponse();
    return new NextResponse(file.body as BodyInit, { status: 200, headers: {
      'Content-Type': file.mimeType || 'application/octet-stream',
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return notFoundResponse();
  }
}
