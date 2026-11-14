import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROLE_CAPABILITIES } from '../../../../../packages/auth/src/lib/permissionCapabilities';
import {
  CO_MANAGED_SEAT_ROLE,
  CO_MANAGED_SEAT_ROLE_CAPABILITY,
  CO_MANAGED_SEAT_ROLE_DESCRIPTION,
  CO_MANAGED_SEAT_ROLE_GRANTS,
} from '../../../../../packages/co-managed/src/seatRole';

/**
 * The seat role (co-managed seat shape, F019) is declared three times: in the permission
 * catalog, which synchronization reads; in `@alga-psa/co-managed`, which seeds it at admission;
 * and in `@alga-psa/auth`, which hides it from tenants not served. These pin the three together
 * and hold the role to operational work.
 */
const require = createRequire(import.meta.url);
const permissions = path.resolve(__dirname, '../../../../migrations/utils/permissions');
const catalog = require(path.join(permissions, 'catalog.cjs'));
const roleGrants = require(path.join(permissions, 'roleGrants.cjs'));
const { buildCatalogPlan } = require(path.join(permissions, 'syncPermissionCatalog.cjs'));
const { collectCatalogErrors } = require(path.join(permissions, 'catalogValidation.cjs'));
const { summarizePlan } = require(path.join(permissions, 'auditPermissionCatalog.cjs'));

const SEAT_KEY = 'msp:Seat Technician';
const seatRole = roleGrants.CAPABILITY_ROLES.psa.find((role: any) => role.key === SEAT_KEY);
const TENANT = '11111111-1111-1111-1111-111111111111';

/**
 * Every MSP-scoped resource of the PSA catalog, by what it is for. A resource added to the
 * catalog fails the classification test below until someone decides where it belongs, so the
 * seat role cannot pick up a commercial or administrative permission by omission.
 */
const RESOURCE_CATEGORIES: Record<string, 'operational' | 'sales' | 'billing' | 'accounting' | 'settings' | 'user-administration' | 'withheld'> = {
  asset: 'operational', canned_response: 'operational', client: 'operational', contact: 'operational',
  document: 'operational', project: 'operational', project_task: 'operational', tag: 'operational',
  ticket: 'operational', time_entry: 'operational', time_sheet: 'operational',

  marketing: 'sales', opportunities: 'sales', quotes: 'sales', sales_order: 'sales',

  billing: 'billing', 'billing.recurring_service_periods': 'billing', billing_profile_report: 'billing',
  billing_settings: 'billing', credit: 'billing', invoice: 'billing', service: 'billing', tax: 'billing',

  accounting_integrations: 'accounting', financial: 'accounting', purchase_order: 'accounting',
  vendor: 'accounting', vendor_bill: 'accounting',

  account_management: 'settings', co_management: 'settings', email: 'settings', extension: 'settings', import_export: 'settings',
  inbound_webhook: 'settings', notification: 'settings', priority: 'settings', secrets: 'settings',
  security_settings: 'settings', settings: 'settings', sla_policy: 'settings', storage: 'settings',
  system_settings: 'settings', ticket_settings: 'settings', user_settings: 'settings', workflow: 'settings',

  service_principal: 'user-administration', team: 'user-administration', user: 'user-administration',
  user_schedule: 'user-administration',

  // Not one of the five closed categories, and not seat work either.
  credential: 'withheld', cycle_count: 'withheld', interaction: 'withheld', inventory: 'withheld', job: 'withheld',
  list_view: 'withheld', recurring_ticket: 'withheld', reports: 'withheld', rmm: 'withheld',
  stock_location: 'withheld', stock_transfer: 'withheld', technician_dispatch: 'withheld',
  ticket_template: 'withheld', time_period: 'withheld', warranty: 'withheld',
};

const mspPermissions = catalog.getProductPermissions('psa', { capabilities: ['co-managed', 'co-managed-seat'] })
  .filter((entry: any) => entry.msp === true);

