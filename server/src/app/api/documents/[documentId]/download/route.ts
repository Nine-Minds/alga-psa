import { coManagedWorkspaceDenial } from '@/lib/api/coManagedWorkspaceDenial';
import { canReadDocument } from '@alga-psa/documents/lib/documentPermissions';
import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex } from 'server/src/lib/db';
import { resolveDocumentRoutePrincipal } from '@/lib/api/documentRoutePrincipal';
import { serveDocumentFile } from '@/lib/api/serveDocumentFile';
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

    // Session auth or API-key auth (internal users only), through the shared principal.
    const principal = await resolveDocumentRoutePrincipal(_request);
    if (principal.ok === false) return principal.response;
    const tenantId = principal.tenant;
    const currentUser = principal.user;

    const denial = await coManagedWorkspaceDenial(tenantId);
    if (denial) return denial;

    return await runWithTenant(tenantId, async () => {
      const canReadDocuments = await canReadDocument(currentUser, documentId);
      if (!canReadDocuments) {
        return NextResponse.json(
          { error: 'Forbidden - Cannot read documents' },
          { status: 403 },
        );
      }

      const { knex } = await createTenantKnex();
      const document = await withTransaction(knex, async (trx) => {
        const byDocumentId = await getAuthorizedDocumentById(trx, tenantId, currentUser, documentId);
        if (byDocumentId) {
          return byDocumentId;
        }

        return getAuthorizedDocumentByFileId(trx, tenantId, currentUser, documentId);
      });

      if (!document) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      return serveDocumentFile(document, { knex, tenant: tenantId });
    });
  } catch (error) {
    console.error('API: Error downloading document:', error);
    return NextResponse.json(
      { error: 'Failed to download document' },
      { status: 500 }
    );
  }
}
