import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import { createDisposableDatabase, type DisposableDatabase } from './helpers/disposableDatabase';

const connectionRef = vi.hoisted(() => ({ current: null as unknown as Knex }));
const getCurrentUserMock = vi.hoisted(() => vi.fn());

// Substitute only the database connection. `runWithTenant` and
// `getTenantContext` stay the real implementations so tenant context is
// propagated through AsyncLocalStorage exactly as production does; the
// context-aware `createTenantKnex` reads the real context store.
vi.mock('@alga-psa/db/tenant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db/tenant')>();
  return {
    ...actual,
    createTenantKnex: async (tenantId?: string | null) => ({
      knex: connectionRef.current,
      tenant: tenantId ?? actual.getTenantContext() ?? null,
    }),
  };
});

vi.mock('@/lib/db', async () => {
  const tenant = await import('@alga-psa/db/tenant');
  return {
    createTenantKnex: tenant.createTenantKnex,
    runWithTenant: tenant.runWithTenant,
  };
});

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

import { runWithTenant } from '@alga-psa/db';
import Message from '@ee/models/message';
import Chat from '@ee/models/chat';
import { getChatMessagesAction, updateMessageAction } from '@ee/lib/chat-actions/chatActions';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const SHARED_USER = '33333333-3333-4333-8333-333333333333';
const OTHER_USER = '66666666-6666-4666-8666-666666666666';

const DUP_CHAT = '44444444-4444-4444-8444-444444444444';
const DUP_MESSAGE = '55555555-5555-4555-8555-555555555555';
const A_ONLY_CHAT = '77777777-7777-4777-8777-777777777777';
const A_ONLY_MESSAGE = '88888888-8888-4888-8888-888888888888';
const B_ONLY_CHAT = '99999999-9999-4999-8999-999999999999';
const B_ONLY_MESSAGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const asUser = (user_id: string, tenant: string) =>
  getCurrentUserMock.mockResolvedValue({ user_id, tenant });

const messageContent = async (id: string, tenant: string): Promise<string> =>
  (await connectionRef.current('messages').where({ id, tenant }).first())?.content;

const messageRow = async (id: string, tenant: string) =>
  connectionRef.current('messages').where({ id, tenant }).first();

