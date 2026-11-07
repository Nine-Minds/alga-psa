import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  TENANT_TABLE_MANIFEST as SHARED_TENANT_TABLE_MANIFEST,
  computeTenantDeletionOrder,
  tenantDeletionOrder,
} from '@alga-psa/db/tenantTableManifest';
import { TENANT_TABLE_MANIFEST } from '../tenantTableManifest';

describe('Enterprise tenant lifecycle manifest', () => {
  it('deletes service identities before users while preserving the shared order', () => {
    const sharedOrder = tenantDeletionOrder(SHARED_TENANT_TABLE_MANIFEST);
    const enterpriseOrder = tenantDeletionOrder(TENANT_TABLE_MANIFEST);
    expect(sharedOrder).not.toContain('service_principals');
    expect(enterpriseOrder).toEqual(['service_principals', ...sharedOrder]);
    expect(enterpriseOrder.indexOf('service_principals')).toBeLessThan(enterpriseOrder.indexOf('users'));
    expect(computeTenantDeletionOrder(TENANT_TABLE_MANIFEST).violations).toEqual([]);
    expect(TENANT_TABLE_MANIFEST[0].scope).toEqual({ scope: 'tenant' });
  });
});

const ACTIVITY = path.resolve(__dirname, '../../activities/tenant-deletion-activities.ts');

function parseActivityLiteral(): string[] {
  const content = readFileSync(ACTIVITY, 'utf-8');
  const match = content.match(/const\s+TENANT_TABLES_DELETION_ORDER\s*:\s*string\[\]\s*=\s*\[([\s\S]*?)\n\];/);
  if (!match) throw new Error('TENANT_TABLES_DELETION_ORDER not found');
  return [...match[1].replace(/\/\/.*$/gm, '').matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]);
}

describe('tenant table manifest golden order', () => {
  it('computed order equals the activity literal element for element, with zero violations', () => {
    const literal = parseActivityLiteral();
    const computed = computeTenantDeletionOrder(TENANT_TABLE_MANIFEST);
    expect(computed.violations).toEqual([]);
    expect(computed.order).toEqual(literal);
    expect(tenantDeletionOrder(TENANT_TABLE_MANIFEST)).toEqual(literal);
  });

  it('has 604 unique ordered names', () => {
    const order = tenantDeletionOrder(TENANT_TABLE_MANIFEST);
    expect(order).toHaveLength(604);
    expect(new Set(order).size).toBe(604);
  });

  it('schedules organization SLA history and priority mappings before their parents', () => {
    const order = tenantDeletionOrder(TENANT_TABLE_MANIFEST);
    const history = [
      'sla_organization_notification_events',
      'sla_organization_events',
      'sla_organization_obligations',
    ];
    expect(order.filter(table => history.includes(table))).toEqual(history);

    const mappings = ['co_managed_sla_priority_mappings', 'priorities'];
    expect(order.filter(table => mappings.includes(table))).toEqual(mappings);
  });

  it('declares the eight breakCircularDependencies FKs as null-before-delete', () => {
    const declared = SHARED_TENANT_TABLE_MANIFEST.flatMap(e => (e.references ?? []).map(r => `${e.table}.${r.column}->${r.table}`)).sort();
    expect(declared).toEqual([
      'assets.stock_unit_id->stock_units',
      'authorization_bundles.published_revision_id->authorization_bundle_revisions',
      'clients.account_manager_id->users',
      'contacts.client_id->clients',
      'inbound_ticket_defaults.client_id->clients',
      'opportunities.suggestion_id->opportunity_suggestions',
      'statuses.board_id->boards',
      'stock_units.allocated_staging_line_id->project_staging_lines',
    ]);
  });

  it('keeps the eight declarations in step with the breakCircularDependencies source', () => {
    const src = readFileSync(ACTIVITY, 'utf-8');
    const start = src.indexOf('breakCircularDependencies');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start);
    for (const [table, column] of [
      ['assets', 'stock_unit_id'], ['authorization_bundles', 'published_revision_id'], ['clients', 'account_manager_id'],
      ['contacts', 'client_id'], ['inbound_ticket_defaults', 'client_id'], ['opportunities', 'suggestion_id'],
      ['statuses', 'board_id'], ['stock_units', 'allocated_staging_line_id'],
    ]) {
      expect(body, `${table}.${column}`).toMatch(new RegExp(`${table}[\\s\\S]{0,400}${column}`));
    }
  });
});
