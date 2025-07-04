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

  const result = await db.query(
    `INSERT INTO api_keys (
      key_id, tenant, user_id, key, 
      name, is_active, created_at, created_by
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8
    ) RETURNING *`,
    [
      apiKey.key_id,
      apiKey.tenant,
      apiKey.user_id,
      apiKey.key,
      apiKey.name,
      apiKey.is_active,
      apiKey.created_at,
      apiKey.created_by
    ]
  );

  return result.rows[0];
}