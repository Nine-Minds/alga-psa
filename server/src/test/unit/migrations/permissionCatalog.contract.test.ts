/**
 * The other direction of the catalog guard.
 *
 * permissionCatalog.test.ts proves no catalog entry ships without a call site.
 * This file proves the converse: no literal `hasPermission(user, 'x', 'y')` in
 * production code checks a permission the catalog never provisions — the shape
 * of the invoice:credit gap, where a documented endpoint returned 403 for
 * everyone because no tenant had ever been given the permission.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../../../..');
const permissionsDir = path.join(repoRoot, 'server/migrations/utils/permissions');
const { ACTIVE_PERMISSIONS } = require(path.join(permissionsDir, 'catalog.cjs'));
const { ALL_MSP, compileLegacyRoleGrants } = require(path.join(permissionsDir, 'roleGrants.cjs'));

const FOLLOW_UP_CARD = '63db81a4-76cf-4486-aca3-a09f7c02efb1';

/**
 * Enforced but never provisioned — a real 403 for every tenant, tracked by its
 * own card. Never extend this list: a new permission goes in the catalog.
 *
 * Six entries left it when the 2026-08-27 usage audit promoted
 * billing_profile_report:read, credential:read, cycle_count:approve,
 * import_export:manage, import_export:read and marketing:manage into the
 * catalog. billing:manage then left it once the Xero CSV export/import routes
 * moved to the granular accounting_integrations:exports_execute permission and
 * no production code checked billing:manage any longer. tenant.create left it
 * when tenant provisioning moved onto the master-tenant gate
 * (system_settings:update) with the GHSA-v72r-pvf8-6cq2 fix. role.read left it
 * when the API admin permissions (metadata:read, role:*, webhook:*) were
 * provisioned by 20261115120000_add_api_admin_permissions.
 */
const KNOWN_UNDECLARED = [
  'user.admin',
  'user_schedule.read_all',
] as const;

/**
 * Controller options whose effective resource (`permissionResource ?? resource`)
 * has no catalog entry, so the base checkPermission denies every caller. Found
 * when the contract test started scanning controller options; tracked as
 * follow-up and deliberately NOT provisioned alongside the API admin fix.
 * `permission` (GET/POST /api/v1/rbac/permissions) is the closest neighbour of
 * `role` and the most important of the four. Never extend this list: a new
 * resource goes in the catalog. board, status, email_template, quote, stopwatch,
 * service_category and ticket_category are not here: the first two override
 * checkPermission onto `ticket`, the next three set permissionResource, and the
 * last two are search-filter payloads rather than permission checks.
 */
const KNOWN_UNDECLARED_CONTROLLER_RESOURCES = [
  'category',
  'country',
  'search',
] as const;

/**
 * Literal `this.checkPermission(req, '<action>')` calls in ApiInvoiceController
 * whose `invoice:<action>` pair the catalog never provisions, so the endpoint
 * 403s for every caller (Admin included). Found by the exact-pair controller
 * scan; tracked as follow-up and NOT provisioned alongside the API admin fix.
 * Never extend this list: a new permission goes in the catalog.
 *
 * invoice.payment left it when the MSP "Record payment" action landed and
 * 20261117120000_add_invoice_payment_permission provisioned the pair.
 */
const KNOWN_UNDECLARED_CONTROLLER_PAIRS = [
  'ApiInvoiceController.ts: invoice.analytics',
  'ApiInvoiceController.ts: invoice.approve',
  'ApiInvoiceController.ts: invoice.billing',
  'ApiInvoiceController.ts: invoice.bulk_credit',
  'ApiInvoiceController.ts: invoice.bulk_delete',
  'ApiInvoiceController.ts: invoice.bulk_send',
  'ApiInvoiceController.ts: invoice.bulk_update',
  'ApiInvoiceController.ts: invoice.recurring',
  'ApiInvoiceController.ts: invoice.reject',
] as const;

const productionRoots = ['server/src', 'packages', 'shared', 'ee'];
const excludedPath = /(?:^|\/)(?:__tests__|test|tests|testing|mocks|e2e|dist|node_modules)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/;

