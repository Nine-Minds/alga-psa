'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { IQuote, IQuoteItem, IQuoteListItem, PaginatedResult } from '@alga-psa/types';
import Quote, { type QuoteListOptions } from '../models/quote';
import QuoteItem from '../models/quoteItem';
import { createQuoteItemSchema, createQuoteSchema, updateQuoteItemSchema, updateQuoteSchema } from '../schemas/quoteSchemas';

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

const getActorUserId = (user: unknown): string | null => {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const candidate = (user as { user_id?: string; id?: string }).user_id ?? (user as { id?: string }).id;
  return typeof candidate === 'string' ? candidate : null;
};

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
  return await Quote.getById(knex, tenant, quoteId);
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
  return await Quote.listByTenant(knex, tenant, options);
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
    const template = await Quote.getById(trx, tenant, templateQuoteId);
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
        created_by: actorUserId,
      });
    }

    return await Quote.getById(trx, tenant, createdQuote.quote_id) as IQuote;
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
  return await knex.transaction((trx) => Quote.createRevision(trx, tenant, quoteId, getActorUserId(user)));
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
  return await Quote.listVersions(knex, tenant, quoteId);
});
