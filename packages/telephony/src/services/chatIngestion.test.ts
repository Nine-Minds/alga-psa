import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalChatRecord } from '../types';

/**
 * In-memory stand-in for the tenant database, in the style of the call
 * ingestion tests: rows are kept, so idempotency and match stamping are
 * asserted on state rather than on mocked call lists.
 */
const hoisted = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  let sequence = 0;

  const rowsFor = (expression: string) => {
    const name = expression.split(' ')[0];
    tables[name] ??= [];
    return tables[name];
  };

  const clone = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  const column = (name: string) => String(name).split('.').pop()!;

  const createQuery = (expression: string) => {
    const predicates: Array<(row: any) => boolean> = [];
    const filtered = () => rowsFor(expression).filter((row) => predicates.every((fn) => fn(row)));

    const query: any = {
      where(conditions: any, operator?: any, value?: any) {
        if (typeof conditions === 'string') {
          const key = column(conditions);
          const expected = value === undefined ? operator : value;
          predicates.push((row) => row[key] === expected);
        } else {
          predicates.push((row) =>
            Object.entries(conditions).every(([key, expected]) => row[column(key)] === expected));
        }
        return query;
      },
      andWhere(conditions: any, operator?: any, value?: any) {
        return query.where(conditions, operator, value);
      },
      whereRaw(sql: string, bindings: any[]) {
        if (/lower\((?:\w+\.)?email\)\s*=\s*\?/i.test(sql)) {
          const expected = String(bindings[0]).toLowerCase();
          predicates.push((row) => String(row.email ?? '').toLowerCase() === expected);
        }
        return query;
      },
      whereIn(name: string, values: any[]) {
        const isDigits = String(name).includes('regexp_replace');
        predicates.push((row) => values.includes(
          isDigits ? String(row.phone ?? '').replace(/\D+/g, '') : row[column(name)],
        ));
        return query;
      },
      whereNotNull(name: string) {
        predicates.push((row) => row[column(name)] != null);
        return query;
      },
      distinct() { return query; },
      select() { return query; },
      orderBy() { return query; },
      limit() { return query; },
      async first(..._columns: unknown[]) {
        return clone(filtered()[0]);
      },
      insert(values: Record<string, unknown>) {
        sequence += 1;
        const row = { chat_record_id: `chat-record-${sequence}`, ...values };
        rowsFor(expression).push(row);
        return {
          returning: async () => [row],
          then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([row]).then(resolve),
        };
      },
      async update(values: Record<string, unknown>) {
        const rows = filtered();
        rows.forEach((row) => Object.assign(row, values));
        return rows.length;
      },
      then(resolve: (rows: unknown[]) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(filtered().map((row) => clone(row))).then(resolve, reject);
      },
    };
    return query;
  };

  const knexMock: any = (expression: string) => createQuery(expression);
  knexMock.fn = { now: () => '2026-09-15T00:00:00.000Z' };
  knexMock.raw = (sql: string) => sql;

  const interactionCreate = vi.fn(async ({ tenant, interactionData }: any) => {
    sequence += 1;
    const row = { tenant, interaction_id: `interaction-${sequence}`, ...interactionData };
    rowsFor('interactions').push(row);
    return row;
  });

  return { tables, knexMock, interactionCreate, rowsFor };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  withTransaction: async (_knex: any, fn: (trx: any) => Promise<unknown>) => fn(hoisted.knexMock),
  tenantDb: (conn: any, tenant: string) => ({
    table: (expression: string) => conn(expression).where({ tenant }),
    tenantJoin: (builder: any) => builder,
  }),
}));

vi.mock('@alga-psa/clients/actions/interactionCreateHelper', () => ({
  createInteractionRecord: hoisted.interactionCreate,
}));

import { ingestChat } from './ingestChat';
import { resolveChatMatch } from './resolveChatMatch';
import { listUnattributedChats } from './listTelephonyChats';

const TENANT = 'tenant-1';

function table(name: string): any[] {
  return hoisted.rowsFor(name);
}

function seedTenantBasics(): void {
  table('system_interaction_types').push({ tenant: TENANT, type_id: 'type-chat', type_name: 'Chat' });
  table('users').push({
    tenant: TENANT,
    user_id: 'user-system',
    user_type: 'internal',
    is_inactive: false,
    email: 'system@msp.example',
    created_at: '2020-01-01T00:00:00Z',
  });
}

