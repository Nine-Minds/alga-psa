/**
 * Static guard for the operator-route auth regression tests.
 *
 * Fails when a platform-operator route is added, loses its gate, starts reading
 * `x-internal-*` headers, gains a method without a behavioural matrix row, or
 * imports a module the tripwire mocks have not been reviewed for.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  allRows,
  applianceAndProvisioningRows,
  platformOperatorRows,
  tenantManagementRows,
  UNGATED_ROUTE_ALLOWLIST,
} from './routeTable';

const API_ROOT = path.resolve(__dirname, '../../../app/api');
const OPERATOR_ROOTS = [
  'v1/tenant-management',
  'v1/appliance-installs',
  'provisioning',
  ...fs.readdirSync(path.join(API_ROOT, 'v1')).filter((d) => d.startsWith('platform-')).map((d) => `v1/${d}`),
];

function findRouteFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findRouteFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

const routeFiles = OPERATOR_ROOTS.flatMap((r) => findRouteFiles(path.join(API_ROOT, r)))
  .map((f) => path.relative(API_ROOT, f).split(path.sep).join('/'))
  .sort();

const source = (file: string) => fs.readFileSync(path.join(API_ROOT, file), 'utf8');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function exportedMethods(text: string): string[] {
  const found = new Set<string>();
  const pattern = new RegExp(
    [
      `export\\s+(?:async\\s+)?function\\s+(${METHODS.join('|')})\\b`,
      `export\\s+const\\s+(${METHODS.join('|')})\\b`,
      `export\\s*\\{[^}]*\\bas\\s+(${METHODS.join('|')})\\b[^}]*\\}`,
    ].join('|'),
    'g',
  );
  for (const match of text.matchAll(pattern)) {
    found.add(match[1] ?? match[2] ?? match[3]);
  }
  return [...found];
}

/** Gate, or a helper that calls the gate before anything else. */
const GATE_REFERENCES = ['assertMasterTenantAccess', 'handleApplianceTrigger', 'createTenantActionRoute'];

/**
 * Every module specifier a route may import. Entries in TRIPWIRED are replaced
 * by spies in the spec files; SAFE ones are pure or are the gate itself. A new
 * import fails here until someone decides which list it belongs to (and, if
 * tripwired, adds the vi.mock to the relevant spec).
 */
const TRIPWIRED = new Set([
  '@alga-psa/db',
  '@alga-psa/db/admin',
  '@ee/lib/tenant-management/workflowClient',
  '@ee/lib/platformReports',
  '@ee/lib/platformReports/blocklist',
  '@ee/lib/platformNotifications',
  '@ee/lib/platformFeatureFlags',
  '@ee/lib/applianceConsole/algaLicenseAdminClient',
  '@ee/lib/applianceConsole/workflowClient',
  '@ee/lib/applianceConsole/stripeBilling',
  '@ee/lib/storage/s3-client',
  '../../../../services/provisioning',
  '@/lib/observability/logging',
]);
const SAFE = new Set([
  'next/server',
  'zod',
  '@alga-psa/types',
  '@ee/lib/auth/masterTenantAccess',
  '@ee/lib/applianceConsole/triggerRoute',
  '@ee/lib/applianceConsole/actionInputs',
  '../../../../services/provisioning/types/tenant.schema',
  '../tenantManagementRouteErrors',
  '../../../tenantManagementRouteErrors',
  'server/src/lib/reports/core/types', // type-only import
]);

describe('operator route inventory', () => {
  it('finds the operator route files', () => {
    expect(routeFiles.length).toBeGreaterThan(0);
    for (const allowed of UNGATED_ROUTE_ALLOWLIST) {
      expect(routeFiles).toContain(allowed);
    }
  });

  it.each(routeFiles)('%s never reads x-internal-* headers', (file) => {
    expect(source(file)).not.toContain('x-internal-');
  });

  it.each(routeFiles.filter((f) => !UNGATED_ROUTE_ALLOWLIST.includes(f)))('%s is gated', (file) => {
    const text = source(file);
    expect(GATE_REFERENCES.some((ref) => text.includes(ref))).toBe(true);
  });

  it('the ungated allowlist route touches no data', () => {
    for (const file of UNGATED_ROUTE_ALLOWLIST) {
      const specifiers = [...source(file).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      expect(specifiers.filter((s) => s !== 'next/server')).toEqual([]);
    }
  });

  it('the behavioural table covers exactly the (file, method) pairs the routes export', () => {
    const onDisk = routeFiles
      .filter((f) => !UNGATED_ROUTE_ALLOWLIST.includes(f))
      .flatMap((f) => exportedMethods(source(f)).map((m) => `${f} ${m}`))
      .sort();
    const inTable = [...new Set(allRows.map((r) => `${r.file} ${r.method}`))].sort();
    expect(inTable).toEqual(onDisk);
  });

  it('has a row for every __method override the routes dispatch on', () => {
    for (const file of routeFiles.filter((f) => source(f).includes('__method'))) {
      const rows = allRows.filter((r) => r.file === file && r.method === 'POST');
      expect(rows.some((r) => r.body && '__method' in r.body), file).toBe(true);
    }
  });

  it('row ids are unique', () => {
    const ids = allRows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every route import is either tripwired or reviewed as safe', () => {
    const unknown: string[] = [];
    for (const file of routeFiles) {
      for (const match of source(file).matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1];
        if (!TRIPWIRED.has(specifier) && !SAFE.has(specifier)) unknown.push(`${file}: ${specifier}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it.each([
    ['tenantManagementRoutes.spoofedHeaders.test.ts', tenantManagementRows],
    ['platformOperatorRoutes.spoofedHeaders.test.ts', platformOperatorRows],
    ['applianceAndProvisioningRoutes.spoofedHeaders.test.ts', applianceAndProvisioningRows],
  ] as const)('%s mocks every tripwired module its routes (and the trigger helper) import', (specFile, rows) => {
    const specText = fs.readFileSync(path.join(__dirname, specFile), 'utf8');
    const mocked = new Set([...specText.matchAll(/vi\.mock\('([^']+)'/g)].map((m) => m[1]));
    const triggerSource = fs.readFileSync(path.resolve(__dirname, '../../../lib/applianceConsole/triggerRoute.ts'), 'utf8');
    const files = [...new Set(rows.map((r) => r.file))];
    const imported = new Set<string>();
    for (const text of [...files.map(source), ...(files.some((f) => /appliance-installs/.test(f)) ? [triggerSource] : [])]) {
      for (const match of text.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1] === '../../../../services/provisioning' ? '@ee/services/provisioning' : match[1];
        if (TRIPWIRED.has(match[1]) || specifier === '@ee/services/provisioning') imported.add(specifier);
      }
    }
    const missing = [...imported].filter((m) => !mocked.has(m));
    expect(missing).toEqual([]);
  });
});
