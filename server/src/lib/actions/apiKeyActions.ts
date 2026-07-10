'use server'

import { ApiKeyService } from '@alga-psa/auth';
import { getUserRoles } from '@alga-psa/auth/actions';
import { IRole } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth/withAuth';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

type ApiKeyActionError = ActionMessageError | ActionPermissionError;

interface ApiKeyCreateView {
  api_key_id: string;
  api_key: string;
  description: string | null;
  created_at: Date;
  expires_at: Date | null;
  purpose: string | null;
  metadata: Record<string, unknown> | null;
  usage_limit: number | null;
  usage_count: number;
}

interface ApiKeyListView {
  api_key_id: string;
  description: string | null;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  purpose: string | null;
  metadata: Record<string, unknown> | null;
  usage_limit: number | null;
  usage_count: number;
  active: boolean;
}

interface AdminApiKeyListView extends ApiKeyListView {
  username: string;
  first_name: string | null;
  last_name: string | null;
}

async function isTenantAdmin(userId: string): Promise<boolean> {
  const userRoles = await getUserRoles(userId);
  return userRoles.some((role: IRole) => role.role_name.toLowerCase() === 'admin');
}

async function requireTenantAdmin(userId: string): Promise<ActionPermissionError | null> {
  if (await isTenantAdmin(userId)) {
    return null;
  }

  return permissionError('Permission denied: Admin access required');
}

/**
 * Create a new API key for the current user
 */
export const createApiKey = withAuth(async (
  user,
  { tenant },
  description?: string,
  expiresAt?: string,
): Promise<ApiKeyCreateView | ApiKeyActionError> => {
  const expiresOn = expiresAt ? new Date(expiresAt) : undefined;
  if (expiresAt && Number.isNaN(expiresOn?.getTime())) {
    return actionError('Choose a valid expiration date for this API key.');
  }

  const apiKey = await ApiKeyService.createApiKey(
    user.user_id,
    description,
    expiresOn,
    { tenantId: tenant }
  );

  // Only return the full API key value upon creation
  return {
    api_key_id: apiKey.api_key_id,
    api_key: apiKey.api_key,
    description: apiKey.description,
    created_at: apiKey.created_at,
    expires_at: apiKey.expires_at,
    purpose: apiKey.purpose,
    metadata: apiKey.metadata,
    usage_limit: apiKey.usage_limit,
    usage_count: apiKey.usage_count,
  };
});

/**
 * List all API keys for the current user
 */
export const listApiKeys = withAuth(async (user, { tenant }): Promise<ApiKeyListView[]> => {
  const apiKeys = await ApiKeyService.listUserApiKeys(user.user_id, tenant);

  // Remove sensitive information from the response
  return apiKeys.map(key => ({
    api_key_id: key.api_key_id,
    description: key.description,
    created_at: key.created_at,
    last_used_at: key.last_used_at,
    expires_at: key.expires_at,
    purpose: key.purpose,
    metadata: key.metadata,
    usage_limit: key.usage_limit,
    usage_count: key.usage_count,
    active: key.active,
  }));
});

/**
 * Deactivate an API key
 */
export const deactivateApiKey = withAuth(async (
  user,
  { tenant },
  apiKeyId: string,
): Promise<{ deactivated: true } | ApiKeyActionError> => {
  // Verify the API key exists and belongs to the user
  const apiKeys = await ApiKeyService.listUserApiKeys(user.user_id, tenant);
  const keyExists = apiKeys.some(key => key.api_key_id === apiKeyId);

  if (!keyExists) {
    return actionError('API key not found.');
  }

  await ApiKeyService.deactivateApiKey(apiKeyId, tenant);
  return { deactivated: true };
});

/**
 * List all API keys across users (admin only)
 */
export const adminListApiKeys = withAuth(async (
  user,
  { tenant },
): Promise<AdminApiKeyListView[] | ApiKeyActionError> => {
  // Check if user has admin role
  const adminError = await requireTenantAdmin(user.user_id);
  if (adminError) {
    return adminError;
  }

  const apiKeys = await ApiKeyService.listAllApiKeys(tenant);

  // Remove sensitive information from the response
  return apiKeys.map(key => ({
    api_key_id: key.api_key_id,
    description: key.description,
    username: key.username,
    first_name: key.first_name,
    last_name: key.last_name,
    created_at: key.created_at,
    last_used_at: key.last_used_at,
    expires_at: key.expires_at,
    purpose: key.purpose,
    metadata: key.metadata,
    usage_limit: key.usage_limit,
    usage_count: key.usage_count,
    active: key.active,
  }));
});

/**
 * Admin deactivate any API key
 */
export const adminDeactivateApiKey = withAuth(async (
  user,
  { tenant },
  apiKeyId: string,
): Promise<{ deactivated: true } | ApiKeyActionError> => {
  // Check if user has admin role
  const adminError = await requireTenantAdmin(user.user_id);
  if (adminError) {
    return adminError;
  }

  try {
    await ApiKeyService.adminDeactivateApiKey(apiKeyId, tenant);
    return { deactivated: true };
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return actionError('API key not found.');
    }
    throw error;
  }
});
