import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IOpportunityEvidence } from '@alga-psa/types';

export const OpportunityEvidenceModel = {
  async listActive(conn: Knex | Knex.Transaction, tenant: string, opportunityId: string): Promise<IOpportunityEvidence[]> {
    return tenantDb(conn, tenant).table('opportunity_evidence')
      .where({ opportunity_id: opportunityId })
      .whereNull('corrected_at')
      .orderBy('recorded_at', 'asc') as unknown as IOpportunityEvidence[];
  },
};

