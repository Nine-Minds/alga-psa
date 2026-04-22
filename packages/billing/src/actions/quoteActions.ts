'use server';
/* eslint-disable custom-rules/no-feature-to-feature-imports -- Quote PDF generation creates document records - direct model access required in server action context */

import { randomUUID } from 'crypto';
import { createTenantKnex } from '@alga-psa/db';
import type { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { TenantEmailService } from '@alga-psa/email';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { IContract, IInvoice, TemplateAst, IQuote, IQuoteItem, IQuoteListItem, PaginatedResult, QuoteConversionPreview } from '@alga-psa/types';
import Quote, { type QuoteListOptions } from '../models/quote';
import QuoteActivity from '../models/quoteActivity';
import QuoteItem from '../models/quoteItem';
import { buildQuoteReminderEmailTemplate, buildQuoteSentEmailTemplate } from '../lib/quote-email-templates';
import { getQuoteApprovalWorkflowSettings as loadQuoteApprovalWorkflowSettings, setQuoteApprovalWorkflowRequired as persistQuoteApprovalWorkflowRequired, type QuoteApprovalWorkflowSettings } from '../lib/quoteApprovalSettings';
import { createQuoteItemSchema, createQuoteSchema, updateQuoteItemSchema, updateQuoteSchema } from '../schemas/quoteSchemas';
import { buildQuoteConversionPreview, convertQuoteToDraftContract, convertQuoteToDraftContractAndInvoice, convertQuoteToDraftInvoice, createPDFGenerationService } from '../services';
import { Document as DocumentModel, DocumentAssociation } from '@alga-psa/documents/models';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
} from 'server/src/lib/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from 'server/src/lib/authorization/bundles/service';
import { buildAuthorizationAwarePage } from 'server/src/lib/api/controllers/authorizationAwarePagination';

type CreateQuoteInput = Omit<
  IQuote,
  | 'quote_id'
  | 'tenant'
  | 'quote_number'
  | 'quote_items'
  | 'quote_activities'
  | 'created_at'
  | 'updated_at'
  | 'status'
  | 'version'
> & Partial<Pick<IQuote, 'status' | 'version'>>;

type CreateQuoteFromTemplateInput = Pick<CreateQuoteInput, 'client_id' | 'quote_date' | 'valid_until'>
  & Partial<Omit<CreateQuoteInput, 'client_id' | 'quote_date' | 'valid_until' | 'is_template'>>;

type CreateQuoteItemInput = Omit<
  IQuoteItem,
  | 'quote_item_id'
  | 'tenant'
  | 'total_price'
  | 'net_amount'
  | 'tax_amount'
  | 'display_order'
  | 'created_at'
  | 'updated_at'
> & Partial<Pick<IQuoteItem, 'display_order'>>;

type UpdateQuoteItemInput = Partial<IQuoteItem>;

interface SendQuoteInput {
  email_addresses?: string[];
  subject?: string;
  message?: string;
}

const requireBillingCreatePermission = async (user: unknown): Promise<ActionPermissionError | null> => {
  if (!await hasPermission(user as any, 'billing', 'create')) {
    return permissionError('Permission denied: Cannot create quotes');
  }

  return null;
};

const requireBillingUpdatePermission = async (user: unknown): Promise<ActionPermissionError | null> => {
  if (!await hasPermission(user as any, 'billing', 'update')) {
    return permissionError('Permission denied: Cannot update quotes');
  }

  return null;
};

const requireBillingReadPermission = async (user: unknown): Promise<ActionPermissionError | null> => {
  if (!await hasPermission(user as any, 'billing', 'read')) {
    return permissionError('Permission denied: Cannot read quotes');
  }

  return null;
};

const requireBillingDeletePermission = async (user: unknown): Promise<ActionPermissionError | null> => {
  if (!await hasPermission(user as any, 'billing', 'delete')) {
    return permissionError('Permission denied: Cannot delete quotes');
  }

  return null;
};

const requireSettingsUpdatePermission = async (user: unknown): Promise<ActionPermissionError | null> => {
  if (!await hasPermission(user as any, 'settings', 'update')) {
    return permissionError('Permission denied: Cannot update quote approval settings');
  }

  return null;
};

const requireQuoteApprovePermission = async (user: unknown): Promise<ActionPermissionError | null> => {
  if (!await hasPermission(user as any, 'quotes', 'approve')) {
    return permissionError('Permission denied: Cannot approve quotes');
  }

  return null;
};

const getActorUserId = (user: unknown): string | null => {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const candidate = (user as { user_id?: string; id?: string }).user_id ?? (user as { id?: string }).id;
  return typeof candidate === 'string' ? candidate : null;
};

type BillingAuthUser = {
  user_id: string;
  user_type: 'internal' | 'client';
  clientId?: string | null;
  roles?: Array<{ role_id?: string } | string>;
};

function extractRoleIdsFromUser(user: BillingAuthUser): string[] {
  if (!Array.isArray(user.roles)) {
    return [];
  }

  return user.roles
    .map((role) => {
      if (typeof role === 'string') {
        return role;
      }
      return typeof role?.role_id === 'string' ? role.role_id : null;
    })
    .filter((value): value is string => Boolean(value));
}

async function resolveAuthorizationSubjectForUser(
  knex: Knex,
  tenant: string,
  user: BillingAuthUser
): Promise<AuthorizationSubject> {
  let roleIds = extractRoleIdsFromUser(user);
  if (roleIds.length === 0) {
    try {
      const roleRows = await knex('user_roles')
        .where({ tenant, user_id: user.user_id })
        .select<{ role_id: string }[]>('role_id');
      roleIds = roleRows.map((row) => row.role_id);
    } catch {
      roleIds = [];
    }
  }

  const [teamRows, managedRows] = await Promise.all([
    knex('team_members').where({ tenant, user_id: user.user_id }).select<{ team_id: string }[]>('team_id').catch(() => []),
    knex('users').where({ tenant, reports_to: user.user_id }).select<{ user_id: string }[]>('user_id').catch(() => []),
  ]);

  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds,
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? null,
    portfolioClientIds: user.clientId ? [user.clientId] : [],
  };
}

