'use server';

import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { revalidatePath } from 'next/cache';
import {
  IContractLineUnitPricingRevision,
  IContractLineUnitPricingRevisionInput,
  IContractLineUnitPricingRevisionHistoryEntry,
  type IUserWithRoles,
} from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  listRecurringUnitPricingHistory,
  listRecurringUnitPricingRevisions as listRecurringUnitPricingRevisionsInTransaction,
  resolveRecurringUnitDisplayPricing,
  scheduleRecurringUnitRevisionInTransaction,
  type IRecurringUnitPricingRevisionListRow,
} from '../lib/billing/seatRevisions';
import {
  resolveRecurringUnitKind,
  type RecurringUnitKind,
} from '@alga-psa/shared/billingClients/recurringUnitPricing';

type UnitPricingActionError = ActionMessageError | ActionPermissionError;
type AuthUser = IUserWithRoles;

/**
 * Server boundary for scheduling recurring quantity/price changes on
 * unit-priced Fixed services and catalog products.
 *
 * A change is stored as a prospective revision effective at an explicit
 * service-period boundary (contract_line_unit_pricing_revisions). Periods
 * whose covered start is at/after that date bill the revision; earlier periods
 * keep the configuration columns and are never rewritten — they remain
 * immutable once billed because the engine never recomputes them.
 *
 * Guards:
 *  - quantity is a whole number >= 0 (zero is an explicit stop, never a
 *    fallback to one);
 *  - the target must be a catalog product or an explicitly unit-priced service
 *    on a Fixed line;
 *  - the effective boundary must not fall inside a period that is already
 *    billed or locked (finalizing);
 *  - replacing an existing pending boundary with an expected version performs a
 *    compare-and-set; a stale version is rejected and the superseded edit is
 *    preserved in append-only history.
 */
function toActionError(error: unknown): UnitPricingActionError {
  if (error instanceof Error && error.message.startsWith('Permission denied:')) {
    return permissionError(error.message);
  }
  const dbError = error as { code?: string };
  if (dbError?.code === '22P02') {
    return actionError('The selected contract line, service, or date is invalid.');
  }
  if (dbError?.code === '23505') {
    return actionError(
      'Another change was created or replaced at this effective date by someone else. Reload the period and review the newer values before saving.',
    );
  }
  throw error;
}

async function detectRecurringUnitKind(
  conn: Knex,
  tenant: string,
  input: { contract_line_id: string; service_id: string; config_id: string },
): Promise<RecurringUnitKind | null> {
  const db = tenantDb(conn, tenant);
  const row = await db
    .table('contract_line_service_configuration as clsc')
    .leftJoin('contract_line_service_fixed_config as fc', function () {
      this.on('fc.config_id', '=', 'clsc.config_id').andOn('fc.tenant', '=', 'clsc.tenant');
    })
    .leftJoin('service_catalog as sc', function () {
      this.on('sc.service_id', '=', 'clsc.service_id').andOn('sc.tenant', '=', 'clsc.tenant');
    })
    .where({
      'clsc.tenant': tenant,
      'clsc.contract_line_id': input.contract_line_id,
      'clsc.service_id': input.service_id,
      'clsc.config_id': input.config_id,
    })
    .first<{
      configuration_type: string | null;
      pricing_basis: string | null;
      item_kind: string | null;
    }>({
      configuration_type: 'clsc.configuration_type',
      pricing_basis: 'fc.pricing_basis',
      item_kind: 'sc.item_kind',
    });
  if (!row) return null;
  return resolveRecurringUnitKind({
    configurationType: row.configuration_type,
    pricingBasis: row.pricing_basis,
    itemKind: row.item_kind,
  });
}

