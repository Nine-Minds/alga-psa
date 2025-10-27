'use server'

import { ApiKeyService } from '@server/lib/services/apiKeyService';
import { getCurrentUser, getUserRoles } from './user-actions/userActions';
import { IRole } from 'server/src/interfaces/auth.interfaces';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';

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
