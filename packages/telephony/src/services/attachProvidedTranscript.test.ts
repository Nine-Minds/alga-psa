import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Same in-memory tenant database as the capture suite. A ReportCall can be
 * re-delivered, so the property under test is that a second attach re-links
 * the document already filed and never appends the summary twice.
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
      select() { return query; },
      orderBy() { return query; },
      limit() { return query; },
      async first(..._columns: unknown[]) {
        return clone(filtered()[0]);
      },
      insert(values: Record<string, unknown>) {
        sequence += 1;
        const row = { artifact_id: `artifact-${sequence}`, ...values };
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
  knexMock.fn = { now: () => '2026-09-15T12:00:00.000Z' };
  knexMock.raw = (sql: string) => sql;

  return { tables, knexMock, rowsFor };
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

import { attachProvidedTranscript } from './attachProvidedTranscript';

const TENANT = 'tenant-1';
const NOW = new Date('2026-09-15T12:00:00.000Z');

function table(name: string): any[] {
  return hoisted.rowsFor(name);
}

function seedCall(overrides: Record<string, unknown> = {}): void {
  table('telephony_call_records').push({
    tenant: TENANT,
    call_record_id: 'call-record-1',
    provider: '3cx',
    provider_call_id: 'hash-1',
    direction: 'inbound',
    caller_number_raw: '+1 (555) 123-4567',
    caller_number_e164: '+15551234567',
    callee_number_raw: null,
    callee_number_e164: null,
    organizer_user_id: null,
    match_status: 'matched',
    matched_contact_id: 'contact-dorothy',
    matched_client_id: 'client-oz',
    interaction_id: 'interaction-1',
    ticket_id: null,
    artifact_status: 'pending',
    artifact_fetch_attempts: 0,
    last_artifact_fetch_at: null,
    ...overrides,
  });
}

function seedUser(): void {
  table('users').push({
    tenant: TENANT,
    user_id: 'user-system',
    user_type: 'internal',
    is_inactive: false,
    created_at: '2020-01-01T00:00:00Z',
  });
}

describe('attachProvidedTranscript', () => {
  beforeEach(() => {
    for (const name of Object.keys(hoisted.tables)) {
      hoisted.tables[name].length = 0;
    }
  });

  it('T163: files the transcript on contact, client and interaction and marks the call ready', async () => {
    seedCall();
    seedUser();
    table('interactions').push({ tenant: TENANT, interaction_id: 'interaction-1', notes: 'Provider: 3cx' });

    const outcome = await attachProvidedTranscript({
      tenantId: TENANT,
      callRecordId: 'call-record-1',
      transcription: 'Caller: my laptop will not boot.',
      summary: 'Laptop boot failure; replacement arranged.',
      now: () => NOW,
    });

    expect(outcome).toMatchObject({ status: 'attached', created: true, summaryAppended: true });

    const [document] = table('documents');
    expect(document.document_name).toBe('Call transcript - Inbound call from +1 (555) 123-4567');
    expect(document.user_id).toBe('user-system');
    expect(table('document_block_content')[0].block_data).toContain('my laptop will not boot');
    expect(
      table('document_associations').map((row) => [row.entity_type, row.entity_id]).sort(),
    ).toEqual([
      ['client', 'client-oz'],
      ['contact', 'contact-dorothy'],
      ['interaction', 'interaction-1'],
    ]);

    const [artifact] = table('telephony_call_artifacts');
    expect(artifact).toMatchObject({
      tenant: TENANT,
      call_record_id: 'call-record-1',
      artifact_type: 'transcript',
      provider_artifact_id: 'report-call',
      document_id: document.document_id,
      file_id: null,
    });
    expect(new Date(artifact.created_date_time).toISOString()).toBe(NOW.toISOString());

    expect(table('interactions')[0].notes).toBe('Provider: 3cx\n\nSummary: Laptop boot failure; replacement arranged.');
    expect(table('telephony_call_records')[0]).toMatchObject({ artifact_status: 'ready' });
  });

  it('T165: a summary is appended only when the call has an interaction', async () => {
    seedCall({ interaction_id: null, match_status: 'unmatched', matched_contact_id: null, matched_client_id: null });
    seedUser();

    const outcome = await attachProvidedTranscript({
      tenantId: TENANT,
      callRecordId: 'call-record-1',
      transcription: 'Hello?',
      summary: 'Nobody answered.',
    });

    expect(outcome).toMatchObject({ status: 'attached', created: true, summaryAppended: false });
    expect(table('document_associations')).toHaveLength(0);
    expect(table('interactions')).toHaveLength(0);
    expect(table('telephony_call_records')[0].artifact_status).toBe('ready');
  });

  it('a re-delivered report re-links the existing document and never appends the summary twice', async () => {
    seedCall();
    seedUser();
    table('interactions').push({ tenant: TENANT, interaction_id: 'interaction-1', notes: '' });
    const input = {
      tenantId: TENANT,
      callRecordId: 'call-record-1',
      transcription: 'Caller: hi.',
      summary: 'Short call.',
    };

    const first = await attachProvidedTranscript(input);
    const second = await attachProvidedTranscript(input);

    expect(first).toMatchObject({ status: 'attached', created: true, summaryAppended: true });
    expect(second).toMatchObject({
      status: 'attached',
      created: false,
      summaryAppended: false,
      documentId: (first as any).documentId,
    });
    expect(table('documents')).toHaveLength(1);
    expect(table('telephony_call_artifacts')).toHaveLength(1);
    expect(table('interactions')[0].notes).toBe('Summary: Short call.');
  });

  it('T164: an empty transcript leaves the record pending for the sweep', async () => {
    seedCall();
    seedUser();

    const outcome = await attachProvidedTranscript({ tenantId: TENANT, callRecordId: 'call-record-1', transcription: '   ' });

    expect(outcome).toEqual({ status: 'skipped', reason: 'empty_transcript' });
    expect(table('documents')).toHaveLength(0);
    expect(table('telephony_call_records')[0].artifact_status).toBe('pending');
  });

  it('an unknown call record is reported, not invented', async () => {
    seedUser();

    const outcome = await attachProvidedTranscript({ tenantId: TENANT, callRecordId: 'missing', transcription: 'x' });

    expect(outcome).toEqual({ status: 'skipped', reason: 'not_found' });
  });

  it('without an internal user to own the document nothing is filed', async () => {
    seedCall();

    const outcome = await attachProvidedTranscript({ tenantId: TENANT, callRecordId: 'call-record-1', transcription: 'x' });

    expect(outcome).toEqual({ status: 'skipped', reason: 'no_owner' });
    expect(table('telephony_call_records')[0].artifact_status).toBe('pending');
  });
});
