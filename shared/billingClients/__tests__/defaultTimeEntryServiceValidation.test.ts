import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertValidClientDefaultTimeEntryService,
  assertValidTenantDefaultTimeEntryService,
  InvalidDefaultTimeEntryServiceError,
  isServiceApplicableToClient,
} from '../defaultTimeEntryServiceValidation';

type ServiceOwner = { tenant: string; activeHourly: boolean };

const state: {
  services: Record<string, ServiceOwner>;
  applicable: Set<string>;
  lastServiceFilters: Record<string, unknown> | null;
} = {
  services: {},
  applicable: new Set(),
  lastServiceFilters: null,
};

function makeQuery(name: string, tenant: string) {
  const filters: Record<string, unknown> = {};
  const builder: any = {
    where(next: unknown) {
      if (next && typeof next === 'object') {
        Object.assign(filters, next as Record<string, unknown>);
      }
      return builder;
    },
    whereNull() {
      return builder;
    },
    orWhere() {
      return builder;
    },
    select() {
      return builder;
    },
    async first() {
      if (name === 'service_catalog') {
        state.lastServiceFilters = { ...filters };
        const owner = state.services[String(filters.service_id)];
        // The real tenantDb facade applies the tenant predicate, and the query
        // itself restricts to active hourly services; model both here.
        return owner && owner.tenant === tenant && owner.activeHourly
          ? { service_id: filters.service_id }
          : null;
      }
      if (name === 'client_contracts') {
        const key = `${filters['client_contracts.client_id']}:${filters['contract_line_services.service_id']}`;
        return state.applicable.has(key) ? { contract_line_id: 'line-1' } : null;
      }
      return null;
    },
  };
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (name: string) => makeQuery(name, tenant),
    tenantJoin: () => undefined,
    unscoped: (name: string) => makeQuery(name, tenant),
  }),
}));

describe('default time-entry service write-time validation', () => {
  beforeEach(() => {
    state.services = {};
    state.applicable = new Set();
    state.lastServiceFilters = null;
  });

  it('accepts an active hourly service in the tenant', async () => {
    state.services['service-a'] = { tenant: 'tenant-1', activeHourly: true };

    await expect(
      assertValidTenantDefaultTimeEntryService({} as any, 'tenant-1', 'service-a')
    ).resolves.toBeUndefined();
  });

  it('rejects a missing or cross-tenant service', async () => {
    state.services['service-a'] = { tenant: 'tenant-1', activeHourly: true };

    await expect(
      assertValidTenantDefaultTimeEntryService({} as any, 'tenant-2', 'service-a')
    ).rejects.toMatchObject({
      name: 'InvalidDefaultTimeEntryServiceError',
      reason: 'not_active_hourly_service',
    });

    await expect(
      assertValidTenantDefaultTimeEntryService({} as any, 'tenant-1', 'does-not-exist')
    ).rejects.toBeInstanceOf(InvalidDefaultTimeEntryServiceError);
  });

  it('queries the catalog for a service item, hourly, and active only', async () => {
    state.services['service-a'] = { tenant: 'tenant-1', activeHourly: true };

    await assertValidTenantDefaultTimeEntryService({} as any, 'tenant-1', 'service-a');

    expect(state.lastServiceFilters).toMatchObject({
      service_id: 'service-a',
      item_kind: 'service',
      billing_method: 'hourly',
      is_active: true,
    });
  });

  it('rejects an inactive or non-hourly catalog item', async () => {
    state.services['service-inactive'] = { tenant: 'tenant-1', activeHourly: false };

    await expect(
      assertValidTenantDefaultTimeEntryService({} as any, 'tenant-1', 'service-inactive')
    ).rejects.toMatchObject({ reason: 'not_active_hourly_service' });

    await expect(
      assertValidClientDefaultTimeEntryService({} as any, 'tenant-1', 'client-1', 'service-inactive')
    ).rejects.toMatchObject({ reason: 'not_active_hourly_service' });
  });

  it('rejects a client default that the client has no active contract for', async () => {
    state.services['service-a'] = { tenant: 'tenant-1', activeHourly: true };
    // No applicable entry for client-1.

    await expect(
      assertValidClientDefaultTimeEntryService({} as any, 'tenant-1', 'client-1', 'service-a')
    ).rejects.toMatchObject({
      name: 'InvalidDefaultTimeEntryServiceError',
      reason: 'not_applicable_to_client',
    });
  });

  it('accepts a client default covered by the client contract', async () => {
    state.services['service-a'] = { tenant: 'tenant-1', activeHourly: true };
    state.applicable.add('client-1:service-a');

    await expect(
      assertValidClientDefaultTimeEntryService({} as any, 'tenant-1', 'client-1', 'service-a')
    ).resolves.toBeUndefined();
  });

  it('reports the catalog failure before applicability when the service is missing', async () => {
    await expect(
      assertValidClientDefaultTimeEntryService({} as any, 'tenant-1', 'client-1', 'missing-service')
    ).rejects.toMatchObject({ reason: 'not_active_hourly_service' });
  });

  it('reports applicability independently of the catalog check', async () => {
    state.services['service-a'] = { tenant: 'tenant-1', activeHourly: true };

    await expect(
      isServiceApplicableToClient({} as any, 'tenant-1', 'client-1', 'service-a')
    ).resolves.toBe(false);
  });
});