function agentUser(): void {
  table('users').push({
    tenant: TENANT,
    user_id: 'user-agent',
    user_type: 'internal',
    is_inactive: false,
    email: 'Agent@MSP.example',
    created_at: '2021-01-01T00:00:00Z',
  });
}

function dorothy(overrides: Record<string, unknown> = {}): void {
  table('contacts').push({
    tenant: TENANT,
    contact_name_id: 'contact-dorothy',
    full_name: 'Dorothy Gale',
    email: 'Dorothy@Example.com',
    client_id: 'client-oz',
    is_inactive: false,
    ...overrides,
  });
}

function dorothyPhone(): void {
  table('contact_phone_numbers').push({
    tenant: TENANT,
    contact_name_id: 'contact-dorothy',
    full_name: 'Dorothy Gale',
    client_id: 'client-oz',
    normalized_phone_number: '15551234567',
    phone_number: '+1 (555) 123-4567',
  });
}

const baseChat: CanonicalChatRecord = {
  provider: '3cx',
  providerChatId: 'chat-hash-1',
  agentEmail: 'agent@msp.example',
  number: '+15551234567',
  email: 'dorothy@example.com',
  name: 'Dorothy Gale',
  queueExtension: '800',
  startedAt: '2026-09-15T10:00:00.000Z',
  endedAt: '2026-09-15T10:02:05.000Z',
  durationSeconds: 125,
  messages: 'Dorothy: hi\nAgent: hello',
  raw: { source: 'test' },
};