function productionPermissionCalls(resources?: Set<string>): Set<string> {
  const calls = new Set<string>();
  const visit = (relativePath: string) => {
    const absolutePath = path.join(repoRoot, relativePath);
    if (excludedPath.test(relativePath)) return;
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(relativePath, entry.name);
      if (excludedPath.test(child)) continue;
      if (entry.isDirectory()) visit(child);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const source = fs.readFileSync(path.join(repoRoot, child), 'utf8');
        // Quoted resource with ANY action expression, so `(ctx, 'webhook', action, knex)` is seen.
        for (const match of source.matchAll(
          /(?:hasPermission|hasApiContextPermission)\s*\(\s*[^,]+,\s*['"]([^'"]+)['"]\s*,/g,
        )) resources?.add(match[1]);
        for (const match of source.matchAll(
          /(?:hasPermission|hasApiContextPermission)\s*\(\s*[^,]+,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g,
        )) calls.add(`${match[1]}.${match[2]}`);
      }
    }
  };
  for (const root of productionRoots) visit(root);
  return calls;
}

const catalogResources = new Set<string>(ACTIVE_PERMISSIONS.map((permission: { resource: string }) => permission.resource));
const catalogPairs = new Set<string>(ACTIVE_PERMISSIONS.map(
  (permission: { resource: string; action: string }) => `${permission.resource}.${permission.action}`,
));

const controllersDir = path.join(repoRoot, 'server/src/lib/api/controllers');

