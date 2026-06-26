import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IOnlineMeeting, IOnlineMeetingArtifact } from '@alga-psa/types';

const hoisted = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  tenantDbMock: vi.fn((conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
  })),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
  tenantDb: hoisted.tenantDbMock,
}));

import OnlineMeetingModel from './onlineMeeting';

type TableName = 'online_meetings' | 'online_meeting_artifacts';
type Row = Record<string, any>;

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private orderings: Array<{ column: string; order: 'asc' | 'desc' }> = [];
  private limitCount: number | null = null;
  private action: 'select' | 'insert' | 'update' = 'select';
  private insertRows: Row[] = [];
  private updateData: Row = {};
  private conflictColumns: string[] = [];
  private mergeData: Row | null = null;

  constructor(private readonly rows: Row[], private readonly tableName: TableName) {}

  where(columnOrConditions: string | Row, operator?: string, value?: unknown): this {
    if (typeof columnOrConditions === 'string') {
      const column = columnOrConditions;
      if (operator === '<=') {
        this.filters.push((row) => row[column] <= (value as any));
      } else if (operator === '>=') {
        this.filters.push((row) => row[column] >= (value as any));
      } else {
        this.filters.push((row) => row[column] === operator);
      }
      return this;
    }

    this.filters.push((row) =>
      Object.entries(columnOrConditions).every(([key, expected]) => row[key] === expected),
    );
    return this;
  }

  andWhere(column: string, operator: string, value: unknown): this {
    return this.where(column, operator, value);
  }

  whereIn(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  orderBy(column: string, order: 'asc' | 'desc'): this {
    this.orderings.push({ column, order });
    return this;
  }

  limit(limitCount: number): this {
    this.limitCount = limitCount;
    return this;
  }

  insert(data: Row | Row[]): this {
    this.action = 'insert';
    this.insertRows = Array.isArray(data) ? data : [data];
    return this;
  }

  update(data: Row): this {
    this.action = 'update';
    this.updateData = data;
    return this;
  }

  onConflict(columns: string[]): this {
    this.conflictColumns = columns;
    return this;
  }

  merge(data: Row): this {
    this.mergeData = data;
    return this;
  }

  async returning(_columns: string): Promise<Row[]> {
    if (this.action === 'insert') {
      return this.insertRows.map((row) => this.insertOne(row));
    }

    if (this.action === 'update') {
      const matched = this.applyFilters(this.rows);
      matched.forEach((row) => Object.assign(row, this.updateData));
      return matched;
    }

    return this.execute();
  }

  async first(): Promise<Row | undefined> {
    return (await this.execute())[0];
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private insertOne(input: Row): Row {
    const now = new Date('2026-06-01T12:00:00.000Z');
    const conflict = this.conflictColumns.length
      ? this.rows.find((row) => this.conflictColumns.every((column) => row[column] === input[column]))
      : undefined;

    if (conflict) {
      Object.assign(conflict, this.mergeData ?? input);
      return conflict;
    }

    const row = {
      ...input,
      meeting_id: input.meeting_id ?? `meeting-${this.rows.length + 1}`,
      artifact_id: input.artifact_id ?? (this.tableName === 'online_meeting_artifacts' ? `artifact-${this.rows.length + 1}` : undefined),
      recording_fetch_attempts: input.recording_fetch_attempts ?? 0,
      last_fetch_at: input.last_fetch_at ?? null,
      created_at: input.created_at ?? now,
      updated_at: input.updated_at ?? now,
    };

    if (this.tableName === 'online_meetings') {
      delete row.artifact_id;
    }

    this.rows.push(row);
    return row;
  }

  private async execute(): Promise<Row[]> {
    let result = this.applyFilters(this.rows);

    for (const { column, order } of [...this.orderings].reverse()) {
      result = [...result].sort((left, right) => {
        const leftValue = left[column]?.getTime?.() ?? left[column] ?? 0;
        const rightValue = right[column]?.getTime?.() ?? right[column] ?? 0;
        if (leftValue === rightValue) return 0;
        return order === 'asc'
          ? leftValue < rightValue ? -1 : 1
          : leftValue > rightValue ? -1 : 1;
      });
    }

    if (this.limitCount !== null) {
      result = result.slice(0, this.limitCount);
    }

    return result;
  }

  private applyFilters(rows: Row[]): Row[] {
    return rows.filter((row) => this.filters.every((filter) => filter(row)));
  }
}

function createFakeKnex(tables: Record<TableName, Row[]>) {
  return ((tableName: TableName) => new FakeQuery(tables[tableName], tableName)) as any;
}

function meeting(overrides: Partial<IOnlineMeeting> = {}): Omit<IOnlineMeeting, 'artifacts'> {
  const now = new Date('2026-06-01T10:00:00.000Z');

  return {
    tenant: 'tenant-1',
    meeting_id: 'meeting-1',
    provider: 'teams',
    provider_meeting_id: 'provider-meeting-1',
    provider_event_id: 'event-1',
    organizer_upn: 'organizer@example.com',
    organizer_user_id: 'organizer-aad-1',
    subject: 'Support review',
    join_url: 'https://teams.example/join',
    start_time: new Date('2026-06-01T09:00:00.000Z'),
    end_time: new Date('2026-06-01T09:30:00.000Z'),
    status: 'ended',
    recording_fetch_attempts: 0,
    last_fetch_at: null,
    appointment_request_id: 'appointment-1',
    interaction_id: 'interaction-1',
    schedule_entry_id: null,
    created_by: 'user-1',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function artifact(overrides: Partial<IOnlineMeetingArtifact> = {}): IOnlineMeetingArtifact {
  const now = new Date('2026-06-01T10:00:00.000Z');

  return {
    tenant: 'tenant-1',
    artifact_id: 'artifact-1',
    meeting_id: 'meeting-1',
    artifact_type: 'recording',
    provider_artifact_id: 'artifact-provider-1',
    content_url: 'https://graph.example/content',
    document_id: null,
    file_id: null,
    created_date_time: new Date('2026-06-01T09:35:00.000Z'),
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('OnlineMeetingModel', () => {
  let tables: Record<TableName, Row[]>;

  beforeEach(() => {
    tables = {
      online_meetings: [],
      online_meeting_artifacts: [],
    };
    hoisted.createTenantKnexMock.mockReset();
    hoisted.tenantDbMock.mockClear();
    hoisted.createTenantKnexMock.mockImplementation(async (tenantId: string) => ({
      knex: createFakeKnex(tables),
      tenant: tenantId,
    }));
  });

  it('T012 create + getById round-trips a meeting with its artifacts array', async () => {
    const created = await OnlineMeetingModel.create(meeting({ tenant: undefined }), 'tenant-1');

    expect(created.meeting_id).toBe('meeting-1');
    expect(created.tenant).toBe('tenant-1');
    expect(created.artifacts).toEqual([]);

    await OnlineMeetingModel.upsertArtifact('meeting-1', artifact({ tenant: undefined, meeting_id: undefined }) as any, 'tenant-1');
    const fetched = await OnlineMeetingModel.getById('meeting-1', 'tenant-1');

    expect(fetched?.artifacts).toHaveLength(1);
    expect(fetched?.artifacts[0].provider_artifact_id).toBe('artifact-provider-1');
  });

  it('T013 provider, interaction, and appointment lookups return tenant-scoped rows', async () => {
    tables.online_meetings.push(meeting());

    await expect(OnlineMeetingModel.getByProviderMeetingId('provider-meeting-1', 'tenant-1')).resolves.toMatchObject({
      meeting_id: 'meeting-1',
    });
    await expect(OnlineMeetingModel.getByInteractionId('interaction-1', 'tenant-1')).resolves.toMatchObject({
      meeting_id: 'meeting-1',
    });
    await expect(OnlineMeetingModel.getByAppointmentRequestId('appointment-1', 'tenant-1')).resolves.toMatchObject({
      meeting_id: 'meeting-1',
    });
    await expect(OnlineMeetingModel.getByProviderMeetingId('provider-meeting-1', 'tenant-2')).resolves.toBeNull();
  });

  it('T014 listPendingRecordings returns only pending-eligible ended meetings', async () => {
    tables.online_meetings.push(
      meeting({ meeting_id: 'scheduled-ended', provider_meeting_id: 'pm-1', status: 'scheduled' }),
      meeting({ meeting_id: 'ended', provider_meeting_id: 'pm-2', status: 'ended' }),
      meeting({ meeting_id: 'recording-pending', provider_meeting_id: 'pm-3', status: 'recording_pending' }),
      meeting({ meeting_id: 'future', provider_meeting_id: 'pm-4', status: 'scheduled', end_time: new Date('2999-01-01T00:00:00.000Z') }),
      meeting({ meeting_id: 'ready', provider_meeting_id: 'pm-5', status: 'recording_ready' }),
      meeting({ meeting_id: 'none', provider_meeting_id: 'pm-6', status: 'no_recording' }),
      meeting({ meeting_id: 'cancelled', provider_meeting_id: 'pm-7', status: 'cancelled' }),
      meeting({ meeting_id: 'failed', provider_meeting_id: 'pm-8', status: 'failed' }),
    );

    const pending = await OnlineMeetingModel.listPendingRecordings('tenant-1');

    expect(pending.map((row) => row.meeting_id)).toEqual([
      'scheduled-ended',
      'ended',
      'recording-pending',
    ]);
  });

  it('T015 all queries are tenant-scoped', async () => {
    tables.online_meetings.push(
      meeting({ tenant: 'tenant-1', meeting_id: 'meeting-1', provider_meeting_id: 'provider-meeting-1' }),
      meeting({ tenant: 'tenant-2', meeting_id: 'meeting-2', provider_meeting_id: 'provider-meeting-1' }),
    );
    tables.online_meeting_artifacts.push(
      artifact({ tenant: 'tenant-1', meeting_id: 'meeting-1', artifact_id: 'artifact-1' }),
      artifact({ tenant: 'tenant-2', meeting_id: 'meeting-2', artifact_id: 'artifact-2' }),
    );

    const tenantOne = await OnlineMeetingModel.getByProviderMeetingId('provider-meeting-1', 'tenant-1');
    const tenantTwo = await OnlineMeetingModel.getByProviderMeetingId('provider-meeting-1', 'tenant-2');

    expect(tenantOne?.meeting_id).toBe('meeting-1');
    expect(tenantOne?.artifacts.map((row) => row.artifact_id)).toEqual(['artifact-1']);
    expect(tenantTwo?.meeting_id).toBe('meeting-2');
    expect(tenantTwo?.artifacts.map((row) => row.artifact_id)).toEqual(['artifact-2']);
  });

  it('T008 upsertArtifact updates an existing provider artifact instead of duplicating it', async () => {
    tables.online_meetings.push(meeting());

    await OnlineMeetingModel.upsertArtifact('meeting-1', artifact({ tenant: undefined, meeting_id: undefined, content_url: 'old-url' }) as any, 'tenant-1');
    const updated = await OnlineMeetingModel.upsertArtifact(
      'meeting-1',
      artifact({
        tenant: undefined,
        meeting_id: undefined,
        content_url: 'new-url',
        file_id: 'file-1',
      }) as any,
      'tenant-1',
    );

    expect(updated.content_url).toBe('new-url');
    expect(updated.file_id).toBe('file-1');
    expect(tables.online_meeting_artifacts).toHaveLength(1);
  });

  it('T016 listArtifacts returns artifacts newest-first', async () => {
    tables.online_meeting_artifacts.push(
      artifact({ artifact_id: 'old', created_date_time: new Date('2026-06-01T09:31:00.000Z') }),
      artifact({ artifact_id: 'new', provider_artifact_id: 'artifact-provider-2', created_date_time: new Date('2026-06-01T09:40:00.000Z') }),
    );

    const artifacts = await OnlineMeetingModel.listArtifacts('meeting-1', 'tenant-1');

    expect(artifacts.map((row) => row.artifact_id)).toEqual(['new', 'old']);
  });
});