function toQuoteAuthorizationRecord(quote: Partial<IQuote>): AuthorizationRecord {
  return {
    id: quote.quote_id ?? null,
    ownerUserId: quote.created_by ?? null,
    clientId: quote.client_id ?? null,
  };
}

function createQuoteAuthorizationKernel(knex: Knex | Knex.Transaction, includeApproveGuard = false) {
  return createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      mutationGuards: includeApproveGuard
        ? [
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
          ]
        : [],
    }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => {
        try {
          return await resolveBundleNarrowingRulesForEvaluation(knex, input);
        } catch {
          return [];
        }
      },
    }),
    rbacEvaluator: async () => true,
  });
}

async function authorizeQuoteReadDecision(
  knex: Knex | Knex.Transaction,
  tenant: string,
  user: BillingAuthUser,
  quote: Partial<IQuote>
) {
  const subject = await resolveAuthorizationSubjectForUser(knex, tenant, user);
  const authorizationKernel = createQuoteAuthorizationKernel(knex);
  const decision = await authorizationKernel.authorizeResource({
    subject,
    resource: {
      type: 'billing',
      action: 'read',
      id: quote.quote_id ?? null,
    },
    record: toQuoteAuthorizationRecord(quote),
    requestCache: new RequestLocalAuthorizationCache(),
    knex,
  });

  return { decision, subject, authorizationKernel };
}

async function getAuthorizedQuoteForRead(
  knex: Knex | Knex.Transaction,
  tenant: string,
  user: BillingAuthUser,
  quoteId: string
): Promise<IQuote | null> {
  const quote = await Quote.getById(knex, tenant, quoteId);
  if (!quote) {
    return null;
  }

  const { decision } = await authorizeQuoteReadDecision(knex, tenant, user, quote);
  if (!decision.allowed) {
    return null;
  }

  return applyQuoteRedactions(quote, decision.redactedFields);
}

async function assertQuoteReadAllowedForMutation(
  knex: Knex | Knex.Transaction,
  tenant: string,
  user: BillingAuthUser,
  quoteId: string,
  deniedMessage: string
): Promise<IQuote> {
  const quote = await Quote.getById(knex, tenant, quoteId);
  if (!quote) {
    throw new Error(`Quote ${quoteId} not found in tenant ${tenant}`);
  }

  const { decision } = await authorizeQuoteReadDecision(knex, tenant, user, quote);
  if (!decision.allowed) {
    throw new Error(deniedMessage);
  }

  return quote;
}

function applyQuoteRedactions<T extends object>(value: T, redactedFields: string[]): T {
  if (redactedFields.length === 0) {
    return value;
  }
  const redacted = { ...value } as Record<string, unknown>;
  for (const field of redactedFields) {
    delete redacted[field];
  }
  return redacted as T;
}

const QUOTE_DATE_FIELDS = [
  'quote_date',
  'valid_until',
  'archived_at',
  'sent_at',
  'viewed_at',
  'accepted_at',
  'rejected_at',
  'cancelled_at',
  'expired_at',
  'converted_at',
] as const;

const normalizeQuoteDates = (value: Record<string, any>): Record<string, any> => {
  const normalized: Record<string, any> = { ...value };

  for (const field of QUOTE_DATE_FIELDS) {
    if (normalized[field] instanceof Date) {
      normalized[field] = normalized[field].toISOString();
    }
  }

  return normalized;
};

const getQuoteRecipients = async (
  knex: Knex,
  tenant: string,
  quote: IQuote,
  emailAddresses: string[] = []
): Promise<string[]> => {
  const [contactRecipient, clientRecipient] = await Promise.all([
    quote.contact_id
      ? knex('contacts')
        .select('email')
        .where({ tenant, contact_name_id: quote.contact_id })
        .first<{ email?: string | null }>()
      : Promise.resolve(null),
    quote.client_id
      ? knex('clients')
        .select('billing_email')
        .where({ tenant, client_id: quote.client_id })
        .first<{ billing_email?: string | null }>()
      : Promise.resolve(null),
  ]);

  return Array.from(
    new Set(
      [
        ...emailAddresses,
        contactRecipient?.email ?? '',
        clientRecipient?.billing_email ?? '',
      ]
        .map((email) => email.trim())
        .filter((email) => email.length > 0)
    )
  );
};

const storeQuotePdf = async (
  knex: Knex,
  tenant: string,
  quote: IQuote,
  userId: string
): Promise<string> => {
  const pdfService = createPDFGenerationService(tenant);
  const fileRecord = await pdfService.generateAndStore({
    quoteId: quote.quote_id,
    quoteNumber: quote.quote_number ?? undefined,
    userId,
  });

  const documentId = randomUUID();
  const resolvedQuoteNumber = quote.quote_number ?? quote.quote_id;

  await DocumentModel.insert(knex, {
    document_id: documentId,
    document_name: `Quote_${resolvedQuoteNumber}.pdf`,
    type_id: null,
    user_id: userId,
    created_by: userId,
    order_number: 0,
    tenant,
    file_id: fileRecord.file_id,
    storage_path: fileRecord.storage_path,
    mime_type: 'application/pdf',
    file_size: fileRecord.file_size,
    folder_path: '/Quotes/Generated',
    is_client_visible: true,
  });

  await DocumentAssociation.create(knex, {
    document_id: documentId,
    entity_id: quote.quote_id,
    entity_type: 'quote',
    tenant,
  });

  return fileRecord.file_id;
};

