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

export const createQuote = withAuth(async (user, { tenant }, input: CreateQuoteInput): Promise<IQuote | ActionPermissionError> => {
  const denied = await requireBillingCreatePermission(user);
  if (denied) {
    return denied;
  }

  const { knex } = await createTenantKnex();
  const parsedInput = createQuoteSchema.parse({
    ...input,
    created_by: input.created_by ?? getActorUserId(user),
  });

  const createdQuote = await Quote.create(knex, tenant, parsedInput);
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
  const parsedInput = updateQuoteSchema.parse({
    ...input,
    updated_by: input.updated_by ?? getActorUserId(user),
  });

  const updatedQuote = await Quote.update(knex, tenant, quoteId, parsedInput);
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

  return await QuoteItem.create(knex, tenant, parsedInput);
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
