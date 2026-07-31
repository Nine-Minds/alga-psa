import type { Knex } from 'knex';
import type { IOpportunityCommitment } from '@alga-psa/types';

export async function getOpportunityHandoffCommitments(
  _knex: Knex | Knex.Transaction,
  _tenant: string,
  _opportunityId: string,
): Promise<IOpportunityCommitment[]> {
  return [];
}
