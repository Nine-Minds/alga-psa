import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { TestContext } from '../../../../test-utils/testContext';
import { createClient, createTenant, createUser } from '../../../../test-utils/testDataFactory';
import {
  clearUserClientPortfolio,
  readUserClientPortfolio,
  setUserClientPortfolio,
} from '@alga-psa/authorization/portfolios/service';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  compileResourceReadAuthorizationSql,
  createAuthorizationKernel,
  type AuthorizationSubject,
  type BundleNarrowingRule,
  type RelationshipSqlAdapter,
} from '@alga-psa/authorization/kernel';
import { tenantDb } from '@alga-psa/db';

// T002. The stored portfolio (`user_client_portfolios`, written and read through
// the package commands) drives the `client_portfolio` template. The record
// matcher and the SQL compiler must agree on every row, and both must deny
// everything when the portfolio is empty.
//
// The records are the tenant's own `clients` rows: each is "a record of" itself,
// so the fixture needs no second table to carry a client column.

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

const PORTFOLIO_RULE: BundleNarrowingRule = {
  id: 'client-portfolio-rule',
  resource: 'ticket',
  action: 'read',
  templateKey: 'client_portfolio',
};

const SQL_ADAPTER: RelationshipSqlAdapter = {
  clientColumn: 'c.client_id',
  applyAssignedUsers(builder) {
    builder.whereRaw('1 = 0');
  },
};