async function scheduleRecurringUnitPricingRevisionImpl(
  user: AuthUser,
  tenant: string,
  input: IContractLineUnitPricingRevisionInput,
): Promise<IContractLineUnitPricingRevision | UnitPricingActionError> {
  if (!(await hasPermission(user, 'billing', 'update'))) {
    return permissionError('Permission denied: billing update required');
  }
  const quantity = Number(input.quantity);
  const pricePolicy = input.price_policy ?? 'override';
  const effective = String(input.effective_period_start);
  if (!Number.isInteger(quantity) || quantity < 0) {
    return actionError('Quantity must be a whole number of 0 or more.');
  }
  if (pricePolicy !== 'override' && pricePolicy !== 'catalog') {
    return actionError('Price policy must be either an explicit override or catalog inheritance.');
  }
  if (pricePolicy === 'override') {
    const unitRateCents = Number(input.unit_rate_cents);
    if (!Number.isFinite(unitRateCents) || unitRateCents < 0 || !Number.isInteger(unitRateCents)) {
      return actionError('Unit rate must be a whole number of minor units (cents) of 0 or more.');
    }
  } else if (input.unit_rate_cents !== null && input.unit_rate_cents !== undefined) {
    return actionError('Catalog inheritance stores no unit rate; omit the override amount or choose explicit pricing.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
    return actionError('Effective date must be a calendar date (YYYY-MM-DD) at a service-period boundary.');
  }

  try {
    const { knex } = await createTenantKnex();
    const kind =
      input.kind ??
      (await detectRecurringUnitKind(knex, tenant, {
        contract_line_id: input.contract_line_id,
        service_id: input.service_id,
        config_id: input.config_id,
      }));
    if (!kind) {
      return actionError('The selected item is not a recurring product or unit-priced service on this contract line.');
    }
    const result = await knex.transaction(async (trx) => {
      const scheduled = await scheduleRecurringUnitRevisionInTransaction({
        trx,
        tenant,
        userId: user.user_id ?? null,
        contractLineId: input.contract_line_id,
        serviceId: input.service_id,
        configId: input.config_id,
        kind,
        quantity,
        pricePolicy,
        unitRateCents: pricePolicy === 'override' ? Number(input.unit_rate_cents) : null,
        effectivePeriodStart: effective,
        // Preserve the caller's explicit expectation: `null` means "I saw no
        // revision at this boundary", `undefined` (omitted) means a legacy
        // unconditional writer, a number is a compare-and-set token.
        expectedVersion: input.expected_version,
      });
      if (scheduled.ok === false) {
        return actionError(scheduled.error);
      }
      return scheduled.revision;
    });

    revalidatePath('/msp/billing');
    return result;
  } catch (error) {
    return toActionError(error);
  }
}

async function getEffectiveRecurringUnitPricingImpl(
  user: AuthUser,
  tenant: string,
  input: { contract_line_id: string; service_id: string; config_id: string; service_period_start: string },
): Promise<EffectiveRecurringUnitPricingReadResult | UnitPricingActionError> {
  if (!(await hasPermission(user, 'billing', 'read'))) {
    return permissionError('Permission denied: billing read required');
  }
  try {
    const { knex } = await createTenantKnex();
    const kind = await detectRecurringUnitKind(knex, tenant, {
      contract_line_id: input.contract_line_id,
      service_id: input.service_id,
      config_id: input.config_id,
    });
    if (!kind) {
      return actionError('The selected item is not a recurring product or unit-priced service on this contract line.');
    }
    const effective = await resolveRecurringUnitDisplayPricing({
      trx: knex as unknown as Knex.Transaction,
      tenant,
      contractLineId: input.contract_line_id,
      serviceId: input.service_id,
      configId: input.config_id,
      kind,
      boundary: String(input.service_period_start),
    });
    return { kind, ...effective };
  } catch (error) {
    return toActionError(error);
  }
}

async function listRecurringUnitPricingRevisionHistoryImpl(
  user: AuthUser,
  tenant: string,
  input: { contract_line_id: string; service_id: string; config_id: string },
): Promise<IContractLineUnitPricingRevisionHistoryEntry[] | UnitPricingActionError> {
  if (!(await hasPermission(user, 'billing', 'read'))) {
    return permissionError('Permission denied: billing read required');
  }
  try {
    const { knex } = await createTenantKnex();
    const rows = await listRecurringUnitPricingHistory({
      trx: knex,
      tenant,
      contractLineId: input.contract_line_id,
      serviceId: input.service_id,
      configId: input.config_id,
    });
    return rows as unknown as IContractLineUnitPricingRevisionHistoryEntry[];
  } catch (error) {
    return toActionError(error);
  }
}

async function listRecurringUnitPricingRevisionsImpl(
  user: AuthUser,
  tenant: string,
  input: { contract_line_id: string; service_id: string; config_id: string },
): Promise<IRecurringUnitPricingRevisionListRow[] | UnitPricingActionError> {
  if (!(await hasPermission(user, 'billing', 'read'))) {
    return permissionError('Permission denied: billing read required');
  }
  try {
    const { knex } = await createTenantKnex();
    return await listRecurringUnitPricingRevisionsInTransaction({
      trx: knex,
      tenant,
      contractLineId: input.contract_line_id,
      serviceId: input.service_id,
      configId: input.config_id,
    });
  } catch (error) {
    return toActionError(error);
  }
}

export interface EffectiveRecurringUnitPricingReadResult {
  kind: RecurringUnitKind;
  quantity: number;
  pricePolicy: 'override' | 'catalog';
  unitRateCents: number | null;
  source: 'baseline' | 'revision';
  revisionId: string | null;
  version: number | null;
  effectivePeriodStart: string | null;
  /** Resolved currency/period catalog rate for display (null for N/A). */
  resolvedUnitRateCents?: number | null;
  catalogPriceId?: string | null;
  catalogEffectiveDate?: string | null;
  coveredStart?: string;
  coveredEnd?: string | null;
  protectedLifecycle?: string | null;
  currencyCode?: string;
  baselineQuantity?: number;
  baselineUnitRateCents?: number | null;
}

export const scheduleRecurringUnitPricingRevision = withAuth(
  async (user, { tenant }, input: IContractLineUnitPricingRevisionInput) =>
    scheduleRecurringUnitPricingRevisionImpl(user, tenant, input),
);

/**
 * Backwards-compatible seat entry point. Unit-priced services keep explicit
 * override pricing; products should call `scheduleRecurringUnitPricingRevision`
 * so they can also express catalog inheritance.
 */
export const scheduleUnitPricingRevision = withAuth(
  async (user, { tenant }, input: IContractLineUnitPricingRevisionInput) =>
    scheduleRecurringUnitPricingRevisionImpl(user, tenant, {
      ...input,
      kind: input.kind ?? 'service',
      price_policy: input.price_policy ?? 'override',
    }),
);

export const getEffectiveRecurringUnitPricing = withAuth(
  async (
    user,
    { tenant },
    input: { contract_line_id: string; service_id: string; config_id: string; service_period_start: string },
  ) => getEffectiveRecurringUnitPricingImpl(user, tenant, input),
);

/**
 * Backwards-compatible seat read. Returns `unit_rate_cents` only for explicit
 * overrides; catalog items report null plus the policy.
 */
export const getEffectiveUnitPricing = withAuth(
  async (
    user,
    { tenant },
    input: { contract_line_id: string; service_id: string; config_id: string; service_period_start: string },
  ) => getEffectiveRecurringUnitPricingImpl(user, tenant, input),
);

/**
 * Canonical scheduled revisions for a configuration, earliest boundary first,
 * so the scheduler can show the full effective-period history alongside the
 * point-in-time effective read.
 */
export const listRecurringUnitPricingRevisions = withAuth(
  async (
    user,
    { tenant },
    input: { contract_line_id: string; service_id: string; config_id: string },
  ) => listRecurringUnitPricingRevisionsImpl(user, tenant, input),
);

/**
 * Append-only log of superseded pending edits for a configuration, newest
 * first, so replacing a scheduled boundary does not lose who changed what.
 */
export const listRecurringUnitPricingRevisionHistory = withAuth(
  async (
    user,
    { tenant },
    input: { contract_line_id: string; service_id: string; config_id: string },
  ) => listRecurringUnitPricingRevisionHistoryImpl(user, tenant, input),
);
