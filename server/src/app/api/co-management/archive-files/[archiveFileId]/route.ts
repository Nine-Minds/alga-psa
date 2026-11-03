import { NextResponse } from 'next/server';
import { getSession } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { capabilityRouteGuard, notFoundResponse } from '@alga-psa/core/capability/server';
import { readCoManagedArchiveFile } from '@alga-psa/co-managed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bytes of one archived file. Session-authenticated and 404 by default: every refusal (no session,
 * capability closed, id not named by this workspace's sealed manifest, no retained bytes) is the
 * same 404, so the route discloses nothing about which condition failed. Only files copied into the
 * sponsor-owned archive store before sealing can be returned.
 *
 * Middleware has a narrowly scoped single-segment exemption for this session-authenticated route;
 * all authorization remains here and within readCoManagedArchiveFile.
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
