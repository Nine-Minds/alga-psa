import { describe, expect, it } from 'vitest';
import { CUSTOM_THEME_TOKEN_KEYS } from '@alga-psa/tenancy/lib/customTheme';
import { createRegistry } from '../../../lib/api/openapi/registry';
import { registerMobileCapabilitiesV1Routes } from '../../../lib/api/openapi/routes/mobileCapabilitiesV1';

function buildMobileCapabilitiesDocument() {
  const registry = createRegistry([registerMobileCapabilitiesV1Routes], { edition: 'ee' });
  return registry.buildDocument({
    title: 'Mobile capabilities',
    version: 'test',
    edition: 'ee',
  }) as any;
}

describe('mobile capabilities OpenAPI', () => {
  it('T007 documents the theme block with a 15-key seed token schema for light and dark', () => {
    const document = buildMobileCapabilitiesDocument();
    const schemas = document.components?.schemas ?? {};

    const seedTokens = schemas.MobileThemeSeedTokensV1;
    expect(Object.keys(seedTokens.properties).sort()).toEqual([...CUSTOM_THEME_TOKEN_KEYS].sort());

    const theme = schemas.MobileCapabilitiesSuccessV1.properties.data.properties.theme;
    expect(Object.keys(theme.properties).sort()).toEqual(['dark', 'label', 'light', 'pairId', 'version']);
    for (const mode of ['light', 'dark'] as const) {
      expect(theme.properties[mode].$ref).toBe('#/components/schemas/MobileThemeSeedTokensV1');
    }
  });
});
