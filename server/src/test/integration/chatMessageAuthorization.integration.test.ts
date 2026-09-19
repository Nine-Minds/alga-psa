import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { knex as createKnex, type Knex } from 'knex';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const runWithTenantMock = vi.hoisted(() =>
  vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
);
const getCurrentUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

// The EE chat/message models import ee/server/src/lib/db, which re-exports
// @alga-psa/db/tenant (not @/lib/db) — mock it too so model queries hit the
// test database instead of the env-configured shared connection.
vi.mock('@alga-psa/db/tenant', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createTenantKnex: createTenantKnexMock,
    runWithTenant: runWithTenantMock,
  };
});

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

import Message from '@ee/models/message';
import Chat from '@ee/models/chat';

const TENANT_A = 'chat-authz-tenant-a';
const TENANT_B = 'chat-authz-tenant-b';
const USER_A = 'chat-authz-user-a';
const USER_B = 'chat-authz-user-b';

type ChatActionsModule = typeof import('@ee/lib/chat-actions/chatActions');

describe('EE chat message authorization (db-backed)', () => {
  let db: Knex;

  const loadChatActions = async (): Promise<ChatActionsModule> => {
    vi.resetModules();
    return import('@ee/lib/chat-actions/chatActions');
  };

  const seedChat = async (params: {
    id: string;
    tenant: string;
    userId: string;
    title?: string;
  }) => {
    await db('chats').insert({
      id: params.id,
      tenant: params.tenant,
      user_id: params.userId,
      title_text: params.title ?? 'Chat',
      title_is_locked: false,
    });
  };

  const seedMessage = async (params: {
    id: string;
    tenant: string;
    chatId: string;
    content: string;
    order?: number;
    thumb?: string | null;
    feedback?: string | null;
    role?: string;
  }) => {
    await db('messages').insert({
      id: params.id,
      tenant: params.tenant,
      chat_id: params.chatId,
      chat_role: params.role ?? 'bot',
      content: params.content,
      thumb: params.thumb ?? 'up',
      feedback: params.feedback ?? 'original-feedback',
      message_order: params.order ?? 1,
    });
  };

  beforeAll(async () => {
    db = createKnex({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5438),
        user: process.env.DB_USER_ADMIN ?? 'postgres',
        password: process.env.DB_PASSWORD_ADMIN ?? 'postpass123',
        database: 'postgres',
      },
      pool: { min: 1, max: 4 },
    });

    await db.schema.dropTableIfExists('messages');
    await db.schema.dropTableIfExists('chats');

    await db.schema.createTable('chats', (table) => {
      table.text('id').primary();
      table.text('tenant').notNullable();
      table.text('user_id').notNullable();
      table.text('title_text');
      table.boolean('title_is_locked');
    });

    await db.schema.createTable('messages', (table) => {
      table.text('id').primary();
      table.text('tenant').notNullable();
      table.text('chat_id').notNullable();
      table.text('chat_role').notNullable();
      table.text('content').notNullable();
      table.text('thumb');
      table.text('feedback');
      table.integer('message_order');
    });
  });

  beforeEach(async () => {
    createTenantKnexMock.mockReset();
    getCurrentUserMock.mockReset();
    createTenantKnexMock.mockResolvedValue({ knex: db, tenant: TENANT_A });
    getCurrentUserMock.mockResolvedValue({ user_id: USER_A, tenant: TENANT_A });
    await db('messages').whereIn('tenant', [TENANT_A, TENANT_B]).delete();
    await db('chats').whereIn('tenant', [TENANT_A, TENANT_B]).delete();
  });

  afterAll(async () => {
    await db.schema.dropTableIfExists('messages');
    await db.schema.dropTableIfExists('chats');
    await db.destroy();
  });

  it('allows the owner to read and partially update a message, including falsy/null values', async () => {
    const chatId = randomUUID();
    const messageId = randomUUID();
    await seedChat({ id: chatId, tenant: TENANT_A, userId: USER_A });
    await seedMessage({ id: messageId, tenant: TENANT_A, chatId, content: 'hello', order: 1 });

    const { getChatMessagesAction, updateMessageAction } = await loadChatActions();

    const loaded = await getChatMessagesAction(chatId);
    expect(loaded.map((message) => message.id)).toEqual([messageId]);

    const result = await updateMessageAction(messageId, {
      thumb: null,
      feedback: null,
      message_order: 0,
    });
    expect(result).toBe('success');

    const row = await db('messages').where({ id: messageId, tenant: TENANT_A }).first();
    expect(row).toMatchObject({ thumb: null, feedback: null, message_order: 0 });
  });

  it('denies anonymous and incomplete callers instead of returning empty or skipped', async () => {
    const chatId = randomUUID();
    const messageId = randomUUID();
    await seedChat({ id: chatId, tenant: TENANT_A, userId: USER_A });
    await seedMessage({ id: messageId, tenant: TENANT_A, chatId, content: 'secret' });

    const { getChatMessagesAction, updateMessageAction } = await loadChatActions();

    getCurrentUserMock.mockResolvedValue(null);
    await expect(getChatMessagesAction(chatId)).rejects.toThrow('Not authenticated');
    await expect(updateMessageAction(messageId, { content: 'hacked' })).rejects.toThrow(
      'Not authenticated',
    );

    getCurrentUserMock.mockResolvedValue({ tenant: TENANT_A });
    await expect(getChatMessagesAction(chatId)).rejects.toThrow('Not authenticated');

    getCurrentUserMock.mockResolvedValue({ user_id: USER_A });
    await expect(getChatMessagesAction(chatId)).rejects.toThrow('Missing tenant for chat action');
    await expect(updateMessageAction(messageId, { content: 'hacked' })).rejects.toThrow(
      'Missing tenant for chat action',
    );

    const row = await db('messages').where({ id: messageId }).first();
    expect(row.content).toBe('secret');
  });

  it('denies another user in the same tenant from reading or updating', async () => {
    const chatId = randomUUID();
    const messageId = randomUUID();
    await seedChat({ id: chatId, tenant: TENANT_A, userId: USER_A });
    await seedMessage({ id: messageId, tenant: TENANT_A, chatId, content: 'private' });

    getCurrentUserMock.mockResolvedValue({ user_id: USER_B, tenant: TENANT_A });

    const { getChatMessagesAction, updateMessageAction } = await loadChatActions();

    await expect(getChatMessagesAction(chatId)).rejects.toThrow('Chat access denied');
    await expect(updateMessageAction(messageId, { content: 'hacked' })).resolves.toBe('unauthorized');

    const row = await db('messages').where({ id: messageId }).first();
    expect(row.content).toBe('private');
  });

  it('denies cross-tenant reads and writes', async () => {
    const chatId = randomUUID();
    const messageId = randomUUID();
    await seedChat({ id: chatId, tenant: TENANT_B, userId: USER_B });
    await seedMessage({ id: messageId, tenant: TENANT_B, chatId, content: 'other-tenant' });

    // Caller is authenticated in tenant A; the target rows live in tenant B.
    getCurrentUserMock.mockResolvedValue({ user_id: USER_A, tenant: TENANT_A });

    const { getChatMessagesAction, updateMessageAction } = await loadChatActions();

    await expect(getChatMessagesAction(chatId)).rejects.toThrow('Chat access denied');
    await expect(updateMessageAction(messageId, { content: 'hacked' })).resolves.toBe('unauthorized');

    const row = await db('messages').where({ id: messageId }).first();
    expect(row).toMatchObject({ content: 'other-tenant', tenant: TENANT_B });
  });

  it('strips non-allowlisted columns on the action update path', async () => {
    const chatId = randomUUID();
    const messageId = randomUUID();
    await seedChat({ id: chatId, tenant: TENANT_A, userId: USER_A });
    await seedMessage({ id: messageId, tenant: TENANT_A, chatId, content: 'original', role: 'bot' });

    const { updateMessageAction } = await loadChatActions();
    const result = await updateMessageAction(messageId, {
      content: 'edited',
      thumb: 'down',
      feedback: 'feedback-text',
      message_order: 7,
      tenant: 'attacker-tenant',
      chat_id: 'attacker-chat',
      chat_role: 'system',
      id: 'attacker-id',
    } as never);
    expect(result).toBe('success');

    const row = await db('messages').where({ id: messageId }).first();
    expect(row).toMatchObject({
      id: messageId,
      tenant: TENANT_A,
      chat_id: chatId,
      chat_role: 'bot',
      content: 'edited',
      thumb: 'down',
      feedback: 'feedback-text',
      message_order: 7,
    });
  });

  it('strips non-allowlisted columns on the direct model update path', async () => {
    const chatId = randomUUID();
    const messageId = randomUUID();
    await seedChat({ id: chatId, tenant: TENANT_A, userId: USER_A });
    await seedMessage({ id: messageId, tenant: TENANT_A, chatId, content: 'original', role: 'bot' });

    await Message.update(
      messageId,
      {
        content: 'direct-edit',
        tenant: 'attacker-tenant',
        chat_id: 'attacker-chat',
        chat_role: 'system',
        id: 'attacker-id',
      } as never,
      USER_A,
    );

    const row = await db('messages').where({ id: messageId }).first();
    expect(row).toMatchObject({
      id: messageId,
      tenant: TENANT_A,
      chat_id: chatId,
      chat_role: 'bot',
      content: 'direct-edit',
    });
  });

  it('fails model reads and writes closed when the tenant context is missing', async () => {
    const chatId = randomUUID();
    const messageId = randomUUID();
    await seedChat({ id: chatId, tenant: TENANT_A, userId: USER_A });
    await seedMessage({ id: messageId, tenant: TENANT_A, chatId, content: 'original' });

    createTenantKnexMock.mockResolvedValue({ knex: db, tenant: null });

    await expect(Message.getByChatId(chatId)).rejects.toThrow('Missing tenant for message model');
    await expect(Message.getByChatIdForUser(chatId, USER_A)).rejects.toThrow(
      'Missing tenant for message model',
    );
    await expect(Message.update(messageId, { content: 'hacked' }, USER_A)).rejects.toThrow(
      'Missing tenant for message model',
    );
    await expect(Chat.getRecentByUser(USER_A, 20)).rejects.toThrow('Missing tenant for chat model');

    const row = await db('messages').where({ id: messageId }).first();
    expect(row.content).toBe('original');
  });
});
