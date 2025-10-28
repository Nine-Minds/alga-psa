import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';

/**
 * GET /api/documents/[documentId]/preview
 *
 * Serves the cached preview for a document
 * Returns 800x600 JPEG preview with aggressive caching
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

    // Get document with preview_file_id
    const document = await knex('documents')
      .where({ document_id: documentId, tenant })
      .select('preview_file_id', 'preview_generated_at', 'mime_type', 'file_id')
      .first();

    if (!document) {
      return new NextResponse('Document not found', { status: 404 });
    }

    // If no preview, return 404
    if (!document.preview_file_id) {
      // Could fallback to original file for small images
      // But for now, return 404 to indicate preview needs to be generated
      return new NextResponse('Preview not available', { status: 404 });
    }

    // Download preview from storage
    const downloadResult = await StorageService.downloadFile(document.preview_file_id);
    if (!downloadResult) {
      return new NextResponse('Preview file not found in storage', { status: 404 });
    }

    // Set aggressive caching headers
    const headers = new Headers();
    headers.set('Content-Type', 'image/jpeg');
    headers.set('Content-Length', downloadResult.buffer.length.toString());

    // Cache for 1 year - previews are immutable (file_id changes if regenerated)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    // ETag based on file ID for cache validation
    headers.set('ETag', `"${document.preview_file_id}"`);

    // Last-Modified based on generation time
    if (document.preview_generated_at) {
      headers.set('Last-Modified', new Date(document.preview_generated_at).toUTCString());
    }

    // Check if client has cached version (ETag match)
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === `"${document.preview_file_id}"`) {
      return new NextResponse(null, { status: 304, headers });
    }

    return new NextResponse(downloadResult.buffer as any, {
      status: 200,
      headers,
    });

  } catch (error) {
    console.error(`Error serving preview for document ${documentId}:`, error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
