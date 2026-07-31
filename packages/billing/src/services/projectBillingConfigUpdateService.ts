import type { Knex } from 'knex';
import type {
  IProjectBillingConfig,
  IProjectBillingScheduleEntry,
} from '@alga-psa/types';
import ProjectBillingConfig, {
  type UpdateProjectBillingConfigModelInput,
} from '../models/projectBillingConfig';
import { assertTotalCoversFrozenAmounts } from './projectBillingService';

export async function persistProjectBillingConfigUpdate(
  configId: string,
  updates: UpdateProjectBillingConfigModelInput,
  entries: readonly IProjectBillingScheduleEntry[],
  trx: Knex.Transaction,
): Promise<IProjectBillingConfig> {
  if (Object.prototype.hasOwnProperty.call(updates, 'total_price')) {
    assertTotalCoversFrozenAmounts(updates.total_price ?? null, entries);
  }

  const updated = await ProjectBillingConfig.update(configId, updates, trx);
  if (!updated) {
    throw new Error('Project billing config not found');
  }
  return updated;
}