const sendQuoteEmailWithAttachment = async ({
  tenant,
  quote,
  user,
  recipients,
  subject,
  html,
  text,
}: {
  tenant: string;
  quote: IQuote;
  user: unknown;
  recipients: string[];
  subject: string;
  html: string;
  text: string;
}) => {
  const actorId = getActorUserId(user);
  const pdfBuffer = await createPDFGenerationService(tenant).generatePDF({ quoteId: quote.quote_id, userId: actorId ?? '' });
  const resolvedQuoteNumber = quote.quote_number ?? quote.quote_id;

  return await TenantEmailService.getInstance(tenant).sendEmail({
    tenantId: tenant,
    to: recipients,
    subject,
    html,
    text,
    attachments: [
      {
        filename: `Quote_${resolvedQuoteNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
    entityType: 'quote',
    entityId: quote.quote_id,
    contactId: quote.contact_id ?? undefined,
    userId: getActorUserId(user) ?? undefined,
  });
};

export const createQuote = withAuth(async (user, { tenant }, input: CreateQuoteInput): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireBillingCreatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const parsedInput = normalizeQuoteDates(createQuoteSchema.parse({
    ...input,
    created_by: input.created_by ?? getActorUserId(user),
  }));

  const createdQuote = await Quote.create(knex, tenant, {
    ...parsedInput,
    subtotal: input.subtotal ?? 0,
    discount_total: input.discount_total ?? 0,
    tax: input.tax ?? 0,
    total_amount: input.total_amount ?? 0,
  } as any);
  return await Quote.getById(knex, tenant, createdQuote.quote_id) as IQuote;
});

export const updateQuote = withAuth(async (
  user,
  { tenant },
  quoteId: string,
  input: Partial<IQuote>
): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireBillingUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot update quote'
  );
  const parsedInput = normalizeQuoteDates(updateQuoteSchema.parse({
    ...input,
    updated_by: input.updated_by ?? getActorUserId(user),
  }));

  const updatedQuote = await Quote.update(knex, tenant, quoteId, parsedInput as Partial<IQuote>);
  return await Quote.getById(knex, tenant, updatedQuote.quote_id) as IQuote;
});

export const getQuote = withAuth(async (
  user,
  { tenant },
  quoteId: string
): Promise<IQuote | null | ActionPermissionError> => {
  const denied = await requireBillingReadPermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await getAuthorizedQuoteForRead(knex, tenant, user as BillingAuthUser, quoteId);
  if (!quote) return null;

  // Resolve accepted_by UUID to a display name
  if (quote.accepted_by) {
    try {
      const contact = await knex('contacts')
        .select('full_name')
        .where({ tenant, contact_name_id: quote.accepted_by })
        .first<{ full_name?: string }>();
      if (contact?.full_name) {
        quote.accepted_by_name = contact.full_name;
      } else {
        const user = await knex('users')
          .select('first_name', 'last_name')
          .where({ tenant, user_id: quote.accepted_by })
          .first<{ first_name?: string; last_name?: string }>();
        if (user) {
          quote.accepted_by_name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null;
        }
      }
    } catch {
      // Non-blocking
    }
  }

  return quote;
});

export const listQuotes = withAuth(async (
  user,
  { tenant },
  options: QuoteListOptions = {}
): Promise<PaginatedResult<IQuoteListItem> | ActionPermissionError> => {
  const denied = await requireBillingReadPermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const page = Number.isFinite(options.page) && (options.page ?? 0) > 0 ? Number(options.page) : 1;
  const pageSize =
    Number.isFinite(options.pageSize) && (options.pageSize ?? 0) > 0
      ? Math.min(Number(options.pageSize), 200)
      : 25;

  const subject = await resolveAuthorizationSubjectForUser(knex, tenant, user as BillingAuthUser);
  const authorizationKernel = createQuoteAuthorizationKernel(knex);
  const requestCache = new RequestLocalAuthorizationCache();
  const authorizedPage = await buildAuthorizationAwarePage<IQuoteListItem>({
    page,
    limit: pageSize,
    fetchPage: (sourcePage, sourceLimit) =>
      Quote.listByTenant(knex, tenant, {
        ...options,
        page: sourcePage,
        pageSize: sourceLimit,
      }),
    authorizeRecord: async (quote) => {
      const decision = await authorizationKernel.authorizeResource({
        subject,
        resource: {
          type: 'billing',
          action: 'read',
          id: quote.quote_id,
        },
        record: toQuoteAuthorizationRecord(quote as unknown as Partial<IQuote>),
        requestCache,
        knex,
      });
      return decision.allowed;
    },
    scanLimit: Math.max(pageSize, 100),
  });
  const redactedData = await Promise.all(
    authorizedPage.data.map(async (quote) => {
      const decision = await authorizationKernel.authorizeResource({
        subject,
        resource: {
          type: 'billing',
          action: 'read',
          id: quote.quote_id,
        },
        record: toQuoteAuthorizationRecord(quote as unknown as Partial<IQuote>),
        requestCache,
        knex,
      });
      return applyQuoteRedactions(quote, decision.redactedFields ?? []);
    })
  );

  return {
    data: redactedData,
    total: authorizedPage.total,
    page,
    pageSize,
    totalPages: Math.ceil(authorizedPage.total / pageSize) || 1,
  };
});

export const deleteQuote = withAuth(async (
  user,
  { tenant },
  quoteId: string
): Promise<Awaited<ReturnType<typeof Quote.delete>> | ActionPermissionError> => {
  const denied = await requireBillingDeletePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot delete quote'
  );
  return await Quote.delete(knex, tenant, quoteId);
});

export const addQuoteItem = withAuth(async (
  user,
  { tenant },
  input: CreateQuoteItemInput
): Promise<IQuoteItem | ActionPermissionError> => {
  const denied = await requireBillingUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const parsedInput = createQuoteItemSchema.parse({
    ...input,
    created_by: input.created_by ?? getActorUserId(user),
  });
  await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    parsedInput.quote_id,
    'Permission denied: Cannot update quote'
  );

  return await QuoteItem.create(knex, tenant, parsedInput as any);
});

export const updateQuoteItem = withAuth(async (
  user,
  { tenant },
  quoteItemId: string,
  input: UpdateQuoteItemInput
): Promise<IQuoteItem | ActionPermissionError> => {
  const denied = await requireBillingUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const parsedInput = updateQuoteItemSchema.parse({
    ...input,
    updated_by: input.updated_by ?? getActorUserId(user),
  });
  const quoteItem = await knex('quote_items')
    .where({ tenant, quote_item_id: quoteItemId })
    .first<{ quote_id: string; quote_item_id: string }>('quote_id', 'quote_item_id');
  if (!quoteItem) {
    throw new Error(`Quote item ${quoteItemId} not found in tenant ${tenant}`);
  }
  if (typeof parsedInput.quote_id === 'string' && parsedInput.quote_id !== quoteItem.quote_id) {
    throw new Error('Quote item updates cannot move items across quotes.');
  }
  await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteItem.quote_id,
    'Permission denied: Cannot update quote'
  );

  return await QuoteItem.update(knex, tenant, quoteItemId, parsedInput);
});

export const removeQuoteItem = withAuth(async (
  user,
  { tenant },
  quoteItemId: string
): Promise<boolean | ActionPermissionError> => {
  const denied = await requireBillingUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quoteItem = await knex('quote_items')
    .where({ tenant, quote_item_id: quoteItemId })
    .first<{ quote_id: string; quote_item_id: string }>('quote_id', 'quote_item_id');
  if (!quoteItem) {
    throw new Error(`Quote item ${quoteItemId} not found in tenant ${tenant}`);
  }
  await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteItem.quote_id,
    'Permission denied: Cannot update quote'
  );
  return await QuoteItem.delete(knex, tenant, quoteItemId);
});

export const reorderQuoteItems = withAuth(async (
  user,
  { tenant },
  quoteId: string,
  orderedQuoteItemIds: string[]
): Promise<IQuoteItem[] | ActionPermissionError> => {
  const denied = await requireBillingUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot update quote'
  );
  return await QuoteItem.reorder(knex, tenant, quoteId, orderedQuoteItemIds);
});

export const createQuoteFromTemplate = withAuth(async (
  user,
  { tenant },
  templateQuoteId: string,
  input: CreateQuoteFromTemplateInput
): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireBillingCreatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();

  return await knex.transaction(async (trx) => {
    const template = await assertQuoteReadAllowedForMutation(
      trx,
      tenant,
      user as BillingAuthUser,
      templateQuoteId,
      'Permission denied: Cannot read quote template'
    );
    if (!template) {
      throw new Error(`Quote template ${templateQuoteId} not found in tenant ${tenant}`);
    }

    if (!template.is_template) {
      throw new Error(`Quote ${templateQuoteId} is not a template`);
    }

    const actorUserId = getActorUserId(user);
    const parsedQuote = normalizeQuoteDates(createQuoteSchema.parse({
      client_id: input.client_id,
      contact_id: input.contact_id ?? null,
      title: input.title ?? template.title,
      description: input.description ?? template.description ?? null,
      quote_date: input.quote_date,
      valid_until: input.valid_until,
      po_number: input.po_number ?? null,
      internal_notes: input.internal_notes ?? template.internal_notes ?? null,
      client_notes: input.client_notes ?? template.client_notes ?? null,
      terms_and_conditions: input.terms_and_conditions ?? template.terms_and_conditions ?? null,
      currency_code: input.currency_code ?? template.currency_code,
      is_template: false,
      created_by: input.created_by ?? actorUserId,
    }));

    const createdQuote = await Quote.create(trx, tenant, {
      ...parsedQuote,
      subtotal: input.subtotal ?? 0,
      discount_total: input.discount_total ?? 0,
      tax: input.tax ?? 0,
      total_amount: input.total_amount ?? 0,
    } as any);

    for (const templateItem of template.quote_items ?? []) {
      await QuoteItem.create(trx, tenant, {
        quote_id: createdQuote.quote_id,
        service_id: templateItem.service_id ?? null,
        service_item_kind: templateItem.service_item_kind ?? null,
        service_name: templateItem.service_name ?? null,
        service_sku: templateItem.service_sku ?? null,
        billing_method: templateItem.billing_method ?? null,
        description: templateItem.description,
        quantity: templateItem.quantity,
        unit_price: templateItem.unit_price,
        unit_of_measure: templateItem.unit_of_measure ?? null,
        display_order: templateItem.display_order,
        phase: templateItem.phase ?? null,
        is_optional: templateItem.is_optional,
        is_selected: templateItem.is_selected,
        is_recurring: templateItem.is_recurring,
        billing_frequency: templateItem.billing_frequency ?? null,
        is_discount: templateItem.is_discount ?? false,
        discount_type: templateItem.discount_type ?? null,
        discount_percentage: templateItem.discount_percentage ?? null,
        applies_to_item_id: templateItem.applies_to_item_id ?? null,
        applies_to_service_id: templateItem.applies_to_service_id ?? null,
        is_taxable: templateItem.is_taxable ?? true,
        cost: templateItem.cost ?? null,
        cost_currency: templateItem.cost_currency ?? null,
        location_id: templateItem.location_id ?? null,
        created_by: actorUserId,
      });
    }

    return await Quote.getById(trx, tenant, createdQuote.quote_id) as IQuote;
  });
});

export const duplicateQuote = withAuth(async (
  user,
  { tenant },
  quoteId: string
): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireBillingCreatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();

  return await knex.transaction(async (trx) => {
    const sourceQuote = await assertQuoteReadAllowedForMutation(
      trx,
      tenant,
      user as BillingAuthUser,
      quoteId,
      'Permission denied: Cannot duplicate quote'
    );

    if (sourceQuote.is_template) {
      throw new Error('Use createQuoteFromTemplate for business templates');
    }

    const actorUserId = getActorUserId(user);
    const duplicatedQuote = await Quote.create(trx, tenant, {
      client_id: sourceQuote.client_id ?? null,
      contact_id: sourceQuote.contact_id ?? null,
      title: sourceQuote.title,
      description: sourceQuote.description ?? null,
      quote_date: sourceQuote.quote_date ?? null,
      valid_until: sourceQuote.valid_until ?? null,
      po_number: sourceQuote.po_number ?? null,
      internal_notes: sourceQuote.internal_notes ?? null,
      client_notes: sourceQuote.client_notes ?? null,
      terms_and_conditions: sourceQuote.terms_and_conditions ?? null,
      currency_code: sourceQuote.currency_code,
      tax_source: sourceQuote.tax_source ?? 'internal',
      is_template: false,
      opportunity_id: sourceQuote.opportunity_id ?? null,
      created_by: actorUserId,
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
    } as any);

    for (const sourceItem of sourceQuote.quote_items ?? []) {
      await QuoteItem.create(trx, tenant, {
        quote_id: duplicatedQuote.quote_id,
        service_id: sourceItem.service_id ?? null,
        service_item_kind: sourceItem.service_item_kind ?? null,
        service_name: sourceItem.service_name ?? null,
        service_sku: sourceItem.service_sku ?? null,
        billing_method: sourceItem.billing_method ?? null,
        description: sourceItem.description,
        quantity: sourceItem.quantity,
        unit_price: sourceItem.unit_price,
        unit_of_measure: sourceItem.unit_of_measure ?? null,
        display_order: sourceItem.display_order,
        phase: sourceItem.phase ?? null,
        is_optional: sourceItem.is_optional,
        is_selected: sourceItem.is_selected,
        is_recurring: sourceItem.is_recurring,
        billing_frequency: sourceItem.billing_frequency ?? null,
        is_discount: sourceItem.is_discount ?? false,
        discount_type: sourceItem.discount_type ?? null,
        discount_percentage: sourceItem.discount_percentage ?? null,
        applies_to_item_id: sourceItem.applies_to_item_id ?? null,
        applies_to_service_id: sourceItem.applies_to_service_id ?? null,
        is_taxable: sourceItem.is_taxable ?? true,
        tax_region: sourceItem.tax_region ?? null,
        tax_rate: sourceItem.tax_rate ?? null,
        cost: sourceItem.cost ?? null,
        cost_currency: sourceItem.cost_currency ?? null,
        location_id: sourceItem.location_id ?? null,
        created_by: actorUserId,
      });
    }

    await QuoteActivity.create(trx, tenant, {
      quote_id: duplicatedQuote.quote_id,
      activity_type: 'duplicated',
      description: `Quote duplicated from ${sourceQuote.quote_number || sourceQuote.title}`,
      performed_by: actorUserId,
      metadata: { source_quote_id: sourceQuote.quote_id },
    });

    return await Quote.getById(trx, tenant, duplicatedQuote.quote_id) as IQuote;
  });
});

export const saveQuoteAsTemplate = withAuth(async (
  user,
  { tenant },
  quoteId: string
): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireBillingCreatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();

  return await knex.transaction(async (trx) => {
    const sourceQuote = await assertQuoteReadAllowedForMutation(
      trx,
      tenant,
      user as BillingAuthUser,
      quoteId,
      'Permission denied: Cannot read quote'
    );

    if (sourceQuote.is_template) {
      throw new Error('Quote is already a template');
    }

    const actorUserId = getActorUserId(user);
    const templateQuote = await Quote.create(trx, tenant, {
      client_id: null,
      contact_id: null,
      title: `${sourceQuote.title} Template`,
      description: sourceQuote.description ?? null,
      quote_date: null,
      valid_until: null,
      po_number: null,
      internal_notes: sourceQuote.internal_notes ?? null,
      client_notes: sourceQuote.client_notes ?? null,
      terms_and_conditions: sourceQuote.terms_and_conditions ?? null,
      currency_code: sourceQuote.currency_code,
      tax_source: sourceQuote.tax_source ?? 'internal',
      is_template: true,
      opportunity_id: null,
      created_by: actorUserId,
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
    } as any);

    for (const sourceItem of sourceQuote.quote_items ?? []) {
      await QuoteItem.create(trx, tenant, {
        quote_id: templateQuote.quote_id,
        service_id: sourceItem.service_id ?? null,
        service_item_kind: sourceItem.service_item_kind ?? null,
        service_name: sourceItem.service_name ?? null,
        service_sku: sourceItem.service_sku ?? null,
        billing_method: sourceItem.billing_method ?? null,
        description: sourceItem.description,
        quantity: sourceItem.quantity,
        unit_price: sourceItem.unit_price,
        unit_of_measure: sourceItem.unit_of_measure ?? null,
        display_order: sourceItem.display_order,
        phase: sourceItem.phase ?? null,
        is_optional: sourceItem.is_optional,
        is_selected: true,
        is_recurring: sourceItem.is_recurring,
        billing_frequency: sourceItem.billing_frequency ?? null,
        is_discount: sourceItem.is_discount ?? false,
        discount_type: sourceItem.discount_type ?? null,
        discount_percentage: sourceItem.discount_percentage ?? null,
        applies_to_item_id: sourceItem.applies_to_item_id ?? null,
        applies_to_service_id: sourceItem.applies_to_service_id ?? null,
        is_taxable: sourceItem.is_taxable ?? true,
        tax_region: sourceItem.tax_region ?? null,
        tax_rate: sourceItem.tax_rate ?? null,
        cost: sourceItem.cost ?? null,
        cost_currency: sourceItem.cost_currency ?? null,
        location_id: sourceItem.location_id ?? null,
        created_by: actorUserId,
      });
    }

    await QuoteActivity.create(trx, tenant, {
      quote_id: templateQuote.quote_id,
      activity_type: 'created_from_quote',
      description: `Template created from ${sourceQuote.quote_number || sourceQuote.title}`,
      performed_by: actorUserId,
      metadata: { source_quote_id: sourceQuote.quote_id },
    });

    return await Quote.getById(trx, tenant, templateQuote.quote_id) as IQuote;
  });
});

export const createQuoteRevision = withAuth(async (
  user,
  { tenant },
  quoteId: string
): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireBillingUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot update quote'
  );
  return await knex.transaction((trx) => Quote.createRevision(trx, tenant, quoteId, getActorUserId(user)));
});

export const submitQuoteForApproval = withAuth(async (
  user,
  { tenant },
  quoteId: string
): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireBillingUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot update quote'
  );

  if (quote.is_template) {
    throw new Error('Quote templates cannot be submitted for approval');
  }

  if (quote.status !== 'draft') {
    throw new Error('Only draft quotes can be submitted for approval');
  }

  return await Quote.update(knex, tenant, quoteId, {
    status: 'pending_approval',
    updated_by: getActorUserId(user),
  });
});

export const listQuoteVersions = withAuth(async (
  user,
  { tenant },
  quoteId: string
): Promise<IQuote[] | ActionPermissionError> => {
  const denied = await requireBillingReadPermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const readableQuote = await getAuthorizedQuoteForRead(knex, tenant, user as BillingAuthUser, quoteId);
  if (!readableQuote) {
    return permissionError('Permission denied: Cannot read quote');
  }
  return await Quote.listVersions(knex, tenant, quoteId);
});

export const getQuoteApprovalSettings = withAuth(async (
  user,
  { tenant }
): Promise<QuoteApprovalWorkflowSettings | ActionPermissionError> => {
  const denied = await requireBillingReadPermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  return await loadQuoteApprovalWorkflowSettings(knex, tenant);
});

export const updateQuoteApprovalSettings = withAuth(async (
  user,
  { tenant },
  approvalRequired: boolean
): Promise<QuoteApprovalWorkflowSettings | ActionPermissionError> => {
  const denied = await requireSettingsUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  return await persistQuoteApprovalWorkflowRequired(knex, tenant, approvalRequired);
});

export const approveQuote = withAuth(async (
  user,
  { tenant },
  quoteId: string,
  comment?: string
): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireQuoteApprovePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot approve quote'
  );

  if (quote.status !== 'pending_approval') {
    throw new Error('Only quotes pending approval can be approved');
  }

  const subject = await resolveAuthorizationSubjectForUser(knex, tenant, user as BillingAuthUser);
  const authorizationKernel = createQuoteAuthorizationKernel(knex, true);
  const mutationDecision = await authorizationKernel.authorizeMutation({
    subject,
    resource: {
      type: 'billing',
      action: 'approve',
      id: quote.quote_id,
    },
    record: toQuoteAuthorizationRecord(quote),
    mutation: {
      kind: 'approve',
      record: toQuoteAuthorizationRecord(quote),
    },
    requestCache: new RequestLocalAuthorizationCache(),
    knex,
  });
  if (!mutationDecision.allowed) {
    throw new Error('Permission denied: Cannot approve your own quote');
  }

  const updatedQuote = await Quote.update(knex, tenant, quoteId, {
    status: 'approved',
    updated_by: getActorUserId(user),
  });

  await QuoteActivity.create(knex, tenant, {
    quote_id: quoteId,
    activity_type: 'approved',
    description: comment?.trim() ? `Quote approved: ${comment.trim()}` : 'Quote approved',
    performed_by: getActorUserId(user),
    metadata: { comment: comment?.trim() || null },
  });

  return updatedQuote;
});

export const requestQuoteApprovalChanges = withAuth(async (
  user,
  { tenant },
  quoteId: string,
  comment: string
): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireQuoteApprovePermission(user);
  if (denied) {
    return denied;
  }

  const trimmedComment = comment.trim();
  if (!trimmedComment) {
    throw new Error('A comment is required when requesting quote changes');
  }

  const { knex } = await createTenantKnex();
  const quote = await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot update quote'
  );

  if (quote.status !== 'pending_approval') {
    throw new Error('Only quotes pending approval can be sent back for changes');
  }

  const updatedQuote = await Quote.update(knex, tenant, quoteId, {
    status: 'draft',
    updated_by: getActorUserId(user),
  });

  await QuoteActivity.create(knex, tenant, {
    quote_id: quoteId,
    activity_type: 'approval_changes_requested',
    description: `Approval changes requested: ${trimmedComment}`,
    performed_by: getActorUserId(user),
    metadata: { comment: trimmedComment },
  });

  return updatedQuote;
});

export const sendQuote = withAuth(async (
  user,
  { tenant },
  quoteId: string,
  input: SendQuoteInput = {}
): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireBillingUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot update quote'
  );

  if (quote.is_template) {
    throw new Error('Quote templates cannot be sent to clients');
  }

  const approvalSettings = await loadQuoteApprovalWorkflowSettings(knex, tenant);

  if (approvalSettings.approvalRequired) {
    if (quote.status !== 'approved') {
      throw new Error('Only approved quotes can be sent when quote approval is required');
    }
  } else if (quote.status !== 'draft' && quote.status !== 'approved') {
    throw new Error('Only draft or approved quotes can be sent');
  }

  // Transition to "sent" first — this publishes the quote in the client portal
  const actorUserId = getActorUserId(user);
  await Quote.update(knex, tenant, quoteId, {
    status: 'sent',
    sent_at: new Date().toISOString(),
    updated_by: actorUserId,
  });

  // Store the generated PDF as a document associated with the quote (best-effort)
  try {
    await storeQuotePdf(knex, tenant, quote, actorUserId ?? quote.created_by ?? 'system');
  } catch (pdfStoreError) {
    console.error('Failed to store quote PDF:', pdfStoreError);
  }

  // Attempt email notification (best-effort — quote is already visible in client portal)
  let emailSent = false;
  let emailRecipients: string[] = [];
  let emailMessageId: string | null = null;
  try {
    const [recipients, tenantRecord] = await Promise.all([
      getQuoteRecipients(knex, tenant, quote, input.email_addresses ?? []),
      knex('tenants').select('client_name').where({ tenant }).first<{ client_name?: string | null }>(),
    ]);

    if (recipients.length > 0) {
      emailRecipients = recipients;
      const companyName = tenantRecord?.client_name?.trim() || 'Your Company';
      const portalBaseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const portalLink = `${portalBaseUrl}/client-portal/billing?tab=quotes`;
      const renderedEmail = buildQuoteSentEmailTemplate({
        quote,
        companyName,
        portalLink,
        customMessage: input.message,
      });
      const subject = input.subject?.trim() || renderedEmail.subject;

      const emailResult = await sendQuoteEmailWithAttachment({
        tenant,
        quote,
        user,
        recipients,
        subject,
        html: renderedEmail.html,
        text: renderedEmail.text,
      });

      emailSent = emailResult.success;
      emailMessageId = emailResult.messageId ?? null;
      if (!emailResult.success) {
        console.warn('Quote email failed (quote is still published in client portal):', emailResult.error);
      }
    }
  } catch (emailError) {
    console.warn('Quote email failed (quote is still published in client portal):', emailError);
  }

  const activityDescription = emailSent && emailRecipients.length > 0
    ? `Quote sent to ${emailRecipients.join(', ')} and published in client portal`
    : 'Quote published in client portal';

  await QuoteActivity.create(knex, tenant, {
    quote_id: quoteId,
    activity_type: 'sent',
    description: activityDescription,
    performed_by: actorUserId,
    metadata: {
      recipients: emailRecipients,
      email_sent: emailSent,
      message_id: emailMessageId,
    },
  });

  return await Quote.getById(knex, tenant, quoteId) as IQuote;
});

export const resendQuote = withAuth(async (
  user,
  { tenant },
  quoteId: string,
  input: SendQuoteInput = {}
): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireBillingUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot update quote'
  );

  if (quote.is_template) {
    throw new Error('Quote templates cannot be resent to clients');
  }

  if (quote.status !== 'sent') {
    throw new Error('Only sent quotes can be resent');
  }

  let emailSent = false;
  let emailRecipients: string[] = [];
  let emailMessageId: string | null = null;
  try {
    const [recipients, tenantRecord] = await Promise.all([
      getQuoteRecipients(knex, tenant, quote, input.email_addresses ?? []),
      knex('tenants').select('client_name').where({ tenant }).first<{ client_name?: string | null }>(),
    ]);

    if (recipients.length > 0) {
      emailRecipients = recipients;
      const companyName = tenantRecord?.client_name?.trim() || 'Your Company';
      const portalBaseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const portalLink = `${portalBaseUrl}/client-portal/billing?tab=quotes`;
      const renderedEmail = buildQuoteSentEmailTemplate({
        quote,
        companyName,
        portalLink,
        customMessage: input.message,
      });
      const subject = input.subject?.trim() || `Reminder: ${renderedEmail.subject}`;

      const emailResult = await sendQuoteEmailWithAttachment({
        tenant,
        quote,
        user,
        recipients,
        subject,
        html: renderedEmail.html,
        text: renderedEmail.text,
      });

      emailSent = emailResult.success;
      emailMessageId = emailResult.messageId ?? null;
      if (!emailResult.success) {
        console.warn('Quote resend email failed:', emailResult.error);
      }
    }
  } catch (emailError) {
    console.warn('Quote resend email failed:', emailError);
  }

  await QuoteActivity.create(knex, tenant, {
    quote_id: quoteId,
    activity_type: 'resent',
    description: emailSent ? `Quote resent to ${emailRecipients.join(', ')}` : 'Quote resend attempted (email not configured)',
    performed_by: getActorUserId(user),
    metadata: {
      recipients: emailRecipients,
      email_sent: emailSent,
      message_id: emailMessageId,
    },
  });

  return await Quote.getById(knex, tenant, quoteId) as IQuote;
});

export const sendQuoteReminder = withAuth(async (
  user,
  { tenant },
  quoteId: string,
  input: SendQuoteInput = {}
): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireBillingUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot update quote'
  );

  if (quote.is_template) {
    throw new Error('Quote templates cannot receive reminders');
  }

  if (quote.status !== 'sent') {
    throw new Error('Only sent quotes can receive reminders');
  }

  let emailSent = false;
  let emailRecipients: string[] = [];
  let emailMessageId: string | null = null;
  try {
    const [recipients, tenantRecord] = await Promise.all([
      getQuoteRecipients(knex, tenant, quote, input.email_addresses ?? []),
      knex('tenants').select('client_name').where({ tenant }).first<{ client_name?: string | null }>(),
    ]);

    if (recipients.length > 0) {
      emailRecipients = recipients;
      const companyName = tenantRecord?.client_name?.trim() || 'Your Company';
      const portalBaseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const portalLink = `${portalBaseUrl}/client-portal/billing?tab=quotes`;
      const renderedEmail = buildQuoteReminderEmailTemplate({
        quote,
        companyName,
        portalLink,
        customMessage: input.message,
      });
      const subject = input.subject?.trim() || renderedEmail.subject;

      const emailResult = await sendQuoteEmailWithAttachment({
        tenant,
        quote,
        user,
        recipients,
        subject,
        html: renderedEmail.html,
        text: renderedEmail.text,
      });

      emailSent = emailResult.success;
      emailMessageId = emailResult.messageId ?? null;
      if (!emailResult.success) {
        console.warn('Quote reminder email failed:', emailResult.error);
      }
    }
  } catch (emailError) {
    console.warn('Quote reminder email failed:', emailError);
  }

  await QuoteActivity.create(knex, tenant, {
    quote_id: quoteId,
    activity_type: 'reminder_sent',
    description: emailSent ? `Quote reminder sent to ${emailRecipients.join(', ')}` : 'Quote reminder attempted (email not configured)',
    performed_by: getActorUserId(user),
    metadata: {
      recipients: emailRecipients,
      email_sent: emailSent,
      message_id: emailMessageId,
    },
  });

  return await Quote.getById(knex, tenant, quoteId) as IQuote;
});

export const convertQuoteToContract = withAuth(async (
  user,
  { tenant },
  quoteId: string,
): Promise<{ quote: IQuote; contract: IContract } | ActionPermissionError> => {
  const createDenied = await requireBillingCreatePermission(user);
  if (createDenied) {
    return createDenied;
  }

  const updateDenied = await requireBillingUpdatePermission(user);
  if (updateDenied) {
    return updateDenied;
  }

  const { knex } = await createTenantKnex();
  await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot convert quote'
  );

  return await knex.transaction(async (trx) => {
    return convertQuoteToDraftContract(trx, tenant, quoteId, getActorUserId(user));
  });
});

export const convertQuoteToInvoice = withAuth(async (
  user,
  { tenant },
  quoteId: string,
): Promise<{ quote: IQuote; invoice: IInvoice } | ActionPermissionError> => {
  const createDenied = await requireBillingCreatePermission(user);
  if (createDenied) {
    return createDenied;
  }

  const updateDenied = await requireBillingUpdatePermission(user);
  if (updateDenied) {
    return updateDenied;
  }

  const { knex } = await createTenantKnex();
  await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot convert quote'
  );

  return await knex.transaction(async (trx) => {
    return convertQuoteToDraftInvoice(trx, tenant, quoteId, getActorUserId(user));
  });
});

export const convertQuoteToBoth = withAuth(async (
  user,
  { tenant },
  quoteId: string,
): Promise<{ quote: IQuote; contract: IContract; invoice: IInvoice } | ActionPermissionError> => {
  const createDenied = await requireBillingCreatePermission(user);
  if (createDenied) {
    return createDenied;
  }

  const updateDenied = await requireBillingUpdatePermission(user);
  if (updateDenied) {
    return updateDenied;
  }

  const { knex } = await createTenantKnex();
  await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot convert quote'
  );

  return await knex.transaction(async (trx) => {
    const result = await convertQuoteToDraftContractAndInvoice(trx, tenant, quoteId, getActorUserId(user));
    return {
      quote: result.quote,
      contract: result.contract,
      invoice: result.invoice,
    };
  });
});

export const getQuoteConversionPreview = withAuth(async (
  user,
  { tenant },
  quoteId: string,
): Promise<QuoteConversionPreview | ActionPermissionError> => {
  const denied = await requireBillingReadPermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await getAuthorizedQuoteForRead(knex, tenant, user as BillingAuthUser, quoteId);
  if (!quote) {
    throw new Error('Permission denied: Cannot read quote');
  }

  return buildQuoteConversionPreview(quote, knex, tenant);
});

export const getQuoteByConvertedContractId = withAuth(async (
  user,
  { tenant },
  contractId: string,
): Promise<IQuote | null | ActionPermissionError> => {
  const denied = await requireBillingReadPermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await Quote.getByConvertedContractId(knex, tenant, contractId);
  if (!quote) {
    return null;
  }
  const { decision } = await authorizeQuoteReadDecision(knex, tenant, user as BillingAuthUser, quote);
  if (!decision.allowed) {
    return null;
  }
  return applyQuoteRedactions(quote, decision.redactedFields);
});

export const getQuoteByConvertedInvoiceId = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
): Promise<IQuote | null | ActionPermissionError> => {
  const denied = await requireBillingReadPermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await Quote.getByConvertedInvoiceId(knex, tenant, invoiceId);
  if (!quote) {
    return null;
  }
  const { decision } = await authorizeQuoteReadDecision(knex, tenant, user as BillingAuthUser, quote);
  if (!decision.allowed) {
    return null;
  }
  return applyQuoteRedactions(quote, decision.redactedFields);
});

/**
 * Get the most recent stored PDF file_id for a quote.
 * Returns null if no PDF has been stored yet.
 */
export const getQuotePdfFileId = withAuth(async (
  user,
  { tenant },
  quoteId: string,
): Promise<string | null | ActionPermissionError> => {
  const denied = await requireBillingReadPermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await getAuthorizedQuoteForRead(knex, tenant, user as BillingAuthUser, quoteId);
  if (!quote) {
    return null;
  }

  const doc = await knex('document_associations as da')
    .join('documents as d', function () {
      this.on('da.document_id', 'd.document_id')
        .andOn('da.tenant', 'd.tenant');
    })
    .where({
      'da.entity_id': quoteId,
      'da.entity_type': 'quote',
      'da.tenant': tenant,
    })
    .whereNotNull('d.file_id')
    .orderBy('da.created_at', 'desc')
    .select('d.file_id')
    .first<{ file_id: string } | undefined>();

  return doc?.file_id ?? null;
});

/**
 * Generate a fresh PDF for a quote and store it, replacing any existing stored PDF.
 */
export const regenerateQuotePdf = withAuth(async (
  user,
  { tenant },
  quoteId: string,
): Promise<string | ActionPermissionError> => {
  const denied = await requireBillingUpdatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await assertQuoteReadAllowedForMutation(
    knex,
    tenant,
    user as BillingAuthUser,
    quoteId,
    'Permission denied: Cannot update quote'
  );

  const actorUserId = getActorUserId(user) ?? quote.created_by ?? 'system';
  const fileId = await storeQuotePdf(knex, tenant, quote, actorUserId);
  return fileId;
});

export const downloadQuotePdf = withAuth(async (
  user,
  { tenant },
  quoteId: string,
): Promise<{ pdfData: number[]; quoteNumber: string } | ActionPermissionError> => {
  const denied = await requireBillingReadPermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await getAuthorizedQuoteForRead(knex, tenant, user as BillingAuthUser, quoteId);
  if (!quote) {
    throw new Error('Permission denied: Cannot read quote');
  }

  const pdfService = createPDFGenerationService(tenant);
  const pdfBuffer = await pdfService.generatePDF({ quoteId, userId: user.user_id });

  return {
    pdfData: Array.from(pdfBuffer),
    quoteNumber: quote.quote_number ?? quote.quote_id,
  };
});

export const renderQuotePreview = withAuth(async (
  user,
  { tenant },
  quoteId: string,
  templateId?: string,
): Promise<{ html: string; css: string } | ActionPermissionError> => {
  const denied = await requireBillingReadPermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const quote = await getAuthorizedQuoteForRead(knex, tenant, user as BillingAuthUser, quoteId);
  if (!quote) {
    throw new Error('Permission denied: Cannot read quote');
  }

  let templateAst: TemplateAst | undefined;
  if (templateId) {
    const allTemplates = (await import('../models/quoteDocumentTemplate')).default;
    const templates = await allTemplates.getTemplates(knex, tenant);
    const match = templates.find((t) => t.template_id === templateId);
    if (match?.templateAst) {
      templateAst = match.templateAst;
    }
  }

  const service = createPDFGenerationService(tenant);
  const preview = await service.renderQuotePreview({ quoteId: quote.quote_id, templateAst });
  return { html: preview.html, css: preview.css };
});
