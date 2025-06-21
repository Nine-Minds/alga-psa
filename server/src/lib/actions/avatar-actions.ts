'use server';

import { getUserAvatarUrl, getContactAvatarUrl, getCompanyLogoUrl, getEntityImageUrlsBatch } from '../utils/avatarUtils';

export async function getUserAvatarUrlAction(userId: string, tenant: string): Promise<string | null> {
  return getUserAvatarUrl(userId, tenant);
}

export async function getContactAvatarUrlAction(contactId: string, tenant: string): Promise<string | null> {
  return getContactAvatarUrl(contactId, tenant);
}

export async function getCompanyLogoUrlAction(companyId: string, tenant: string): Promise<string | null> {
  return getCompanyLogoUrl(companyId, tenant);
}

export async function getUserAvatarUrlsBatchAction(userIds: string[], tenant: string): Promise<Map<string, string | null>> {
  return getEntityImageUrlsBatch('user', userIds, tenant);
}

export async function getContactAvatarUrlsBatchAction(contactIds: string[], tenant: string): Promise<Map<string, string | null>> {
  return getEntityImageUrlsBatch('contact', contactIds, tenant);
}