'use server'

import { ApiKeyService } from '../services/apiKeyService';
import { getUserRoles } from './policyActions';
import { IRole } from '@alga-psa/types';
import { withAuth } from '../lib/withAuth';

/**
 * Create a new API key for the current user
 */
export const createApiKey = withAuth(async (user, { tenant }, description?: string, expiresAt?: string) => {
  const apiKey = await ApiKeyService.createApiKey(
    user.user_id,
    description,
    expiresAt ? new Date(expiresAt) : undefined,
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
export const listApiKeys = withAuth(async (user, { tenant }) => {
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
export const deactivateApiKey = withAuth(async (user, { tenant }, apiKeyId: string) => {
  // Verify the API key exists and belongs to the user
  const apiKeys = await ApiKeyService.listUserApiKeys(user.user_id, tenant);
  const keyExists = apiKeys.some(key => key.api_key_id === apiKeyId);

  if (!keyExists) {
    throw new Error('API key not found');
  }

  await ApiKeyService.deactivateApiKey(apiKeyId, tenant);
});

/**
 * List all API keys across users (admin only)
 */
export const adminListApiKeys = withAuth(async (user, { tenant }) => {
  // Check if user has admin role
  const userRoles = await getUserRoles(user.user_id);
  const isAdmin = userRoles.some((role: IRole) => role.role_name.toLowerCase() === 'admin');

  if (!isAdmin) {
    throw new Error('Forbidden: Admin access required');
  }

  const apiKeys = await ApiKeyService.listAllApiKeys(tenant);

  // Remove sensitive information from the response
  return apiKeys.map(key => ({
    api_key_id: key.api_key_id,
    description: key.description,
    username: key.username,
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
export const adminDeactivateApiKey = withAuth(async (user, { tenant }, apiKeyId: string) => {
  // Check if user has admin role
  const userRoles = await getUserRoles(user.user_id);
  const isAdmin = userRoles.some((role: IRole) => role.role_name.toLowerCase() === 'admin');

  if (!isAdmin) {
    throw new Error('Forbidden: Admin access required');
  }

  await ApiKeyService.adminDeactivateApiKey(apiKeyId, tenant);
});
