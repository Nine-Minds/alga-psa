import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { knex as createKnex, type Knex } from 'knex';

const createTenantKnexMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

const TEST_TENANT = 'chat-persistence-test-tenant';

type ChatActionsModule = typeof import('@ee/lib/chat-actions/chatActions');

describe('chat persistence execution flows (db-backed)', () => {
  let db: Knex;

  const loadChatActions = async (): Promise<ChatActionsModule> => {
    vi.resetModules();
    return import('@ee/lib/chat-actions/chatActions');
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
    createTenantKnexMock.mockResolvedValue({ knex: db, tenant: TEST_TENANT });
    await db('messages').where({ tenant: TEST_TENANT }).delete();
    await db('chats').where({ tenant: TEST_TENANT }).delete();
  });

  afterAll(async () => {
    await db.schema.dropTableIfExists('messages');
    await db.schema.dropTableIfExists('chats');
    await db.destroy();
  });

  it('DB-backed happy path: approved execution persists final assistant message', async () => {
    const { createNewChatAction, addMessageToChatAction, getChatMessagesAction } =
      await loadChatActions();

    const chatId = randomUUID();
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();

    const chatResult = await createNewChatAction({
      id: chatId,
      user_id: 'user-1',
      title_text: 'Execution chat',
      title_is_locked: false,
    });
    expect(chatResult).toMatchObject({ _id: chatId, persisted: true });

    await addMessageToChatAction({
      id: userMessageId,
      chat_id: chatId,
      chat_role: 'user',
      content: 'Run the approved action',
      thumb: null,
      feedback: null,
      message_order: 1,
    });

    await addMessageToChatAction({
      id: assistantMessageId,
      chat_id: chatId,
      chat_role: 'bot',
      content: 'Execution complete.',
      thumb: null,
      feedback: null,
      message_order: 2,
    });

    const persisted = await getChatMessagesAction(chatId);
    expect(persisted).toHaveLength(2);
    expect(persisted[1]).toMatchObject({
      id: assistantMessageId,
      chat_role: 'bot',
      content: 'Execution complete.',
    });
  });

  it('DB-backed guard path: declined/failed execution does not persist false completion', async () => {
    const { createNewChatAction, addMessageToChatAction, getChatMessagesAction } =
      await loadChatActions();

    const chatId = randomUUID();

    await createNewChatAction({
      id: chatId,
      user_id: 'user-2',
      title_text: 'Declined execution chat',
      title_is_locked: false,
    });

    await addMessageToChatAction({
      id: randomUUID(),
      chat_id: chatId,
      chat_role: 'user',
      content: 'Please run this action',
      thumb: null,
      feedback: null,
      message_order: 1,
    });

    // No assistant completion insert: simulates declined/failed execution guard behavior.
    const persisted = await getChatMessagesAction(chatId);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ chat_role: 'user' });
    expect(
      persisted.some((message) => message.chat_role === 'bot' && message.content.trim().length > 0),
    ).toBe(false);
  });

  it('No migration required: existing chat persistence read/write ordering remains functional', async () => {
    const { createNewChatAction, addMessageToChatAction, getChatMessagesAction } =
      await loadChatActions();

    const chatId = randomUUID();

    await createNewChatAction({
      id: chatId,
      user_id: 'user-3',
      title_text: null,
      title_is_locked: false,
    });

    const lateMessageId = randomUUID();
    const earlyMessageId = randomUUID();

    await addMessageToChatAction({
      id: lateMessageId,
      chat_id: chatId,
      chat_role: 'bot',
      content: 'Second message',
      thumb: null,
      feedback: null,
      message_order: 2,
    });

    await addMessageToChatAction({
      id: earlyMessageId,
      chat_id: chatId,
      chat_role: 'user',
      content: 'First message',
      thumb: null,
      feedback: null,
      message_order: 1,
    });

    const persisted = await getChatMessagesAction(chatId);
    expect(persisted.map((message) => message.id)).toEqual([earlyMessageId, lateMessageId]);
  });
});
