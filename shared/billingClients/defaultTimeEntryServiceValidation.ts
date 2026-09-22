import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Write-time validation for the configurable default ticket time-entry service.
 *
 * The migration deliberately omits a foreign key (service_catalog is a
 * distributed table and services soft-deactivate), so the write paths must
 * reject a non-null default that would not resolve. Tenant defaults must be an
 * active hourly service in the authenticated tenant; client defaults must
 * additionally be covered by an active contract for that client.
 *
 * Resolution still re-validates candidates (see the scheduling resolver), so a
 * default that goes stale after it was saved is skipped then; these checks stop
 * obviously invalid values from being persisted and reported as saved.
 */

export type InvalidDefaultTimeEntryServiceReason =
  | 'not_active_hourly_service'
  | 'not_applicable_to_client';

export class InvalidDefaultTimeEntryServiceError extends Error {
  readonly reason: InvalidDefaultTimeEntryServiceReason;

  constructor(reason: InvalidDefaultTimeEntryServiceReason, message: string) {
    super(message);
    this.name = 'InvalidDefaultTimeEntryServiceError';
    this.reason = reason;
  }
}

const TENANT_SERVICE_REQUIREMENT =
  'The default time-entry service must be an active hourly service in this tenant.';
const CLIENT_SERVICE_REQUIREMENT =
  'The default time-entry service must be covered by an active contract for this client.';

function isNonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveEffectiveDateRange(effectiveDate?: string | Date): { rangeStart: string; rangeEnd: string } {
  const source =
    effectiveDate instanceof Date
      ? effectiveDate.toISOString()
      : typeof effectiveDate === 'string' && effectiveDate.trim().length > 0
        ? effectiveDate
        : new Date().toISOString();
  const normalizedDate = source.slice(0, 10);
  return {
    rangeStart: `${normalizedDate}T00:00:00.000Z`,
    rangeEnd: `${normalizedDate}T23:59:59.999Z`,
  };
}

/**
 * True when the service exists in the tenant catalog as an active hourly service.
 * The tenant predicate is applied by the `tenantDb` facade, so a service id from
 * another tenant never matches.
 */
export async function isActiveHourlyServiceInTenant(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  serviceId: string | null | undefined
): Promise<boolean> {
  if (!isNonEmptyId(serviceId)) return false;
  const row = await tenantDb(knexOrTrx, tenant)
    .table('service_catalog')
    .where({
      service_id: serviceId,
      item_kind: 'service',
      billing_method: 'hourly',
      is_active: true,
    })
    .first('service_id');
  return !!row;
}

/**
 * True when the client has an active contract line that explicitly covers the
 * service within the effective date window. Mirrors the resolution-time
 * `getEligibleContractLines` predicate: same joins and same exclusions.
 */
export async function isServiceApplicableToClient(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  serviceId: string | null | undefined,
  effectiveDate?: string | Date
): Promise<boolean> {
  if (!isNonEmptyId(clientId) || !isNonEmptyId(serviceId)) return false;
  const { rangeStart, rangeEnd } = resolveEffectiveDateRange(effectiveDate);
  const db = tenantDb(knexOrTrx, tenant);
  const query = db.table('client_contracts');
  db.tenantJoin(query, 'contracts', 'client_contracts.contract_id', 'contracts.contract_id');
  db.tenantJoin(query, 'contract_lines', 'contracts.contract_id', 'contract_lines.contract_id');
  db.tenantJoin(query, 'contract_line_services', 'contract_lines.contract_line_id', 'contract_line_services.contract_line_id');

  const row = await query
    .where({
      'client_contracts.client_id': clientId,
      'client_contracts.is_active': true,
      'contract_line_services.service_id': serviceId,
    })
    .where('client_contracts.start_date', '<=', rangeEnd)
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('client_contracts.end_date').orWhere('client_contracts.end_date', '>=', rangeStart);
    })
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('contracts.is_system_managed_default').orWhere('contracts.is_system_managed_default', false);
    })
    .select('contract_lines.contract_line_id')
    .first();

  return !!row;
}

/**
 * Throws `InvalidDefaultTimeEntryServiceError` when the value is not an active
 * hourly service in the tenant. Null/undefined are out of scope (clearing).
 */
export async function assertValidTenantDefaultTimeEntryService(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  serviceId: string | null | undefined
): Promise<void> {
  if (await isActiveHourlyServiceInTenant(knexOrTrx, tenant, serviceId)) return;
  throw new InvalidDefaultTimeEntryServiceError(
    'not_active_hourly_service',
    TENANT_SERVICE_REQUIREMENT
  );
}

/**
 * Throws when the value is not an active hourly service in the tenant, or is
 * not covered by an active contract for the given client.
 */
export async function assertValidClientDefaultTimeEntryService(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  serviceId: string | null | undefined
): Promise<void> {
  if (!(await isActiveHourlyServiceInTenant(knexOrTrx, tenant, serviceId))) {
    throw new InvalidDefaultTimeEntryServiceError(
      'not_active_hourly_service',
      TENANT_SERVICE_REQUIREMENT
    );
  }
  if (!(await isServiceApplicableToClient(knexOrTrx, tenant, clientId, serviceId))) {
    throw new InvalidDefaultTimeEntryServiceError(
      'not_applicable_to_client',
      CLIENT_SERVICE_REQUIREMENT
    );
  }
}
