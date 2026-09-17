import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RELEASE_V1_6_FEATURE_FLAG } from '@alga-psa/core/features';
import { TIER_FEATURES } from '@alga-psa/types';
import { TELEPHONY_PROVIDERS } from '@alga-psa/telephony/types';
import {
  TELEPHONY_PROVIDER_REGISTRY,
  getTelephonyProviderRegistryEntry,
} from './providerRegistry';
import { loadTelephonyProviderEe } from './providerEeLoader';

describe('telephony provider registry', () => {
  it('T014: exports exactly one entry per TELEPHONY_PROVIDERS value', () => {
    expect(TELEPHONY_PROVIDER_REGISTRY.map((entry) => entry.id)).toEqual([...TELEPHONY_PROVIDERS]);
  });

  it('T015: the 3cx entry carries the tier feature and release flag, teams-phone carries neither', () => {
    const threecx = getTelephonyProviderRegistryEntry('3cx');
    const teams = getTelephonyProviderRegistryEntry('teams-phone');

    expect(threecx?.requiresTierFeature).toBe(TIER_FEATURES.PBX_TELEPHONY);
    expect(threecx?.releaseFlag).toBe(RELEASE_V1_6_FEATURE_FLAG);

    expect(teams?.requiresTierFeature).toBeNull();
    expect(teams?.releaseFlag).toBeNull();
  });

  it('every entry exposes i18n keys', () => {
    for (const entry of TELEPHONY_PROVIDER_REGISTRY) {
      expect(entry.labelKey).toMatch(/^integrations\.telephony\.providers\./);
      expect(entry.descriptionKey).toMatch(/^integrations\.telephony\.providers\./);
    }
  });

  it('keeps the registry client-safe: no EE module references', () => {
    // Client components render cards from this registry; an EE reference here
    // (even inside a dynamic import) drags handlers/ingest/db into the browser
    // bundle and 500s every page. EE dispatch lives in providerEeLoader.ts.
    const source = fs.readFileSync(path.resolve(__dirname, 'providerRegistry.ts'), 'utf8');
    expect(source).not.toContain('@alga-psa/ee-');
    expect(source).not.toContain('loadEe');
  });

  it('T028: the 3cx EE loader resolves to an adapter over the EE module', async () => {
    const adapter = await loadTelephonyProviderEe('3cx');
    expect(typeof adapter.activateProvider).toBe('function');
    expect(typeof adapter.deactivateProvider).toBe('function');
    expect(typeof adapter.getProviderState).toBe('function');
    expect(typeof adapter.setAutoCreateTickets).toBe('function');
  });
});
