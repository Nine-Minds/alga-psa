// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('time entry API service tenant-scoped query contract', () => {
  it('uses structural tenant scoping for time entry service roots', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/services/TimeEntryService.ts'),
      'utf8'
    );

    expect(source).toContain('this.buildTenantScopedQuery(knex, context)');
    expect(source).toContain('createTenantScopedQuery(knex, {');
    for (const table of [
      'tickets',
      'time_sheets',
      'time_periods',
      'users',
      'project_tasks',
      'service_catalog',
    ]) {
      expect(source).toContain(`table: '${table}'`);
    }

    expect(source).not.toMatch(/knex\(this\.tableName\)\s*\.where/);
    expect(source).not.toMatch(/knex\('tickets'\)\s*\.where/);
    expect(source).not.toMatch(/knex\('project_tasks'\)\s*\.join/);
    expect(source).not.toMatch(/knex\('service_catalog'\)\s*\.where/);
    expect(source).not.toMatch(/knex\('time_sheets'\)\s*\.where/);
    expect(source).not.toMatch(/knex\('time_periods'\)\s*\.where/);
    expect(source).not.toMatch(/knex\('users'\)\s*\.where/);
  });
});