describe('client portfolio: stored set, matcher and SQL compiler', () => {
  let ctx: TestContext;
  let portfolioClientA: string;
  let portfolioClientB: string;
  let otherClient: string;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: ['user_client_portfolios'] });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    portfolioClientA = await createClient(ctx.db, ctx.tenantId, 'Portfolio Client A');
    portfolioClientB = await createClient(ctx.db, ctx.tenantId, 'Portfolio Client B');
    otherClient = await createClient(ctx.db, ctx.tenantId, 'Other Client');
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function subjectFromStoredPortfolio(userId: string = ctx.user.user_id): Promise<AuthorizationSubject> {
    return {
      tenant: ctx.tenantId,
      userId,
      userType: 'internal',
      teamIds: [],
      managedUserIds: [],
      portfolioClientIds: await readUserClientPortfolio(ctx.db, { tenant: ctx.tenantId, userId }),
      clientId: null,
    };
  }

  async function tenantClientIds(): Promise<string[]> {
    const rows = await tenantDb(ctx.db, ctx.tenantId).table('clients').select<{ client_id: string }[]>('client_id');
    return rows.map((row) => row.client_id);
  }

  async function matcherAllowedClientIds(subject: AuthorizationSubject): Promise<string[]> {
    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
      bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: async () => [PORTFOLIO_RULE] }),
      rbacEvaluator: async () => true,
    });
    const requestCache = new RequestLocalAuthorizationCache();
    const allowed: string[] = [];
    for (const clientId of await tenantClientIds()) {
      const decision = await kernel.authorizeResource({
        subject,
        resource: { type: 'ticket', action: 'read', id: clientId },
        record: { id: clientId, clientId },
        requestCache,
      });
      if (decision.allowed) allowed.push(clientId);
    }
    return allowed.sort();
  }

  async function sqlAllowedClientIds(subject: AuthorizationSubject): Promise<string[]> {
    const query = tenantDb(ctx.db, ctx.tenantId).table('clients as c') as unknown as Knex.QueryBuilder;
    const result = compileResourceReadAuthorizationSql(query, {
      resourceType: 'ticket',
      action: 'read',
      builtinRules: [],
      bundleRules: [PORTFOLIO_RULE],
      ctx: { subject, adapter: SQL_ADAPTER },
    });
    expect(result.supported, 'client_portfolio must compile to SQL').toBe(true);
    const rows = await query.clearSelect().select<{ client_id: string }[]>('c.client_id');
    return rows.map((row) => row.client_id).sort();
  }

  it('T002: allows records of portfolio clients and denies another client, identically in the matcher and in SQL', async () => {
    await setUserClientPortfolio(ctx.db, {
      tenant: ctx.tenantId,
      userId: ctx.user.user_id,
      clientIds: [portfolioClientA, portfolioClientB],
    });

    const subject = await subjectFromStoredPortfolio();
    const expected = [portfolioClientA, portfolioClientB].sort();

    const matcher = await matcherAllowedClientIds(subject);
    const sql = await sqlAllowedClientIds(subject);

    expect(matcher).toEqual(expected);
    expect(sql).toEqual(matcher);
    expect(matcher).not.toContain(otherClient);
    // The tenant's seeded client is outside the portfolio too: the rule narrows, it does not allow by default.
    expect(matcher).not.toContain(ctx.clientId);
  });

  it('T002: an empty portfolio denies everything, with no rows and again after a clear', async () => {
    const neverSet = await subjectFromStoredPortfolio();
    expect(neverSet.portfolioClientIds).toEqual([]);
    expect(await matcherAllowedClientIds(neverSet)).toEqual([]);
    expect(await sqlAllowedClientIds(neverSet)).toEqual([]);

    await setUserClientPortfolio(ctx.db, {
      tenant: ctx.tenantId,
      userId: ctx.user.user_id,
      clientIds: [portfolioClientA],
    });
    expect(await sqlAllowedClientIds(await subjectFromStoredPortfolio())).toEqual([portfolioClientA]);

    await clearUserClientPortfolio(ctx.db, { tenant: ctx.tenantId, userId: ctx.user.user_id });

    const cleared = await subjectFromStoredPortfolio();
    expect(cleared.portfolioClientIds).toEqual([]);
    expect(await matcherAllowedClientIds(cleared)).toEqual([]);
    expect(await sqlAllowedClientIds(cleared)).toEqual([]);
  });

  it('T002: a subject built without a portfolio at all is denied by both facets', async () => {
    const subject: AuthorizationSubject = {
      tenant: ctx.tenantId,
      userId: ctx.user.user_id,
      userType: 'internal',
      clientId: null,
    };
    expect(await matcherAllowedClientIds(subject)).toEqual([]);
    expect(await sqlAllowedClientIds(subject)).toEqual([]);
  });

  it('set replaces the stored portfolio and ignores duplicates', async () => {
    const target = { tenant: ctx.tenantId, userId: ctx.user.user_id };

    await setUserClientPortfolio(ctx.db, { ...target, clientIds: [portfolioClientA, portfolioClientB, portfolioClientA] });
    expect(await readUserClientPortfolio(ctx.db, target)).toEqual([portfolioClientA, portfolioClientB].sort());

    const stored = await setUserClientPortfolio(ctx.db, { ...target, clientIds: [portfolioClientB, otherClient] });
    expect(stored).toEqual([portfolioClientB, otherClient].sort());
    expect(await readUserClientPortfolio(ctx.db, target)).toEqual([portfolioClientB, otherClient].sort());

    await setUserClientPortfolio(ctx.db, { ...target, clientIds: [] });
    expect(await readUserClientPortfolio(ctx.db, target)).toEqual([]);
  });

  it('a portfolio belongs to one user: setting or clearing another user leaves it alone', async () => {
    const colleague = await createUser(ctx.db, ctx.tenantId);
    const mine = { tenant: ctx.tenantId, userId: ctx.user.user_id };
    const theirs = { tenant: ctx.tenantId, userId: colleague };

    await setUserClientPortfolio(ctx.db, { ...mine, clientIds: [portfolioClientA] });
    await setUserClientPortfolio(ctx.db, { ...theirs, clientIds: [portfolioClientB, otherClient] });
    expect(await readUserClientPortfolio(ctx.db, mine)).toEqual([portfolioClientA]);

    await clearUserClientPortfolio(ctx.db, theirs);
    expect(await readUserClientPortfolio(ctx.db, theirs)).toEqual([]);
    expect(await readUserClientPortfolio(ctx.db, mine)).toEqual([portfolioClientA]);
  });

  it('refuses a user or a client from outside the tenant and stores nothing', async () => {
    const otherTenant = await createTenant(ctx.db, 'Other Tenant');
    const foreignClient = await createClient(ctx.db, otherTenant, 'Foreign Client');
    const foreignUser = await createUser(ctx.db, otherTenant);
    const mine = { tenant: ctx.tenantId, userId: ctx.user.user_id };

    await setUserClientPortfolio(ctx.db, { ...mine, clientIds: [portfolioClientA] });

    await expect(
      setUserClientPortfolio(ctx.db, { ...mine, clientIds: [portfolioClientB, foreignClient] })
    ).rejects.toThrow('client was not found');
    // The refused replacement left the previous portfolio intact.
    expect(await readUserClientPortfolio(ctx.db, mine)).toEqual([portfolioClientA]);

    await expect(
      setUserClientPortfolio(ctx.db, { tenant: ctx.tenantId, userId: foreignUser, clientIds: [portfolioClientA] })
    ).rejects.toThrow('user was not found');
  });

  it('one tenant cannot read or clear another tenant\'s portfolio rows', async () => {
    const otherTenant = await createTenant(ctx.db, 'Other Tenant');
    const foreignClient = await createClient(ctx.db, otherTenant, 'Foreign Client');
    const foreignUser = await createUser(ctx.db, otherTenant);

    await setUserClientPortfolio(ctx.db, { tenant: otherTenant, userId: foreignUser, clientIds: [foreignClient] });

    // Same user id, wrong tenant: nothing to read, and a clear removes nothing.
    expect(await readUserClientPortfolio(ctx.db, { tenant: ctx.tenantId, userId: foreignUser })).toEqual([]);
    await clearUserClientPortfolio(ctx.db, { tenant: ctx.tenantId, userId: foreignUser });
    expect(await readUserClientPortfolio(ctx.db, { tenant: otherTenant, userId: foreignUser })).toEqual([foreignClient]);
  });

  it('the unique index holds one row per tenant, user and client', async () => {
    const row = { tenant: ctx.tenantId, user_id: ctx.user.user_id, client_id: portfolioClientA };
    await tenantDb(ctx.db, ctx.tenantId).table('user_client_portfolios').insert(row);
    await expect(
      ctx.db.transaction((trx) => tenantDb(trx, ctx.tenantId).table('user_client_portfolios').insert(row))
    ).rejects.toMatchObject({ code: '23505' });
  });
});
