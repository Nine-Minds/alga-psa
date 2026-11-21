import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, 'UserService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('user service bulk deactivate tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the bulk user update root', () => {
    const section = sectionBetween('async bulkDeactivateUsers', 'ANALYTICS & REPORTING');

    expect(section).toContain('this.buildTenantScopedQuery(trx, context)');
    expect(section).not.toMatch(/trx\('users'\)\s*\./);
    expect(section).not.toMatch(/\.where\('tenant', context\.tenant\)/);
  });

  it('clears the deactivated users as board default assignees, as the settings UI does', () => {
    const section = sectionBetween('async bulkDeactivateUsers', 'private async publishBulkActivationEvents');

    expect(section).toContain("tenantDb(trx, context.tenant).table('boards')");
    expect(section).toContain(".whereIn('default_assigned_to', changedUserIds)");
    expect(section).toContain('.update({ default_assigned_to: null })');
    expect(section).toMatch(/if \(deactivate && changedUserIds\.length > 0\)/);
  });

  it('publishes USER_UPDATED for the changed users only after the transaction commits', () => {
    const section = sectionBetween('async bulkDeactivateUsers', 'private async publishBulkActivationEvents');
    const transactionEnd = section.indexOf('});\n\n    // After commit');
    const publish = section.indexOf('await this.publishBulkActivationEvents(changedUserIds, context)');

    expect(transactionEnd).toBeGreaterThan(0);
    expect(publish).toBeGreaterThan(transactionEnd);

    const publisher = sectionBetween('private async publishBulkActivationEvents', 'ANALYTICS & REPORTING');
    expect(publisher).toContain("eventType: 'USER_UPDATED'");
    expect(publisher).toContain("changedFields: ['is_inactive']");
  });
});
