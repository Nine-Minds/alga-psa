import { NextRequest, NextResponse } from 'next/server';
import type { Knex } from 'knex';
import { createTenantKnex, runWithTenant, tenantDb, withTransaction } from '@alga-psa/db';
import { convertBlockNoteToMarkdown } from '@alga-psa/formatting/blocknoteUtils';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { assertInternalApiUser } from '@/lib/api/middleware/apiMiddleware';
import { coManagedWorkspaceDenial } from '@/lib/api/coManagedWorkspaceDenial';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getAuthorizedDocumentById } from '@alga-psa/documents/actions/documentActions';

const DOCUMENT_METADATA_FIELDS = [
  'document_id',
  'document_name',
  'file_id',
  'mime_type',
  'type_id',
  'shared_type_id',
  'updated_at',
] as const;

type BlockContentPayload = {
  content_id: string;
  block_data: unknown;
  version_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type TextContentPayload = {
  id: string;
  content: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const { documentId } = await params;
    if (!documentId) {
      return NextResponse.json({ error: 'Document ID is required' }, { status: 400 });
    }

    const sessionUser = await getCurrentUser();
    const apiKey = request.headers.get('x-api-key');

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
      try {
        assertInternalApiUser(apiUser);
      } catch {
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

    // Session and API-key callers alike: refuse before any permission or
    // document read while the workspace awaits co-managed acceptance.
    const denial = await coManagedWorkspaceDenial(tenantId);
    if (denial) return denial;

    return await runWithTenant(tenantId, async () => {
      const canReadDocuments = await hasPermission(currentUser as any, 'document', 'read');
      if (!canReadDocuments) {
        return NextResponse.json(
          { error: 'Forbidden - Cannot read documents' },
          { status: 403 },
        );
      }

      const { knex } = await createTenantKnex();
      const db = tenantDb(knex, tenantId);

      // document:read is a type permission; resolve the instance through the
      // document authorization kernel before reading any content.
      const authorizedDocument = await withTransaction(knex, (trx: Knex.Transaction) =>
        getAuthorizedDocumentById(trx, tenantId as string, currentUser as any, documentId),
      );
      if (!authorizedDocument) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      // Everything below is built from the kernel's decision. Redacted fields
      // are absent from `authorizedDocument`, so a field is served only if the
      // kernel left it in place: document metadata is projected from the
      // authorized record, and the document's content bodies (block and text)
      // are governed by its `content` field.
      const authorizedFields: Record<string, unknown> = { ...authorizedDocument };
      const documentRecord = Object.fromEntries(
        DOCUMENT_METADATA_FIELDS
          .filter((field) => Object.prototype.hasOwnProperty.call(authorizedFields, field))
          .map((field) => [field, authorizedFields[field]]),
      );
      const contentReadable = Object.prototype.hasOwnProperty.call(authorizedFields, 'content');
      const fileId = typeof documentRecord.file_id === 'string' ? documentRecord.file_id : null;

      const [blockContentRecord, textContentRecord] = contentReadable
        ? await Promise.all([
            db.table('document_block_content')
              .where({ document_id: documentId })
              .select('content_id', 'block_data', 'version_id', 'created_at', 'updated_at')
              .first<BlockContentPayload>(),
            db.table('document_content')
              .where({ document_id: documentId })
              .select('id', 'content', 'created_at', 'updated_at')
              .first<TextContentPayload>(),
          ])
        : [undefined, undefined];

      let parsedBlockData: unknown = null;
      let blockDataParseError: string | null = null;

      if (blockContentRecord?.block_data !== undefined && blockContentRecord?.block_data !== null) {
        if (typeof blockContentRecord.block_data === 'string') {
          try {
            parsedBlockData = JSON.parse(blockContentRecord.block_data);
          } catch (error) {
            console.warn('[document-content] Failed to parse block_data JSON:', {
              documentId,
              error,
            });
            parsedBlockData = blockContentRecord.block_data;
            blockDataParseError = 'Stored block content could not be parsed.';
          }
        } else {
          parsedBlockData = blockContentRecord.block_data;
        }
      }

      let extractedBlockText: string | null = null;
      if (parsedBlockData !== null) {
        try {
          const markdown = convertBlockNoteToMarkdown(parsedBlockData);
          if (typeof markdown === 'string' && markdown.trim().length > 0) {
            extractedBlockText = markdown;
          }
        } catch (error) {
          console.warn('[document-content] Failed to extract block_data text:', {
            documentId,
            error,
          });
          // Keep the response useful even if markdown extraction fails.
          blockDataParseError = blockDataParseError
            ?? 'Stored block content text could not be extracted.';
        }
      }

      const textContent =
        typeof textContentRecord?.content === 'string' && textContentRecord.content.trim().length > 0
          ? textContentRecord.content
          : null;

      const extractedText = extractedBlockText ?? textContent;

      return NextResponse.json({
        data: {
          document: documentRecord,
          content: {
            source:
              parsedBlockData !== null
                ? 'document_block_content'
                : textContent !== null
                  ? 'document_content'
                  : null,
            has_content: parsedBlockData !== null || textContent !== null,
            block_content: blockContentRecord
              ? {
                  content_id: blockContentRecord.content_id,
                  version_id: blockContentRecord.version_id,
                  created_at: blockContentRecord.created_at,
                  updated_at: blockContentRecord.updated_at,
                  block_data: parsedBlockData,
                }
              : null,
            text_content: textContentRecord
              ? {
                  id: textContentRecord.id,
                  created_at: textContentRecord.created_at,
                  updated_at: textContentRecord.updated_at,
                  content: textContentRecord.content,
                }
              : null,
            extracted_text: extractedText,
            parse_warning: blockDataParseError,
          },
          guidance: {
            file_backed_document: Boolean(fileId),
            next_step_if_file_backed: fileId
              ? `/api/documents/${documentId}/download`
              : null,
          },
        },
      });
    });
  } catch (error) {
    console.error('API: Error fetching document content:', error);
    return NextResponse.json({ error: 'Failed to fetch document content' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
