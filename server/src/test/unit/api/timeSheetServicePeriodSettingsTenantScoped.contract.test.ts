import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TimeSheetService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('time sheet service period settings tenant-scoped query contract', () => {
  it('uses structural tenant scoping for period-settings roots', () => {
    const section = sectionBetween('// Time period settings', '// Schedule entries');

    expect(section).toContain('tenantDb(');
    expect(section).toContain('tenantDb(');
    expect(section).toContain(".table('time_period_settings')");
    expect(section).toContain("const [settings] = await tenantDb(trx, context.tenant).table('time_period_settings')");

    expect(section).not.toMatch(/knex\('time_period_settings'\)\s*\.(?:where|orderBy)/);
    expect(section).not.toMatch(/trx\('time_period_settings'\)\s*[\r\n]+\s*\.where/);
    expect(section).not.toMatch(/\.where\(\{\s*tenant: context\.tenant,\s*is_active: true\s*\}\)/);
    expect(section).not.toMatch(/\.where\(\{\s*settings_id: id,\s*tenant: context\.tenant\s*\}\)/);
  });
});
