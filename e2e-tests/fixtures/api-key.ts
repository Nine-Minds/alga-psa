import { randomBytes, createHash } from 'node:crypto';
import type { Knex } from 'knex';

/** Real stored API credential for an isolated browser actor; caller deletes it. */
export async function createBrowserApiKey(db: Knex, userId: string, tenant: string) {
  const plaintext = randomBytes(32).toString('hex');
  const [record] = await db('api_keys').insert({ tenant, user_id: userId,
    api_key: createHash('sha256').update(plaintext).digest('hex'), active: true,
    description: 'Production browser fixture', expires_at: new Date(Date.now() + 3600000),
    created_at: db.fn.now(), updated_at: db.fn.now(),
  }).returning('api_key_id');
  if (!record) throw new Error('Failed to create isolated browser API key');
  return { api_key_id: record.api_key_id as string, api_key: plaintext };
}
