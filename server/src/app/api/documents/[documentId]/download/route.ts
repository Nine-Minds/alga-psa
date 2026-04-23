import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { runWithTenant } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import {
  getAuthorizedDocumentByFileId,
  getAuthorizedDocumentById,
} from '@alga-psa/documents/actions/documentActions';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    if (!documentId) {
      return NextResponse.json(
        { error: 'Document ID is required' },
        { status: 400 },
      );
    }

    // Support both session auth and API-key auth for document downloads.
    const sessionUser = await getCurrentUser();
    const apiKey = _request.headers.get('x-api-key');

    let tenantId: string | null = null;
    let currentUser: Awaited<ReturnType<typeof getCurrentUser>> | null = null;

    if (sessionUser?.tenant) {
      tenantId = sessionUser.tenant;
      currentUser = sessionUser;
    } else if (apiKey) {
      const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
      if (!keyRecord?.tenant) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const apiUser = await findUserByIdForApi(keyRecord.user_id, keyRecord.tenant);
      if (!apiUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      tenantId = keyRecord.tenant;
      currentUser = apiUser;
    } else {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!tenantId || !currentUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return await runWithTenant(tenantId, async () => {
      const canReadDocuments = await hasPermission(currentUser as any, 'document', 'read');
      if (!canReadDocuments) {
        return NextResponse.json(
          { error: 'Forbidden - Cannot read documents' },
          { status: 403 },
        );
      }

      const { knex } = await createTenantKnex();
      const document = await withTransaction(knex, async (trx) => {
        const byDocumentId = await getAuthorizedDocumentById(trx, tenantId, currentUser as any, documentId);
        if (byDocumentId) {
          return byDocumentId;
        }

        return getAuthorizedDocumentByFileId(trx, tenantId, currentUser as any, documentId);
      });

      if (!document || !document.file_id) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      const result = await StorageService.downloadFile(document.file_id);
      if (!result) {
        return NextResponse.json({ error: 'File not found in storage' }, { status: 404 });
      }

      const { buffer, metadata } = result;
      const headers = new Headers();
      headers.set('Content-Type', metadata.mime_type || 'application/octet-stream');

      const encodedFilename = encodeURIComponent(document.document_name || 'download');
      const asciiFilename = document.document_name?.replace(/[^\x00-\x7F]/g, '_') || 'download';
      headers.set(
        'Content-Disposition',
        `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
      );
      headers.set('Content-Length', buffer.length.toString());
      headers.set('Cache-Control', 'no-cache');

      return new Response(buffer as any, { status: 200, headers });
    });
  } catch (error) {
    console.error('API: Error downloading document:', error);
    return NextResponse.json(
      { error: 'Failed to download document' },
      { status: 500 }
    );
  }
}
