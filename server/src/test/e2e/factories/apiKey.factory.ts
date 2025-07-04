/**
 * API Key Factory for E2E Tests
 * Creates API key test data
 */

import { faker } from '@faker-js/faker';
import crypto from 'crypto';

interface ApiKeyInput {
  tenant: string;
  user_id: string;
  description?: string;
  active?: boolean;
}

export async function apiKeyFactory(db: any, input: ApiKeyInput) {
  const plaintextKey = faker.string.alphanumeric(32);
  const hashedKey = crypto.createHash('sha256').update(plaintextKey).digest('hex');
  
  const apiKey = {
    api_key_id: faker.string.uuid(),
    tenant: input.tenant,
    user_id: input.user_id,
    api_key: hashedKey,
    description: input.description || 'Test API Key',
    active: input.active !== undefined ? input.active : true,
    created_at: new Date(),
    updated_at: new Date()
  };

  const result = await db('api_keys')
    .insert(apiKey)
    .returning('*');

  // Return both the record and the plaintext key
  return { ...result[0], key: plaintextKey };
}