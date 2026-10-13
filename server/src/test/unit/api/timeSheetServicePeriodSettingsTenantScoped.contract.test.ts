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

describe('time sheet service period settings contract', () => {
  it('delegates every period-settings operation to the shared scheduling model', () => {
    const section = sectionBetween('// Time period settings', '// Schedule entries');

    // The model owns tenant scoping, the effective_from default/hand-off, and overlap validation,
    // so the REST API and the settings UI apply the same rules.
    for (const call of [
      'TimePeriodSettings.list(knex, context.tenant)',
      'TimePeriodSettings.getById(knex, context.tenant, id)',
      'TimePeriodSettings.create(knex, context.tenant, data, { userId: context.userId })',
      'TimePeriodSettings.update(knex, context.tenant, id, data)',
      'TimePeriodSettings.delete(knex, context.tenant, id)',
    ]) {
      expect(section).toContain(call);
    }

    expect(section).not.toContain("table('time_period_settings')");
    expect(section).not.toMatch(/knex\('time_period_settings'\)|trx\('time_period_settings'\)/);
  });
});
