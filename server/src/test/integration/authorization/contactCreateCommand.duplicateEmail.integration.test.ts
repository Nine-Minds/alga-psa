/**
 * T002 (alga-2026-0003445, S2, F002/F003/F005): a duplicate email never names a contact or client the caller
 * cannot read. A restricted internal user (a published bundle naming client A only) gets one generic in-use
 * result, with no client name and no contact, when the email is held by a contact at client C or by a client-less
 * contact, on the create command and on find-or-create (`createOrFindContactByEmail`); an in-scope holder is
 * returned with `isNew: false`. An unrestricted user still gets the named-client message. A client-portal user
 * keeps the own-client rule and is never told more than "in use" about another client's contact.
 * Real DB, real kernel, real bundle service; only the session and the coarse RBAC grant are stood in for.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
  getConnection: vi.fn(async () => ref.knex),
}));
vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
  getApiKeyUserOverride: () => null,
  getSession: async () => null,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/authorization/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/authorization/rbac')>()),
  hasPermission: async (...args: Parameters<typeof import('@alga-psa/authorization/rbac').hasPermission>) => {
    const { hasPermission } = await import('@alga-psa/auth');
    return hasPermission(args[0] as import('@alga-psa/types').IUser, args[1], args[2], args[3]);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

import { createContactAs, CONTACT_EMAIL_IN_USE_CODE, CONTACT_EMAIL_IN_USE_MESSAGE } from '@alga-psa/shared/models/contactCreateCommand';
import { createOrFindContactByEmail } from '../../../../../packages/clients/src/actions/queryActions';

describe('T002: duplicate emails are projected through contact read scope', () => {
  let db: Knex;
  let tenant: string;
  const mark = uuidv4().slice(0, 8);
  const ids = { clientA: uuidv4(), clientC: uuidv4(), admin: '', narrowed: '', unrestricted: '', portal: '' };
  const email = (n: string) => `${n}-${mark}@example.com`;
  const emails = { outOfScope: email('out'), clientless: email('none'), inScope: email('in') };
  const clientCName = `Client C ${mark}`;

  const actAs = (userId: string, extra: Record<string, unknown> = {}) => {
    ref.tenant = tenant;
    ref.user = { user_id: userId, user_type: 'internal', tenant, email: `${userId}@example.com`, ...extra };
  };
  const run = <T>(fn: () => Promise<T>) => runWithTenant(tenant, fn);
  const rows = async (e: string) =>
    Number((await db('contacts').where({ tenant, email: e }).count('* as n').first() as any).n);

  async function attempt<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: Error }> {
    try { return { value: await fn() }; } catch (error) { return { error: error as Error }; }
  }
  const viaCommand = (e: string, clientId: string | null) => attempt(() =>
    run(() => db.transaction((trx) => createContactAs(trx, {
      tenant, actor: ref.user, input: { full_name: `Cmd ${e}`, email: e, client_id: clientId ?? undefined } as any,
    }))));
  const viaFindOrCreate = (e: string, clientId: string) =>
    attempt(() => run(() => createOrFindContactByEmail({ email: e, clientId, name: 'Finder' })));

  /** The generic result carries the code and one fixed message, and nothing else. */
  function expectGeneric(error: Error | undefined) {
    expect(error, 'expected a refusal').toBeDefined();
    expect((error as any).code).toBe(CONTACT_EMAIL_IN_USE_CODE);
    expect(error!.message).toBe(CONTACT_EMAIL_IN_USE_MESSAGE);
    expect(error!.message).toMatch(/^EMAIL_EXISTS:/);
    expect(error!.message).not.toContain(clientCName);
    // Own enumerable properties are the code and the error name; no client, contact or id rides along.
    expect(Object.keys(error as object).sort()).toEqual(['code', 'name']);
  }

  beforeAll(async () => {
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `Dup email scope ${mark}`);
    ids.admin = await createUser(db, tenant, { first_name: 'Ada', last_name: 'Admin' });
    ids.narrowed = await createUser(db, tenant, { user_type: 'internal', first_name: 'Nora', last_name: 'Narrowed' });
    ids.unrestricted = await createUser(db, tenant, { user_type: 'internal', first_name: 'Uma', last_name: 'Unrestricted' });
    ids.portal = await createUser(db, tenant, { user_type: 'client', first_name: 'Pat', last_name: 'Portal' });

    await db('clients').insert({ tenant, client_id: ids.clientA, client_name: `Client A ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false });
    await db('clients').insert({ tenant, client_id: ids.clientC, client_name: clientCName, billing_cycle: 'monthly', is_tax_exempt: false });
    await db('contacts').insert([
      { tenant, contact_name_id: uuidv4(), full_name: `Out ${mark}`, client_id: ids.clientC, email: emails.outOfScope, is_inactive: false },
      { tenant, contact_name_id: uuidv4(), full_name: `Clientless ${mark}`, client_id: null, email: emails.clientless, is_inactive: false },
      { tenant, contact_name_id: uuidv4(), full_name: `In ${mark}`, client_id: ids.clientA, email: emails.inScope, is_inactive: false },
    ]);

    const bundle = await createAuthorizationBundle(db, { tenant, name: `client-a-${mark}`, actorUserId: ids.admin });
    await upsertBundleRule(db, {
      tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId,
      resourceType: 'contact', action: 'read', templateKey: 'selected_clients', config: { selectedClientIds: [ids.clientA] }, actorUserId: ids.admin,
    });
    await publishBundleRevision(db as any, { tenant, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: ids.admin });
    await createBundleAssignment(db, { tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: ids.narrowed, actorUserId: ids.admin });
  }, 900_000);

  afterAll(async () => {
    if (!db) return;
    try { await db('contacts').where({ tenant }).del(); } catch { /* disposable tenant */ }
    await db.destroy();
  }, 120_000);

  describe('restricted to client A', () => {
    it.each([['out-of-scope', 'outOfScope'], ['client-less', 'clientless']] as const)(
      'the %s holder yields the one generic result on create and on find-or-create',
      async (_label, key) => {
        actAs(ids.narrowed);
        const created = await viaCommand(emails[key], ids.clientA);
        expect(created.value).toBeUndefined();
        expectGeneric(created.error);

        const found = await viaFindOrCreate(emails[key], ids.clientA);
        expect(found.value).toBeUndefined();
        expectGeneric(found.error);
        expect(await rows(emails[key])).toBe(1);
      },
    );

    it('makes the out-of-scope and client-less outcomes indistinguishable', async () => {
      actAs(ids.narrowed);
      const shape = async (key: 'outOfScope' | 'clientless') => {
        const c = await viaCommand(emails[key], ids.clientA);
        const f = await viaFindOrCreate(emails[key], ids.clientA);
        return [c, f].map(({ error }) => ({ name: error!.name, message: error!.message, code: (error as any).code, keys: Object.keys(error!) }));
      };
      expect(await shape('outOfScope')).toEqual(await shape('clientless'));
    });

    it('returns the in-scope holder from find-or-create with isNew false', async () => {
      actAs(ids.narrowed);
      const found = await viaFindOrCreate(emails.inScope, ids.clientA);
      expect(found.error).toBeUndefined();
      expect(found.value?.isNew).toBe(false);
      expect(found.value?.contact.email).toBe(emails.inScope);
      expect(found.value?.contact.client_id).toBe(ids.clientA);
      expect(await rows(emails.inScope)).toBe(1);
    });

    it('create on an in-scope holder is the plain duplicate, and nothing is written', async () => {
      actAs(ids.narrowed);
      const created = await viaCommand(emails.inScope, ids.clientA);
      expect(created.error?.message).toMatch(/already exists/i);
      expect((created.error as any).code).toBeUndefined();
    });

    it('a find-or-create for a client outside scope is refused by the create gate before any lookup', async () => {
      actAs(ids.narrowed);
      const found = await viaFindOrCreate(emails.outOfScope, ids.clientC);
      expect(found.error?.message).toMatch(/Permission denied/i);
      expect(found.error?.message).not.toContain(clientCName);
    });

    it('still creates a new contact in scope', async () => {
      actAs(ids.narrowed);
      const fresh = email('fresh');
      const found = await viaFindOrCreate(fresh, ids.clientA);
      expect(found.error).toBeUndefined();
      expect(found.value?.isNew).toBe(true);
      expect(await rows(fresh)).toBe(1);
    });
  });

  describe('unrestricted MSP user', () => {
    it('still gets the named-client message on find-or-create', async () => {
      actAs(ids.unrestricted);
      const found = await viaFindOrCreate(emails.outOfScope, ids.clientA);
      expect(found.error?.message).toBe(`EMAIL_EXISTS: This email is already associated with ${clientCName}`);
      expect((found.error as any).code).toBeUndefined();
    });

    it('still gets the no-client message for a client-less holder, and the plain duplicate on create', async () => {
      actAs(ids.unrestricted);
      const found = await viaFindOrCreate(emails.clientless, ids.clientA);
      expect(found.error?.message).toMatch(/without a client assignment/);
      const created = await viaCommand(emails.outOfScope, ids.clientC);
      expect(created.error?.message).toMatch(/already exists/i);
    });

    it('returns a holder at the same client with isNew false', async () => {
      actAs(ids.unrestricted);
      const found = await viaFindOrCreate(emails.inScope, ids.clientA);
      expect(found.value?.isNew).toBe(false);
    });
  });

  describe('client-portal user', () => {
    it('is refused outside their own client', async () => {
      actAs(ids.portal, { user_type: 'client', clientId: ids.clientA });
      const found = await viaFindOrCreate(email('portal-other'), ids.clientC);
      expect(found.error?.message).toMatch(/Permission denied/i);
    });

    it('gets the generic result, never a name, for another client\'s contact', async () => {
      actAs(ids.portal, { user_type: 'client', clientId: ids.clientA });
      for (const key of ['outOfScope', 'clientless'] as const) {
        const found = await viaFindOrCreate(emails[key], ids.clientA);
        expectGeneric(found.error);
      }
    });

    it('finds a contact of their own client and creates new ones there', async () => {
      actAs(ids.portal, { user_type: 'client', clientId: ids.clientA });
      const found = await viaFindOrCreate(emails.inScope, ids.clientA);
      expect(found.value?.isNew).toBe(false);
      const fresh = email('portal-new');
      const created = await viaFindOrCreate(fresh, ids.clientA);
      expect(created.error, created.error?.message).toBeUndefined();
      expect(created.value?.isNew).toBe(true);
    });
  });
});
