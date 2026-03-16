import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedContext = vi.hoisted(() => ({
  db: null as any,
}));

const runWithTenantMock = vi.hoisted(() => vi.fn(async (_tenantId: string, callback: () => Promise<unknown>) => callback()));
const getConnectionMock = vi.hoisted(() => vi.fn(async () => mockedContext.db));
const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ success: true, messageId: 'expired-quote-email' })));
const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock('server/src/lib/db', () => ({
  runWithTenant: (...args: any[]) => runWithTenantMock(...args),
}));

vi.mock('server/src/lib/db/db', () => ({
  getConnection: (...args: any[]) => getConnectionMock(...args),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getInstance: vi.fn(() => ({
      sendEmail: (...args: any[]) => sendEmailMock(...args),
    })),
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: (...args: any[]) => loggerInfoMock(...args),
    warn: (...args: any[]) => loggerWarnMock(...args),
  },
}));

import { TestContext } from '../../../../../test-utils/testContext';
import { expireQuotesHandler } from '../../../../lib/jobs/handlers/expireQuotesHandler';

process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

describe('expireQuotesHandler', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupContext({ runSeeds: false });
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    mockedContext.db = context.db;
    runWithTenantMock.mockClear();
    getConnectionMock.mockClear();
    sendEmailMock.mockClear();
    loggerInfoMock.mockClear();
    loggerWarnMock.mockClear();

    await context.db('users')
      .where({ tenant: context.tenantId, user_id: context.userId })
      .update({ email: 'quote-owner@example.com' });
  }, 30000);

  afterEach(async () => {
    mockedContext.db = null;
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('T126: bulk-expires all sent quotes past valid_until', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const expiredCandidateIds = [randomUUID(), randomUUID()];
    const untouchedSentId = randomUUID();
    const untouchedDraftId = randomUUID();

    await context.db('quotes').insert([
      {
        tenant: context.tenantId,
        quote_id: expiredCandidateIds[0],
        quote_number: 'Q-2001',
        client_id: context.clientId,
        title: 'Past Due Quote 1',
        quote_date: yesterday.toISOString(),
        valid_until: yesterday.toISOString(),
        currency_code: 'USD',
        status: 'sent',
        is_template: false,
        subtotal: 1000,
        discount_total: 0,
        tax: 0,
        total_amount: 1000,
        created_by: context.userId,
      },
      {
        tenant: context.tenantId,
        quote_id: expiredCandidateIds[1],
        quote_number: 'Q-2002',
        client_id: context.clientId,
        title: 'Past Due Quote 2',
        quote_date: yesterday.toISOString(),
        valid_until: yesterday.toISOString(),
        currency_code: 'USD',
        status: 'sent',
        is_template: false,
        subtotal: 2000,
        discount_total: 0,
        tax: 0,
        total_amount: 2000,
        created_by: context.userId,
      },
      {
        tenant: context.tenantId,
        quote_id: untouchedSentId,
        quote_number: 'Q-2003',
        client_id: context.clientId,
        title: 'Future Quote',
        quote_date: yesterday.toISOString(),
        valid_until: tomorrow.toISOString(),
        currency_code: 'USD',
        status: 'sent',
        is_template: false,
        subtotal: 3000,
        discount_total: 0,
        tax: 0,
        total_amount: 3000,
        created_by: context.userId,
      },
      {
        tenant: context.tenantId,
        quote_id: untouchedDraftId,
        quote_number: 'Q-2004',
        client_id: context.clientId,
        title: 'Draft Quote',
        quote_date: yesterday.toISOString(),
        valid_until: yesterday.toISOString(),
        currency_code: 'USD',
        status: 'draft',
        is_template: false,
        subtotal: 4000,
        discount_total: 0,
        tax: 0,
        total_amount: 4000,
        created_by: context.userId,
      },
    ]);

    await expireQuotesHandler({ tenantId: context.tenantId });

    const quotes = await context.db('quotes')
      .select('quote_id', 'status', 'expired_at')
      .where({ tenant: context.tenantId })
      .whereIn('quote_id', [...expiredCandidateIds, untouchedSentId, untouchedDraftId]);

    const statusById = Object.fromEntries(quotes.map((quote) => [quote.quote_id, quote]));
    expect(statusById[expiredCandidateIds[0]].status).toBe('expired');
    expect(statusById[expiredCandidateIds[1]].status).toBe('expired');
    expect(statusById[expiredCandidateIds[0]].expired_at).not.toBeNull();
    expect(statusById[expiredCandidateIds[1]].expired_at).not.toBeNull();
    expect(statusById[untouchedSentId].status).toBe('sent');
    expect(statusById[untouchedDraftId].status).toBe('draft');

    const expiredActivities = await context.db('quote_activities')
      .where({ tenant: context.tenantId, activity_type: 'expired' })
      .whereIn('quote_id', expiredCandidateIds)
      .select('quote_id', 'description');

    expect(expiredActivities).toHaveLength(2);
    expect(expiredActivities.map((activity) => activity.quote_id).sort()).toEqual([...expiredCandidateIds].sort());
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'quote',
      to: 'quote-owner@example.com',
    }));
    expect(runWithTenantMock).toHaveBeenCalledWith(context.tenantId, expect.any(Function));
    expect(getConnectionMock).toHaveBeenCalledWith(context.tenantId);
  });
});
