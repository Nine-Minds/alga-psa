import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';
import { hashPassword, verifyPassword } from '@alga-psa/core/encryption';

describe('appliance initial-admin password reset', () => {
  let db: Knex;
  let tenantId: string;
  let otherTenantId: string;
  const email = 'appliance-admin@example.test';
  const oldPassword = 'Old!Appliance123';
  const newPassword = 'New!Appliance456';

  beforeAll(async () => {
    process.env.nextauth_secret = 'appliance-password-reset-integration-secret';
    process.env.NEXTAUTH_SECRET = process.env.nextauth_secret;
    process.env.SALT_BYTES = '12';
    process.env.ITERATIONS = '1000';
    process.env.KEY_LENGTH = '64';
    process.env.ALGORITHM = 'sha512';

    db = await createTestDbConnection({ runSeeds: false });
    tenantId = await createTenant(db, 'Appliance Reset Tenant');
    otherTenantId = await createTenant(db, 'Unrelated Tenant');
    await createUser(db, tenantId, {
      email,
      username: email,
      user_type: 'internal',
      hashed_password: await hashPassword(oldPassword),
    });
    await createUser(db, otherTenantId, {
      email: 'other-admin@example.test',
      username: 'other-admin@example.test',
      user_type: 'internal',
      hashed_password: await hashPassword(oldPassword),
    });
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('updates only the exact original tenant admin and produces an application-verifiable hash', async () => {
    const { resetInitialAdminPassword } = await import('../../../scripts/appliance-reset-admin-password.mjs');
    const otherBefore = await db('users')
      .select('hashed_password')
      .where({ tenant: otherTenantId, email: 'other-admin@example.test' })
      .first();

    await resetInitialAdminPassword({ db, tenantId, email, password: newPassword, hashPassword });

    const resetUser = await db('users').select('hashed_password').where({ tenant: tenantId, email }).first();
    const otherAfter = await db('users')
      .select('hashed_password')
      .where({ tenant: otherTenantId, email: 'other-admin@example.test' })
      .first();

    await expect(verifyPassword(newPassword, resetUser.hashed_password)).resolves.toBe(true);
    await expect(verifyPassword(oldPassword, resetUser.hashed_password)).resolves.toBe(false);
    expect(otherAfter.hashed_password).toBe(otherBefore.hashed_password);
  });

  it('fails without mutation when the tenant/email target does not exist', async () => {
    const { resetInitialAdminPassword } = await import('../../../scripts/appliance-reset-admin-password.mjs');
    const before = await db('users').select('hashed_password').where({ tenant: tenantId, email }).first();

    await expect(resetInitialAdminPassword({
      db,
      tenantId,
      email: 'missing-admin@example.test',
      password: 'Missing!Admin789',
      hashPassword,
    })).rejects.toThrow('Expected exactly one original appliance administrator.');

    const after = await db('users').select('hashed_password').where({ tenant: tenantId, email }).first();
    expect(after.hashed_password).toBe(before.hashed_password);
  });

  it('fails closed when an unexpected database state returns multiple targets', async () => {
    const { resetInitialAdminPassword } = await import('../../../scripts/appliance-reset-admin-password.mjs');
    let updateCalled = false;
    const fakeTransactionDb = {
      transaction: async (callback: (trx: any) => Promise<unknown>) => {
        let queryNumber = 0;
        const trx = () => {
          queryNumber += 1;
          if (queryNumber === 1) {
            const selection = {
              select: () => selection,
              where: () => selection,
              forUpdate: async () => [{ user_id: 'one' }, { user_id: 'two' }],
            };
            return selection;
          }
          return {
            where: () => ({
              update: async () => { updateCalled = true; return 2; },
            }),
          };
        };
        return callback(trx);
      },
    };

    await expect(resetInitialAdminPassword({
      db: fakeTransactionDb,
      tenantId,
      email,
      password: 'Duplicate!Admin789',
      hashPassword: async () => 'replacement-hash',
    })).rejects.toThrow('Expected exactly one original appliance administrator.');
    expect(updateCalled).toBe(false);
  });
});
