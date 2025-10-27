'use server';

import { getUserAvatarUrl, getContactAvatarUrl, getClientLogoUrl, getEntityImageUrlsBatch } from '@server/lib/utils/avatarUtils';

export async function getUserAvatarUrlAction(userId: string, tenant: string): Promise<string | null> {
  return getUserAvatarUrl(userId, tenant);
}

export async function getContactAvatarUrlAction(contactId: string, tenant: string): Promise<string | null> {
  return getContactAvatarUrl(contactId, tenant);
}

export async function getClientLogoUrlAction(clientId: string, tenant: string): Promise<string | null> {
  return getClientLogoUrl(clientId, tenant);
}

export async function getUserAvatarUrlsBatchAction(userIds: string[], tenant: string): Promise<Map<string, string | null>> {
  return getEntityImageUrlsBatch('user', userIds, tenant);
}

export async function getContactAvatarUrlsBatchAction(contactIds: string[], tenant: string): Promise<Map<string, string | null>> {
  return getEntityImageUrlsBatch('contact', contactIds, tenant);
}