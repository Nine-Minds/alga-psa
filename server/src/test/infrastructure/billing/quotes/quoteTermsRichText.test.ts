import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedTenantConnection = vi.hoisted(() => ({
  db: null as any,
  tenant: null as string | null,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => {
      if (!mockedTenantConnection.db || !mockedTenantConnection.tenant) {
        throw new Error('Mock tenant connection not initialized');
      }
      return {
        knex: mockedTenantConnection.db,
        tenant: mockedTenantConnection.tenant,
      };
    }),
  };
});

// BaseService (used by QuoteService) imports createTenantKnex from the db
// package's own tenant module, so point that at the test connection too.
vi.mock('../../../../../../packages/db/src/lib/tenant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../packages/db/src/lib/tenant')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({
      knex: mockedTenantConnection.db,
      tenant: mockedTenantConnection.tenant,
    })),
  };
});

import { TestContext } from '../../../../../test-utils/testContext';
import Quote from '../../../../../../packages/billing/src/models/quote';
import { QuoteService } from '@/lib/api/services/QuoteService';
import { flattenBlockContentToPlainText } from '@alga-psa/formatting/blocknoteUtils';

process.env.DB_PORT = process.env.DB_PORT === '6432' ? '5432' : process.env.DB_PORT;
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

const RICH_BLOCK = [
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Welcome to our services. ' },
      { type: 'text', text: 'Bold terms', styles: { bold: true } },
    ],
  },
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Read our ' },
      { type: 'link', href: 'https://example.com/terms', content: [{ type: 'text', text: 'terms' }] },
    ],
  },
];

const SECOND_BLOCK = [
  { type: 'paragraph', content: [{ type: 'text', text: 'Replacement terms' }] },
];

const RICH_PROJECTION = flattenBlockContentToPlainText(RICH_BLOCK);

describe('Quote rich Terms & Conditions persistence', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 180000);

  beforeEach(async () => {
    context = await resetContext();
    mockedTenantConnection.db = context.db;
    mockedTenantConnection.tenant = context.tenantId;
  }, 30000);

  afterEach(async () => {
    mockedTenantConnection.db = null;
    mockedTenantConnection.tenant = null;
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  async function createQuote(overrides: Record<string, unknown> = {}) {
    return Quote.create(context.db, context.tenantId, {
      client_id: context.clientId,
      title: 'Rich terms quote',
      quote_date: '2026-03-13T00:00:00.000Z',
      valid_until: validUntil,
      subtotal: 0,
      discount_total: 0,
      tax: 0,
      total_amount: 0,
      currency_code: 'USD',
      is_template: false,
      created_by: context.userId,
      ...overrides,
    } as any);
  }

  it('T008: create persists the block as jsonb and the text projection, and reload returns both', async () => {
    const created = await createQuote({
      terms_and_conditions_block: RICH_BLOCK,
      terms_and_conditions: 'ignored stale text',
    });

    // The bug being guarded: passing the JS array straight to Knex produced a
    // PostgreSQL array literal, so this insert would have thrown.
    const row = await context.db('quotes')
      .where({ tenant: context.tenantId, quote_id: created.quote_id })
      .first();
    expect(Array.isArray(row.terms_and_conditions_block)).toBe(true);
    expect(row.terms_and_conditions_block).toEqual(RICH_BLOCK);
    expect(row.terms_and_conditions).toBe(RICH_PROJECTION);

    const reloaded = await Quote.getById(context.db, context.tenantId, created.quote_id);
    expect(reloaded?.terms_and_conditions_block).toEqual(RICH_BLOCK);
    expect(reloaded?.terms_and_conditions).toBe(RICH_PROJECTION);
  });

  it('T008: update replaces both columns; a plain-string write clears the block; clearing both empties them', async () => {
    const created = await createQuote({ terms_and_conditions_block: RICH_BLOCK });

    const updated = await Quote.update(context.db, context.tenantId, created.quote_id, {
      terms_and_conditions_block: SECOND_BLOCK,
    } as any);
    expect(updated.terms_and_conditions_block).toEqual(SECOND_BLOCK);
    expect(updated.terms_and_conditions).toBe('Replacement terms');

    const plain = await Quote.update(context.db, context.tenantId, created.quote_id, {
      terms_and_conditions: 'Plain API write',
      terms_and_conditions_block: null,
    } as any);
    expect(plain.terms_and_conditions_block).toBeNull();
    expect(plain.terms_and_conditions).toBe('Plain API write');

    const cleared = await Quote.update(context.db, context.tenantId, created.quote_id, {
      terms_and_conditions: null,
      terms_and_conditions_block: null,
    } as any);
    expect(cleared.terms_and_conditions_block).toBeNull();
    expect(cleared.terms_and_conditions).toBeNull();
  });

  it('T010: createRevision copies both columns onto the revised quote', async () => {
    const created = await createQuote({ terms_and_conditions_block: RICH_BLOCK });
    await context.db('quotes')
      .where({ tenant: context.tenantId, quote_id: created.quote_id })
      .update({ status: 'sent' });

    const revision = await Quote.createRevision(context.db, context.tenantId, created.quote_id, context.userId);

    expect(revision.terms_and_conditions_block).toEqual(RICH_BLOCK);
    expect(revision.terms_and_conditions).toBe(RICH_PROJECTION);
  });

  it('T011: REST service create writes the block and a plain-string update clears it', async () => {
    const service = new QuoteService();
    const ctx = { userId: context.userId, tenant: context.tenantId, user: { user_id: context.userId } };

    const created = await service.create({
      client_id: context.clientId,
      title: 'REST rich terms',
      quote_date: '2026-03-13',
      valid_until: '2026-04-13',
      terms_and_conditions_block: RICH_BLOCK,
      currency_code: 'USD',
    } as any, ctx);

    expect(created.terms_and_conditions_block).toEqual(RICH_BLOCK);
    expect(created.terms_and_conditions).toBe(RICH_PROJECTION);

    const updated = await service.update(created.quote_id, {
      terms_and_conditions: 'Written through the API',
    } as any, ctx);

    expect(updated.terms_and_conditions_block).toBeNull();
    expect(updated.terms_and_conditions).toBe('Written through the API');
  });
});
