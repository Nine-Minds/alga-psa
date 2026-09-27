import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  permitted: true,
  provider: 'resend',
  verifiedDomain: false,
  sender: null as any,
  routes: [] as any[],
  insertedSender: null as any,
  insertedRoute: null as any,
  insertError: null as any,
}));
const hasPermissionMock = vi.hoisted(() => vi.fn(async () => state.permitted));
const getEmailSettingsMock = vi.hoisted(() => vi.fn(async () => ({ emailProvider: state.provider })));
const loggerMock = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: loggerMock }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', email: 'admin@example.test' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: hasPermissionMock }));
vi.mock('@alga-psa/db', () => {
  const knex = {
    transaction: async (callback: (trx: unknown) => unknown) => callback(knex),
  };
  const tenantDb = () => ({
    tenantJoin: (builder: unknown) => builder,
    table: (name: string) => {
      let conditions: Record<string, unknown> = {};
      const rows = () => name.startsWith('email_sender_routes') ? state.routes
        : name === 'email_sender_addresses' ? [state.sender, state.insertedSender].filter(Boolean)
          : name === 'email_domains' ? (state.verifiedDomain ? [{ domain_name: 'verified.example', status: 'verified' }] : [])
            : name === 'email_providers' ? [{ id: 'mailbox-1', provider_type: 'microsoft', mailbox: 'shared@example.test', status: 'connected', is_active: true }]
              : [];
      const matches = (row: any) => Object.entries(conditions).every(([key, value]) => row?.[key.split('.').pop()!] === value);
      const query: any = {
        where: (next: Record<string, unknown> | string, value?: unknown) => { conditions = typeof next === 'string' ? { [next]: value } : next; return query; },
        select: () => query,
        orderBy: () => query,
        first: async () => rows().find(matches) ?? null,
        insert: (row: any) => { if (state.insertError) throw state.insertError; if (name === 'email_sender_routes') { state.insertedRoute = row; state.routes.push(row); } else { state.insertedSender = { sender_id: 'new-sender', verification_status: 'unverified', ...row }; } return query; },
        returning: async () => [state.insertedSender],
        update: (row: any) => { state.sender = { ...state.sender, ...row }; return query; },
        del: async () => { state.sender = null; return 1; },
        then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows().filter(matches)).then(resolve, reject),
      };
      return query;
    },
  });
  return { createTenantKnex: vi.fn(async () => ({ knex })), tenantDb };
});
vi.mock('@alga-psa/email', () => ({ TenantEmailService: { invalidateTenantSettings: vi.fn(), getTenantEmailSettings: getEmailSettingsMock, getDefaultFromAddress: () => ({ email: 'provider@example.test', name: 'Provider' }), getInstance: () => ({ sendEmail: vi.fn(async () => ({ success: true })) }) } }));

import { clearEmailSenderRoute, createEmailSender, deleteEmailSender, listEmailSenders, listSelectableSenders, setEmailSenderRoute, updateEmailSender, verifyEmailSender } from './emailSenderActions';

