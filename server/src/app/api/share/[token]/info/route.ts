import { NextRequest, NextResponse } from 'next/server';
import { getConnection } from '@/lib/db/db';
import {
  validateShareToken,
  logShareAccess,
} from '@alga-psa/documents/lib/shareLinkPublic';

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
      console.error(`[share/info] Token validation failed: ${validation.error}`);
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

    // Get additional file info (if document has a file)
    const knex = await getConnection();
    let mimeType = 'application/octet-stream';
    let fileSize = 0;

    if (share.file_id) {
      const fileRecord = await knex('external_files')
        .where({ file_id: share.file_id, tenant: share.tenant, is_deleted: false })
        .first();

      if (!fileRecord) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }
      mimeType = fileRecord.mime_type || mimeType;
      fileSize = fileRecord.file_size || 0;
    } else {
      // Content-only document (BlockNote editor)
      mimeType = 'text/html';
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
      mimeType,
      fileSize,
      shareType: share.share_type,
      requiresPassword: share.share_type === 'password',
      requiresAuth: share.share_type === 'portal_authenticated',
      expiresAt: share.expires_at,
      maxDownloads: share.max_downloads,
      downloadCount: share.download_count,
    });
  } catch (error) {
    console.error(`Error getting share info for ${token}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
