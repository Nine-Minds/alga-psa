import type { Knex } from 'knex';

import { flattenJsonbPayload } from '../normalize';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ServiceRequestSubmissionSearchRow {
  submission_id: string;
  client_id: string | null;
  request_name: string;
  submitted_payload: unknown;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function toSourceUpdatedAt(row: ServiceRequestSubmissionSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: ServiceRequestSubmissionSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'service_request_submission',
    objectId: row.submission_id,
    title: row.request_name,
    body: flattenJsonbPayload(row.submitted_payload) || undefined,
    url: `/msp/service-requests/${row.submission_id}`,
    acl: {
      requiredPermission: 'service_request:read',
      clientScopeId: row.client_id ?? undefined,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const serviceRequestSubmissionIndexer: EntityIndexer = {
  objectType: 'service_request_submission',
  sourceEvents: [
    'SERVICE_REQUEST_SUBMISSION_CREATED',
    'SERVICE_REQUEST_SUBMISSION_UPDATED',
    'SERVICE_REQUEST_SUBMISSION_DELETED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<ServiceRequestSubmissionSearchRow>('service_request_submissions')
      .select('submission_id', 'client_id', 'request_name', 'submitted_payload', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .andWhere('submission_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<ServiceRequestSubmissionSearchRow>('service_request_submissions')
      .select('submission_id', 'client_id', 'request_name', 'submitted_payload', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .orderBy('submission_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('submission_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
