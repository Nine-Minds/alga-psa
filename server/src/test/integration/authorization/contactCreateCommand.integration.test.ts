/**
 * T001 (alga-2026-0003442, S1, F001/F004): addContact, createClientContact and the CSV import create branch all
 * go through `createContactAs`, so the client-scope check runs before the duplicate check on every path.
 *
 * A restricted internal user (a published bundle naming client A only) creates in scope, and is refused, with no
 * row written, for client C and for no client, on all three paths. The refusal wins over the duplicate check: an
 * email that already exists in the tenant yields a scope refusal, never EMAIL_EXISTS. An unrestricted user in a
 * tenant with no bundle and no resolver subject creates as before. Real DB, real kernel, real bundle service;
 * only the session, the DB handle and the coarse RBAC grant are stood in for.
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

import {
  addContact,
  createClientContact,
  importContactsFromCSV,
} from '../../../../../packages/clients/src/actions/contact-actions/contactActions';

const OUT_OF_SCOPE = /Permission denied/i;

describe('T001: one contact create command behind addContact, createClientContact and the CSV import', () => {
  let db: Knex;
  let tenant: string;
  let plainTenant: string;
  const mark = uuidv4().slice(0, 8);
  const ids = { clientA: uuidv4(), clientC: uuidv4(), plainClient: uuidv4(), admin: '', narrowed: '', unrestricted: '', plainUser: '' };
  const existingEmail = `existing-${mark}@example.com`;

  const actAs = (userId: string, forTenant = tenant) => {
    ref.tenant = forTenant;
    ref.user = { user_id: userId, user_type: 'internal', tenant: forTenant, email: `${userId}@example.com` };
  };
  const run = <T>(fn: () => Promise<T>, forTenant = tenant) => runWithTenant(forTenant, fn);
  const rows = async (email: string, forTenant = tenant) =>
    Number((await db('contacts').where({ tenant: forTenant, email }).count('* as n').first() as any).n);

  /** What each path reports for a refusal; a thrown Error, a failed result row, or a failed action result. */
  async function outcome(fn: () => Promise<any>): Promise<{ ok: boolean; message: string }> {
    try {
      const value = await fn();
      if (Array.isArray(value)) return { ok: value.every((r) => r.success), message: value.map((r) => r.message).join('; ') };
      if (value && value.success === false) return { ok: false, message: String(value.error) };
      return { ok: true, message: '' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  const paths = {
    addContact: (email: string, clientId?: string) =>
      outcome(() => run(() => addContact({ full_name: `Via add ${email}`, email, client_id: clientId } as any))),
    createClientContact: (email: string, clientId?: string) =>
      outcome(() => run(() => createClientContact({ clientId: clientId as string, fullName: `Via client ${email}`, email }))),
    csvImport: (email: string, clientId?: string) =>
      outcome(() => run(() => importContactsFromCSV([{ full_name: `Via csv ${email}`, email, client_id: clientId ?? null } as any], false))),
  };

  beforeAll(async () => {
    db = await createTestDbConnection();
    ref.knex = db;
    tenant = await createTenant(db, `Contact create cmd ${mark}`);
    plainTenant = await createTenant(db, `Contact create cmd plain ${mark}`);
    ids.admin = await createUser(db, tenant, { first_name: 'Ada', last_name: 'Admin' });
    ids.narrowed = await createUser(db, tenant, { user_type: 'internal', first_name: 'Nora', last_name: 'Narrowed' });
    ids.unrestricted = await createUser(db, tenant, { user_type: 'internal', first_name: 'Uma', last_name: 'Unrestricted' });
    ids.plainUser = await createUser(db, plainTenant, { user_type: 'internal', first_name: 'Pia', last_name: 'Plain' });

    for (const [forTenant, clientId, name] of [[tenant, ids.clientA, 'A'], [tenant, ids.clientC, 'C'], [plainTenant, ids.plainClient, 'P']] as const) {
      await db('clients').insert({ tenant: forTenant, client_id: clientId, client_name: `Client ${name} ${mark}`, billing_cycle: 'monthly', is_tax_exempt: false });
    }
    // An email already held in the tenant, so the duplicate check has something to find.
    await db('contacts').insert({ tenant, contact_name_id: uuidv4(), full_name: `Existing ${mark}`, client_id: ids.clientC, email: existingEmail, is_inactive: false });

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
    try {
      for (const t of [tenant, plainTenant]) {
        await db('contacts').where({ tenant: t }).del();
      }
    } catch {
      // disposable tenants
    }
    await db.destroy();
  }, 120_000);

  for (const [name, create] of Object.entries(paths)) {
    describe(`${name}, restricted to client A`, () => {
      it('creates for client A', async () => {
        actAs(ids.narrowed);
        const email = `${name}-in-${mark}@example.com`.toLowerCase();
        const result = await create(email, ids.clientA);
        expect(result.ok, result.message).toBe(true);
        expect(await rows(email)).toBe(1);
      });

      it('is refused for client C, with no row written', async () => {
        actAs(ids.narrowed);
        const email = `${name}-out-${mark}@example.com`.toLowerCase();
        const result = await create(email, ids.clientC);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(OUT_OF_SCOPE);
        expect(await rows(email)).toBe(0);
      });

      it('is refused for no client, with no row written', async () => {
        actAs(ids.narrowed);
        const email = `${name}-none-${mark}@example.com`.toLowerCase();
        const result = await create(email, undefined);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(OUT_OF_SCOPE);
        expect(await rows(email)).toBe(0);
      });

      it('is refused by scope, not by the duplicate check, when the email already exists', async () => {
        actAs(ids.narrowed);
        const result = await create(existingEmail, ids.clientC);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(OUT_OF_SCOPE);
        expect(result.message).not.toMatch(/EMAIL_EXISTS|already exists/i);
        expect(await rows(existingEmail)).toBe(1);
      });

      it('lets an unrestricted user in the same tenant create for client C, and reports a duplicate as before', async () => {
        actAs(ids.unrestricted);
        const email = `${name}-free-${mark}@example.com`.toLowerCase();
        const created = await create(email, ids.clientC);
        expect(created.ok, created.message).toBe(true);
        expect(await rows(email)).toBe(1);

        const duplicate = await create(existingEmail, ids.clientC);
        expect(duplicate.ok).toBe(false);
        expect(duplicate.message).toMatch(/already exists/i);
      });
    });
  }

  describe('a tenant with no bundle and no resolver subject', () => {
    it('creates through all three paths as before, with or without a client', async () => {
      actAs(ids.plainUser, plainTenant);
      for (const [name, create] of Object.entries(paths)) {
        const withClient = `${name}-plain-${mark}@example.com`.toLowerCase();
        const result = await outcome(() => run(() => {
          if (name === 'addContact') return addContact({ full_name: `P ${name}`, email: withClient, client_id: ids.plainClient } as any);
          if (name === 'createClientContact') return createClientContact({ clientId: ids.plainClient, fullName: `P ${name}`, email: withClient });
          return importContactsFromCSV([{ full_name: `P ${name}`, email: withClient, client_id: ids.plainClient } as any], false);
        }, plainTenant));
        expect(result.ok, `${name}: ${result.message}`).toBe(true);
        expect(await rows(withClient, plainTenant)).toBe(1);
        void create;
      }
      const clientless = `clientless-plain-${mark}@example.com`;
      const result = await outcome(() => run(() => addContact({ full_name: 'No client', email: clientless } as any), plainTenant));
      expect(result.ok, result.message).toBe(true);
      expect(await rows(clientless, plainTenant)).toBe(1);
    });
  });
});
