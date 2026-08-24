import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalCallRecord } from '../types';

/**
 * In-memory stand-in for the tenant database. The ingestion path is the riskiest
 * code in telephony — it is the only thing standing between a re-delivered Graph
 * notification and a duplicate timeline entry — so it is exercised against a
 * fake that keeps rows, not against mocked call assertions.
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

  const createQuery = (expression: string) => {
    const predicates: Array<(row: any) => boolean> = [];
    const filtered = () => rowsFor(expression).filter((row) => predicates.every((fn) => fn(row)));
    const column = (name: string) => String(name).split('.').pop()!;

    const query: any = {
      where(conditions: any, operator?: any, value?: any) {
        if (typeof conditions === 'function') {
          // Sub-builder: the add-on expiry predicate (null OR in the future).
          const clauses: Array<(row: any) => boolean> = [];
          const sub: any = {
            whereNull(name: string) {
              clauses.push((row) => row[column(name)] == null);
              return sub;
            },
            orWhere(name: string, _operator: string, _value: unknown) {
              clauses.push((row) => {
                const raw = row[column(name)];
                return raw != null && new Date(raw).getTime() > Date.now();
              });
              return sub;
            },
          };
          conditions(sub);
          predicates.push((row) => clauses.some((fn) => fn(row)));
        } else if (typeof conditions === 'string') {
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
      whereIn(name: string, values: any[]) {
        // client_locations is compared through a raw digits expression.
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
      offset() { return query; },
      async first(..._columns: unknown[]) {
        return clone(filtered()[0]);
      },
      insert(values: Record<string, unknown>) {
        sequence += 1;
        const row = { call_record_id: `call-record-${sequence}`, ...values };
        rowsFor(expression).push(row);
        // knex's insert is chainable: `.returning()` or awaited directly.
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
  knexMock.fn = { now: () => '2026-08-22T00:00:00.000Z' };
  knexMock.raw = (sql: string) => sql;

  const interactionCreate = vi.fn(async ({ tenant, interactionData }: any) => {
    sequence += 1;
    const row = { tenant, interaction_id: `interaction-${sequence}`, ...interactionData };
    rowsFor('interactions').push(row);
    return row;
  });

  const createTicketWithRetry = vi.fn(async (payload: any) => ({
    ticket_id: 'ticket-created-1',
    ticket_number: '2001',
    ...payload,
  }));

  return { tables, knexMock, interactionCreate, createTicketWithRetry, rowsFor };
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

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: { createTicketWithRetry: hoisted.createTicketWithRetry },
}));

import { ingestCanonicalCall } from './ingestCanonicalCall';
import { resolveCallMatch } from './resolveCallMatch';
import { autoCreateTicketForCall } from './autoTicketFromCall';

const TENANT = 'tenant-1';

function table(name: string): any[] {
  return hoisted.rowsFor(name);
}

function grantAddOn(): void {
  // Telephony is gated by the Microsoft Teams add-on.
  table('tenant_addons').push({ tenant: TENANT, addon_key: 'teams', expires_at: null });
}

function seedTenantBasics(): void {
  table('system_interaction_types').push({ tenant: TENANT, type_id: 'type-call', type_name: 'Call' });
  table('users').push({
    tenant: TENANT,
    user_id: 'user-system',
    user_type: 'internal',
    is_inactive: false,
    created_at: '2020-01-01T00:00:00Z',
  });
}

function knownContact(): void {
  table('contact_phone_numbers').push({
    tenant: TENANT,
    contact_name_id: 'contact-dorothy',
    full_name: 'Dorothy Gale',
    client_id: 'client-oz',
    normalized_phone_number: '15551234567',
    phone_number: '+1 (555) 123-4567',
  });
}

const inboundCall: CanonicalCallRecord = {
  provider: 'teams-phone',
  providerCallId: 'graph-call-1',
  direction: 'inbound',
  callerNumber: { raw: '+1 (555) 123-4567', e164: '+15551234567' },
  calleeNumber: { raw: '+15559998888', e164: '+15559998888' },
  startedAt: '2026-08-22T15:00:00.000Z',
  endedAt: '2026-08-22T15:03:30.000Z',
  durationSeconds: 210,
  modality: 'audio',
  raw: { id: 'graph-call-1' },
};

describe('ingestCanonicalCall', () => {
  beforeEach(() => {
    for (const name of Object.keys(hoisted.tables)) {
      hoisted.tables[name].length = 0;
    }
    hoisted.interactionCreate.mockClear();
    hoisted.createTicketWithRetry.mockClear();
    seedTenantBasics();
  });

  it('T027: refuses a tenant without the Teams add-on and writes nothing', async () => {
    knownContact();

    const outcome = await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });

    expect(outcome).toEqual({ status: 'skipped', reason: 'addon_inactive' });
    expect(table('telephony_call_records')).toHaveLength(0);
    expect(hoisted.interactionCreate).not.toHaveBeenCalled();
  });

  it('rejects a payload that is not a canonical call record', async () => {
    grantAddOn();

    const outcome = await ingestCanonicalCall({
      tenantId: TENANT,
      call: { provider: 'teams-phone', direction: 'inbound' } as unknown as CanonicalCallRecord,
    });

    expect(outcome).toEqual({ status: 'skipped', reason: 'invalid_payload' });
    expect(table('telephony_call_records')).toHaveLength(0);
  });

  it('T024: a matched inbound call is stored and filed as a Call interaction', async () => {
    grantAddOn();
    knownContact();

    const outcome = await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'matched', created: true });

    const [record] = table('telephony_call_records');
    expect(record).toMatchObject({
      tenant: TENANT,
      provider: 'teams-phone',
      provider_call_id: 'graph-call-1',
      direction: 'inbound',
      caller_number_e164: '+15551234567',
      match_status: 'matched',
      matched_contact_id: 'contact-dorothy',
      matched_client_id: 'client-oz',
    });
    expect(record.interaction_id).toBe((outcome as any).interactionId);

    const [interaction] = table('interactions');
    expect(interaction).toMatchObject({
      type_id: 'type-call',
      user_id: 'user-system',
      contact_name_id: 'contact-dorothy',
      client_id: 'client-oz',
      title: 'Inbound call from +1 (555) 123-4567',
      // interactions.duration is minutes everywhere else in the product.
      duration: 4,
    });
    expect(new Date(interaction.start_time).toISOString()).toBe('2026-08-22T15:00:00.000Z');
    expect(new Date(interaction.end_time).toISOString()).toBe('2026-08-22T15:03:30.000Z');
  });

  it('T023: the same provider call id ingested twice keeps one record and one interaction', async () => {
    grantAddOn();
    knownContact();

    const first = await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });
    const second = await ingestCanonicalCall({
      tenantId: TENANT,
      // Graph re-delivers with a later, fuller payload.
      call: { ...inboundCall, durationSeconds: 240, endedAt: '2026-08-22T15:04:00.000Z' },
    });

    expect(table('telephony_call_records')).toHaveLength(1);
    expect(table('interactions')).toHaveLength(1);
    expect(hoisted.interactionCreate).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({
      status: 'ingested',
      created: false,
      callRecordId: (first as any).callRecordId,
      interactionId: (first as any).interactionId,
    });
    // The replay still refreshes the payload it carried.
    expect(table('telephony_call_records')[0].duration_seconds).toBe(240);
  });

  it('T025: an unmatched call is recorded without an interaction', async () => {
    grantAddOn();

    const outcome = await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'unmatched', interactionId: null });
    expect(table('telephony_call_records')[0]).toMatchObject({
      match_status: 'unmatched',
      matched_contact_id: null,
      matched_client_id: null,
    });
    expect(table('interactions')).toHaveLength(0);
  });

  it('T025: a contact with no client still persists the call instead of losing it', async () => {
    grantAddOn();
    // contacts.client_id is nullable by design, so the ladder can match a
    // contact and still have nowhere to file the interaction.
    table('contact_phone_numbers').push({
      tenant: TENANT,
      contact_name_id: 'contact-orphan',
      full_name: 'Unaffiliated Munchkin',
      client_id: null,
      normalized_phone_number: '15551234567',
      phone_number: '+1 (555) 123-4567',
    });
    table('contacts').push({ tenant: TENANT, contact_name_id: 'contact-orphan', client_id: null });

    const outcome = await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'matched', interactionId: null });
    expect(table('telephony_call_records')).toHaveLength(1);
    expect(table('telephony_call_records')[0]).toMatchObject({
      matched_contact_id: 'contact-orphan',
      matched_client_id: null,
    });
    expect(table('telephony_call_records')[0].interaction_id).toBeUndefined();
    expect(table('interactions')).toHaveLength(0);
  });

  it('T025: an ambiguous call is recorded with its candidates and no attribution', async () => {
    grantAddOn();
    knownContact();
    table('contact_phone_numbers').push({
      tenant: TENANT,
      contact_name_id: 'contact-toto',
      full_name: 'Toto',
      client_id: 'client-kansas',
      normalized_phone_number: '15551234567',
      phone_number: '+1 (555) 123-4567',
    });

    const outcome = await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'ambiguous', interactionId: null });
    const [record] = table('telephony_call_records');
    expect(record.matched_client_id).toBeNull();
    expect(JSON.parse(record.match_candidates)).toHaveLength(2);
    expect(table('interactions')).toHaveLength(0);
  });

  it('T029: an outbound call matches on the callee and titles as outbound', async () => {
    grantAddOn();
    table('contact_phone_numbers').push({
      tenant: TENANT,
      contact_name_id: 'contact-scarecrow',
      full_name: 'Scarecrow',
      client_id: 'client-oz',
      normalized_phone_number: '15557654321',
      phone_number: '+1 (555) 765-4321',
    });

    const outcome = await ingestCanonicalCall({
      tenantId: TENANT,
      call: {
        ...inboundCall,
        providerCallId: 'graph-call-out',
        direction: 'outbound',
        callerNumber: { raw: '+15559998888', e164: '+15559998888' },
        calleeNumber: { raw: '+1 (555) 765-4321', e164: '+15557654321' },
      },
    });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'matched' });
    expect(table('telephony_call_records')[0]).toMatchObject({
      direction: 'outbound',
      matched_contact_id: 'contact-scarecrow',
    });
    expect(table('interactions')[0].title).toBe('Outbound call to +1 (555) 765-4321');
  });

  it('T024: a client-only match still files the call on the client timeline', async () => {
    grantAddOn();
    table('client_locations').push({ tenant: TENANT, client_id: 'client-emerald', phone: '+1 (555) 123-4567' });

    const outcome = await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });

    expect(outcome).toMatchObject({ status: 'ingested', matchStatus: 'matched' });
    expect(table('interactions')[0]).toMatchObject({ client_id: 'client-emerald' });
    expect(table('interactions')[0].contact_name_id).toBeUndefined();
  });
});

describe('resolveCallMatch', () => {
  beforeEach(() => {
    for (const name of Object.keys(hoisted.tables)) {
      hoisted.tables[name].length = 0;
    }
    hoisted.interactionCreate.mockClear();
    seedTenantBasics();
    grantAddOn();
  });

  it('T026: resolving an unmatched call mints the interaction and stamps the record', async () => {
    await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });
    const record = table('telephony_call_records')[0];
    table('contacts').push({ tenant: TENANT, contact_name_id: 'contact-lion', client_id: 'client-forest' });

    const outcome = await resolveCallMatch({
      tenantId: TENANT,
      callRecordId: record.call_record_id,
      contactId: 'contact-lion',
      actingUserId: 'user-dispatcher',
    });

    expect(outcome.status).toBe('resolved');
    expect(table('telephony_call_records')[0]).toMatchObject({
      match_status: 'resolved',
      matched_contact_id: 'contact-lion',
      // The client is inferred from the contact when only a contact is picked.
      matched_client_id: 'client-forest',
      interaction_id: (outcome as any).interactionId,
    });
    expect(table('interactions')[0]).toMatchObject({
      contact_name_id: 'contact-lion',
      client_id: 'client-forest',
      user_id: 'user-dispatcher',
      title: 'Inbound call from +1 (555) 123-4567',
    });
  });

  it('T026: resolving to a client alone is enough', async () => {
    await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });
    const record = table('telephony_call_records')[0];

    const outcome = await resolveCallMatch({
      tenantId: TENANT,
      callRecordId: record.call_record_id,
      clientId: 'client-emerald',
    });

    expect(outcome.status).toBe('resolved');
    expect(table('interactions')[0]).toMatchObject({ client_id: 'client-emerald' });
  });

  it('T026: a second resolve is a no-op rather than a second interaction', async () => {
    await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });
    const record = table('telephony_call_records')[0];

    await resolveCallMatch({ tenantId: TENANT, callRecordId: record.call_record_id, clientId: 'client-emerald' });
    const second = await resolveCallMatch({
      tenantId: TENANT,
      callRecordId: record.call_record_id,
      clientId: 'client-kansas',
    });

    expect(second.status).toBe('already_resolved');
    expect(table('interactions')).toHaveLength(1);
    expect(table('telephony_call_records')[0].matched_client_id).toBe('client-emerald');
  });

  it('T026: resolving to a contact with no client asks for a client instead', async () => {
    await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });
    const record = table('telephony_call_records')[0];
    table('contacts').push({ tenant: TENANT, contact_name_id: 'contact-orphan', client_id: null });

    await expect(resolveCallMatch({
      tenantId: TENANT,
      callRecordId: record.call_record_id,
      contactId: 'contact-orphan',
    })).rejects.toThrow(/not associated with a client/);

    expect(table('interactions')).toHaveLength(0);
    expect(table('telephony_call_records')[0].match_status).toBe('unmatched');
  });

  it('T026: an unknown call record is reported, not invented', async () => {
    await expect(resolveCallMatch({ tenantId: TENANT, callRecordId: 'nope', clientId: 'client-oz' }))
      .resolves.toEqual({ status: 'not_found' });
  });

  it('T026: resolving without a contact or a client is refused', async () => {
    await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });
    const record = table('telephony_call_records')[0];

    await expect(resolveCallMatch({ tenantId: TENANT, callRecordId: record.call_record_id }))
      .rejects.toThrow(/requires a contact or a client/);
  });
});

describe('autoCreateTicketForCall', () => {
  const defaults = { boardId: 'board-1', statusId: 'status-open', priorityId: 'priority-normal' };

  beforeEach(() => {
    for (const name of Object.keys(hoisted.tables)) {
      hoisted.tables[name].length = 0;
    }
    hoisted.interactionCreate.mockClear();
    hoisted.createTicketWithRetry.mockClear();
    seedTenantBasics();
    grantAddOn();
  });

  it('T043: a matched call yields a ticket carrying the call attribution', async () => {
    knownContact();
    const outcome = await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });

    const result = await autoCreateTicketForCall({
      tenantId: TENANT,
      callRecordId: (outcome as any).callRecordId,
      defaults,
    });

    expect(result).toMatchObject({ status: 'created', ticketId: 'ticket-created-1' });
    expect(hoisted.createTicketWithRetry.mock.calls[0][0]).toMatchObject({
      title: 'Inbound call from +1 (555) 123-4567',
      client_id: 'client-oz',
      contact_id: 'contact-dorothy',
      board_id: 'board-1',
      status_id: 'status-open',
      priority_id: 'priority-normal',
      source: 'telephony',
    });
    expect(table('telephony_call_records')[0].ticket_id).toBe('ticket-created-1');
    expect(table('interactions')[0].ticket_id).toBe('ticket-created-1');
  });

  it('T043: an unmatched call never auto-creates a ticket', async () => {
    const outcome = await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });

    const result = await autoCreateTicketForCall({
      tenantId: TENANT,
      callRecordId: (outcome as any).callRecordId,
      defaults,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'unmatched' });
    expect(hoisted.createTicketWithRetry).not.toHaveBeenCalled();
  });

  it('T043: a call that already has a ticket is left alone', async () => {
    knownContact();
    const outcome = await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });
    table('telephony_call_records')[0].ticket_id = 'ticket-existing';

    const result = await autoCreateTicketForCall({
      tenantId: TENANT,
      callRecordId: (outcome as any).callRecordId,
      defaults,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'already_ticketed' });
    expect(hoisted.createTicketWithRetry).not.toHaveBeenCalled();
  });

  it('T043: missing board/status/priority defaults stop the ticket, not the call', async () => {
    knownContact();
    const outcome = await ingestCanonicalCall({ tenantId: TENANT, call: inboundCall });

    const result = await autoCreateTicketForCall({
      tenantId: TENANT,
      callRecordId: (outcome as any).callRecordId,
      defaults: { ...defaults, priorityId: null },
    });

    expect(result).toEqual({ status: 'skipped', reason: 'no_defaults' });
    expect(hoisted.createTicketWithRetry).not.toHaveBeenCalled();
  });
});
