import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import type { Knex } from 'knex';

let tenantId = '';
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) => fn({ user_id: 'sender-test-user', email: 'sender-test@example.test' }, { tenant: tenantId }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));

import { clearEmailSenderRoute, createEmailSender, deleteEmailSender, listEmailSenders, setEmailSenderRoute } from '@alga-psa/integrations/actions';

describe('email sender actions persistence', () => {
  let db: Knex;
  let boardId: string;
  let senderId: string;
  let originalServerDatabaseName: string | undefined;

  beforeAll(async () => {
    originalServerDatabaseName = process.env.DB_NAME_SERVER;
    process.env.DB_NAME_SERVER = 'email_sender_actions_test';
    db = await createTestDbConnection({ databaseName: 'email_sender_actions_test', runSeeds: true });
    const tenant = await db('tenants').first('tenant');
    if (!tenant?.tenant) throw new Error('No tenant found in isolated integration DB');
    tenantId = tenant.tenant;
    const board = await db('boards').where({ tenant: tenantId }).first('board_id');
    if (!board?.board_id) throw new Error('No seeded board found in isolated integration DB');
    boardId = board.board_id;
    await db('tenant_email_settings').where({ tenant: tenantId }).del();
    await db('tenant_email_settings').insert({ tenant: tenantId, email_provider: 'smtp', default_from_domain: 'example.test' });
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
    if (originalServerDatabaseName === undefined) delete process.env.DB_NAME_SERVER;
    else process.env.DB_NAME_SERVER = originalServerDatabaseName;
  });

  it('creates senders and persists, upserts, lists, and clears class and board routes', async () => {
    const address = `sender-${Date.now()}@example.test`;
    const created = await createEmailSender({ emailAddress: address });
    expect(created).toMatchObject({ tenant: tenantId, sender_id: expect.any(String), email_address: address });
    if (!('sender_id' in created)) throw new Error(`Could not create sender: ${'error' in created ? created.error : 'unknown error'}`);
    senderId = created.sender_id;
    expect(created.tenant).toBe(tenantId);
    expect(await db('email_sender_addresses').where({ tenant: tenantId, sender_id: senderId }).first()).toMatchObject({ email_address: address });
    expect((await listEmailSenders()).senders.some((sender: any) => sender.sender_id === senderId)).toBe(true);

    await expect(setEmailSenderRoute({ routeType: 'mail_class', mailClass: 'billing', senderId, confirmUnverifiedSmtpSender: true })).resolves.toMatchObject({ success: true });
    let classRoute = await db('email_sender_routes').where({ tenant: tenantId, route_type: 'mail_class', mail_class: 'billing' }).first();
    expect(classRoute).toMatchObject({ sender_id: senderId });
    await expect(setEmailSenderRoute({ routeType: 'mail_class', mailClass: 'billing', displayName: 'Billing team' })).resolves.toMatchObject({ success: true });
    const classRoutes = await db('email_sender_routes').where({ tenant: tenantId, route_type: 'mail_class', mail_class: 'billing' });
    expect(classRoutes).toHaveLength(1);
    expect(classRoutes[0]).toMatchObject({ sender_id: null, display_name: 'Billing team' });

    await expect(setEmailSenderRoute({ routeType: 'board', boardId, senderId, confirmUnverifiedSmtpSender: true })).resolves.toMatchObject({ success: true });
    expect(await db('email_sender_routes').where({ tenant: tenantId, route_type: 'board', board_id: boardId }).first()).toMatchObject({ sender_id: senderId });
    const board = await db('boards').where({ tenant: tenantId, board_id: boardId }).first('board_name');
    expect((await listEmailSenders()).routes).toContainEqual(expect.objectContaining({ board_id: boardId, board_name: board.board_name }));
    await expect(deleteEmailSender(senderId)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining(`board "${board.board_name}"`),
    });
    await expect(setEmailSenderRoute({ routeType: 'board', boardId, displayName: 'Board team' })).resolves.toMatchObject({ success: true });
    expect(await db('email_sender_routes').where({ tenant: tenantId, route_type: 'board', board_id: boardId })).toHaveLength(1);
    await expect(clearEmailSenderRoute({ routeType: 'mail_class', mailClass: 'billing' })).resolves.toMatchObject({ success: true });
    expect(await db('email_sender_routes').where({ tenant: tenantId, route_type: 'mail_class', mail_class: 'billing' })).toHaveLength(0);
    await expect(clearEmailSenderRoute({ routeType: 'board', boardId })).resolves.toMatchObject({ success: true });
    expect(await db('email_sender_routes').where({ tenant: tenantId, route_type: 'board', board_id: boardId })).toHaveLength(0);
    await db('email_sender_addresses').where({ tenant: tenantId, sender_id: senderId }).del();
  });
});
