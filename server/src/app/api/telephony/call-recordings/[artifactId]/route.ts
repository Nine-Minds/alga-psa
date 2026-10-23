import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { isEnterprise } from '@alga-psa/core/features';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth/rbac';
import { StorageService } from '@alga-psa/storage/StorageService';

/**
 * Serves a stored phone-call recording (Teams Phone or 3CX) to MSP users.
 * Call recordings are uploaded as bare files, not documents, so the generic
 * document download routes cannot reach them.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  if (!isEnterprise) {
    return new NextResponse('Call recordings are available in Enterprise Edition only', { status: 404 });
  }

  const { artifactId } = await params;
  if (!artifactId) {
    return new NextResponse('Artifact ID is required', { status: 400 });
  }

  const user = await getCurrentUser().catch(() => null);
  const tenant = (user as any)?.tenant;
  if (!user || !tenant || (user as any).user_type === 'client') {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { knex } = await createTenantKnex(tenant);
  if (!(await hasPermission(user as any, 'interaction', 'read', knex))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const artifact = await tenantDb(knex, tenant).table('telephony_call_artifacts')
    .where({ artifact_id: artifactId, artifact_type: 'recording' })
    .first('file_id', 'provider_artifact_id');

  if (!artifact?.file_id) {
    return new NextResponse('Recording not found', { status: 404 });
  }

  const stored = await StorageService.downloadFile(artifact.file_id);
  const headers = new Headers();
  headers.set('Content-Type', stored.metadata.mime_type || 'application/octet-stream');
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Content-Length', String(stored.metadata.size));
  headers.set('Content-Disposition', `attachment; filename="${stored.metadata.original_name}"`);
  return new NextResponse(stored.buffer as any, { status: 200, headers });
}

export const dynamic = 'force-dynamic';
