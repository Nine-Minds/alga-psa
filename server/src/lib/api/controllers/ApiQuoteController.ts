/**
 * API Quote Controller
 * Handles all quote-related API endpoints with API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import type { AuthenticatedApiRequest } from '../middleware/apiMiddleware';
import { QuoteService } from '../services/QuoteService';
import {
  createQuoteApiSchema,
  updateQuoteApiSchema,
  quoteListQuerySchema,
  createQuoteItemSchema,
  updateQuoteItemSchema,
  sendQuoteSchema,
  approvalRequestChangesSchema,
  convertQuoteSchema,
  reorderQuoteItemsSchema,
} from '../schemas/quoteSchemas';
import {
  runWithTenant,
} from '../../db';
import { getConnection } from '../../db/db';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
} from '@alga-psa/authorization/kernel';
import { authorizeApiResourceRead, buildAuthorizationPrincipalSubject } from './authorizationKernel';
import { buildAuthorizationAwarePage } from '@alga-psa/authorization/pagination';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError,
} from '../middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiQuoteController extends ApiBaseController {
  private quoteService: QuoteService;

  constructor() {
    const quoteService = new QuoteService();

    super(quoteService, {
      resource: 'quote',
      createSchema: createQuoteApiSchema,
      updateSchema: updateQuoteApiSchema,
      querySchema: quoteListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read',
      },
    });

    this.quoteService = quoteService;
  }

  private buildQuoteRecordContext(quote: Record<string, any>) {
    // `approved_by` is the approver, NOT an assignee. Coercing it into
    // assignedUserIds would let any approver pass the `own_or_assigned`
    // relationship rule on quotes they didn't author. Quotes have no
    // assignee concept today, so leave assignedUserIds empty. Self-approval
    // is enforced separately via the `billing_not_self_approver_denied`
    // mutation guard in assertQuoteApproveAllowed.
    return {
      id: quote.quote_id,
      ownerUserId: typeof quote.created_by === 'string' ? quote.created_by : undefined,
      assignedUserIds: [] as string[],
      clientId: typeof quote.client_id === 'string' ? quote.client_id : undefined,
      status: quote.status,
    };
  }

  private async assertQuoteReadAllowed(
    apiRequest: AuthenticatedApiRequest,
    quoteId: string,
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<Record<string, any>> {
    const resolvedKnex = knex ?? await getConnection(apiRequest.context.tenant);
    const quote = await this.quoteService.getById(quoteId, apiRequest.context);

    if (!quote) {
      throw new NotFoundError('Quote not found');
    }

    const allowed = await authorizeApiResourceRead({
      knex: resolvedKnex,
      tenant: apiRequest.context.tenant,
      user: apiRequest.context.user,
      apiKeyId: apiRequest.context.apiKeyId,
      resource: 'billing',
      recordContext: this.buildQuoteRecordContext(quote as Record<string, any>),
    });

    if (!allowed) {
      throw new ForbiddenError('Permission denied: Cannot read quote');
    }

    return quote as Record<string, any>;
  }

  private async assertQuoteApproveAllowed(apiRequest: AuthenticatedApiRequest, quote: Record<string, any>) {
    const knex = await getConnection(apiRequest.context.tenant);
    const subject = buildAuthorizationPrincipalSubject(apiRequest.context.user, apiRequest.context.apiKeyId);
    subject.tenant = apiRequest.context.tenant;

    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({
        mutationGuards: [
          (input) => {
            if (input.mutation?.kind === 'approve' && input.record?.ownerUserId === input.subject.userId) {
              return {
                allowed: false,
                reasons: [
                  {
                    stage: 'mutation' as const,
                    sourceType: 'builtin' as const,
                    code: 'billing_not_self_approver_denied',
                    message: 'Approvers cannot approve their own quotes.',
                  },
                ],
              };
            }

            return {
              allowed: true,
              reasons: [],
            };
          },
        ],
      }),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: (input) => resolveBundleNarrowingRulesForEvaluation(knex, input),
      }),
      rbacEvaluator: async () => true,
    });

    const decision = await kernel.authorizeMutation({
      knex,
      subject,
      resource: {
        type: 'billing',
        action: 'approve',
        id: quote.quote_id,
      },
      record: this.buildQuoteRecordContext(quote),
      mutation: {
        kind: 'approve',
        record: this.buildQuoteRecordContext(quote),
      },
      requestCache: new RequestLocalAuthorizationCache(),
    });

    if (!decision.allowed) {
      throw new ForbiddenError('Permission denied: Cannot approve your own quote');
    }
  }

  // ============================================================================
  // Override CRUD for quote-specific logic
  // ============================================================================

  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
          const sort = url.searchParams.get('sort') || 'created_at';
          const order = (url.searchParams.get('order') || 'desc') as 'asc' | 'desc';

          const include_items = url.searchParams.get('include_items') === 'true';
          const include_client = url.searchParams.get('include_client') !== 'false'; // default true

          const filters: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            if (!['page', 'limit', 'sort', 'order', 'include_items', 'include_client'].includes(key)) {
              filters[key] = value;
            }
          });

          const listOptions = {
            page,
            limit,
            sort,
            order,
            include_items,
            include_client,
            status: filters.status,
            client_id: filters.client_id,
            is_template: filters.is_template === 'true',
            search: filters.search,
          };

          const knex = await getConnection(apiRequest.context.tenant);
          const authorizedPage = await buildAuthorizationAwarePage<Record<string, any>>({
            page,
            limit,
            fetchPage: (sourcePage, sourceLimit) =>
              this.quoteService.list(
                {
                  ...listOptions,
                  page: sourcePage,
                  limit: sourceLimit,
                },
                apiRequest.context,
                filters
              ),
            authorizeRecord: (quote) =>
              authorizeApiResourceRead({
                knex,
                tenant: apiRequest.context.tenant,
                user: apiRequest.context.user,
                apiKeyId: apiRequest.context.apiKeyId,
                resource: 'billing',
                recordContext: this.buildQuoteRecordContext(quote),
              }),
            scanLimit: 100,
          });

          return createPaginatedResponse(
            authorizedPage.data,
            authorizedPage.total,
            page,
            limit,
            { sort, order, filters },
          );
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  getById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const quote = await this.assertQuoteReadAllowed(apiRequest, id);

          return createSuccessResponse(quote);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  update() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.update || 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const data = this.options.updateSchema
            ? await this.validateData(apiRequest, this.options.updateSchema)
            : await apiRequest.json();

          const updated = await this.service.update(id, data, apiRequest.context);
          if (!updated) {
            throw new NotFoundError(`${this.options.resource} not found`);
          }

          return createSuccessResponse(updated);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  delete() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, this.options.permissions?.delete || 'delete');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const resource = await this.service.getById(id, apiRequest.context);
          if (!resource) {
            throw new NotFoundError(`${this.options.resource} not found`);
          }

          await this.service.delete(id, apiRequest.context);
          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // Quote Items
  // ============================================================================

  listItems() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const items = await this.quoteService.listItems(id, apiRequest.context);

          return createSuccessResponse(items);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  addItem() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const body = await req.json();
          const data = createQuoteItemSchema.parse(body);

          const item = await this.quoteService.addItem(id, data, apiRequest.context);

          return createSuccessResponse(item, 201);
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.errors));
        }
        return handleApiError(error);
      }
    };
  }

  updateItem() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const quoteId = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, quoteId, knex);
          const params = await (apiRequest as any).params;
          const itemId = params?.itemId;

          if (!itemId) {
            throw new ValidationError('Item ID is required');
          }

          const body = await req.json();
          const data = updateQuoteItemSchema.parse(body);

          const item = await this.quoteService.updateItem(quoteId, itemId, data, apiRequest.context);

          return createSuccessResponse(item);
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.errors));
        }
        return handleApiError(error);
      }
    };
  }

  deleteItem() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const quoteId = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, quoteId, knex);
          const params = await (apiRequest as any).params;
          const itemId = params?.itemId;

          if (!itemId) {
            throw new ValidationError('Item ID is required');
          }

          await this.quoteService.removeItem(quoteId, itemId, apiRequest.context);

          return new NextResponse(null, { status: 204 });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  reorderItems() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const body = await req.json();
          const data = reorderQuoteItemsSchema.parse(body);

          const items = await this.quoteService.reorderItems(id, data.item_ids, apiRequest.context);

          return createSuccessResponse(items);
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.errors));
        }
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // Lifecycle / Workflow
  // ============================================================================

  send() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const body = await req.json().catch(() => ({}));
          const data = sendQuoteSchema.parse(body);

          const quote = await this.quoteService.send(id, data, apiRequest.context);

          return createSuccessResponse(quote);
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.errors));
        }
        return handleApiError(error);
      }
    };
  }

  resend() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const body = await req.json().catch(() => ({}));
          const data = sendQuoteSchema.parse(body);

          const quote = await this.quoteService.send(id, data, apiRequest.context);

          return createSuccessResponse(quote);
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.errors));
        }
        return handleApiError(error);
      }
    };
  }

  remind() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const quote = await this.quoteService.sendReminder(id, apiRequest.context);

          return createSuccessResponse(quote);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  submitForApproval() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const quote = await this.quoteService.submitForApproval(id, apiRequest.context);

          return createSuccessResponse(quote);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  approve() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'approve');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          const existingQuote = await this.assertQuoteReadAllowed(apiRequest, id, knex);

          if (existingQuote.status !== 'pending_approval') {
            throw new ForbiddenError('Only quotes pending approval can be approved');
          }

          await this.assertQuoteApproveAllowed(apiRequest, existingQuote as Record<string, any>);
          const quote = await this.quoteService.approve(id, apiRequest.context);

          return createSuccessResponse(quote);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  requestChanges() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'approve');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          const body = await req.json();
          const data = approvalRequestChangesSchema.parse(body);
          const existingQuote = await this.assertQuoteReadAllowed(apiRequest, id, knex);

          if (existingQuote.status !== 'pending_approval') {
            throw new ForbiddenError('Only quotes pending approval can be sent back for changes');
          }

          const quote = await this.quoteService.requestChanges(id, data.reason, apiRequest.context);

          return createSuccessResponse(quote);
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.errors));
        }
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // Conversion
  // ============================================================================

  conversionPreview() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const preview = await this.quoteService.getConversionPreview(id, apiRequest.context);

          return createSuccessResponse(preview);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  convert() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const body = await req.json();
          const data = convertQuoteSchema.parse(body);

          const result = await this.quoteService.convert(id, data, apiRequest.context);

          return createSuccessResponse(result, 201);
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.errors));
        }
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // Versioning
  // ============================================================================

  listVersions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const versions = await this.quoteService.listVersions(id, apiRequest.context);

          return createSuccessResponse(versions);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  createRevision() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const revision = await this.quoteService.createRevision(id, apiRequest.context);

          return createSuccessResponse(revision, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // Activities
  // ============================================================================

  listActivities() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);

        return await runWithTenant(apiRequest.context.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const activities = await this.quoteService.listActivities(id, apiRequest.context);

          return createSuccessResponse(activities);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
