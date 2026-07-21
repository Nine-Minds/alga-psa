import { tenantDb } from '@alga-psa/db';
import type {
  IProjectBillingConfig,
  ProjectBillingCapBehavior,
  ProjectBillingDepositTreatment,
  ProjectBillingInvoiceMode,
  ProjectBillingModel
} from '@alga-psa/types';
import { computeEntryAmounts } from '../services/projectBillingService';
import ProjectBillingScheduleEntry from './projectBillingScheduleEntry';
import {
  normalizeProjectBillingCapUsage,
  normalizeProjectBillingConfig,
  resolveProjectBillingDb,
  withoutUndefined,
  type ProjectBillingDbConnection
} from './projectBillingModelUtils';

export interface CreateProjectBillingConfigModelInput {
  project_id: string;
  billing_model: ProjectBillingModel;
  total_price?: number | null;
  currency?: string | null;
  invoice_mode: ProjectBillingInvoiceMode;
  contract_id?: string | null;
  cap_amount?: number | null;
  cap_behavior?: ProjectBillingCapBehavior | null;
  cap_notify_thresholds?: number[];
  deposit_treatment?: ProjectBillingDepositTreatment;
  is_taxable?: boolean;
  tax_region?: string | null;
}

export type UpdateProjectBillingConfigModelInput = Partial<Omit<
  IProjectBillingConfig,
  'tenant' | 'config_id' | 'project_id' | 'created_at' | 'updated_at'
>>;

export interface ProjectBillingRollup {
  total_price: number | null;
  invoiced_amount: number;
  ready_amount: number;
  approved_amount: number;
  remaining_amount: number;
  allocated_pct: number | null;
}

const ProjectBillingConfig = {
  getByProject: async (
    projectId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingConfig | null> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const row = await tenantDb(connection, tenant).table('project_billing_configs')
      .where({ project_id: projectId })
      .first();

    return row ? normalizeProjectBillingConfig(row as Record<string, unknown>) : null;
  },

  getById: async (
    configId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingConfig | null> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const row = await tenantDb(connection, tenant).table('project_billing_configs')
      .where({ config_id: configId })
      .first();

    return row ? normalizeProjectBillingConfig(row as Record<string, unknown>) : null;
  },

  insert: async (
    input: CreateProjectBillingConfigModelInput,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingConfig> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const {
      tenant: _tenant,
      config_id: _configId,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...safeInput
    } = input as CreateProjectBillingConfigModelInput & Partial<IProjectBillingConfig>;
    const persistenceInput = withoutUndefined({
      ...safeInput,
      cap_notify_thresholds: safeInput.cap_notify_thresholds === undefined
        ? undefined
        : JSON.stringify(safeInput.cap_notify_thresholds),
      tenant,
    });
    const [row] = await tenantDb(connection, tenant).table('project_billing_configs')
      .insert(persistenceInput)
      .returning('*');

    if (!row) {
      throw new Error('Failed to insert project billing config');
    }
    return normalizeProjectBillingConfig(row as Record<string, unknown>);
  },

  update: async (
    configId: string,
    updates: UpdateProjectBillingConfigModelInput,
    trx?: ProjectBillingDbConnection
  ): Promise<IProjectBillingConfig | null> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const {
      tenant: _tenant,
      config_id: _configId,
      project_id: _projectId,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...mutableUpdates
    } = updates as Partial<IProjectBillingConfig>;
    const persistenceUpdates = withoutUndefined({
      ...mutableUpdates,
      cap_notify_thresholds: mutableUpdates.cap_notify_thresholds === undefined
        ? undefined
        : JSON.stringify(mutableUpdates.cap_notify_thresholds),
    });
    const [row] = await tenantDb(connection, tenant).table('project_billing_configs')
      .where({ config_id: configId })
      .update({
        ...persistenceUpdates,
        updated_at: new Date().toISOString()
      })
      .returning('*');

    return row ? normalizeProjectBillingConfig(row as Record<string, unknown>) : null;
  },

  delete: async (
    configId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<boolean> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const deleted = await tenantDb(connection, tenant).table('project_billing_configs')
      .where({ config_id: configId })
      .delete();
    return deleted > 0;
  },

  getRollupByProject: async (
    projectId: string,
    trx?: ProjectBillingDbConnection
  ): Promise<ProjectBillingRollup | null> => {
    const { connection, tenant } = await resolveProjectBillingDb(trx);
    const db = tenantDb(connection, tenant);
    const configRow = await db.table('project_billing_configs')
      .where({ project_id: projectId })
      .first();
    if (!configRow) {
      return null;
    }

    const config = normalizeProjectBillingConfig(configRow as Record<string, unknown>);
    const entries = await ProjectBillingScheduleEntry.listByConfig(config.config_id, connection);
    const computedAmounts = computeEntryAmounts(config, entries);
    const sumStatus = (status: 'invoiced' | 'ready' | 'approved'): number => entries.reduce(
      (sum, entry, index) => entry.status === status ? sum + computedAmounts[index] : sum,
      0
    );
    const readyAmount = sumStatus('ready');
    const approvedAmount = sumStatus('approved');

    if (config.billing_model === 'time_and_materials') {
      const capUsageRow = await db.table('project_billing_cap_usage')
        .where({ config_id: config.config_id })
        .first();
      const billedAmount = capUsageRow
        ? normalizeProjectBillingCapUsage(capUsageRow as Record<string, unknown>).billed_amount
        : 0;

      return {
        total_price: null,
        invoiced_amount: billedAmount,
        ready_amount: readyAmount,
        approved_amount: approvedAmount,
        remaining_amount: config.cap_amount === null
          ? 0
          : Math.max(0, config.cap_amount - billedAmount),
        allocated_pct: null
      };
    }

    const totalPrice = config.total_price ?? 0;
    const invoicedAmount = sumStatus('invoiced');
    const allocatedAmount = entries.reduce(
      (sum, entry, index) => entry.status === 'canceled' ? sum : sum + computedAmounts[index],
      0
    );

    return {
      total_price: config.total_price,
      invoiced_amount: invoicedAmount,
      ready_amount: readyAmount,
      approved_amount: approvedAmount,
      remaining_amount: totalPrice - invoicedAmount - readyAmount - approvedAmount,
      allocated_pct: totalPrice === 0
        ? (allocatedAmount === 0 ? 100 : 0)
        : (allocatedAmount / totalPrice) * 100
    };
  }
};

export default ProjectBillingConfig;
