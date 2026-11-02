import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '@main-test-utils/dbConfig';

/**
 * Schema-drift guard (D2). Stripe readers/writers use
 * stripe_subscriptions.stripe_subscription_item_id, which no migration used to
 * create. stripe_subscriptions is an EE table, so this lives in the enterprise
 * integration lane, whose database is built from the combined CE+EE migrations.
 */
let conn: Knex;

beforeAll(async () => {
  conn = await createTestDbConnection();
}, 180_000);

afterAll(async () => {
  await conn?.destroy();
});

describe('stripe_subscriptions.stripe_subscription_item_id (D2)', () => {
  it('exists on a freshly migrated schema', async () => {
    expect(await conn.schema.hasTable('stripe_subscriptions')).toBe(true);
    expect(await conn.schema.hasColumn('stripe_subscriptions', 'stripe_subscription_item_id')).toBe(true);
  });
});