describe('EE chat message authorization (disposable database, real tenant context)', () => {
  let disposable: DisposableDatabase | undefined;
  let db: Knex;

  beforeAll(async () => {
    disposable = await createDisposableDatabase('ee_chat_authz');
    db = disposable.db;
    connectionRef.current = db;

    // Migration-equivalent EE schema: composite (tenant, id) primary keys and
    // composite foreign keys, matching 202410291100_create_ai_schema.cjs.
    await db.schema.createTable('users', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('user_id').notNullable();
      table.primary(['tenant', 'user_id']);
    });

    await db.schema.createTable('chats', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable();
      table.uuid('user_id');
      table.text('title_text');
      table.boolean('title_is_locked');
      table.timestamp('created_at', { useTz: true }).defaultTo(db.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(db.fn.now());
      table.primary(['tenant', 'id']);
      table
        .foreign(['tenant', 'user_id'])
        .references(['tenant', 'user_id'])
        .inTable('users');
    });

    await db.schema.createTable('messages', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable();
      table.uuid('chat_id');
      table.text('chat_role');
      table.text('content');
      table.text('thumb');
      table.text('feedback');
      table.specificType('message_order', 'serial');
      table.primary(['tenant', 'id']);
      table
        .foreign(['tenant', 'chat_id'])
        .references(['tenant', 'id'])
        .inTable('chats');
    });
  });

  beforeEach(async () => {
    getCurrentUserMock.mockReset();
    await db('messages').delete();
    await db('chats').delete();
    await db('users').delete();

    await db('users').insert([
      { tenant: TENANT_A, user_id: SHARED_USER },
      { tenant: TENANT_A, user_id: OTHER_USER },
      { tenant: TENANT_B, user_id: SHARED_USER },
    ]);

    // Duplicate chat and message identifiers across tenants, with the same
    // user id present in both tenants.
    await db('chats').insert([
      { tenant: TENANT_A, id: DUP_CHAT, user_id: SHARED_USER, title_text: 'A', title_is_locked: false },
      { tenant: TENANT_B, id: DUP_CHAT, user_id: SHARED_USER, title_text: 'B', title_is_locked: false },
      { tenant: TENANT_A, id: A_ONLY_CHAT, user_id: SHARED_USER, title_text: 'A only', title_is_locked: false },
      { tenant: TENANT_B, id: B_ONLY_CHAT, user_id: SHARED_USER, title_text: 'B only', title_is_locked: false },
    ]);

    await db('messages').insert([
      { tenant: TENANT_A, id: DUP_MESSAGE, chat_id: DUP_CHAT, chat_role: 'bot', content: 'tenant-a', thumb: 'up', feedback: 'feedback-a', message_order: 3 },
      { tenant: TENANT_B, id: DUP_MESSAGE, chat_id: DUP_CHAT, chat_role: 'bot', content: 'tenant-b', thumb: 'up', feedback: 'feedback-b', message_order: 3 },
      { tenant: TENANT_A, id: A_ONLY_MESSAGE, chat_id: A_ONLY_CHAT, chat_role: 'bot', content: 'a-only', message_order: 1 },
      { tenant: TENANT_B, id: B_ONLY_MESSAGE, chat_id: B_ONLY_CHAT, chat_role: 'bot', content: 'b-only', message_order: 1 },
    ]);
  });

  afterAll(async () => {
    connectionRef.current = null as unknown as Knex;
    if (disposable) {
      await disposable.drop();
    }
  });

  it('authorizes duplicate-id reads and updates in both tenants for the same user id', async () => {
    asUser(SHARED_USER, TENANT_A);
    const tenantARead = await getChatMessagesAction(DUP_CHAT);
    expect(tenantARead.map((message) => message.content)).toEqual(['tenant-a']);
    await expect(updateMessageAction(DUP_MESSAGE, { content: 'a-edited' })).resolves.toBe('success');
    expect(await messageContent(DUP_MESSAGE, TENANT_B)).toBe('tenant-b');

    asUser(SHARED_USER, TENANT_B);
    const tenantBRead = await getChatMessagesAction(DUP_CHAT);
    expect(tenantBRead.map((message) => message.content)).toEqual(['tenant-b']);
    await expect(updateMessageAction(DUP_MESSAGE, { content: 'b-edited' })).resolves.toBe('success');
    expect(await messageContent(DUP_MESSAGE, TENANT_A)).toBe('a-edited');
  });

  it('denies another user in the same tenant and leaves the foreign row unchanged', async () => {
    asUser(OTHER_USER, TENANT_A);

    await expect(getChatMessagesAction(DUP_CHAT)).rejects.toThrow('Chat access denied');
    await expect(updateMessageAction(DUP_MESSAGE, { content: 'hacked' })).resolves.toBe('unauthorized');
    expect(await messageContent(DUP_MESSAGE, TENANT_A)).toBe('tenant-a');
  });

  it('denies cross-tenant access and leaves the foreign row unchanged', async () => {
    asUser(SHARED_USER, TENANT_B);

    await expect(getChatMessagesAction(A_ONLY_CHAT)).rejects.toThrow('Chat access denied');
    await expect(updateMessageAction(A_ONLY_MESSAGE, { content: 'hacked' })).resolves.toBe('unauthorized');
    expect(await messageContent(A_ONLY_MESSAGE, TENANT_A)).toBe('a-only');
  });

  it('returns the same denial for missing and foreign identifiers', async () => {
    asUser(SHARED_USER, TENANT_B);
    const missingId = randomUUID();

    await expect(getChatMessagesAction(A_ONLY_CHAT)).rejects.toThrow('Chat access denied');
    await expect(getChatMessagesAction(missingId)).rejects.toThrow('Chat access denied');
    await expect(updateMessageAction(A_ONLY_MESSAGE, { content: 'x' })).resolves.toBe('unauthorized');
    await expect(updateMessageAction(missingId, { content: 'x' })).resolves.toBe('unauthorized');
  });

  it('enforces ownership in the models through the real tenant context', async () => {
    await expect(
      runWithTenant(TENANT_A, () => Message.getByChatIdForUser(A_ONLY_CHAT, SHARED_USER)),
    ).resolves.toHaveLength(1);

    await expect(
      runWithTenant(TENANT_A, () => Message.getByChatIdForUser(B_ONLY_CHAT, SHARED_USER)),
    ).rejects.toThrow('Chat access denied');

    await expect(
      runWithTenant(TENANT_A, () => Message.update(B_ONLY_MESSAGE, { content: 'hacked' }, SHARED_USER)),
    ).resolves.toBe(0);
    expect(await messageContent(B_ONLY_MESSAGE, TENANT_B)).toBe('b-only');
  });

  it('strips forged columns on the action update path and leaves foreign rows untouched', async () => {
    asUser(SHARED_USER, TENANT_A);

    await expect(
      updateMessageAction(DUP_MESSAGE, {
        content: 'action-edited',
        thumb: 'down',
        feedback: 'action-feedback',
        message_order: 7,
        tenant: TENANT_B,
        chat_id: B_ONLY_CHAT,
        chat_role: 'system',
        id: 'forged-id',
      } as never),
    ).resolves.toBe('success');

    expect(await messageRow(DUP_MESSAGE, TENANT_A)).toMatchObject({
      id: DUP_MESSAGE,
      tenant: TENANT_A,
      chat_id: DUP_CHAT,
      chat_role: 'bot',
      content: 'action-edited',
      thumb: 'down',
      feedback: 'action-feedback',
      message_order: 7,
    });
    // The tenant-B row with the same message id must be untouched.
    expect(await messageRow(DUP_MESSAGE, TENANT_B)).toMatchObject({
      id: DUP_MESSAGE,
      tenant: TENANT_B,
      chat_id: DUP_CHAT,
      chat_role: 'bot',
      content: 'tenant-b',
      thumb: 'up',
      feedback: 'feedback-b',
      message_order: 3,
    });
  });

  it('strips forged columns on the direct model update path and leaves foreign rows untouched', async () => {
    const updated = await runWithTenant(TENANT_A, () =>
      Message.update(
        DUP_MESSAGE,
        {
          content: 'model-edited',
          tenant: TENANT_B,
          chat_id: B_ONLY_CHAT,
          chat_role: 'system',
          id: 'forged-id',
        } as never,
        SHARED_USER,
      ),
    );
    expect(updated).toBe(1);

    expect(await messageRow(DUP_MESSAGE, TENANT_A)).toMatchObject({
      id: DUP_MESSAGE,
      tenant: TENANT_A,
      chat_id: DUP_CHAT,
      chat_role: 'bot',
      content: 'model-edited',
      thumb: 'up',
      feedback: 'feedback-a',
      message_order: 3,
    });
    expect(await messageRow(DUP_MESSAGE, TENANT_B)).toMatchObject({
      id: DUP_MESSAGE,
      tenant: TENANT_B,
      chat_id: DUP_CHAT,
      chat_role: 'bot',
      content: 'tenant-b',
    });
  });

  it('persists partial updates including empty strings, nulls, zero, and omitted fields', async () => {
    asUser(SHARED_USER, TENANT_A);

    await expect(
      updateMessageAction(DUP_MESSAGE, { content: '', thumb: null, feedback: null, message_order: 0 }),
    ).resolves.toBe('success');

    expect(await messageRow(DUP_MESSAGE, TENANT_A)).toMatchObject({
      id: DUP_MESSAGE,
      tenant: TENANT_A,
      chat_id: DUP_CHAT,
      chat_role: 'bot',
      content: '',
      thumb: null,
      feedback: null,
      message_order: 0,
    });

    // Omitted fields keep their stored values; only the supplied field changes.
    await expect(updateMessageAction(DUP_MESSAGE, { feedback: 'only-feedback' })).resolves.toBe(
      'success',
    );

    expect(await messageRow(DUP_MESSAGE, TENANT_A)).toMatchObject({
      id: DUP_MESSAGE,
      tenant: TENANT_A,
      chat_id: DUP_CHAT,
      chat_role: 'bot',
      content: '',
      thumb: null,
      feedback: 'only-feedback',
      message_order: 0,
    });
  });

  it('fails model operations closed without tenant context', async () => {
    await expect(Message.getByChatId(DUP_CHAT)).rejects.toThrow('Missing tenant for message model');
    await expect(Message.update(DUP_MESSAGE, { content: 'x' }, SHARED_USER)).rejects.toThrow(
      'Missing tenant for message model',
    );
    await expect(Chat.getRecentByUser(SHARED_USER, 20)).rejects.toThrow('Missing tenant for chat model');
  });

  it('enforces the composite message-to-chat foreign key', async () => {
    await expect(
      connectionRef.current('messages').insert({
        tenant: TENANT_A,
        id: randomUUID(),
        chat_id: randomUUID(),
        chat_role: 'bot',
        content: 'orphan',
        message_order: 99,
      }),
    ).rejects.toThrow();

    const orphanCount = await connectionRef.current('messages')
      .where({ tenant: TENANT_A, content: 'orphan' })
      .count<{ count: string }[]>('* as count');
    expect(Number(orphanCount[0].count)).toBe(0);
  });

  it('authenticates empty-id requests for both actions before any access', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    await expect(getChatMessagesAction('')).rejects.toThrow('Not authenticated');
    await expect(updateMessageAction('', { content: 'x' })).rejects.toThrow('Not authenticated');
  });
});