describe('the seat role in the permission catalog', () => {
  it('is a capability role of psa only, tagged co-managed-seat, and valid', () => {
    expect(collectCatalogErrors()).toEqual([]);
    expect(seatRole).toMatchObject({ roleName: 'Seat Technician', msp: true, client: false, capabilities: ['co-managed-seat'] });
    expect(roleGrants.getCapabilityRoles('co_managed')).toEqual([]);
    expect(roleGrants.getCapabilityRoles('algadesk')).toEqual([]);
  });

  it('agrees with the co-managed and auth constants', () => {
    expect({ role_name: seatRole.roleName, msp: seatRole.msp, client: seatRole.client }).toEqual(CO_MANAGED_SEAT_ROLE);
    expect(seatRole.description).toBe(CO_MANAGED_SEAT_ROLE_DESCRIPTION);
    expect(seatRole.capabilities).toEqual([CO_MANAGED_SEAT_ROLE_CAPABILITY]);
    expect([...seatRole.grants].sort()).toEqual([...CO_MANAGED_SEAT_ROLE_GRANTS].sort());
    expect(new Set(seatRole.grants).size).toBe(seatRole.grants.length);
    const catalogRoles = Object.values(roleGrants.CAPABILITY_ROLES).flat()
      .map((role: any) => [role.key, role.capabilities[0]]);
    expect(Object.entries(ROLE_CAPABILITIES).sort()).toEqual(catalogRoles.sort());
  });

  it('classifies every MSP resource of the catalog', () => {
    const resources = [...new Set(mspPermissions.map((entry: any) => entry.resource))].sort();
    expect(resources.filter((resource: any) => !(resource in RESOURCE_CATEGORIES))).toEqual([]);
  });

  it('holds operational permissions and none for sales, billing, accounting, settings or user administration', () => {
    const compiled = roleGrants.compileRoleGrants('psa').get(SEAT_KEY);
    // Every declared grant resolved to a real MSP-only permission.
    expect(compiled.identities).toHaveLength(seatRole.grants.length);
    expect(compiled.identities.length).toBeGreaterThan(0);
    for (const identity of compiled.identities) {
      const [resource, , msp, client] = identity.split('|');
      expect(RESOURCE_CATEGORIES[resource], identity).toBe('operational');
      expect([msp, client], identity).toEqual(['msp', '-']);
    }
    // Deleting, approving and administering stay with the MSP even on operational resources.
    const actions = new Set(seatRole.grants.map((grant: string) => grant.split(':')[1]));
    expect([...actions].filter((action) => !['read', 'create', 'update', 'submit', 'delete'].includes(action as string))).toEqual([]);
    expect(seatRole.grants.filter((grant: string) => grant.endsWith(':delete'))).toEqual(['time_entry:delete']);
  });

  it('is never created by a product seed or granted by the string-keyed seed view', () => {
    for (const product of catalog.PRODUCTS) {
      expect(roleGrants.getDefaultRoles(product).some((role: any) => role.roleName === 'Seat Technician')).toBe(false);
      expect(roleGrants.knownRoleKeys(product)).not.toContain(SEAT_KEY);
      expect(Object.keys(roleGrants.compileLegacyRoleGrants(product).msp)).not.toContain('Seat Technician');
    }
  });

  it('is skipped silently by synchronization where the tenant does not have it, and granted where it does', () => {
    const roles = roleGrants.getDefaultRoles('psa').filter((role: any) => !role.legacy).map((role: any, index: number) => ({
      tenant: TENANT, role_id: `role-${index}`, role_name: role.roleName, msp: role.msp, client: role.client,
    }));
    const without = buildCatalogPlan({ tenantId: TENANT, product: 'psa', permissions: [], roles, rolePermissions: [] });
    expect(without.errors).toEqual([]);
    expect(without.roleResolution.find((role: any) => role.roleKey === SEAT_KEY).status).toBe('capability-absent');
    expect(without.missingGrants.some((grant: any) => grant.roleKey === SEAT_KEY)).toBe(false);
    expect(summarizePlan(without).unresolvedRoles.some((role: any) => role.roleKey === SEAT_KEY)).toBe(false);

    const seat = { tenant: TENANT, role_id: 'seat', role_name: 'Seat Technician', msp: true, client: false };
    const withRole = buildCatalogPlan({ tenantId: TENANT, product: 'psa', permissions: [], roles: [...roles, seat], rolePermissions: [] });
    expect(withRole.roleResolution.find((role: any) => role.roleKey === SEAT_KEY)).toEqual({ roleKey: SEAT_KEY, status: 'resolved', roleId: 'seat' });
    expect(withRole.missingGrants.find((grant: any) => grant.roleKey === SEAT_KEY).identities).toHaveLength(seatRole.grants.length);
    expect(withRole.customRoles).toBe(without.customRoles);
  });
});