describe('ingestChat', () => {
  beforeEach(() => {
    for (const name of Object.keys(hoisted.tables)) {
      hoisted.tables[name].length = 0;
    }
    hoisted.interactionCreate.mockClear();
    seedTenantBasics();
  });

  it('rejects a payload that is not a canonical chat record', async () => {
    const outcome = await ingestChat({
      tenantId: TENANT,
      chat: { provider: '3cx', providerChatId: 'x' } as unknown as CanonicalChatRecord,
    });
    expect(outcome).toEqual({ status: 'skipped', reason: 'invalid_payload' });
    expect(table('telephony_chat_records')).toHaveLength(0);
  });

  it('T148: inserts once and returns duplicate on a repeat without a second interaction', async () => {
    dorothy();
    const first = await ingestChat({ tenantId: TENANT, chat: baseChat });
    expect(first).toMatchObject({ status: 'ingested', matchStatus: 'matched' });

    const second = await ingestChat({ tenantId: TENANT, chat: baseChat });
    expect(second).toEqual({
      status: 'duplicate',
      chatRecordId: (first as any).chatRecordId,
      interactionId: (first as any).interactionId,
    });
    expect(table('telephony_chat_records')).toHaveLength(1);
    expect(table('interactions')).toHaveLength(1);
    expect(hoisted.interactionCreate).toHaveBeenCalledTimes(1);
  });

  it('T149: uses entityId when the contact is active', async () => {
    dorothy({ contact_name_id: 'contact-picked', full_name: 'Picked One', email: 'other@example.com', client_id: 'client-picked' });
    dorothy();

    const outcome = await ingestChat({
      tenantId: TENANT,
      chat: { ...baseChat, entityId: 'contact-picked', entityType: 'contact' },
    });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'matched' });
    expect(table('telephony_chat_records')[0]).toMatchObject({
      matched_contact_id: 'contact-picked',
      matched_client_id: 'client-picked',
    });
  });

  it('T149: ignores entityId when that contact is inactive and falls through to email', async () => {
    dorothy({ contact_name_id: 'contact-gone', email: 'gone@example.com', is_inactive: true });
    dorothy();

    const outcome = await ingestChat({
      tenantId: TENANT,
      chat: { ...baseChat, entityId: 'contact-gone', entityType: 'contact' },
    });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'matched' });
    expect(table('telephony_chat_records')[0]).toMatchObject({
      matched_contact_id: 'contact-dorothy',
      matched_client_id: 'client-oz',
    });
  });

  it('T150: matches by email ignoring case when no entityId', async () => {
    dorothy({ email: 'DOROTHY@example.COM' });

    const outcome = await ingestChat({ tenantId: TENANT, chat: { ...baseChat, number: undefined, email: 'dorothy@EXAMPLE.com' } });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'matched' });
    expect(table('telephony_chat_records')[0]).toMatchObject({
      party_email: 'dorothy@EXAMPLE.com',
      matched_contact_id: 'contact-dorothy',
      match_candidates: JSON.stringify([{ contactId: 'contact-dorothy', clientId: 'client-oz', contactName: 'Dorothy Gale', source: 'contact_email' }]),
    });
  });

  it('T151: matches by number through matchCallParty when no email', async () => {
    dorothyPhone();
    table('contacts').push({ tenant: TENANT, contact_name_id: 'contact-dorothy', client_id: 'client-oz', is_inactive: false });

    const outcome = await ingestChat({ tenantId: TENANT, chat: { ...baseChat, email: undefined } });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'matched' });
    expect(table('telephony_chat_records')[0]).toMatchObject({
      party_number_raw: '+15551234567',
      party_number_e164: '+15551234567',
      matched_contact_id: 'contact-dorothy',
      matched_client_id: 'client-oz',
    });
  });

  it('T152: a matched chat creates a Chat interaction with title, notes, times, duration, contact and client', async () => {
    dorothy();

    const outcome = await ingestChat({ tenantId: TENANT, chat: baseChat });
    const [record] = table('telephony_chat_records');
    expect(record).toMatchObject({
      tenant: TENANT,
      provider: '3cx',
      provider_chat_id: 'chat-hash-1',
      party_name: 'Dorothy Gale',
      queue_extension: '800',
      messages: baseChat.messages,
      match_status: 'matched',
      interaction_id: (outcome as any).interactionId,
    });

    const [interaction] = table('interactions');
    expect(interaction).toMatchObject({
      type_id: 'type-chat',
      contact_name_id: 'contact-dorothy',
      client_id: 'client-oz',
      title: 'Chat with Dorothy Gale',
      notes: baseChat.messages,
      duration: 2,
    });
    expect(new Date(interaction.start_time).toISOString()).toBe('2026-09-15T10:00:00.000Z');
    expect(new Date(interaction.end_time).toISOString()).toBe('2026-09-15T10:02:05.000Z');
  });

  it('T153: the agent user is resolved by email, falling back to the telephony actor', async () => {
    dorothy();
    agentUser();

    await ingestChat({ tenantId: TENANT, chat: baseChat });
    expect(table('telephony_chat_records')[0].agent_user_id).toBe('user-agent');
    expect(table('interactions')[0].user_id).toBe('user-agent');

    await ingestChat({ tenantId: TENANT, chat: { ...baseChat, providerChatId: 'chat-hash-2', agentEmail: 'nobody@msp.example' } });
    expect(table('telephony_chat_records')[1].agent_user_id).toBeNull();
    expect(table('interactions')[1].user_id).toBe('user-system');
  });

  it('T154: an unmatched chat stores match_status unmatched and no interaction', async () => {
    const outcome = await ingestChat({ tenantId: TENANT, chat: baseChat });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'unmatched', interactionId: null });
    const [record] = table('telephony_chat_records');
    expect(record).toMatchObject({
      match_status: 'unmatched',
      matched_contact_id: null,
      matched_client_id: null,
    });
    expect(record.interaction_id).toBeUndefined();
    expect(table('interactions')).toHaveLength(0);
    expect(hoisted.interactionCreate).not.toHaveBeenCalled();
  });

  it('T155: an ambiguous email stores candidates and no interaction', async () => {
    dorothy();
    dorothy({ contact_name_id: 'contact-twin', full_name: 'Dorothy Twin', client_id: 'client-kansas' });

    const outcome = await ingestChat({ tenantId: TENANT, chat: baseChat });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'ambiguous', interactionId: null });
    const [record] = table('telephony_chat_records');
    expect(record.match_status).toBe('ambiguous');
    expect(JSON.parse(record.match_candidates)).toEqual([
      expect.objectContaining({ contactId: 'contact-dorothy', source: 'contact_email' }),
      expect.objectContaining({ contactId: 'contact-twin', source: 'contact_email' }),
    ]);
    expect(table('interactions')).toHaveLength(0);
  });

  it('T155: an ambiguous number stores the phone candidates', async () => {
    dorothyPhone();
    table('contact_phone_numbers').push({
      tenant: TENANT,
      contact_name_id: 'contact-scarecrow',
      full_name: 'Scarecrow',
      client_id: 'client-oz',
      normalized_phone_number: '15551234567',
      phone_number: '+1 (555) 123-4567',
    });

    const outcome = await ingestChat({ tenantId: TENANT, chat: { ...baseChat, email: undefined } });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'ambiguous' });
    expect(JSON.parse(table('telephony_chat_records')[0].match_candidates)).toHaveLength(2);
    expect(table('interactions')).toHaveLength(0);
  });

  it('a matched contact with no client keeps the chat without an interaction', async () => {
    dorothy({ client_id: null });

    const outcome = await ingestChat({ tenantId: TENANT, chat: baseChat });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'matched', interactionId: null });
    expect(table('telephony_chat_records')).toHaveLength(1);
    expect(table('interactions')).toHaveLength(0);
  });
});

