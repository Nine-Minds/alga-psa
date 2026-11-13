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
import { ApiBaseController } from './ApiBaseController';
import { ApiDocumentService } from '../services/ApiDocumentService';
import { attachDocumentSchema } from '../schemas/documentAttach';
import { ENTITY_ADAPTERS, assertEntityAvailableForProduct } from '../services/documents/entityAdapters';
import { attachDocument } from '../services/documents/attachDocument';
import {
  assertJsonBodyWithinCap,
  base64SourceCap,
  getMaxUploadBytes,
  mapFetchError,
  resolveSource,
} from '../services/documents/resolveSource';
import { runWithTenant } from '../../db';
import { getConnection } from '../../db/db';
import { hasPermission } from '../../auth/rbac';
import {
  ForbiddenError,
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
}
