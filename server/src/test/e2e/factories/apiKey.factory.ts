/**
 * API Key Factory for E2E Tests
 * Creates API key test data
 */

import { faker } from '@faker-js/faker';

interface ApiKeyInput {
  tenant: string;
  user_id: string;
  name?: string;
  is_active?: boolean;
}

export async function apiKeyFactory(db: any, input: ApiKeyInput) {
  const apiKey = {
    key_id: faker.string.uuid(),
    tenant: input.tenant,
    user_id: input.user_id,
    key: faker.string.alphanumeric(32),
    name: input.name || 'Test API Key',
    is_active: input.is_active !== undefined ? input.is_active : true,
    created_at: new Date(),
    created_by: input.user_id
  };

  const result = await db('api_keys')
    .insert({
      key_id: apiKey.key_id,
      tenant: apiKey.tenant,
      user_id: apiKey.user_id,
      key: apiKey.key,
      name: apiKey.name,
      is_active: apiKey.is_active,
      created_at: apiKey.created_at,
      created_by: apiKey.created_by
    })
    .returning('*');

  return result[0];
}