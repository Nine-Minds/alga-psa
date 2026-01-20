'use server'

import { ApiKeyService } from '../services/apiKeyService';
import { getCurrentUser } from '../lib/getCurrentUser';
import { IRole } from '@alga-psa/types';
import { withTransaction } from '@alga-psa/db';

// Dynamic import to avoid circular dependency (auth -> users -> auth)
// Note: Using string concatenation to prevent static analysis from detecting this dependency
const getUserRoles = async (userId: string) => {
  const { getUserRoles: getRoles } = await import('@alga-psa/users/actions');
  return getRoles(userId);
};
import type { Knex } from 'knex';

/**
 * Create a new API key for the current user
 */
export async function createApiKey(description?: string, expiresAt?: string) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const apiKey = await ApiKeyService.createApiKey(
    user.user_id,
    description,
    expiresAt ? new Date(expiresAt) : undefined
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
}

/**
 * List all API keys for the current user
 */
export async function listApiKeys() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const apiKeys = await ApiKeyService.listUserApiKeys(user.user_id);
  
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
}

/**
 * Deactivate an API key
 */
export async function deactivateApiKey(apiKeyId: string) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  // Verify the API key exists and belongs to the user
  const apiKeys = await ApiKeyService.listUserApiKeys(user.user_id);
  const keyExists = apiKeys.some(key => key.api_key_id === apiKeyId);

  if (!keyExists) {
    throw new Error('API key not found');
  }

  await ApiKeyService.deactivateApiKey(apiKeyId);
}

/**
 * List all API keys across users (admin only)
 */
export async function adminListApiKeys() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  // Check if user has admin role
  const userRoles = await getUserRoles(user.user_id);
  const isAdmin = userRoles.some((role: IRole) => role.role_name.toLowerCase() === 'admin');
  
  if (!isAdmin) {
    throw new Error('Forbidden: Admin access required');
  }

  const apiKeys = await ApiKeyService.listAllApiKeys();
  
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
}

/**
 * Admin deactivate any API key
 */
export async function adminDeactivateApiKey(apiKeyId: string) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  // Check if user has admin role
  const userRoles = await getUserRoles(user.user_id);
  const isAdmin = userRoles.some((role: IRole) => role.role_name.toLowerCase() === 'admin');
  
  if (!isAdmin) {
    throw new Error('Forbidden: Admin access required');
  }

  await ApiKeyService.adminDeactivateApiKey(apiKeyId);
}
