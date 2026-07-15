import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../../../../..');

const settingsSubtabComponents = [
  ['billing', 'packages/billing/src/components/settings/billing/BillingSettings.tsx'],
  ['time entry', 'packages/scheduling/src/components/settings/time-entry/TimeEntrySettings.tsx'],
  ['import/export', 'server/src/components/settings/import-export/ImportExportSettings.tsx'],
] as const;

describe.each(settingsSubtabComponents)('%s settings sub-tab URL', (_name, relativePath) => {
  it('anchors shallow navigation to the current route segment', () => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

    expect(source).toContain('${window.location.pathname}?');
    expect(source).not.toContain('`/msp/settings?${');
  });
});
