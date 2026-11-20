/**
 * API Document Controller
 *
 * `POST /api/v1/documents` attaches a file (fetched from an https URL, or given
 * as base64) to one entity. It is the single JSON upload surface for MCP, the
 * stdio connector, in-app chat and plain API clients; the multipart ticket route
 * remains for the web UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { Knex } from 'knex';
import { ApiBaseController } from './ApiBaseController';
import { ApiDocumentService } from '../services/ApiDocumentService';
import { attachDocumentSchema } from '../schemas/documentAttach';
import { readDocumentContentQuerySchema } from '../schemas/documentContentRead';
import { ENTITY_ADAPTERS, assertEntityAvailableForProduct } from '../services/documents/entityAdapters';
import { canReadDocument } from '@alga-psa/documents/lib/documentPermissions';
import { getAuthorizedDocumentById } from '@alga-psa/documents/actions/documentActions';
import { StorageService } from '@alga-psa/storage/StorageService';
import {
  buildCursor,
  createAttachmentSource,
  decodeCursor,
  readAttachmentContent,
  resolveBudget,
  resolveCursor,
  type AttachmentDocument,
  type AttachmentSource,
} from '@alga-psa/documents/lib/attachmentContent';
import { attachDocument } from '../services/documents/attachDocument';
import {
  assertJsonBodyWithinCap,
  base64SourceCap,
  getMaxUploadBytes,
  mapFetchError,
  resolveSource,
} from '../services/documents/resolveSource';
import { runWithTenant, tenantDb, withTransaction } from '@alga-psa/db';
import { getConnection } from '../../db/db';
import { hasPermission } from '../../auth/rbac';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  handleApiError,
} from '../middleware/apiMiddleware';

export class ApiDocumentController extends ApiBaseController {
  constructor() {
    super(new ApiDocumentService(), {
      resource: 'document',
      permissions: { create: 'create' },
    });
  }

  /** POST /api/v1/documents */
  attach() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          const knex = await getConnection(apiRequest.context.tenant);

          // `document:create` matches the web UI server action.
          if (!(await hasPermission(apiRequest.context.user, 'document', 'create', knex))) {
            throw new ForbiddenError('Permission denied: Cannot create document');
          }

          // `req.json()` holds the whole body, so it is bounded on Content-Length before it is read
          // (411 without one): a url source is tiny, so anything past the base64 cap is base64.
          assertJsonBodyWithinCap(req.headers.get('content-length'), base64SourceCap(await getMaxUploadBytes()));

          let input;
          try {
            input = attachDocumentSchema.parse(await req.json().catch(() => ({})));
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Validation failed', error.issues);
            }
            throw error;
          }

          // Existence (404), `<resource>:update` (403) and the kernel read check.
          const adapter = ENTITY_ADAPTERS[input.entity_type];
          await assertEntityAvailableForProduct(adapter, apiRequest.context.tenant);
          await adapter.assertCanAttach(apiRequest, input.entity_id, knex);

          // Nothing that can throw may sit between resolveSource and attachDocument: attachDocument
          // owns (and destroys) a url source's stream from the moment it receives it.
          const providerMax = await getMaxUploadBytes();
          const file = await resolveSource(
            { source: input.source, fileName: input.file_name, mimeType: input.mime_type },
            {},
            { knex, tenant: apiRequest.context.tenant },
          );

          const document = await attachDocument({
            knex,
            tenant: apiRequest.context.tenant,
            actorUserId: apiRequest.context.userId,
            target: { entityType: input.entity_type, entityId: input.entity_id },
            file: {
              ...file,
              mapSourceError: (error) => mapFetchError(error, apiRequest.context.tenant, providerMax),
            },
            source: input.source.type,
          });

          return createSuccessResponse(document, 201, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v1/documents/content
   *
   * Read an entity's attachments as native MCP content blocks (images, PDF + page text, Markdown).
   * Authorization, all server-side, none of it cached in the cursor:
   *  1. the entity is available for the tenant's product;
   *  2. the entity adapter's read gate (ticket: `ticket:read`, the ticket kernel, client-portal visibility,
   *     the comment-attachment audience filter and the download projection);
   *  3. per document, the download route's pair: `canReadDocument` and the document kernel
   *     (`getAuthorizedDocumentById`). A document either gate refuses is silently left out of a whole-entity
   *     read and answers 404 when asked for by id, so existence is never confirmed.
   */
  readContent() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          const tenant = apiRequest.context.tenant;
          const user = apiRequest.context.user as any;
          const knex = await getConnection(tenant);

          let query;
          try {
            query = readDocumentContentQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
          } catch (error) {
            if (error instanceof ZodError) throw new ValidationError('Validation failed', error.issues);
            throw error;
          }

          const adapter = ENTITY_ADAPTERS[query.entity_type as keyof typeof ENTITY_ADAPTERS];
          if (!adapter?.listReadableDocuments || !adapter.resolveEntityId) {
            throw new ValidationError('Validation failed', [{ path: ['entity_type'], message: 'attachments of this entity type cannot be read' }]);
          }
          await assertEntityAvailableForProduct(adapter, tenant);

          const entityId = await adapter.resolveEntityId(apiRequest, query.entity_id, knex);
          const { entityLabel, documents: readable } = await adapter.listReadableDocuments(apiRequest, entityId, knex);

          // The download route's two document gates, per document, in the entity's stable order.
          const authorized: AttachmentDocument[] = [];
          for (const item of readable) {
            const document = await this.authorizeDocumentForContent(knex, tenant, user, item.document_id);
            if (document) authorized.push(document);
          }

          const documentId = query.document_id ?? null;
          const selected = documentId ? authorized.filter((d) => d.document_id === documentId) : authorized;
          if (documentId && selected.length === 0) {
            throw new NotFoundError('Document not found');
          }

          const scope = { entity: { type: query.entity_type, id: entityId }, documentId };
          const start = query.cursor
            ? resolveCursor(decodeCursor(query.cursor), scope, selected)
            : { docIndex: 0, unitIndex: 0 };

          const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/+$/, '');
          const sources: AttachmentSource[] = selected.map((document) =>
            createAttachmentSource(document, {
              // StorageService directly: downloadTicketDocument 404s on documents without a file.
              downloadFile: async (fileId) => {
                const result = await StorageService.downloadFile(fileId);
                if (!result?.buffer) throw new Error('file not found in storage');
                return result.buffer;
              },
              loadInAppBodies: async (id) => {
                const db = tenantDb(knex, tenant);
                const [block, text] = await Promise.all([
                  db.table('document_block_content').where({ document_id: id }).select('block_data').first<{ block_data: unknown }>(),
                  db.table('document_content').where({ document_id: id }).select('content').first<{ content: string | null }>(),
                ]);
                const blockData = typeof block?.block_data === 'string' ? safeParseJson(block.block_data) : block?.block_data;
                return { blockData, textContent: text?.content ?? null };
              },
            }),
          );

          const result = await readAttachmentContent(sources, start, resolveBudget(), {
            documentUri: (id) => `${baseUrl}/api/documents/${id}/download`,
          });

          const nextCursor = result.next ? buildCursor(scope, selected, result.next) : null;
          const header = {
            entity: { type: query.entity_type, id: entityId, label: entityLabel },
            served: result.served.map((s) => ({
              document_id: s.document_id,
              name: s.name,
              mime_type: s.mime_type,
              part: s.part ?? 'complete',
              rendering: s.rendering,
              ...(s.scanned_pages.length > 0 ? { scanned_pages: s.scanned_pages } : {}),
            })),
            omitted: result.omitted,
            limits_applied: result.limitsApplied,
            remaining: result.remaining,
            next_cursor: nextCursor,
            instructions: nextCursor
              ? 'More content remains. Call read_attachment with the same entity_type and entity_id and cursor set to next_cursor to continue.'
              : selected.length === 0
                ? 'This record has no readable attachments.'
                : 'This read is complete: every attachment has been served or listed under omitted.',
          };

          return createSuccessResponse({ header, blocks: result.blocks }, 200, undefined, apiRequest);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * The download route's gate pair for one document, returning only what the document kernel left in place.
   * Null (never an error) when either gate refuses, or when the kernel redacted what a read needs.
   */
  private async authorizeDocumentForContent(
    knex: Knex,
    tenant: string,
    user: any,
    documentId: string,
  ): Promise<AttachmentDocument | null> {
    if (!(await canReadDocument(user, documentId))) return null;
    const authorized = (await withTransaction(knex, (trx: Knex.Transaction) =>
      getAuthorizedDocumentById(trx, tenant, user, documentId),
    )) as Record<string, any> | null;
    if (!authorized) return null;

    const has = (field: string) => Object.prototype.hasOwnProperty.call(authorized, field);
    const fileId = typeof authorized.file_id === 'string' ? authorized.file_id : null;
    // A file-backed document needs file_id kept; an in-app one needs its `content` field kept (as the content route does).
    // A redacted file_id is indistinguishable from "no file", so it is refused rather than guessed.
    if (fileId === null && !(has('file_id') && has('content'))) return null;

    const size = Number(authorized.file_size);
    const updated = authorized.updated_at ? new Date(authorized.updated_at) : null;
    return {
      document_id: authorized.document_id,
      document_name: typeof authorized.document_name === 'string' && authorized.document_name ? authorized.document_name : 'Attachment',
      mime_type: typeof authorized.mime_type === 'string' ? authorized.mime_type : null,
      file_id: fileId,
      file_size: Number.isFinite(size) ? size : null,
      updated_at: updated && !Number.isNaN(updated.getTime()) ? updated.toISOString() : '',
    };
  }
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