describe('resolveChatMatch', () => {
  beforeEach(() => {
    for (const name of Object.keys(hoisted.tables)) {
      hoisted.tables[name].length = 0;
    }
    hoisted.interactionCreate.mockClear();
    seedTenantBasics();
  });

  it('T158: resolving an unmatched chat mints the Chat interaction and stamps the record', async () => {
    await ingestChat({ tenantId: TENANT, chat: baseChat });
    const record = table('telephony_chat_records')[0];
    table('contacts').push({ tenant: TENANT, contact_name_id: 'contact-lion', client_id: 'client-forest', is_inactive: false });

    const outcome = await resolveChatMatch({
      tenantId: TENANT,
      chatRecordId: record.chat_record_id,
      contactId: 'contact-lion',
      actingUserId: 'user-dispatcher',
    });

    expect(outcome.status).toBe('resolved');
    expect(table('telephony_chat_records')[0]).toMatchObject({
      match_status: 'resolved',
      matched_contact_id: 'contact-lion',
      matched_client_id: 'client-forest',
      interaction_id: (outcome as any).interactionId,
    });
    expect(table('interactions')[0]).toMatchObject({
      type_id: 'type-chat',
      contact_name_id: 'contact-lion',
      client_id: 'client-forest',
      user_id: 'user-dispatcher',
      title: 'Chat with Dorothy Gale',
      notes: baseChat.messages,
    });
  });

  it('T159: a second resolve returns already_resolved rather than a second interaction', async () => {
    await ingestChat({ tenantId: TENANT, chat: baseChat });
    const record = table('telephony_chat_records')[0];
    table('contacts').push({ tenant: TENANT, contact_name_id: 'contact-lion', client_id: 'client-forest', is_inactive: false });

    const first = await resolveChatMatch({ tenantId: TENANT, chatRecordId: record.chat_record_id, contactId: 'contact-lion' });
    const second = await resolveChatMatch({ tenantId: TENANT, chatRecordId: record.chat_record_id, contactId: 'contact-lion' });

    expect(second).toEqual({ status: 'already_resolved', interactionId: (first as any).interactionId });
    expect(table('interactions')).toHaveLength(1);
  });

  it('resolving to a client alone is enough', async () => {
    await ingestChat({ tenantId: TENANT, chat: baseChat });
    const record = table('telephony_chat_records')[0];

    const outcome = await resolveChatMatch({ tenantId: TENANT, chatRecordId: record.chat_record_id, clientId: 'client-forest' });

    expect(outcome.status).toBe('resolved');
    expect(table('interactions')[0]).toMatchObject({ client_id: 'client-forest', contact_name_id: undefined });
  });

  it('an unknown chat record is reported, and resolving without a target is refused', async () => {
    await expect(resolveChatMatch({ tenantId: TENANT, chatRecordId: 'missing', contactId: 'x' })).resolves.toEqual({ status: 'not_found' });

    await ingestChat({ tenantId: TENANT, chat: baseChat });
    const record = table('telephony_chat_records')[0];
    await expect(resolveChatMatch({ tenantId: TENANT, chatRecordId: record.chat_record_id })).rejects.toThrow(/contact or a client/);
  });
});

describe('listUnattributedChats', () => {
  beforeEach(() => {
    for (const name of Object.keys(hoisted.tables)) {
      hoisted.tables[name].length = 0;
    }
    seedTenantBasics();
  });

  it('returns only unmatched and ambiguous chats', async () => {
    await ingestChat({ tenantId: TENANT, chat: baseChat });
    dorothy();
    await ingestChat({ tenantId: TENANT, chat: { ...baseChat, providerChatId: 'chat-hash-2' } });

    const rows = await listUnattributedChats({ tenantId: TENANT });
    expect(rows.map((row) => row.provider_chat_id)).toEqual(['chat-hash-1']);
  });
});
