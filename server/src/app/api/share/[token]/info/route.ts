import { NextRequest, NextResponse } from 'next/server';
import { getConnection } from '@/lib/db/db';
import {
  validateShareToken,
  logShareAccess,
} from '@alga-psa/documents/actions';

/**
 * GET /api/share/[token]/info
 *
 * Returns document metadata without downloading (F067).
 * Used by the share landing page to display file info.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const resolvedParams = await params;
  const token = resolvedParams.token;

  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  // Get client info for logging
  const ipAddress = request.headers.get('x-forwarded-for') ||
                    request.headers.get('x-real-ip') ||
                    'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';

  try {
    // Validate the token (checks expiry, revocation, download limits)
    const validation = await validateShareToken(token);

    if (!validation.valid || !validation.share) {
      await logShareAccess(
        'unknown',
        'unknown',
        {
          ipAddress,
          userAgent,
          accessType: 'info',
          wasSuccessful: false,
          failureReason: validation.error || 'Invalid token',
        }
      ).catch(() => {});

      return NextResponse.json(
        { error: validation.error || 'Invalid share link' },
        { status: 404 }
      );
    }

    const share = validation.share;

    // Get additional file info
    const knex = await getConnection();
    const fileRecord = await knex('external_files')
      .where({ file_id: share.file_id, tenant: share.tenant, is_deleted: false })
      .first();

    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Log the info access
    await logShareAccess(
      share.share_id,
      share.tenant,
      {
        ipAddress,
        userAgent,
        accessType: 'info',
        wasSuccessful: true,
      }
    ).catch(() => {});

    // Return metadata (without sensitive fields)
    return NextResponse.json({
      documentName: share.document_name,
      mimeType: fileRecord.mime_type,
      fileSize: fileRecord.file_size,
      shareType: share.share_type,
      requiresPassword: share.share_type === 'password',
      requiresAuth: share.share_type === 'portal_authenticated',
      expiresAt: share.expires_at,
      maxDownloads: share.max_downloads,
      downloadCount: share.download_count,
      // Don't expose: token, password_hash, internal IDs
    });
  } catch (error) {
    console.error(`Error getting share info for ${token}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
