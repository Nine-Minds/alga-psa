/**
 * Documents helpers for clients package
 *
 * Previously used dynamic imports to avoid circular dependency (clients -> documents -> ... -> clients).
 * Now imports directly from @alga-psa/formatting which has no circular dependency risk.
 */

import {
  getClientLogoUrl,
  getClientLogoUrlsBatch,
  getContactAvatarUrl,
  getContactAvatarUrlsBatch,
} from '@alga-psa/formatting/avatarUtils';

export async function getClientLogoUrlAsync(clientId: string, tenant: string): Promise<string | null> {
  return getClientLogoUrl(clientId, tenant);
}

export async function getClientLogoUrlsBatchAsync(clientIds: string[], tenant: string): Promise<Map<string, string | null>> {
  return getClientLogoUrlsBatch(clientIds, tenant);
}

export async function getContactAvatarUrlAsync(contactId: string, tenant: string): Promise<string | null> {
  return getContactAvatarUrl(contactId, tenant);
}

export async function getContactAvatarUrlsBatchAsync(contactIds: string[], tenant: string): Promise<Map<string, string | null>> {
  return getContactAvatarUrlsBatch(contactIds, tenant);
}
