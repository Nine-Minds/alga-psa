import type { IClientContract } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

type RenewalMode = NonNullable<IClientContract['renewal_mode']>;

const DEFAULT_RENEWAL_MODE: RenewalMode = 'manual';
const DEFAULT_NOTICE_PERIOD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const normalizeRenewalMode = (value: unknown): RenewalMode | undefined => {
  return value === 'none' || value === 'manual' || value === 'auto' ? value : undefined;
};

const normalizeNonNegativeInteger = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.trunc(numeric));
};

const normalizePositiveInteger = (value: unknown): number | undefined => {
  const normalized = normalizeNonNegativeInteger(value);
  return normalized !== undefined && normalized > 0 ? normalized : undefined;
};

const normalizeDateOnly = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (trimmed.includes('T')) {
    return trimmed.slice(0, 10);
  }
  return undefined;
};

const subtractDaysFromDateOnly = (dateOnly: string, days: number): string | undefined => {
  if (!Number.isInteger(days) || days < 0) return undefined;
  const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Date(parsed.getTime() - days * MS_PER_DAY).toISOString().slice(0, 10);
};

const createClampedUtcDate = (year: number, monthIndex: number, dayOfMonth: number): Date => {
  const lastDayOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(dayOfMonth, lastDayOfMonth);
  return new Date(Date.UTC(year, monthIndex, clampedDay));
};

