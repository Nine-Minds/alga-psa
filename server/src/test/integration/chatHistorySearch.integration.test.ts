import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { knex as createKnex, type Knex } from 'knex';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

const TEST_TENANT = 'chat-history-search-test-tenant';
const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';

type ChatActionsModule = typeof import('@ee/lib/chat-actions/chatActions');

describe('chat history search (db-backed)', () => {
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
    await db.raw('DROP FUNCTION IF EXISTS process_large_lexemes(TEXT)');

    await db.raw(`
      CREATE FUNCTION process_large_lexemes(text_input TEXT) RETURNS tsvector AS $$
      BEGIN
        RETURN to_tsvector('english', regexp_replace(coalesce(text_input, ''), '\\m\\w{200,}\\M', '', 'g'));
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    await db.raw(`
      CREATE TABLE chats (
        id TEXT PRIMARY KEY,
        tenant TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title_text TEXT,
        title_is_locked BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        title_index tsvector GENERATED ALWAYS AS (
          to_tsvector('english'::regconfig, coalesce(title_text, ''))
        ) STORED
      )
    `);

    await db.raw(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        tenant TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        chat_role TEXT NOT NULL,
        content TEXT NOT NULL,
        thumb TEXT,
        feedback TEXT,
        message_order INTEGER,
        content_index tsvector GENERATED ALWAYS AS (
          process_large_lexemes(coalesce(content, ''))
        ) STORED
      )
    `);

    await db.raw('CREATE INDEX chats_title_index_idx ON chats USING GIN (title_index)');
    await db.raw('CREATE INDEX messages_content_index_idx ON messages USING GIN (content_index)');
  });

  beforeEach(async () => {
    createTenantKnexMock.mockReset();
    getCurrentUserMock.mockReset();
    createTenantKnexMock.mockResolvedValue({ knex: db, tenant: TEST_TENANT });
    getCurrentUserMock.mockResolvedValue({ user_id: USER_ID });

    await db('messages').where({ tenant: TEST_TENANT }).delete();
    await db('chats').where({ tenant: TEST_TENANT }).delete();
  });

  afterAll(async () => {
    await db.schema.dropTableIfExists('messages');
    await db.schema.dropTableIfExists('chats');
    await db.raw('DROP FUNCTION IF EXISTS process_large_lexemes(TEXT)');
    await db.destroy();
  });

  it('DB-backed integration: search matches title and message body, dedupes chats, keeps latest preview, and orders by relevance then recency', async () => {
    const { searchCurrentUserChatsAction } = await loadChatActions();

    const strongTitleChatId = randomUUID();
    const tieOldChatId = randomUUID();
    const tieRecentChatId = randomUUID();
    const messageMatchChatId = randomUUID();

    await db('chats').insert([
      {
        id: strongTitleChatId,
        tenant: TEST_TENANT,
        user_id: USER_ID,
        title_text: 'Printer outage runbook',
        title_is_locked: false,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-10T00:00:00.000Z',
      },
      {
        id: tieOldChatId,
        tenant: TEST_TENANT,
        user_id: USER_ID,
        title_text: 'Printer runbook',
        title_is_locked: false,
        created_at: '2026-02-01T00:00:00.000Z',
        updated_at: '2026-02-01T00:00:00.000Z',
      },
      {
        id: tieRecentChatId,
        tenant: TEST_TENANT,
        user_id: USER_ID,
        title_text: 'Printer runbook',
        title_is_locked: false,
        created_at: '2026-02-10T00:00:00.000Z',
        updated_at: '2026-02-15T00:00:00.000Z',
      },
      {
        id: messageMatchChatId,
        tenant: TEST_TENANT,
        user_id: USER_ID,
        title_text: 'Operations review',
        title_is_locked: false,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-02T00:00:00.000Z',
      },
    ]);

    await db('messages').insert([
      {
        id: randomUUID(),
        tenant: TEST_TENANT,
        chat_id: strongTitleChatId,
        chat_role: 'bot',
        content: 'Strong title match support note',
        message_order: 1,
      },
      {
        id: randomUUID(),
        tenant: TEST_TENANT,
        chat_id: strongTitleChatId,
        chat_role: 'bot',
        content: 'Latest preview from title-matched chat',
        message_order: 2,
      },
      {
        id: randomUUID(),
        tenant: TEST_TENANT,
        chat_id: tieOldChatId,
        chat_role: 'bot',
        content: 'Tie old latest preview',
        message_order: 1,
      },
      {
        id: randomUUID(),
        tenant: TEST_TENANT,
        chat_id: tieRecentChatId,
        chat_role: 'bot',
        content: 'Tie recent latest preview',
        message_order: 1,
      },
      {
        id: randomUUID(),
        tenant: TEST_TENANT,
        chat_id: messageMatchChatId,
        chat_role: 'bot',
        content: 'Printer maintenance alert for the overnight shift.',
        message_order: 1,
      },
      {
        id: randomUUID(),
        tenant: TEST_TENANT,
        chat_id: messageMatchChatId,
        chat_role: 'bot',
        content: 'Outage escalation steps were documented separately.',
        message_order: 2,
      },
      {
        id: randomUUID(),
        tenant: TEST_TENANT,
        chat_id: messageMatchChatId,
        chat_role: 'bot',
        content: 'Consult the runbook checklist before paging the vendor.',
        message_order: 3,
      },
      {
        id: randomUUID(),
        tenant: TEST_TENANT,
        chat_id: messageMatchChatId,
        chat_role: 'bot',
        content: 'Latest preview should come from this non-matching message.',
        message_order: 4,
      },
    ]);

    const results = await searchCurrentUserChatsAction('printer outage runbook', 20);
    const ids = results.map((row) => row.id);

    expect(ids).toContain(strongTitleChatId);
    expect(ids).toContain(messageMatchChatId);
    expect(ids.filter((id) => id === messageMatchChatId)).toHaveLength(1);
    expect(ids[0]).toBe(strongTitleChatId);
    expect(ids.indexOf(tieRecentChatId)).toBeLessThan(ids.indexOf(tieOldChatId));

    const messageMatchRow = results.find((row) => row.id === messageMatchChatId);
    expect(messageMatchRow?.preview_text).toBe(
      'Latest preview should come from this non-matching message.',
    );
  });

  it("DB-backed guard integration: excludes another user's matching chat and returns no rows for a non-matching query", async () => {
    const { searchCurrentUserChatsAction } = await loadChatActions();
    const currentUserChatId = randomUUID();
    const otherUserChatId = randomUUID();

    await db('chats').insert([
      {
        id: currentUserChatId,
        tenant: TEST_TENANT,
        user_id: USER_ID,
        title_text: 'Network maintenance window',
        title_is_locked: false,
      },
      {
        id: otherUserChatId,
        tenant: TEST_TENANT,
        user_id: OTHER_USER_ID,
        title_text: 'Confidential merger timeline',
        title_is_locked: false,
      },
    ]);

    await db('messages').insert([
      {
        id: randomUUID(),
        tenant: TEST_TENANT,
        chat_id: currentUserChatId,
        chat_role: 'bot',
        content: 'General network changes only.',
        message_order: 1,
      },
      {
        id: randomUUID(),
        tenant: TEST_TENANT,
        chat_id: otherUserChatId,
        chat_role: 'bot',
        content: 'Confidential merger details in message body.',
        message_order: 1,
      },
    ]);

    const excludedOtherUserRows = await searchCurrentUserChatsAction('confidential merger', 20);
    expect(excludedOtherUserRows).toEqual([]);

    const noMatchRows = await searchCurrentUserChatsAction('totally missing phrase', 20);
    expect(noMatchRows).toEqual([]);
  });
});
