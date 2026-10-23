/* @vitest-environment node */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../..');

describe('DataTable preference bridge', () => {
  it('stores all table sizes through one useUserPreference record mounted in the MSP shell', () => {
    const bridge = readFileSync(resolve(root, 'server/src/app/msp/MspLayoutClient.tsx'), 'utf8');
    expect(bridge).toContain('useUserPreference<DataTablePageSizes>(DATA_TABLE_PAGE_SIZES_PREFERENCE_KEY');
    expect(bridge).toContain('<DataTablePreferencesProvider');
    expect(bridge).toContain('onPageSizesChange={dataTablePreferences.setValue}');
    const uiContext = readFileSync(resolve(root, 'packages/ui/src/components/DataTablePreferences.tsx'), 'utf8');
    expect(uiContext).not.toContain('@alga-psa/user-composition');
  });
});
