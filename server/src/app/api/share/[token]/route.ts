import { NextRequest, NextResponse } from 'next/server';
import { getConnection } from '@/lib/db/db';
import { StorageProviderFactory } from '@alga-psa/storage';
import {
  validateShareToken,
  verifySharePassword,
  logShareAccess,
  incrementDownloadCount,
} from '@alga-psa/documents/lib/shareLinkPublic';
import { getCurrentUser } from '@alga-psa/user-composition/actions';

/**
 * GET /api/share/[token]
 *
 * Serves file for valid public shares without session (F063).
 * Verifies password for password-protected shares (F064).
 * Verifies portal session for portal-authenticated shares (F065).
 * Logs access and increments download_count (F066).
 * Enforces expiry and max_downloads limits (F068).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const resolvedParams = await params;
  const token = resolvedParams.token;

  if (!token) {
    return new NextResponse('Token is required', { status: 400 });
  }

  // Get client info for logging
  const ipAddress = request.headers.get('x-forwarded-for') ||
                    request.headers.get('x-real-ip') ||
                    'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';

  try {
    // Validate the token (F068: checks expiry, revocation, download limits)
    const validation = await validateShareToken(token);

    if (!validation.valid || !validation.share) {
      await logShareAccess(
        'unknown',
        'unknown',
        {
          ipAddress,
          userAgent,
          accessType: 'download',
          wasSuccessful: false,
          failureReason: validation.error || 'Invalid token',
        }
      ).catch(() => {}); // Best effort logging

      return new NextResponse(validation.error || 'Invalid share link', { status: 404 });
    }

    const share = validation.share;

    // F064: Verify password for password-protected shares
    if (share.share_type === 'password') {
      // Only accept password via header — never via query string (avoids logging in access/proxy logs)
      const password = request.headers.get('x-share-password');

      if (!password) {
        await logShareAccess(
          share.share_id,
          share.tenant,
          {
            ipAddress,
            userAgent,
            accessType: 'download',
            wasSuccessful: false,
            failureReason: 'Password required',
          }
        ).catch(() => {});

        return new NextResponse('Password required', {
          status: 401,
          headers: { 'WWW-Authenticate': 'X-Share-Password' },
        });
      }

      const passwordValid = await verifySharePassword(token, password, share.tenant);
      if (!passwordValid) {
        await logShareAccess(
          share.share_id,
          share.tenant,
          {
            ipAddress,
            userAgent,
            accessType: 'download',
            wasSuccessful: false,
            failureReason: 'Invalid password',
          }
        ).catch(() => {});

        return new NextResponse('Invalid password', { status: 403 });
      }
    }

    // F065: Verify portal session for portal-authenticated shares
    if (share.share_type === 'portal_authenticated') {
      const user = await getCurrentUser().catch(() => null);

      if (!user) {
        await logShareAccess(
          share.share_id,
          share.tenant,
          {
            ipAddress,
            userAgent,
            accessType: 'download',
            wasSuccessful: false,
            failureReason: 'Authentication required',
          }
        ).catch(() => {});

        return new NextResponse('Authentication required', { status: 401 });
      }

      // Verify user belongs to the same tenant as the share link
      if (user.tenant !== share.tenant) {
        await logShareAccess(
          share.share_id,
          share.tenant,
          {
            ipAddress,
            userAgent,
            accessType: 'download',
            wasSuccessful: false,
            failureReason: 'Tenant mismatch',
          }
        ).catch(() => {});

        return new NextResponse('Access denied', { status: 403 });
      }
    }

    // Get the file record
    const knex = await getConnection();
    const fileRecord = await knex('external_files')
      .where({ file_id: share.file_id, tenant: share.tenant, is_deleted: false })
      .first();

    if (!fileRecord) {
      await logShareAccess(
        share.share_id,
        share.tenant,
        {
          ipAddress,
          userAgent,
          accessType: 'download',
          wasSuccessful: false,
          failureReason: 'File not found',
        }
      ).catch(() => {});

      return new NextResponse('File not found', { status: 404 });
    }

    // F066: Log access and increment download count
    const currentUser = await getCurrentUser().catch(() => null);
    await logShareAccess(
      share.share_id,
      share.tenant,
      {
        ipAddress,
        userAgent,
        userId: currentUser?.user_id,
        accessType: 'download',
        wasSuccessful: true,
      }
    ).catch(() => {}); // Best effort

    await incrementDownloadCount(token, share.tenant).catch(() => {}); // Best effort

    // Get the storage provider and stream the file
    const provider = await StorageProviderFactory.createProvider();

    // Use no-store for sensitive share types to prevent local caching
    const cacheControl = share.share_type === 'public' ? 'private, no-cache' : 'private, no-store';

    // Handle HTTP Range requests for video files
    const range = request.headers.get('range');
    const isVideoFile = fileRecord.mime_type?.startsWith('video/');

    if (range && isVideoFile) {
      const rangeMatch = range.match(/bytes=(\d+)-(\d*)/);
      if (!rangeMatch) {
        return new NextResponse('Invalid Range', { status: 416 });
      }

      const start = parseInt(rangeMatch[1], 10);
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileRecord.file_size - 1;
      const fileSize = fileRecord.file_size;

      if (start >= fileSize || end >= fileSize || start > end) {
        const headers = new Headers();
        headers.set('Content-Range', `bytes */${fileSize}`);
        return new NextResponse('Range Not Satisfiable', { status: 416, headers });
      }

      const contentLength = end - start + 1;
      const stream = await provider.getReadStream(fileRecord.storage_path, { start, end });

      const headers = new Headers();
      headers.set('Content-Type', fileRecord.mime_type);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      headers.set('Content-Length', contentLength.toString());
      headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(share.document_name || 'file')}"`);
      headers.set('Cache-Control', cacheControl);

      return new NextResponse(stream as any, {
        status: 206,
        headers,
      });
    } else {
      const stream = await provider.getReadStream(fileRecord.storage_path);

      const headers = new Headers();
      headers.set('Content-Type', fileRecord.mime_type);
      headers.set('Content-Length', fileRecord.file_size.toString());
      headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(share.document_name || 'file')}"`);

      if (isVideoFile) {
        headers.set('Accept-Ranges', 'bytes');
      }

      headers.set('Cache-Control', cacheControl);

      return new NextResponse(stream as any, {
        status: 200,
        headers,
      });
    }
  } catch (error) {
    console.error(`Error serving share link ${token}:`, error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
