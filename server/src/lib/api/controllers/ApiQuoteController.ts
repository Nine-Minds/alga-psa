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
import { hasPermission } from '../../auth/rbac';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  isSelfApprovalAttempt,
  isSelfApprovalBlocked,
} from '@alga-psa/authorization/kernel';
import { resolveAllowSelfApprovalFlag } from '@alga-psa/authorization/quoteSelfApproval';
import {
  buildAuthorizationPrincipalSubject,
  projectApiResourceRead,
  reprojectUnderDecision,
  type AuthorizedProjection,
} from './authorizationKernel';
import { QUOTE_LINE_RECORD_SOURCE, QUOTE_RECORD_SOURCE } from '@alga-psa/co-managed/recordProjection';
import { buildQuoteRecordContext } from './recordContexts';
import { buildProjectedPage } from '@alga-psa/authorization/pagination';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
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
      // Quotes are gated by the pre-existing `billing` permission set; there is
      // no `quote` resource in the permissions table.
      permissionResource: 'billing',
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

  /**
   * Approval is gated by the dedicated `quotes:approve` permission rather than
   * the `billing` set used for CRUD, mirroring quoteActions.
   */
  private async checkQuoteApprovePermission(apiRequest: AuthenticatedApiRequest): Promise<void> {
    if (!apiRequest.context.user) {
      throw new UnauthorizedError('User context required');
    }

    const knex = await getConnection(apiRequest.context.tenant);
    const allowed = await hasPermission(apiRequest.context.user, 'quotes', 'approve', knex);
    if (!allowed) {
      throw new ForbiddenError('Permission denied: Cannot approve quote');
    }
  }

  // `approved_by` is the approver, NOT an assignee (see buildQuoteRecordContext); kept as a method for existing call sites.
  private buildQuoteRecordContext(quote: Record<string, any>) {
    return buildQuoteRecordContext(quote);
  }

  /** A quote-shaped result (mutation return value) redacted under the gate decision. Never served raw. */
  private serializeQuote(gate: AuthorizedProjection<Record<string, any>>, quote: Record<string, any>) {
    const projected = reprojectUnderDecision(gate, quote, QUOTE_RECORD_SOURCE);
    if (!projected) throw new NotFoundError('Quote not found');
    return projected;
  }

  /** Quote lines redacted under the quote's decision (hidden unit_price => total_price etc. nulled). */
  private serializeQuoteItems(gate: AuthorizedProjection<Record<string, any>>, items: Record<string, any>[]) {
    const out: AuthorizedProjection<Record<string, any>>[] = [];
    for (const item of items) {
      const projected = reprojectUnderDecision(gate, item, QUOTE_LINE_RECORD_SOURCE);
      if (projected) out.push(projected);
    }
    return out;
  }

  private async assertQuoteReadAllowed(
    apiRequest: AuthenticatedApiRequest,
    quoteId: string,
    knex?: Awaited<ReturnType<typeof getConnection>>
  ): Promise<AuthorizedProjection<Record<string, any>>> {
    const resolvedKnex = knex ?? await getConnection(apiRequest.context.tenant);
    const quote = await this.quoteService.getById(quoteId, apiRequest.context);

    if (!quote) {
      throw new NotFoundError('Quote not found');
    }

    // Denied OR suppressed answers 404: 403 would confirm the quote exists.
    const projection = await projectApiResourceRead({
      knex: resolvedKnex,
      tenant: apiRequest.context.tenant,
      user: apiRequest.context.user,
      apiKeyId: apiRequest.context.apiKeyId,
      kind: 'quote',
      record: quote as Record<string, any>,
    });

    if (!projection) {
      throw new NotFoundError('Quote not found');
    }

    return projection;
  }

  /**
   * Enforces the not-self-approver rules for an API approval and reports whether this
   * approval is a permitted self-approval (sole approver, alga-2026-0002597) so the
   * caller can write the audit activity.
   */
  private async assertQuoteApproveAllowed(
    apiRequest: AuthenticatedApiRequest,
    quote: Record<string, any>
  ): Promise<{ selfApproved: boolean }> {
    const knex = await getConnection(apiRequest.context.tenant);
    const subject = buildAuthorizationPrincipalSubject(apiRequest.context.user, apiRequest.context.apiKeyId);
    subject.tenant = apiRequest.context.tenant;

    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({
        mutationGuards: [
          (input) => {
            // Shared decision (see packages/authorization selfApproval.ts).
            if (isSelfApprovalBlocked(input)) {
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

    const record = this.buildQuoteRecordContext(quote);
    // Allowed only when no OTHER active approver exists in the tenant. Computed here
    // because the kernel/providers must not query the database.
    const allowSelfApproval = await resolveAllowSelfApprovalFlag(
      knex,
      apiRequest.context.tenant,
      subject.userId,
      record.ownerUserId
    );
    const mutationInput = {
      knex,
      subject,
      resource: {
        type: 'billing',
        action: 'approve',
        id: quote.quote_id,
      },
      record,
      mutation: {
        kind: 'approve',
        record,
        allowSelfApproval,
      },
      requestCache: new RequestLocalAuthorizationCache(),
    };
    const decision = await kernel.authorizeMutation(mutationInput);

    if (!decision.allowed) {
      throw new ForbiddenError('Permission denied: Cannot approve your own quote');
    }

    return { selfApproved: isSelfApprovalAttempt(mutationInput) };
  }

  /**
   * Reads the JSON request body, turning a missing/empty/unparseable body into a 400
   * instead of the raw SyntaxError from `req.json()` (which surfaced as HTTP 500).
   */
  private async readJsonBody(req: NextRequest): Promise<unknown> {
    let raw: string;
    try {
      raw = await req.text();
    } catch {
      throw new ValidationError('Request body could not be read');
    }

    if (raw.trim() === '') {
      throw new ValidationError('Request body is required and must be a JSON object');
    }

    try {
      return JSON.parse(raw);
    } catch {
      throw new ValidationError('Request body must be valid JSON');
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
          const authorizedPage = await buildProjectedPage<Record<string, any>, AuthorizedProjection<Record<string, any>>>({
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
            projectRecord: (quote) =>
              projectApiResourceRead({
                knex,
                tenant: apiRequest.context.tenant,
                user: apiRequest.context.user,
                apiKeyId: apiRequest.context.apiKeyId,
                kind: 'quote',
                record: quote,
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
          const gate = await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const data = this.options.updateSchema
            ? await this.validateData(apiRequest, this.options.updateSchema)
            : await apiRequest.json();

          const updated = await this.service.update(id, data, apiRequest.context);
          if (!updated) {
            throw new NotFoundError(`${this.options.resource} not found`);
          }

          return createSuccessResponse(this.serializeQuote(gate, updated));
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
          const gate = await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const items = await this.quoteService.listItems(id, apiRequest.context);

          return createSuccessResponse(this.serializeQuoteItems(gate, items));
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
          const gate = await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const body = await req.json();
          const data = createQuoteItemSchema.parse(body);

          const item = await this.quoteService.addItem(id, data, apiRequest.context);

          return createSuccessResponse(this.serializeQuoteItems(gate, [item])[0] ?? null, 201);
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.issues));
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
          const gate = await this.assertQuoteReadAllowed(apiRequest, quoteId, knex);
          const params = await (apiRequest as any).params;
          const itemId = params?.itemId;

          if (!itemId) {
            throw new ValidationError('Item ID is required');
          }

          const body = await req.json();
          const data = updateQuoteItemSchema.parse(body);

          const item = await this.quoteService.updateItem(quoteId, itemId, data, apiRequest.context);

          return createSuccessResponse(this.serializeQuoteItems(gate, [item])[0] ?? null);
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.issues));
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
          const gate = await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const body = await req.json();
          const data = reorderQuoteItemsSchema.parse(body);

          const items = await this.quoteService.reorderItems(id, data.item_ids, apiRequest.context);

          return createSuccessResponse(this.serializeQuoteItems(gate, items));
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.issues));
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
          const gate = await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const body = await req.json().catch(() => ({}));
          const data = sendQuoteSchema.parse(body);

          const quote = await this.quoteService.send(id, data, apiRequest.context);

          return createSuccessResponse(this.serializeQuote(gate, quote));
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.issues));
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
          const gate = await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const body = await req.json().catch(() => ({}));
          const data = sendQuoteSchema.parse(body);

          const quote = await this.quoteService.send(id, data, apiRequest.context);

          return createSuccessResponse(this.serializeQuote(gate, quote));
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.issues));
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
          const gate = await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const quote = await this.quoteService.sendReminder(id, apiRequest.context);

          return createSuccessResponse(this.serializeQuote(gate, quote));
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
          const gate = await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const quote = await this.quoteService.submitForApproval(id, apiRequest.context);

          return createSuccessResponse(this.serializeQuote(gate, quote));
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
          await this.checkQuoteApprovePermission(apiRequest);

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          // The projection only gates access. Approval logic (status, owner for the self-approval guard) needs the
          // unredacted row, which is never serialized.
          const gate = await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const existingQuote = await this.quoteService.getById(id, apiRequest.context);
          if (!existingQuote) {
            throw new NotFoundError('Quote not found');
          }

          if (existingQuote.status !== 'pending_approval') {
            throw new ConflictError('Only quotes pending approval can be approved');
          }

          const { selfApproved } = await this.assertQuoteApproveAllowed(apiRequest, existingQuote as Record<string, any>);
          const quote = await this.quoteService.approve(id, apiRequest.context, { selfApproved });

          return createSuccessResponse(this.serializeQuote(gate, quote));
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
          await this.checkQuoteApprovePermission(apiRequest);

          const id = await this.extractIdFromPath(apiRequest);
          const knex = await getConnection(apiRequest.context.tenant);
          const body = await this.readJsonBody(req);
          const data = approvalRequestChangesSchema.parse(body);
          // Gate only; the status check needs the unredacted row, which is never serialized.
          const gate = await this.assertQuoteReadAllowed(apiRequest, id, knex);
          const existingQuote = await this.quoteService.getById(id, apiRequest.context);
          if (!existingQuote) {
            throw new NotFoundError('Quote not found');
          }

          if (existingQuote.status !== 'pending_approval') {
            throw new ConflictError('Only quotes pending approval can be sent back for changes');
          }

          const quote = await this.quoteService.requestChanges(id, data.reason, apiRequest.context);

          return createSuccessResponse(this.serializeQuote(gate, quote));
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.issues));
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
          // LEVERAGE: pattern api-json-body-400 — raw req.json() throws SyntaxError -> 500 on empty/bad bodies; readJsonBody() (added for request-changes) belongs in ApiBaseController.
          const body = await req.json();
          const data = convertQuoteSchema.parse(body);

          const result = await this.quoteService.convert(id, data, apiRequest.context);

          return createSuccessResponse(result, 201);
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return handleApiError(new ValidationError('Validation failed', error.issues));
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
          const gate = await this.assertQuoteReadAllowed(apiRequest, id, knex);

          const revision = await this.quoteService.createRevision(id, apiRequest.context);

          return createSuccessResponse(this.serializeQuote(gate, revision), 201);
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
