import type { IOnlineMeeting, IOnlineMeetingArtifact, OnlineMeetingStatus } from '@alga-psa/types';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

type OnlineMeetingRow = Omit<IOnlineMeeting, 'artifacts'>;

export type CreateOnlineMeetingInput = Omit<
  OnlineMeetingRow,
  'tenant' | 'meeting_id' | 'created_at' | 'updated_at' | 'recording_fetch_attempts' | 'last_fetch_at'
> &
  Partial<Pick<OnlineMeetingRow, 'meeting_id' | 'recording_fetch_attempts' | 'last_fetch_at' | 'created_at' | 'updated_at'>>;

export type UpdateOnlineMeetingInput = Partial<
  Omit<OnlineMeetingRow, 'tenant' | 'meeting_id' | 'created_at' | 'updated_at'>
>;

export type UpsertOnlineMeetingArtifactInput = Omit<
  IOnlineMeetingArtifact,
  'tenant' | 'artifact_id' | 'meeting_id' | 'created_at' | 'updated_at'
> &
  Partial<Pick<IOnlineMeetingArtifact, 'artifact_id' | 'created_at' | 'updated_at'>>;

const PENDING_RECORDING_STATUSES: OnlineMeetingStatus[] = ['scheduled', 'ended', 'recording_pending'];

function withoutUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function requireTenant(tenant: string | null | undefined): string {
  if (!tenant) {
    throw new Error('Tenant context is required for online meeting operations');
  }

  return tenant;
}

function tenantScopedTable<Row extends object>(
  db: Parameters<typeof tenantDb>[0],
  table: string,
  tenant: string,
) {
  return tenantDb(db, tenant).table<Row>(table);
}

function withArtifacts(row: OnlineMeetingRow, artifacts: IOnlineMeetingArtifact[]): IOnlineMeeting {
  return {
    ...row,
    artifacts,
  };
}

class OnlineMeetingModel {
  static async create(input: CreateOnlineMeetingInput, tenantId: string): Promise<IOnlineMeeting> {
    const { knex: db, tenant: contextTenant } = await createTenantKnex(tenantId);
    const tenant = requireTenant(contextTenant);

    const [created] = await tenantScopedTable<OnlineMeetingRow>(db, 'online_meetings', tenant)
      .insert({
        ...withoutUndefined(input as unknown as Record<string, unknown>),
        tenant,
      } as any)
      .returning('*');

    const meeting = await this.getById(created.meeting_id, tenantId);
    if (!meeting) {
      throw new Error('Failed to fetch created online meeting');
    }

    return meeting;
  }

  static async getById(meetingId: string, tenantId: string): Promise<IOnlineMeeting | null> {
    const { knex: db, tenant: contextTenant } = await createTenantKnex(tenantId);
    const tenant = requireTenant(contextTenant);

    const row = await tenantScopedTable<OnlineMeetingRow>(db, 'online_meetings', tenant)
      .where({ meeting_id: meetingId })
      .first();

    if (!row) {
      return null;
    }

    return withArtifacts(row, await this.listArtifacts(meetingId, tenantId));
  }

  static async getByProviderMeetingId(
    providerMeetingId: string,
    tenantId: string,
    provider = 'teams',
  ): Promise<IOnlineMeeting | null> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    const scopedTenant = requireTenant(tenant);

    const row = await tenantScopedTable<OnlineMeetingRow>(db, 'online_meetings', scopedTenant)
      .where({ provider, provider_meeting_id: providerMeetingId })
      .first();

    if (!row) {
      return null;
    }

    return withArtifacts(row, await this.listArtifacts(row.meeting_id, tenantId));
  }

  static async getByInteractionId(interactionId: string, tenantId: string): Promise<IOnlineMeeting | null> {
    const { knex: db, tenant: contextTenant } = await createTenantKnex(tenantId);
    const tenant = requireTenant(contextTenant);

    const row = await tenantScopedTable<OnlineMeetingRow>(db, 'online_meetings', tenant)
      .where({ interaction_id: interactionId })
      .first();

    if (!row) {
      return null;
    }

    return withArtifacts(row, await this.listArtifacts(row.meeting_id, tenantId));
  }

  static async getByAppointmentRequestId(
    appointmentRequestId: string,
    tenantId: string,
  ): Promise<IOnlineMeeting | null> {
    const { knex: db, tenant: contextTenant } = await createTenantKnex(tenantId);
    const tenant = requireTenant(contextTenant);

    const row = await tenantScopedTable<OnlineMeetingRow>(db, 'online_meetings', tenant)
      .where({ appointment_request_id: appointmentRequestId })
      .first();

    if (!row) {
      return null;
    }

    return withArtifacts(row, await this.listArtifacts(row.meeting_id, tenantId));
  }

  static async update(
    meetingId: string,
    input: UpdateOnlineMeetingInput,
    tenantId: string,
  ): Promise<IOnlineMeeting | null> {
    const { knex: db, tenant: contextTenant } = await createTenantKnex(tenantId);
    const tenant = requireTenant(contextTenant);
    const updateData = withoutUndefined({
      ...(input as unknown as Record<string, unknown>),
      updated_at: new Date(),
    });

    const [updated] = await tenantScopedTable<OnlineMeetingRow>(db, 'online_meetings', tenant)
      .where({ meeting_id: meetingId })
      .update(updateData as any)
      .returning('*');

    if (!updated) {
      return null;
    }

    return this.getById(updated.meeting_id, tenantId);
  }

  static async listPendingRecordings(tenantId: string, limit = 100): Promise<IOnlineMeeting[]> {
    const { knex: db, tenant: contextTenant } = await createTenantKnex(tenantId);
    const tenant = requireTenant(contextTenant);

    const rows = await tenantScopedTable<OnlineMeetingRow>(db, 'online_meetings', tenant)
      .whereIn('status', PENDING_RECORDING_STATUSES)
      .andWhere('end_time', '<=', new Date())
      .orderBy('end_time', 'asc')
      .limit(limit);

    return Promise.all(rows.map(async (row) => withArtifacts(row, await this.listArtifacts(row.meeting_id, tenantId))));
  }

  static async upsertArtifact(
    meetingId: string,
    input: UpsertOnlineMeetingArtifactInput,
    tenantId: string,
  ): Promise<IOnlineMeetingArtifact> {
    const { knex: db, tenant: contextTenant } = await createTenantKnex(tenantId);
    const tenant = requireTenant(contextTenant);
    const insertData = withoutUndefined({
      ...(input as unknown as Record<string, unknown>),
      tenant,
      meeting_id: meetingId,
    });
    const mergeData = withoutUndefined({
      content_url: input.content_url,
      document_id: input.document_id,
      file_id: input.file_id,
      created_date_time: input.created_date_time,
      updated_at: new Date(),
    });

    const [artifact] = await tenantScopedTable<IOnlineMeetingArtifact>(db, 'online_meeting_artifacts', tenant)
      .insert(insertData as any)
      .onConflict(['tenant', 'meeting_id', 'artifact_type', 'provider_artifact_id'])
      .merge(mergeData as any)
      .returning('*');

    return artifact;
  }

  static async listArtifacts(meetingId: string, tenantId: string): Promise<IOnlineMeetingArtifact[]> {
    const { knex: db, tenant: contextTenant } = await createTenantKnex(tenantId);
    const tenant = requireTenant(contextTenant);

    return tenantScopedTable<IOnlineMeetingArtifact>(db, 'online_meeting_artifacts', tenant)
      .where({ meeting_id: meetingId })
      .orderBy('created_date_time', 'desc')
      .orderBy('created_at', 'desc');
  }
}

export default OnlineMeetingModel;
