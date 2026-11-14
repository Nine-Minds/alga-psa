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

  // The seat (operational) time-entry mode is NOT a time source: it writes natively and is decided from the S12
  // principal, so it does not travel through the seam. Its field set (`operationalTimeEntryFields`) and service
  // rule live in @alga-psa/co-managed, and the seam call sites above may not import that package. The exception
  // is explicit and closed: `lib/timeEntryMode.ts` is the one bridge, and it may import only the Next-free
  // `@alga-psa/co-managed/timeEntryBillingMode` subpath. Call sites import the bridge, never the package.
  // `context/TimeEntryModeContext.tsx` imports a TYPE from the same subpath. Anything else that imports
  // @alga-psa/co-managed anywhere in this package fails below, so a new direct import is still caught.
  const ALLOWED_CO_MANAGED_IMPORTERS: Record<string, { subpath: string; typeOnly: boolean }> = {
    'lib/timeEntryMode.ts': { subpath: '@alga-psa/co-managed/timeEntryBillingMode', typeOnly: false },
    'context/TimeEntryModeContext.tsx': { subpath: '@alga-psa/co-managed/timeEntryBillingMode', typeOnly: true },
    'lib/timeSource/timeSource.ts': { subpath: '@alga-psa/co-managed', typeOnly: true },
  };
  const coManagedImports = (src: string) =>
    (importsOf(src).match(/[^\n]*from\s+['"]@alga-psa\/co-managed[^'"]*['"]|import\(\s*['"]@alga-psa\/co-managed[^'"]*['"]\s*\)/g) ?? []);
  const sourceFiles = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === 'node_modules' || e.name === 'test' || e.name === '__tests__' ? [] : sourceFiles(path.join(d, e.name)))
        : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [path.join(d, e.name)] : []);

  /** Importers of @alga-psa/co-managed in `files` that are not on the allowlist, or that import beyond it. */
  const violations = (files: Record<string, string>) =>
    Object.entries(files).flatMap(([rel, src]) => {
      const found = coManagedImports(src);
      if (found.length === 0) return [];
      const allowed = ALLOWED_CO_MANAGED_IMPORTERS[rel];
      if (!allowed) return [`${rel} imports @alga-psa/co-managed and is not the bridge`];
      return found
        .filter((line) => !line.includes(`'${allowed.subpath}'`) && !line.includes(`"${allowed.subpath}"`)
          || (allowed.typeOnly && !/^\s*(import|export)\s+type\b/.test(line)))
        .map((line) => `${rel}: ${line.trim()}`);
    });

  it('only the explicit bridge (and a type-only context import) may import @alga-psa/co-managed', () => {
    const files = Object.fromEntries(sourceFiles(pkg).map((f) => [path.relative(pkg, f).split(path.sep).join('/'), read(f)]));
    expect(violations(files)).toEqual([]);
  });

  it('the allowlist check catches a new direct import', () => {
    expect(violations({ 'lib/somethingNew.ts': "import { x } from '@alga-psa/co-managed';" })).not.toEqual([]);
    expect(violations({ 'lib/timeEntryWriteCore.ts': "import { x } from '@alga-psa/co-managed/timeEntryBillingMode';" })).not.toEqual([]);
    expect(violations({ 'lib/timeEntryMode.ts': "import { x } from '@alga-psa/co-managed/seatAuthority';" })).not.toEqual([]);
    expect(violations({ 'context/TimeEntryModeContext.tsx': "import { x } from '@alga-psa/co-managed/timeEntryBillingMode';" })).not.toEqual([]);
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
