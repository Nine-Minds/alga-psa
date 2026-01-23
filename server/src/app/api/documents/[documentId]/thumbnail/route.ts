import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from 'server/src/lib/auth/rbac';

/**
 * GET /api/documents/[documentId]/thumbnail
 *
 * Serves the cached thumbnail for a document
 * Returns 200x200 JPEG thumbnail with aggressive caching
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const resolvedParams = await params;
  const documentId = resolvedParams.documentId;

  if (!documentId) {
    return new NextResponse('Document ID is required', { status: 400 });
  }

  try {
    // Authentication check
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // Permission check
    if (!await hasPermission(currentUser, 'document', 'read')) {
      return new NextResponse('Forbidden - Cannot read documents', { status: 403 });
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      return new NextResponse('No tenant found', { status: 400 });
    }

    // Get document with thumbnail_file_id
    const document = await knex('documents')
      .where({ document_id: documentId, tenant })
      .select('thumbnail_file_id', 'preview_generated_at', 'mime_type', 'file_id')
      .first();

    if (!document) {
      return new NextResponse('Document not found', { status: 404 });
    }

    // If no thumbnail, return 404
    if (!document.thumbnail_file_id) {
      // For images without generated thumbnails, could fallback to original
      // But for now, return 404 to indicate thumbnail needs to be generated
      return new NextResponse('Thumbnail not available', { status: 404 });
    }

    // Download thumbnail from storage
    const downloadResult = await StorageService.downloadFile(document.thumbnail_file_id);
    if (!downloadResult) {
      return new NextResponse('Thumbnail file not found in storage', { status: 404 });
    }

    // Set aggressive caching headers
    const headers = new Headers();
    headers.set('Content-Type', 'image/jpeg');
    headers.set('Content-Length', downloadResult.buffer.length.toString());

    // Cache for 1 year - thumbnails are immutable (file_id changes if regenerated)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    // ETag based on file ID for cache validation
    headers.set('ETag', `"${document.thumbnail_file_id}"`);

    // Last-Modified based on generation time
    if (document.preview_generated_at) {
      headers.set('Last-Modified', new Date(document.preview_generated_at).toUTCString());
    }

    // Check if client has cached version (ETag match)
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === `"${document.thumbnail_file_id}"`) {
      return new NextResponse(null, { status: 304, headers });
    }

    return new NextResponse(downloadResult.buffer as any, {
      status: 200,
      headers,
    });

  } catch (error) {
    console.error(`Error serving thumbnail for document ${documentId}:`, error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