describe('email sender actions', () => {
  beforeEach(() => {
    state.permitted = true;
    state.provider = 'resend';
    state.verifiedDomain = false;
    state.sender = { tenant: 'tenant-1', sender_id: 'sender-1', email_address: 'support@example.test', verification_status: 'verified' };
    state.routes.splice(0, state.routes.length);
    state.insertedSender = null;
    state.insertedRoute = null;
    state.insertError = null;
    hasPermissionMock.mockClear();
    getEmailSettingsMock.mockClear();
    loggerMock.error.mockClear();
  });

  it('returns the resolved provider fallback when no route exists and the routed address when present', async () => {
    const fallback = await listSelectableSenders({ mailClass: 'billing' });
    expect(fallback).toMatchObject({ effectiveSenderId: null, effectiveSenderAddress: 'provider@example.test' });
    state.routes.push({ route_type: 'mail_class', mail_class: 'billing', sender_id: 'sender-1', display_name: null });
    expect(await listSelectableSenders({ mailClass: 'billing' })).toMatchObject({ effectiveSenderId: 'sender-1', effectiveSenderAddress: 'support@example.test' });
  });

  it('maps and logs sender and route unique violations on the server', async () => {
    state.verifiedDomain = true;
    state.insertError = Object.assign(new Error('sensitive SQL details'), { code: '23505' });
    await expect(createEmailSender({ emailAddress: 'support@verified.example' })).rejects.toThrow('This sender address already exists.');
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('Duplicate sender address'), state.insertError);

    state.insertError = Object.assign(new Error('sensitive SQL details'), { code: '23505' });
    await expect(setEmailSenderRoute({ routeType: 'mail_class', mailClass: 'ticket', senderId: 'sender-1' })).rejects.toThrow('That sender route already exists.');
    expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('Duplicate sender route'), state.insertError);
  });

  it('denies sender reads when settings:read is missing', async () => {
    state.permitted = false;
    await expect(listEmailSenders()).rejects.toThrow(/permission/i);
    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'settings', 'read', expect.anything());
  });

  it('allows verified Resend domains and rejects unverified domains', async () => {
    state.verifiedDomain = true;
    await expect(createEmailSender({ emailAddress: 'support@verified.example' })).resolves.toMatchObject({ tenant: 'tenant-1', verification_status: 'verified' });
    state.insertedSender = null;
    await expect(createEmailSender({ emailAddress: 'support@unverified.example' })).rejects.toThrow(/not verified/);
  });

  it('creates SMTP identities and requires explicit confirmation to route an unverified address', async () => {
    state.provider = 'smtp';
    await expect(createEmailSender({ emailAddress: 'relay@example.test' })).resolves.toMatchObject({ verification_status: 'unverified' });
    state.sender.verification_status = 'unverified';
    await expect(setEmailSenderRoute({ routeType: 'mail_class', mailClass: 'ticket', senderId: 'sender-1' })).rejects.toThrow(/explicitly confirm/);
    await expect(setEmailSenderRoute({ routeType: 'mail_class', mailClass: 'ticket', senderId: 'sender-1', confirmUnverifiedSmtpSender: true })).resolves.toMatchObject({ success: true });
    expect(state.insertedRoute).toMatchObject({ tenant: 'tenant-1', route_type: 'mail_class', mail_class: 'ticket' });
  });

  it('distinguishes Microsoft mailbox send-as from using the mailbox itself', async () => {
    state.provider = 'microsoft';
    await expect(createEmailSender({ emailAddress: 'shared@example.test', microsoftProviderId: 'mailbox-1' })).resolves.toMatchObject({ verification_status: 'verified' });
    state.insertedSender = null;
    await expect(createEmailSender({ emailAddress: 'projects@example.test', microsoftProviderId: 'mailbox-1' })).resolves.toMatchObject({ verification_status: 'unverified' });
  });

  it('blocks deletion while routed and allows deleting an unused sender', async () => {
    state.routes.push({ route_type: 'mail_class', mail_class: 'ticket', sender_id: 'sender-1' });
    await expect(deleteEmailSender('sender-1')).rejects.toThrow(/ticket/);
    state.routes.splice(0);
    await expect(deleteEmailSender('sender-1')).resolves.toMatchObject({ success: true });
  });

  it('requires update permission for every write action', async () => {
    state.permitted = false;
    const writes = [
      () => createEmailSender({ emailAddress: 'x@example.test' }),
      () => updateEmailSender({ senderId: 'sender-1', displayName: 'Updated' }),
      () => deleteEmailSender('sender-1'),
      () => setEmailSenderRoute({ routeType: 'default', senderId: 'sender-1' }),
      () => clearEmailSenderRoute({ routeType: 'default' }),
      () => verifyEmailSender('sender-1'),
    ];
    for (const write of writes) await expect(write()).rejects.toThrow(/permission/i);
    expect(hasPermissionMock).toHaveBeenCalledTimes(writes.length);
    expect(hasPermissionMock).toHaveBeenCalledWith(expect.anything(), 'settings', 'update', expect.anything());
  });
});
