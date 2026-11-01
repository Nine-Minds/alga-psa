import { coManagedWorkspaceDenial } from '@/lib/api/coManagedWorkspaceDenial';
import { canReadDocument } from '@alga-psa/documents/lib/documentPermissions';
import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { StorageError, StorageProviderFactory } from '@alga-psa/storage';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getAuthorizedDocumentById } from '@alga-psa/documents/actions/documentActions';
import { buildDocumentPreviewHeaders } from '@alga-psa/core';

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

    const denial = await coManagedWorkspaceDenial(currentUser.tenant);
    if (denial) return denial;

    // Permission check
    if (!await canReadDocument(currentUser, documentId)) {
      return new NextResponse('Forbidden - Cannot read documents', { status: 403 });
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      return new NextResponse('No tenant found', { status: 400 });
    }

    const document = await withTransaction(knex, async (trx) =>
      getAuthorizedDocumentById(trx, tenant, currentUser as any, documentId)
    );

    if (!document) {
      return new NextResponse('Document not found', { status: 404 });
    }

    // If no preview, return 404
    if (!document.preview_file_id) {
      // Could fallback to original file for small images
      // But for now, return 404 to indicate preview needs to be generated
      return new NextResponse('Preview not available', { status: 404 });
    }

    const fileRecord = await tenantDb(knex, tenant).table('external_files')
      .where({ file_id: document.preview_file_id, is_deleted: false })
      .first();

    if (!fileRecord) {
      return new NextResponse('Preview file not found in storage', { status: 404 });
    }

    const provider = await StorageProviderFactory.createProvider();
    const buffer = await provider.download(fileRecord.storage_path);

    // Set aggressive caching headers
    const headers = new Headers();
    // Shared policy: raster inline, everything else (incl. legacy rows whose preview
    // is the uploaded SVG) neutralised to an octet-stream attachment.
    // LEVERAGE: pattern byte-serving-headers — policy headers set by hand in each byte-serving route
    for (const [name, value] of Object.entries(buildDocumentPreviewHeaders(fileRecord.mime_type))) {
      headers.set(name, value);
    }
    headers.set('Content-Length', buffer.length.toString());

    // Cache for 1 year - previews are immutable (file_id changes if regenerated)
    headers.set('Cache-Control', 'private, no-store');

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

    return new NextResponse(buffer as any, {
      status: 200,
      headers,
    });

  } catch (error) {
    if (
      error instanceof StorageError &&
      error.operation === 'download' &&
      (error.cause?.message === 'File not found' || error.message === 'File not found')
    ) {
      return new NextResponse('Preview file not found in storage', { status: 404 });
    }

    console.error(`Error serving preview for document ${documentId}:`, error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
