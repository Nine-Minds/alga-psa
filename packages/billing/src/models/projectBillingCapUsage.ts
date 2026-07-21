import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IProjectBillingCapUsage } from '@alga-psa/types';
import {
  normalizeProjectBillingCapUsage,
  resolveProjectBillingDb,
  type ProjectBillingDbConnection
} from './projectBillingModelUtils';

export interface ProjectBillingCapUsageIncrement {
  billed: number;
  writtenDown: number;
}

function assertIntegerDelta(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of cents`);
  }
}

const ProjectBillingCapUsage = {
  getByConfig: async (
    configId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingCapUsage | null> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const row = await tenantDb(connection, tenant).table('project_billing_cap_usage')
      .where({ config_id: configId })
      .first();
    return row ? normalizeProjectBillingCapUsage(row as Record<string, unknown>) : null;
  },

  ensureRow: async (
    configId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingCapUsage> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const db = tenantDb(connection, tenant);
    const inserted = await db.table('project_billing_cap_usage')
      .insert({ tenant, config_id: configId })
      .onConflict(['tenant', 'config_id'])
      .ignore()
      .returning('*');

    const row = inserted[0] ?? await db.table('project_billing_cap_usage')
      .where({ config_id: configId })
      .first();
    if (!row) {
      throw new Error(`Failed to ensure cap usage row for project billing config ${configId}`);
    }
    return normalizeProjectBillingCapUsage(row as Record<string, unknown>);
  },

  getForUpdate: async (
    configId: string,
    trx: Knex.Transaction
  ): Promise<IProjectBillingCapUsage | null> => {
    const { tenant } = await resolveProjectBillingDb(trx);
    const row = await tenantDb(trx, tenant).table('project_billing_cap_usage')
      .where({ config_id: configId })
      .forUpdate()
      .first();
    return row ? normalizeProjectBillingCapUsage(row as Record<string, unknown>) : null;
  },

  increment: async (
    configId: string,
    amounts: ProjectBillingCapUsageIncrement,
    trx: Knex.Transaction
  ): Promise<IProjectBillingCapUsage> => {
    assertIntegerDelta(amounts.billed, 'billed');
    assertIntegerDelta(amounts.writtenDown, 'writtenDown');
    const { tenant } = await resolveProjectBillingDb(trx);
    await ProjectBillingCapUsage.ensureRow(configId, trx);
    const [row] = await tenantDb(trx, tenant).table('project_billing_cap_usage')
      .where({ config_id: configId })
      .update({
        billed_amount: trx.raw('billed_amount + ?', [amounts.billed]),
        written_down_amount: trx.raw('written_down_amount + ?', [amounts.writtenDown]),
        updated_at: new Date().toISOString()
      })
      .returning('*');

    if (!row) {
      throw new Error(`Cap usage row for project billing config ${configId} was not found`);
    }
    return normalizeProjectBillingCapUsage(row as Record<string, unknown>);
  },

  recordNotifiedThreshold: async (
    configId: string,
    threshold: number,
    trx: Knex.Transaction
  ): Promise<IProjectBillingCapUsage> => {
    if (!Number.isFinite(threshold)) {
      throw new RangeError('threshold must be a finite number');
    }

    await ProjectBillingCapUsage.ensureRow(configId, trx);
    const current = await ProjectBillingCapUsage.getForUpdate(configId, trx);
    if (!current) {
      throw new Error(`Cap usage row for project billing config ${configId} was not found`);
    }

    const notifiedThresholds = current.notified_thresholds.includes(threshold)
      ? current.notified_thresholds
      : [...current.notified_thresholds, threshold].sort((left, right) => left - right);
    const { tenant } = await resolveProjectBillingDb(trx);
    const [row] = await tenantDb(trx, tenant).table('project_billing_cap_usage')
      .where({ config_id: configId })
      .update({
        notified_thresholds: JSON.stringify(notifiedThresholds),
        updated_at: new Date().toISOString()
      })
      .returning('*');

    if (!row) {
      throw new Error(`Cap usage row for project billing config ${configId} was not found`);
    }
    return normalizeProjectBillingCapUsage(row as Record<string, unknown>);
  }
};

export default ProjectBillingCapUsage;
