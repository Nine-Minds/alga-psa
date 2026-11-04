import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const pkg = path.resolve(__dirname, '..');
const repo = path.resolve(pkg, '../../..');
const read = (p: string) => fs.readFileSync(p, 'utf8');
const importsOf = (src: string) => (src.match(/(?:^|\n)\s*(?:import|export)\b[^;]*?from\s+['"][^'"]+['"]|import\(\s*['"][^'"]+['"]\s*\)/g) ?? []).join('\n');

const SEAM = /from ['"](\.\.\/)+lib\/timeSource['"]|from ['"]\.\.\/timeSource['"]|from ['"]\.\/timeSource['"]|from ['"]\.\.\/\.\.\/lib\/timeSource['"]|from ['"]@alga-psa\/scheduling\/lib\/timeSource['"]/;

const schedulingModules = [
  'actions/timeSheetActions.ts',
  'actions/timeSheetOperations.ts',
  'actions/timePeriodsActions.ts',
  'actions/timeEntryCrudActions.ts',
  'actions/timeEntryWorkItemActions.ts',
  'actions/timeEntryChangeRequestActions.ts',
  'actions/stopwatchActions.ts',
  'actions/time-period-settings-actions/timePeriodSettingsActions.ts',
  'lib/timeEntryWriteCore.ts',
  'lib/timePeriodMaterialization.ts',
];
const serverModules = [
  'server/src/lib/api/services/TimeEntryService.ts',
  'server/src/lib/api/services/TimeSheetService.ts',
  'server/src/lib/jobs/tenantPeriodMaintenance.ts',
];

describe('time-source seam coverage (A1)', () => {
  it.each(schedulingModules)('%s routes through the seam', (m) => {
    expect(read(path.join(pkg, m))).toMatch(SEAM);
  });

  it.each(serverModules)('%s routes through the seam', (m) => {
    const src = read(path.join(repo, m));
    expect(src).toMatch(/@alga-psa\/scheduling\/lib\/timeSource/);
  });

  it('no seam or call-site file imports @alga-psa/co-managed', () => {
    const files = [
      ...schedulingModules.map((m) => path.join(pkg, m)),
      ...serverModules.map((m) => path.join(repo, m)),
      ...fs.readdirSync(path.join(pkg, 'lib/timeSource')).map((f) => path.join(pkg, 'lib/timeSource', f)),
    ];
    for (const f of files) expect(importsOf(read(f)), f).not.toMatch(/@alga-psa\/co-managed/);
  });

  it('timeSource.ts has no runtime imports', () => {
    const src = read(path.join(pkg, 'lib/timeSource/timeSource.ts'));
    const imports = src.match(/^import\s.+$/gm) ?? [];
    const multi = src.match(/^import[\s\S]*?from\s+['"][^'"]+['"];?/gm) ?? [];
    expect(multi.length).toBeGreaterThan(0);
    for (const i of multi) expect(i.startsWith('import type'), i).toBe(true);
    void imports;
  });

  it('client components never import timeEntryWriteCore', () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
    for (const f of walk(path.join(pkg, 'components')).filter((f) => f.endsWith('.tsx'))) {
      const s = read(f);
      if (/^['"]use client['"]/m.test(s.slice(0, 200))) expect(importsOf(s), f).not.toMatch(/timeEntryWriteCore/);
    }
  });
});
