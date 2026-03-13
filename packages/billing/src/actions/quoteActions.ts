'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { IQuote } from '@alga-psa/types';
import Quote from '../models/quote';
import { createQuoteSchema, updateQuoteSchema } from '../schemas/quoteSchemas';

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
