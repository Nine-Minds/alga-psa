'use server';

import { getUserAvatarUrl, getContactAvatarUrl, getClientLogoUrl, getEntityImageUrlsBatch } from '../lib/avatarUtils';
import { withAuth, hasPermission, type AuthContext } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { isClientUserType, type IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';

async function canReadContactAvatar(
  user: IUserWithRoles,
  tenant: string,
  contactIds: string[],
  knex: Knex,
): Promise<Set<string>> {
  const requested = new Set(contactIds);
  if (requested.size === 0) return requested;

  const contacts = await withTransaction(knex, async (trx: Knex.Transaction) =>
    tenantDb(trx, tenant).table('contacts')
      .select('contact_name_id')
      .whereIn('contact_name_id', [...requested]),
  );
  const existingIds = new Set<string>(contacts.map((contact: { contact_name_id: string }) => contact.contact_name_id));

  if (user.user_type === 'internal') {
    return await hasPermission(user, 'contact', 'read', knex) ? existingIds : new Set();
  }

  // Client portal contact reads are limited to the authenticated user's own contact.
  return isClientUserType(user.user_type) && user.contact_id && existingIds.has(user.contact_id) && requested.has(user.contact_id)
    ? new Set([user.contact_id])
    : new Set();
}

export async function getUserAvatarUrlAction(userId: string, tenant: string): Promise<string | null> {
  return getUserAvatarUrl(userId, tenant);
}

export const getContactAvatarUrlAction = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  contactId: string,
  _callerTenant?: string,
): Promise<string | null> => {
  const { knex } = await createTenantKnex();
  const readableIds = await canReadContactAvatar(user, tenant, [contactId], knex);
  if (!readableIds.has(contactId)) return null;
  return getContactAvatarUrl(contactId, tenant);
});

export async function getClientLogoUrlAction(clientId: string, tenant: string): Promise<string | null> {
  return getClientLogoUrl(clientId, tenant);
}

export async function getUserAvatarUrlsBatchAction(userIds: string[], tenant: string): Promise<Map<string, string | null>> {
  return getEntityImageUrlsBatch('user', userIds, tenant);
}

export const getContactAvatarUrlsBatchAction = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  contactIds: string[],
  _callerTenant?: string,
): Promise<Map<string, string | null>> => {
  const result = new Map<string, string | null>(contactIds.map((id) => [id, null]));
  const { knex } = await createTenantKnex();
  const readableIds = await canReadContactAvatar(user, tenant, contactIds, knex);
  if (readableIds.size === 0) return result;
  const resolved = await getEntityImageUrlsBatch('contact', [...readableIds], tenant);
  for (const id of readableIds) result.set(id, resolved.get(id) ?? null);
  return result;
});
