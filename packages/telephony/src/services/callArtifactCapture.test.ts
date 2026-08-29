import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerFeatureFlagChecker } from '@alga-psa/core/features';
import type { CallArtifactPayload } from '../types';

/**
 * Same in-memory tenant database as the ingestion suite: artifact capture is
 * replay-prone (there is no artifact notification, so every call is polled
 * repeatedly), and the property that matters is that a second poll re-links
 * what it already stored instead of duplicating documents.
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
          const clauses: Array<(row: any) => boolean> = [];
          const sub: any = {
            whereNull(name: string) {
              clauses.push((row) => row[column(name)] == null);
              return sub;
            },
            orWhere(name: string) {
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
  knexMock.fn = { now: () => '2026-08-24T12:00:00.000Z' };
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

import { captureCallArtifacts, listCallsAwaitingArtifacts } from './captureCallArtifacts';

const TENANT = 'tenant-1';
const NOW = new Date('2026-08-24T12:00:00.000Z');
const VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n<v Caller>My laptop will not boot.';

function table(name: string): any[] {
  return hoisted.rowsFor(name);
}

function enableReleaseFeature(): void {
  registerFeatureFlagChecker(async () => true);
}

function seedCall(overrides: Record<string, unknown> = {}): string {
  const row = {
    tenant: TENANT,
    call_record_id: 'call-record-1',
    provider: 'teams-phone',
    provider_call_id: 'graph-call-1',
    direction: 'inbound',
    caller_number_raw: '+1 (555) 123-4567',
    caller_number_e164: '+15551234567',
    callee_number_raw: null,
    callee_number_e164: null,
    organizer_user_id: 'agent-object-id',
    match_status: 'matched',
    matched_contact_id: 'contact-dorothy',
    matched_client_id: 'client-oz',
    interaction_id: 'interaction-1',
    ticket_id: 'ticket-7',
    artifact_status: 'pending',
    artifact_fetch_attempts: 0,
    last_artifact_fetch_at: null,
    started_at: '2026-08-24T11:00:00.000Z',
    ended_at: '2026-08-24T11:05:00.000Z',
    created_at: '2026-08-24T11:05:00.000Z',
    ...overrides,
  };
  table('telephony_call_records').push(row);
  return row.call_record_id as string;
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

const transcript: CallArtifactPayload = {
  artifactType: 'transcript',
  providerArtifactId: 'tr-1',
  contentUrl: 'https://graph.test/transcripts/tr-1/content',
  createdDateTime: '2026-08-24T11:06:00.000Z',
  transcriptContent: VTT,
};

const recording: CallArtifactPayload = {
  artifactType: 'recording',
  providerArtifactId: 'rec-1',
  contentUrl: 'https://graph.test/recordings/rec-1/content',
  createdDateTime: '2026-08-24T11:06:00.000Z',
};

describe('captureCallArtifacts', () => {
  beforeEach(() => {
    for (const name of Object.keys(hoisted.tables)) {
      hoisted.tables[name].length = 0;
    }
    seedUser();
    registerFeatureFlagChecker(async () => false);
  });

  it('T075: refuses a tenant when the release feature is disabled', async () => {
    seedCall();

    const outcome = await captureCallArtifacts(
      { tenantId: TENANT, callRecordId: 'call-record-1' },
      { fetchArtifacts: async () => [transcript], now: () => NOW },
    );

    expect(outcome).toEqual({ status: 'skipped', reason: 'feature_disabled' });
    expect(table('telephony_call_artifacts')).toHaveLength(0);
  });

  it('T075: files a transcript as a document and summarizes it onto the call ticket', async () => {
    enableReleaseFeature();
    seedCall();
    const annotate = vi.fn(async () => undefined);

    const outcome = await captureCallArtifacts(
      { tenantId: TENANT, callRecordId: 'call-record-1' },
      { fetchArtifacts: async () => [transcript], annotateTicketFromTranscript: annotate, now: () => NOW },
    );

    expect(outcome).toEqual({ status: 'captured', artifactStatus: 'ready', captured: 1 });

    const [document] = table('documents');
    expect(document.document_name).toBe('Call transcript - Inbound call from +1 (555) 123-4567');
    expect(document.is_client_visible).toBe(false);
    expect(table('document_block_content')).toHaveLength(1);
    expect(table('document_associations').map((row) => row.entity_type).sort()).toEqual(['client', 'contact']);

    const [artifact] = table('telephony_call_artifacts');
    expect(artifact).toMatchObject({
      call_record_id: 'call-record-1',
      artifact_type: 'transcript',
      provider_artifact_id: 'tr-1',
      document_id: document.document_id,
      file_id: null,
    });

    expect(annotate).toHaveBeenCalledWith(expect.objectContaining({
      source: 'call',
      callRecordId: 'call-record-1',
      ticketId: 'ticket-7',
      subject: 'Inbound call from +1 (555) 123-4567',
      transcriptVtt: VTT,
    }));

    const [call] = table('telephony_call_records');
    expect(call.artifact_status).toBe('ready');
    expect(call.artifact_fetch_attempts).toBe(1);
  });

  it('T075: a replayed poll re-links the stored artifact instead of duplicating it', async () => {
    enableReleaseFeature();
    seedCall();
    table('telephony_call_artifacts').push({
      tenant: TENANT,
      artifact_id: 'artifact-existing',
      call_record_id: 'call-record-1',
      artifact_type: 'transcript',
      provider_artifact_id: 'tr-1',
      content_url: 'https://graph.test/transcripts/tr-1/content',
      document_id: 'document-existing',
      file_id: null,
      created_date_time: '2026-08-24T11:06:00.000Z',
    });
    const annotate = vi.fn(async () => undefined);

    const outcome = await captureCallArtifacts(
      { tenantId: TENANT, callRecordId: 'call-record-1' },
      { fetchArtifacts: async () => [transcript], annotateTicketFromTranscript: annotate, now: () => NOW },
    );

    expect(outcome).toEqual({ status: 'captured', artifactStatus: 'ready', captured: 0 });
    expect(table('telephony_call_artifacts')).toHaveLength(1);
    expect(table('documents')).toHaveLength(0);
    expect(annotate).not.toHaveBeenCalled();
  });

  it('T075: stores the recording blob only when the tenant opted into downloads', async () => {
    enableReleaseFeature();
    seedCall();
    const download = vi.fn(async () => 'file-1');

    const withoutDownloads = await captureCallArtifacts(
      { tenantId: TENANT, callRecordId: 'call-record-1' },
      { fetchArtifacts: async () => [recording], downloadRecording: download, now: () => NOW },
    );
    expect(withoutDownloads).toMatchObject({ status: 'captured' });
    expect(download).not.toHaveBeenCalled();
    expect(table('telephony_call_artifacts')[0].file_id).toBeNull();

    table('telephony_call_records')[0].artifact_status = 'pending';
    table('telephony_call_records')[0].last_artifact_fetch_at = null;

    await captureCallArtifacts(
      { tenantId: TENANT, callRecordId: 'call-record-1' },
      {
        fetchArtifacts: async () => [recording],
        downloadRecording: download,
        loadSettings: async () => ({ downloadRecordings: true, exposeRecordingsInPortal: true }),
        now: () => NOW,
      },
    );

    expect(download).toHaveBeenCalledTimes(1);
    expect(table('telephony_call_artifacts')).toHaveLength(1);
    expect(table('telephony_call_artifacts')[0].file_id).toBe('file-1');
  });

  it('T075: an empty poll stays pending inside the window and settles to none after it', async () => {
    enableReleaseFeature();
    seedCall();

    const pending = await captureCallArtifacts(
      { tenantId: TENANT, callRecordId: 'call-record-1' },
      { fetchArtifacts: async () => [], now: () => NOW },
    );
    expect(pending).toEqual({ status: 'captured', artifactStatus: 'pending', captured: 0 });

    table('telephony_call_records')[0].last_artifact_fetch_at = null;
    const settled = await captureCallArtifacts(
      { tenantId: TENANT, callRecordId: 'call-record-1' },
      { fetchArtifacts: async () => [], now: () => new Date('2026-08-24T20:00:00.000Z') },
    );
    expect(settled).toEqual({ status: 'captured', artifactStatus: 'none', captured: 0 });
  });

  it('T075: a call with no Entra organizer can never yield artifacts and stops being polled', async () => {
    enableReleaseFeature();
    seedCall({ organizer_user_id: null });
    const fetchArtifacts = vi.fn(async () => [transcript]);

    const outcome = await captureCallArtifacts(
      { tenantId: TENANT, callRecordId: 'call-record-1' },
      { fetchArtifacts, now: () => NOW },
    );

    expect(outcome).toEqual({ status: 'skipped', reason: 'no_organizer' });
    expect(fetchArtifacts).not.toHaveBeenCalled();
    expect(table('telephony_call_records')[0].artifact_status).toBe('none');
  });

  it('T075: settled and not-yet-due calls are left alone', async () => {
    enableReleaseFeature();
    seedCall({ artifact_status: 'ready' });
    const fetchArtifacts = vi.fn(async () => [transcript]);

    expect(await captureCallArtifacts(
      { tenantId: TENANT, callRecordId: 'call-record-1' },
      { fetchArtifacts, now: () => NOW },
    )).toEqual({ status: 'skipped', reason: 'settled' });

    table('telephony_call_records')[0].artifact_status = 'pending';
    table('telephony_call_records')[0].last_artifact_fetch_at = '2026-08-24T11:59:00.000Z';

    expect(await captureCallArtifacts(
      { tenantId: TENANT, callRecordId: 'call-record-1' },
      { fetchArtifacts, now: () => NOW },
    )).toEqual({ status: 'skipped', reason: 'not_due' });

    expect(fetchArtifacts).not.toHaveBeenCalled();
  });

  it('T075: a Graph failure records the attempt before propagating, so retries back off', async () => {
    enableReleaseFeature();
    seedCall();

    await expect(captureCallArtifacts(
      { tenantId: TENANT, callRecordId: 'call-record-1' },
      { fetchArtifacts: async () => { throw new Error('Graph 503'); }, now: () => NOW },
    )).rejects.toThrow('Graph 503');

    const [call] = table('telephony_call_records');
    expect(call.artifact_fetch_attempts).toBe(1);
    expect(call.last_artifact_fetch_at).toEqual(NOW);
    expect(call.artifact_status).toBe('pending');
  });

  it('T075: the sweep work list is the calls still waiting on artifacts', async () => {
    seedCall();
    seedCall({ call_record_id: 'call-record-2', artifact_status: 'ready' });

    const pending = await listCallsAwaitingArtifacts({ tenantId: TENANT });

    expect(pending.map((call) => call.call_record_id)).toEqual(['call-record-1']);
  });
});