/** Effective resource and literal base-check actions for each controller that passes options to the base class. */
function controllerChecks() {
  const found: Array<{ file: string; resource: string; actions: string[] }> = [];
  for (const file of fs.readdirSync(controllersDir)) {
    if (!/^Api.*Controller\.ts$/.test(file) || file === 'ApiBaseController.ts') continue;
    const source = fs.readFileSync(path.join(controllersDir, file), 'utf8');
    // A controller that overrides checkPermission checks whatever it hard-codes (seen by the call scan), not its options.
    if (/checkPermission\s*\([^)]*\)\s*:\s*Promise/.test(source)) continue;
    const start = source.indexOf('super(');
    if (start < 0) continue;
    const options = source.slice(start, start + 1500);
    const resource = options.match(/\bpermissionResource:\s*'([^']+)'/)?.[1] ?? options.match(/\bresource:\s*'([^']+)'/)?.[1];
    if (!resource) continue; // dynamic resource (inventory family)
    const actions = [...source.matchAll(/this\.checkPermission\(\s*\w+\s*,\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
    found.push({ file, resource, actions: [...new Set(actions)].sort() });
  }
  return found;
}

describe('permission catalog contract', () => {
  it('declares the resource of every quoted-resource permission check, whatever the action expression', () => {
    const resources = new Set<string>();
    productionPermissionCalls(resources);
    const missing = [...resources].filter((resource) => !catalogResources.has(resource)).sort();
    expect(missing, 'A production hasPermission/hasApiContextPermission call names a resource the catalog never provisions').toEqual([]);
    for (const resource of ['role', 'webhook']) expect(resources.has(resource)).toBe(true);
  });

  it('declares the effective resource of every API controller, or quarantines the known follow-up', () => {
    const checks = controllerChecks();
    expect(checks.length).toBeGreaterThan(20);
    const quarantine = new Set<string>(KNOWN_UNDECLARED_CONTROLLER_RESOURCES);
    const effective = new Set(checks.map((check) => check.resource));
    const missing = [...effective].filter((resource) => !catalogResources.has(resource) && !quarantine.has(resource)).sort();
    const stale = [...quarantine].filter((resource) => !effective.has(resource) || catalogResources.has(resource)).sort();

    expect(missing, 'Add the controller resource to the catalog; never extend KNOWN_UNDECLARED_CONTROLLER_RESOURCES').toEqual([]);
    expect(stale, 'Remove stale controller-resource quarantine entries').toEqual([]);
    expect(KNOWN_UNDECLARED_CONTROLLER_RESOURCES).toHaveLength(3);
    for (const resource of ['metadata', 'role']) expect(effective.has(resource)).toBe(true);
  });

  it('declares the exact resource.action pair of every literal controller check', () => {
    const quarantine = new Set<string>(KNOWN_UNDECLARED_CONTROLLER_RESOURCES);
    const missing: string[] = [];
    for (const { file, resource, actions } of controllerChecks()) {
      if (quarantine.has(resource)) continue;
      for (const action of actions) {
        if (!catalogPairs.has(`${resource}.${action}`)) missing.push(`${file}: ${resource}.${action}`);
      }
    }
    const pairQuarantine = new Set<string>(KNOWN_UNDECLARED_CONTROLLER_PAIRS);
    const undeclared = missing.filter((pair) => !pairQuarantine.has(pair));
    const stale = [...pairQuarantine].filter((pair) => !missing.includes(pair));
    expect(undeclared, 'Add the controller permission to the catalog; never extend KNOWN_UNDECLARED_CONTROLLER_PAIRS').toEqual([]);
    expect(stale, 'Remove stale controller-pair quarantine entries').toEqual([]);
    expect(KNOWN_UNDECLARED_CONTROLLER_PAIRS).toHaveLength(9);
  });

  it('declares every action the webhook controller checks', () => {
    const source = fs.readFileSync(path.join(controllersDir, 'ApiWebhookController.ts'), 'utf8');
    const actions = [...new Set([...source.matchAll(/this\.checkPermission\(\s*\w+\s*,\s*'([^']+)'\s*\)/g)].map((m) => m[1]))];
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.filter((action) => !catalogPairs.has(`webhook.${action}`))).toEqual([]);
  });

  it('declares every literal production permission check or quarantines the known follow-up', () => {
    const calls = productionPermissionCalls();
    const catalog = new Set<string>(ACTIVE_PERMISSIONS.map(
      (permission: { resource: string; action: string }) => `${permission.resource}.${permission.action}`,
    ));
    const quarantine = new Set<string>(KNOWN_UNDECLARED);
    const missing = [...calls].filter((pair) => !catalog.has(pair) && !quarantine.has(pair)).sort();
    const stale = [...quarantine].filter((pair) => !calls.has(pair)).sort();

    expect(missing, `Add new production permissions to the catalog; never extend KNOWN_UNDECLARED (${FOLLOW_UP_CARD})`).toEqual([]);
    expect(stale, `Remove stale quarantine entries tracked by ${FOLLOW_UP_CARD}`).toEqual([]);
    expect(KNOWN_UNDECLARED).toHaveLength(2);
  });

  it('retains product-specific grants and the secrets screen grants', () => {
    const psa = compileLegacyRoleGrants('psa');
    const algadesk = compileLegacyRoleGrants('algadesk');

    expect(psa.msp.Admin).toBe(ALL_MSP);
    expect(algadesk.msp.Agent).toContain('ticket:read:msp');
    expect(algadesk.client.Admin).toContain('ticket:delete:client');

    // The Secrets settings screen gates on exactly these two.
    for (const product of [psa, algadesk]) {
      expect(product.msp.Admin === ALL_MSP
        || (product.msp.Admin.includes('secrets:view:msp') && product.msp.Admin.includes('secrets:manage:msp'))).toBe(true);
    }
    expect(ACTIVE_PERMISSIONS.filter((permission: { resource: string }) => permission.resource === 'secrets')
      .map((permission: { action: string }) => permission.action).sort()).toEqual(['manage', 'view']);
  });

  it('declares credential:audit with supervisory default grants (msp only)', () => {
    const audit = ACTIVE_PERMISSIONS.find(
      (permission: { resource: string; action: string }) =>
        permission.resource === 'credential' && permission.action === 'audit'
    );
    expect(audit).toBeDefined();
    expect(audit.msp).toBe(true);
    expect(audit.client).toBe(false);
    expect(audit.products).toEqual(expect.arrayContaining(['algadesk', 'psa']));
    // The audit trail is an oversight surface: technicians can reveal but do
    // not see the report of who else did. Admin on both products; Manager on
    // PSA.
    expect(audit.defaultGrants.algadesk).toEqual(['msp:Admin']);
    expect(audit.defaultGrants.psa).toEqual(['msp:Admin', 'msp:Manager']);
  });
});
