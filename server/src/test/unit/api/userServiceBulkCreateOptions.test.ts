import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * bulkCreateUsers has to honour the options it documents: force_password_reset
 * records the must_change_password preference pair, and send_welcome_email
 * mails each new account a link to set its own password — after the batch
 * commits, never inside the transaction.
 */

const hoisted = vi.hoisted(() => ({
  preferenceUpserts: [] as Array<Record<string, unknown>>,
  recoverPasswordCalls: [] as Array<[string, string]>,
  transactionOpen: false,
  sendsDuringTransaction: 0,
}));

vi.mock('@alga-psa/db/models/userPreferences', () => ({
  default: {
    upsert: vi.fn(async (_trx: unknown, preference: Record<string, unknown>) => {
      hoisted.preferenceUpserts.push(preference);
    }),
  },
}));

vi.mock('@alga-psa/auth/actions', () => ({
  recoverPassword: vi.fn(async (email: string, portal: string) => {
    if (hoisted.transactionOpen) hoisted.sendsDuringTransaction += 1;
    hoisted.recoverPasswordCalls.push([email, portal]);
    return true;
  }),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    withTransaction: vi.fn(async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) => {
      hoisted.transactionOpen = true;
      try {
        return await callback({});
      } finally {
        hoisted.transactionOpen = false;
      }
    }),
    // bulkCreateUsers opens a real savepoint per user in production; this
    // suite only cares about the options (preferences + welcome mail), so the
    // savepoint is a pass-through onto the same fake trx rather than a real
    // nested transaction.
    withSavepoint: vi.fn(async (trx: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(trx)),
  };
});

vi.mock('@alga-psa/formatting/avatarUtils', () => ({ getUserAvatarUrl: vi.fn(async () => null) }));

const { UserService } = await import('../../../../../packages/users/src/services/UserService');

const context = { tenant: '11111111-1111-1111-1111-111111111111', userId: 'actor-1', user: {} } as any;

function serviceWithStubbedCreate() {
  const service = new UserService();
  (service as any).ensurePermission = async () => true;
  (service as any).getKnex = async () => ({ knex: {} });
  (service as any).createUsingTransaction = async (data: any) => ({
    user: {
      user_id: `user-${data.email}`,
      email: data.email,
      user_type: data.user_type ?? 'internal',
    },
    admission: null,
  });
  return service;
}

beforeEach(() => {
  hoisted.preferenceUpserts = [];
  hoisted.recoverPasswordCalls = [];
  hoisted.transactionOpen = false;
  hoisted.sendsDuringTransaction = 0;
});

describe('UserService.bulkCreateUsers options', () => {
  it('forces a password change and mails each new account after the batch commits', async () => {
    const service = serviceWithStubbedCreate();

    const result = await service.bulkCreateUsers(
      [{ email: 'a@acme.test' }, { email: 'b@acme.test' }] as any,
      context,
      { send_welcome_email: true, force_password_reset: true, skip_invalid: true },
    );

    expect(result).toMatchObject({ total_processed: 2, successful: 2, failed: 0 });
    expect(hoisted.preferenceUpserts.filter((p) => p.setting_name === 'must_change_password')).toHaveLength(2);
    expect(hoisted.preferenceUpserts.filter((p) => p.setting_name === 'has_reset_password')).toEqual([
      expect.objectContaining({ setting_value: false }),
      expect.objectContaining({ setting_value: false }),
    ]);
    expect(hoisted.recoverPasswordCalls).toEqual([
      ['a@acme.test', 'msp'],
      ['b@acme.test', 'msp'],
    ]);
    expect(hoisted.sendsDuringTransaction).toBe(0);
  });

  it('writes no preference and sends nothing when both options are off', async () => {
    const service = serviceWithStubbedCreate();

    await service.bulkCreateUsers(
      [{ email: 'a@acme.test' }] as any,
      context,
      { send_welcome_email: false, force_password_reset: false, skip_invalid: true },
    );

    expect(hoisted.preferenceUpserts).toEqual([]);
    expect(hoisted.recoverPasswordCalls).toEqual([]);
  });

  it('mails a bulk-created portal user through the client portal flow', async () => {
    const service = serviceWithStubbedCreate();

    await service.bulkCreateUsers(
      [{ email: 'c@acme.test', user_type: 'client' }] as any,
      context,
      { send_welcome_email: true, skip_invalid: true },
    );

    expect(hoisted.recoverPasswordCalls).toEqual([['c@acme.test', 'client']]);
  });
});