const computeNextEvergreenReviewAnchorDate = (params: {
  startDate: string;
  now?: string | Date;
}): string | undefined => {
  const normalizedStartDate = normalizeDateOnly(params.startDate);
  if (!normalizedStartDate) return undefined;

  const start = new Date(`${normalizedStartDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return undefined;

  const normalizedNow = normalizeDateOnly(params.now instanceof Date ? params.now.toISOString() : params.now);
  const nowBase = normalizedNow
    ? new Date(`${normalizedNow}T00:00:00.000Z`)
    : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  if (Number.isNaN(nowBase.getTime())) return undefined;

  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const thisYearCandidate = createClampedUtcDate(nowBase.getUTCFullYear(), month, day);
  const nextAnchor =
    thisYearCandidate.getTime() >= nowBase.getTime()
      ? thisYearCandidate
      : createClampedUtcDate(nowBase.getUTCFullYear() + 1, month, day);

  return nextAnchor.toISOString().slice(0, 10);
};

const computeEvergreenDecisionDueDate = (params: {
  startDate: string;
  noticePeriodDays: number;
  now?: string | Date;
}): string | undefined => {
  const anchorDate = computeNextEvergreenReviewAnchorDate({
    startDate: params.startDate,
    now: params.now,
  });
  if (!anchorDate) return undefined;

  const normalizedNoticePeriodDays = normalizeNonNegativeInteger(params.noticePeriodDays);
  if (normalizedNoticePeriodDays === undefined) return undefined;

  return subtractDaysFromDateOnly(anchorDate, normalizedNoticePeriodDays);
};

type RenewalDefaultSelectionConfig = {
  joinDefaultSettings: boolean;
  defaultSelections: string[];
};

const getRenewalDefaultSelectionConfig = async (
  db: Knex | Knex.Transaction
): Promise<RenewalDefaultSelectionConfig> => {
  const schema = (db as any).schema;
  if (!schema?.hasColumn) {
    return { joinDefaultSettings: false, defaultSelections: [] };
  }

  const [hasDefaultRenewalModeColumn, hasDefaultNoticePeriodColumn] = await Promise.all([
    schema.hasColumn('default_billing_settings', 'default_renewal_mode'),
    schema.hasColumn('default_billing_settings', 'default_notice_period_days'),
  ]);

  const defaultSelections: string[] = [];
  if (hasDefaultRenewalModeColumn) {
    defaultSelections.push('dbs.default_renewal_mode as tenant_default_renewal_mode');
  }
  if (hasDefaultNoticePeriodColumn) {
    defaultSelections.push('dbs.default_notice_period_days as tenant_default_notice_period_days');
  }

  return {
    joinDefaultSettings: defaultSelections.length > 0,
    defaultSelections,
  };
};

const withRenewalDefaultsJoin = (
  query: Knex.QueryBuilder,
  joinDefaultSettings: boolean
): Knex.QueryBuilder => {
  if (!joinDefaultSettings) {
    return query;
  }

  return query.leftJoin('default_billing_settings as dbs', function joinDefaultBillingSettings() {
    this.on('cc.tenant', '=', 'dbs.tenant');
  });
};

export const normalizeClientContract = (row: any): IClientContract => {
  if (!row) return row;

  const normalized = { ...row } as Record<string, unknown>;

  if (normalized.contract_billing_frequency !== undefined && normalized.billing_frequency === undefined) {
    normalized.billing_frequency = normalized.contract_billing_frequency;
  }

  const renewalMode = normalizeRenewalMode(normalized.renewal_mode);
  const noticePeriodDays = normalizeNonNegativeInteger(normalized.notice_period_days);
  const renewalTermMonths = normalizePositiveInteger(normalized.renewal_term_months);
  const useTenantDefaults =
    typeof normalized.use_tenant_renewal_defaults === 'boolean'
      ? normalized.use_tenant_renewal_defaults
      : true;

  const tenantDefaultRenewalMode =
    normalizeRenewalMode(normalized.tenant_default_renewal_mode) ?? DEFAULT_RENEWAL_MODE;
  const tenantDefaultNoticePeriodDays =
    normalizeNonNegativeInteger(normalized.tenant_default_notice_period_days) ?? DEFAULT_NOTICE_PERIOD_DAYS;

  normalized.renewal_mode = renewalMode;
  normalized.notice_period_days = noticePeriodDays;
  normalized.renewal_term_months = renewalTermMonths;
  normalized.use_tenant_renewal_defaults = useTenantDefaults;
  normalized.effective_renewal_mode = useTenantDefaults
    ? tenantDefaultRenewalMode
    : renewalMode ?? tenantDefaultRenewalMode;
  normalized.effective_notice_period_days = useTenantDefaults
    ? tenantDefaultNoticePeriodDays
    : noticePeriodDays ?? tenantDefaultNoticePeriodDays;

  const normalizedEndDate = normalizeDateOnly(normalized.end_date);
  const normalizedStartDate = normalizeDateOnly(normalized.start_date);
  const effectiveNoticePeriodDays = normalizeNonNegativeInteger(normalized.effective_notice_period_days);
  const effectiveRenewalMode = normalizeRenewalMode(normalized.effective_renewal_mode);
  const contractStatus = typeof normalized.contract_status === 'string' ? normalized.contract_status : undefined;
  const isInactiveByStatus = contractStatus === 'terminated' || contractStatus === 'expired';
  const isInactiveAssignment = normalized.is_active !== true;
  const shouldSkipForLifecycleState = isInactiveAssignment || isInactiveByStatus;
  normalized.evergreen_review_anchor_date =
    !shouldSkipForLifecycleState && !normalizedEndDate && normalizedStartDate
      ? computeNextEvergreenReviewAnchorDate({ startDate: normalizedStartDate })
      : undefined;
  const shouldSkipDecisionDueDate =
    shouldSkipForLifecycleState || (effectiveRenewalMode === 'none' && !normalized.evergreen_review_anchor_date);
  normalized.decision_due_date =
    shouldSkipDecisionDueDate
      ? undefined
      : normalizedEndDate && effectiveNoticePeriodDays !== undefined
      ? subtractDaysFromDateOnly(normalizedEndDate, effectiveNoticePeriodDays)
      : !normalizedEndDate && normalizedStartDate && effectiveNoticePeriodDays !== undefined
        ? computeEvergreenDecisionDueDate({
            startDate: normalizedStartDate,
            noticePeriodDays: effectiveNoticePeriodDays,
          })
      : undefined;
  normalized.renewal_cycle_key = normalized.decision_due_date
    ? normalizedEndDate
      ? `fixed-term:${normalizedEndDate}`
      : normalized.evergreen_review_anchor_date
        ? `evergreen:${normalized.evergreen_review_anchor_date as string}`
        : undefined
    : undefined;

  delete normalized.tenant_default_renewal_mode;
  delete normalized.tenant_default_notice_period_days;

  return normalized as unknown as IClientContract;
};

/**
 * Data access helpers for client contract assignments.
 */
const ClientContract = {
  async getByClientId(clientId: string, tenantId: string): Promise<IClientContract[]> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const renewalDefaults = await getRenewalDefaultSelectionConfig(db);

      const baseQuery = db('client_contracts as cc')
        .leftJoin('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({ 'cc.client_id': clientId, 'cc.tenant': tenant, 'cc.is_active': true })
        .orderBy('cc.start_date', 'desc');

      const rows = await withRenewalDefaultsJoin(baseQuery, renewalDefaults.joinDefaultSettings).select([
        'cc.*',
        'c.billing_frequency as contract_billing_frequency',
        'c.status as contract_status',
        ...renewalDefaults.defaultSelections,
      ]);

      return rows.map(normalizeClientContract);
    } catch (error) {
      console.error(`Error fetching contracts for client ${clientId}:`, error);
      throw error;
    }
  },

  async getActiveByClientIds(clientIds: string[], tenantId: string): Promise<IClientContract[]> {
    if (clientIds.length === 0) {
      return [];
    }

    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const renewalDefaults = await getRenewalDefaultSelectionConfig(db);

      const baseQuery = db('client_contracts as cc')
        .leftJoin('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .whereIn('cc.client_id', clientIds)
        .andWhere({ 'cc.tenant': tenant, 'cc.is_active': true })
        .orderBy([
          { column: 'cc.client_id', order: 'asc' },
          { column: 'cc.start_date', order: 'desc' }
        ]);

      const rows = await withRenewalDefaultsJoin(baseQuery, renewalDefaults.joinDefaultSettings).select([
        'cc.*',
        'c.billing_frequency as contract_billing_frequency',
        'c.status as contract_status',
        ...renewalDefaults.defaultSelections,
      ]);

      return rows.map(normalizeClientContract);
    } catch (error) {
      console.error('Error fetching contracts for clients:', error);
      throw error;
    }
  },

  async getById(clientContractId: string, tenantId: string): Promise<IClientContract | null> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const renewalDefaults = await getRenewalDefaultSelectionConfig(db);

      const baseQuery = db('client_contracts as cc')
        .leftJoin('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({ 'cc.client_contract_id': clientContractId, 'cc.tenant': tenant });

      const row = await withRenewalDefaultsJoin(baseQuery, renewalDefaults.joinDefaultSettings)
        .select([
          'cc.*',
          'c.billing_frequency as contract_billing_frequency',
          'c.status as contract_status',
          ...renewalDefaults.defaultSelections,
        ])
        .first();

      return row ? normalizeClientContract(row) : null;
    } catch (error) {
      console.error(`Error fetching client contract ${clientContractId}:`, error);
      throw error;
    }
  },

  async getDetailedClientContract(clientContractId: string, tenantId: string): Promise<any | null> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contracts');
    }

    try {
      const renewalDefaults = await getRenewalDefaultSelectionConfig(db);

      const baseQuery = db('client_contracts as cc')
        .join('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({ 'cc.client_contract_id': clientContractId, 'cc.tenant': tenant });

      const clientContract = await withRenewalDefaultsJoin(baseQuery, renewalDefaults.joinDefaultSettings).select(
        [
          'cc.*',
          'c.contract_name',
          'c.contract_description',
          'c.billing_frequency as contract_billing_frequency',
          'c.status as contract_status',
          ...renewalDefaults.defaultSelections,
        ]
      )
        .first();

      if (!clientContract) {
        return null;
      }

      const normalized = normalizeClientContract(clientContract) as any;

      const contractLines = await db('contract_lines')
        .where({ contract_id: normalized.contract_id, tenant })
        .select('contract_line_name');

      normalized.contract_line_names = contractLines.map((line) => line.contract_line_name);
      normalized.contract_line_count = contractLines.length;

      return normalized;
    } catch (error) {
      console.error(`Error fetching detailed client contract ${clientContractId}:`, error);
      throw error;
    }
  },

  async assignContractToClient(
    clientId: string,
    contractId: string,
    startDate: string,
    endDate: string | null = null,
    tenantId: string
  ): Promise<IClientContract> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for assigning contracts');
    }

    try {
      const clientExists = await db('clients')
        .where({ client_id: clientId, tenant })
        .first();

      if (!clientExists) {
        throw new Error(`Client ${clientId} not found or belongs to a different tenant`);
      }

      const contractExists = await db('contracts')
        .where({ contract_id: contractId, tenant, is_active: true })
        .first();

      if (!contractExists) {
        throw new Error(`Contract ${contractId} not found, inactive, or belongs to a different tenant`);
      }

      if (startDate) {
        const overlapping = await db('client_contracts')
          .where({ client_id: clientId, tenant, is_active: true })
          .where(function overlap() {
            this.where(function overlapsExistingEnd() {
              this.where('end_date', '>', startDate).orWhereNull('end_date');
            }).where(function overlapsExistingStart() {
              if (endDate) {
                this.where('start_date', '<', endDate);
              } else {
                this.whereRaw('1 = 1');
              }
            });
          })
          .first();

        if (overlapping) {
          throw new Error(`Client ${clientId} already has an active contract overlapping the specified range`);
        }
      }

      const timestamp = new Date().toISOString();
      const insertPayload: IClientContract = {
        client_contract_id: uuidv4(),
        client_id: clientId,
        contract_id: contractId,
        template_contract_id: null,
        start_date: startDate,
        end_date: endDate,
        is_active: true,
        tenant,
        created_at: timestamp,
        updated_at: timestamp,
      };

      const [created] = await db<IClientContract>('client_contracts').insert(insertPayload).returning('*');
      return normalizeClientContract(created);
    } catch (error) {
      console.error(`Error assigning contract ${contractId} to client ${clientId}:`, error);
      throw error;
    }
  },

  async updateClientContract(
    clientContractId: string,
    updateData: Partial<IClientContract>,
    tenantId: string
  ): Promise<IClientContract> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for updating client contracts');
    }

    try {
      const existing = await ClientContract.getById(clientContractId, tenantId);
      if (!existing) {
        throw new Error(`Client contract ${clientContractId} not found`);
      }

      const sanitized: Partial<IClientContract> = {
        ...updateData,
        tenant: undefined,
        client_contract_id: undefined,
        client_id: undefined,
        contract_id: undefined,
        created_at: undefined,
        updated_at: new Date().toISOString(),
      };

      if (updateData.start_date !== undefined && updateData.start_date !== existing.start_date) {
        const contract = await db('contracts')
          .where({ contract_id: existing.contract_id, tenant })
          .first();

        if (contract && contract.is_active) {
          throw new Error('Start date cannot be changed for active contracts. Set the contract to draft first.');
        }
      }

      const effectiveStart = updateData.start_date ?? existing.start_date;
      const effectiveEnd = updateData.end_date !== undefined ? updateData.end_date : existing.end_date;

      if (effectiveStart) {
        const overlapping = await db('client_contracts')
          .where({ client_id: existing.client_id, tenant, is_active: true })
          .whereNot({ client_contract_id: clientContractId })
          .where(function overlap() {
            this.where(function overlapsExistingEnd() {
              this.where('end_date', '>', effectiveStart).orWhereNull('end_date');
            }).where(function overlapsExistingStart() {
              if (effectiveEnd) {
                this.where('start_date', '<', effectiveEnd);
              } else {
                this.whereRaw('1 = 1');
              }
            });
          })
          .first();

        if (overlapping) {
          throw new Error(`Client ${existing.client_id} already has an active contract overlapping the specified range`);
        }
      }

      const [updated] = await db<IClientContract>('client_contracts')
        .where({ tenant, client_contract_id: clientContractId })
        .update(sanitized)
        .returning('*');

      if (!updated) {
        throw new Error(`Client contract ${clientContractId} not found`);
      }

      return normalizeClientContract(updated);
    } catch (error) {
      console.error(`Error updating client contract ${clientContractId}:`, error);
      throw error;
    }
  },

  async deactivateClientContract(clientContractId: string, tenantId: string): Promise<void> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for deactivating client contracts');
    }

    try {
      await db('client_contracts')
        .where({ tenant, client_contract_id: clientContractId })
        .update({ is_active: false, updated_at: new Date().toISOString() });
    } catch (error) {
      console.error(`Error deactivating client contract ${clientContractId}:`, error);
      throw error;
    }
  },

  async getContractLines(clientContractId: string, tenantId: string): Promise<any[]> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract lines');
    }

    try {
      const clientContract = await db('client_contracts')
        .where({ client_contract_id: clientContractId, tenant })
        .first();

      if (!clientContract) {
        throw new Error(`Client contract ${clientContractId} not found`);
      }

      const contractLines = await db('contract_lines')
        .where({ contract_id: clientContract.contract_id, tenant })
        .select('*');

      return contractLines;
    } catch (error) {
      console.error(`Error fetching contract lines for client contract ${clientContractId}:`, error);
      throw error;
    }
  },
};

export default ClientContract;
