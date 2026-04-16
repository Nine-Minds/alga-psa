import type { IClientContract } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import type { Knex } from 'knex';
import {
  createClientContractAssignment,
  deriveClientContractStatus,
  updateClientContractAssignment,
} from '@alga-psa/shared/billingClients';
import { normalizeLiveRecurringStorage } from '@alga-psa/shared/billingClients/recurrenceStorageModel';

type RenewalMode = NonNullable<IClientContract['renewal_mode']>;

const DEFAULT_RENEWAL_MODE: RenewalMode = 'manual';
const DEFAULT_NOTICE_PERIOD_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_ABSOLUTE_DAYS_UNTIL_DUE = 36500;

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

const computeEvergreenCycleBounds = (params: {
  startDate: string;
  now?: string | Date;
}): { cycleStart: string; cycleEnd: string } | undefined => {
  const normalizedStartDate = normalizeDateOnly(params.startDate);
  if (!normalizedStartDate) return undefined;

  const start = new Date(`${normalizedStartDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return undefined;

  const anchorDate = computeNextEvergreenReviewAnchorDate({
    startDate: normalizedStartDate,
    now: params.now,
  });
  if (!anchorDate) return undefined;

  const anchor = new Date(`${anchorDate}T00:00:00.000Z`);
  if (Number.isNaN(anchor.getTime())) return undefined;

  const previousAnchor = createClampedUtcDate(
    anchor.getUTCFullYear() - 1,
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const cycleStartDate = previousAnchor.getTime() < start.getTime() ? start : previousAnchor;

  return {
    cycleStart: cycleStartDate.toISOString().slice(0, 10),
    cycleEnd: anchorDate,
  };
};

const computeDaysUntilDate = (params: {
  targetDate: string;
  now?: string | Date;
}): number | undefined => {
  const normalizedTargetDate = normalizeDateOnly(params.targetDate);
  if (!normalizedTargetDate) return undefined;

  const target = new Date(`${normalizedTargetDate}T00:00:00.000Z`);
  if (Number.isNaN(target.getTime())) return undefined;

  const normalizedNow = normalizeDateOnly(params.now instanceof Date ? params.now.toISOString() : params.now);
  const nowBase = normalizedNow
    ? new Date(`${normalizedNow}T00:00:00.000Z`)
    : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  if (Number.isNaN(nowBase.getTime())) return undefined;

  const rawDaysUntilDue = Math.round((target.getTime() - nowBase.getTime()) / MS_PER_DAY);
  if (!Number.isFinite(rawDaysUntilDue)) return undefined;

  return Math.max(
    -MAX_ABSOLUTE_DAYS_UNTIL_DUE,
    Math.min(MAX_ABSOLUTE_DAYS_UNTIL_DUE, rawDaysUntilDue)
  );
};

const RENEWAL_DEFAULT_SELECTIONS = [
  'dbs.default_renewal_mode as tenant_default_renewal_mode',
  'dbs.default_notice_period_days as tenant_default_notice_period_days',
];

const validateContractOwnershipForClient = (params: {
  contract: {
    contract_id?: string;
    is_template?: boolean | null;
    owner_client_id?: string | null;
  } | undefined;
  contractId: string;
  clientId: string;
}): void => {
  const contract = params.contract;
  if (!contract) {
    throw new Error(`Contract ${params.contractId} not found or inactive`);
  }

  if (contract.is_template === true) {
    return;
  }

  const ownerClientId =
    typeof contract.owner_client_id === 'string' && contract.owner_client_id.trim().length > 0
      ? contract.owner_client_id.trim()
      : null;

  if (!ownerClientId) {
    throw new Error(`Contract ${params.contractId} must have an owning client before it can be assigned`);
  }

  if (ownerClientId !== params.clientId) {
    throw new Error(
      `Contract ${params.contractId} belongs to a different client and cannot be assigned to client ${params.clientId}`
    );
  }
};

const withRenewalDefaultsJoin = (
  query: Knex.QueryBuilder
): Knex.QueryBuilder => {
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
  const isInactiveAssignment = normalized.is_active !== true;
  const shouldSkipForLifecycleState = isInactiveAssignment;
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
  if (normalizedEndDate && normalizedStartDate) {
    normalized.renewal_cycle_start = normalizedStartDate;
    normalized.renewal_cycle_end = normalizedEndDate;
  } else if (!normalizedEndDate && normalizedStartDate && normalized.evergreen_review_anchor_date) {
    const evergreenCycleBounds = computeEvergreenCycleBounds({ startDate: normalizedStartDate });
    normalized.renewal_cycle_start = evergreenCycleBounds?.cycleStart;
    normalized.renewal_cycle_end = evergreenCycleBounds?.cycleEnd;
  } else {
    normalized.renewal_cycle_start = undefined;
    normalized.renewal_cycle_end = undefined;
  }
  normalized.renewal_cycle_key = normalized.decision_due_date
    ? normalizedEndDate
      ? normalized.renewal_cycle_end
        ? `fixed-term:${normalized.renewal_cycle_end as string}`
        : undefined
      : normalized.renewal_cycle_end
        ? `evergreen:${normalized.renewal_cycle_end as string}`
        : undefined
    : undefined;
  normalized.days_until_due = normalized.decision_due_date
    ? computeDaysUntilDate({ targetDate: normalized.decision_due_date as string })
    : undefined;
  normalized.assignment_status = deriveClientContractStatus({
    isActive: normalized.is_active === true,
    startDate: normalizedStartDate ?? null,
    endDate: normalizedEndDate ?? null,
  });

  delete normalized.tenant_default_renewal_mode;
  delete normalized.tenant_default_notice_period_days;

  return normalized as unknown as IClientContract;
};

const dedupeClientContractsByRenewalCycle = (rows: IClientContract[]): IClientContract[] => {
  const deduped = new Map<string, IClientContract>();

  for (const row of rows) {
    const cycleKey = row.renewal_cycle_key;
    if (!cycleKey) {
      deduped.set(`${row.tenant}:${row.client_contract_id}`, row);
      continue;
    }

    const dedupeKey = `${row.tenant}:${row.client_contract_id}:${cycleKey}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, row);
    }
  }

  return [...deduped.values()];
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
      const baseQuery = db('client_contracts as cc')
        .leftJoin('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({ 'cc.client_id': clientId, 'cc.tenant': tenant })
        .orderBy('cc.start_date', 'desc');

      const rows = await withRenewalDefaultsJoin(baseQuery).select([
        'cc.*',
        'c.billing_frequency as contract_billing_frequency',
        'c.status as contract_status',
        ...RENEWAL_DEFAULT_SELECTIONS,
      ]);

      return dedupeClientContractsByRenewalCycle(rows.map(normalizeClientContract));
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

      const rows = await withRenewalDefaultsJoin(baseQuery).select([
        'cc.*',
        'c.billing_frequency as contract_billing_frequency',
        'c.status as contract_status',
        ...RENEWAL_DEFAULT_SELECTIONS,
      ]);

      return dedupeClientContractsByRenewalCycle(rows.map(normalizeClientContract));
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
      const baseQuery = db('client_contracts as cc')
        .leftJoin('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({ 'cc.client_contract_id': clientContractId, 'cc.tenant': tenant });

      const row = await withRenewalDefaultsJoin(baseQuery)
        .select([
          'cc.*',
          'c.billing_frequency as contract_billing_frequency',
          'c.status as contract_status',
          ...RENEWAL_DEFAULT_SELECTIONS,
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
      const baseQuery = db('client_contracts as cc')
        .join('contracts as c', function joinContracts() {
          this.on('cc.contract_id', '=', 'c.contract_id').andOn('cc.tenant', '=', 'c.tenant');
        })
        .where({ 'cc.client_contract_id': clientContractId, 'cc.tenant': tenant });

      const clientContract = await withRenewalDefaultsJoin(baseQuery).select(
        [
          'cc.*',
          'c.contract_name',
          'c.contract_description',
          'c.billing_frequency as contract_billing_frequency',
          'c.status as contract_status',
          ...RENEWAL_DEFAULT_SELECTIONS,
        ]
      )
        .first();

      if (!clientContract) {
        return null;
      }

      const normalized = normalizeClientContract(clientContract) as any;

      const assignmentContractLines = await db('client_contracts as cc')
        .join('contract_lines as cl', function joinContractLines() {
          this.on('cc.contract_id', '=', 'cl.contract_id').andOn('cc.tenant', '=', 'cl.tenant');
        })
        .where({
          'cc.client_contract_id': clientContractId,
          'cc.tenant': tenant,
          'cl.is_active': true,
        })
        .distinct('cl.contract_line_id', 'cl.contract_line_name')
        .select('cl.contract_line_name');

      normalized.contract_line_names = assignmentContractLines.map((line) => line.contract_line_name);
      normalized.contract_line_count = assignmentContractLines.length;

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
    renewalSettings: Pick<
      IClientContract,
      'renewal_mode' | 'notice_period_days' | 'renewal_term_months' | 'use_tenant_renewal_defaults'
    > | undefined,
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
        throw new Error(`Client ${clientId} not found`);
      }

      const contractExists = await db('contracts')
        .where({ contract_id: contractId, tenant, is_active: true })
        .first();

      validateContractOwnershipForClient({
        contract: contractExists,
        contractId,
        clientId,
      });

      return await createClientContractAssignment(db, tenant, {
        client_id: clientId,
        contract_id: contractId,
        template_contract_id: null,
        start_date: startDate,
        end_date: endDate,
        is_active: true,
        use_tenant_renewal_defaults: renewalSettings?.use_tenant_renewal_defaults,
        renewal_mode:
          renewalSettings?.renewal_mode === 'none' ||
          renewalSettings?.renewal_mode === 'manual' ||
          renewalSettings?.renewal_mode === 'auto'
            ? renewalSettings.renewal_mode
            : undefined,
        notice_period_days:
          typeof renewalSettings?.notice_period_days === 'number' &&
          Number.isFinite(renewalSettings.notice_period_days) &&
          renewalSettings.notice_period_days >= 0
            ? Math.floor(renewalSettings.notice_period_days)
            : undefined,
        renewal_term_months:
          typeof renewalSettings?.renewal_term_months === 'number' &&
          Number.isFinite(renewalSettings.renewal_term_months) &&
          renewalSettings.renewal_term_months > 0
            ? Math.floor(renewalSettings.renewal_term_months)
            : undefined,
      });
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
        created_at: undefined,
        updated_at: new Date().toISOString(),
      };

      if (updateData.contract_id && updateData.contract_id !== existing.contract_id) {
        const nextContract = await db('contracts')
          .where({ contract_id: updateData.contract_id, tenant })
          .first();

        validateContractOwnershipForClient({
          contract: nextContract,
          contractId: updateData.contract_id,
          clientId: existing.client_id,
        });

        throw new Error('Changing the contract header for an existing assignment is not supported');
      }

      sanitized.contract_id = undefined;

      if (updateData.start_date !== undefined && updateData.start_date !== existing.start_date) {
        const contract = await db('contracts')
          .where({ contract_id: existing.contract_id, tenant })
          .first();

        if (contract && contract.is_active) {
          throw new Error('Start date cannot be changed for active contracts. Set the contract to draft first.');
        }
      }

      return await updateClientContractAssignment(db, tenant, clientContractId, sanitized);
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

      return contractLines.map((line) => normalizeLiveRecurringStorage(line));
    } catch (error) {
      console.error(`Error fetching contract lines for client contract ${clientContractId}:`, error);
      throw error;
    }
  },
};

export default ClientContract;
