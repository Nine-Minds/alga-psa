import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_NAMESPACES } from '@alga-psa/core/i18n/config';

const repoRoot = path.resolve(__dirname, '../../../../..');
const productionLocales = ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl'] as const;
const pseudoLocales = ['xx', 'yy'] as const;
const batchNamespaces = ['clients', 'contacts', 'assets', 'onboarding'] as const;

type BatchNamespace = (typeof batchNamespaces)[number];

const readRepoFile = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(readRepoFile(relativePath));

const readLocaleJson = (locale: string, namespace: BatchNamespace) =>
  readJson(`server/public/locales/${locale}/msp/${namespace}.json`);

const readLocaleText = (locale: string, namespace: BatchNamespace) =>
  readRepoFile(`server/public/locales/${locale}/msp/${namespace}.json`);

const collectLeafEntries = (value: unknown, prefix = ''): Map<string, string> => {
  const entries = new Map<string, string>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return entries;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      for (const [nestedKey, nestedValue] of collectLeafEntries(child, childPath)) {
        entries.set(nestedKey, nestedValue);
      }
    } else {
      entries.set(childPath, String(child));
    }
  }

  return entries;
};

const getValue = (object: Record<string, unknown>, dottedPath: string): string =>
  dottedPath.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, object) as string;

const extractVariables = (value: string): string[] => {
  const matches = value.match(/\{\{[^}]+\}\}/g);
  return matches ? matches.map((match) => match.trim()) : [];
};

const assertLocaleBundleMatchesEnglish = (namespace: BatchNamespace) => {
  const englishLeaves = collectLeafEntries(readLocaleJson('en', namespace));
  const englishKeys = [...englishLeaves.keys()].sort();

  for (const locale of productionLocales) {
    const localeLeaves = collectLeafEntries(readLocaleJson(locale, namespace));
    expect([...localeLeaves.keys()].sort()).toEqual(englishKeys);

    if (locale !== 'en') {
      for (const [key, englishValue] of englishLeaves) {
        expect(extractVariables(localeLeaves.get(key) ?? '')).toEqual(
          extractVariables(englishValue),
        );
      }
    }
  }

  for (const locale of pseudoLocales) {
    const pseudoLeaves = collectLeafEntries(readLocaleJson(locale, namespace));
    expect([...pseudoLeaves.keys()].sort()).toEqual(englishKeys);
  }
};

describe('MSP clients/contacts/assets/onboarding locale batch', () => {
  it('T004: xx pseudo-locale resolves representative client surfaces to 11111', () => {
    const xx = readLocaleJson('xx', 'clients');

    expect(getValue(xx, 'clientsPage.title')).toBe('11111');
    expect(getValue(xx, 'clientDetails.title')).toBe('11111');
    expect(getValue(xx, 'quickAddClient.title')).toBe('11111');
    expect(getValue(xx, 'clientsImportDialog.title')).toBe('11111');
    expect(getValue(xx, 'billingConfiguration.general')).toBe('11111');
  });

  it('T010: contact locale files stay structurally aligned with English and preserve interpolation variables', () => {
    assertLocaleBundleMatchesEnglish('contacts');
  });

  it('T012: Italian contacts locale stays clear of dropped-accent patterns', () => {
    const italian = readLocaleText('it', 'contacts');
    expect(italian).not.toMatch(
      /\b(puo|gia|verra|funzionalita|perche|cosi|piu)\b| e necessario| e possibile| e richiesto| e richiesta| e configurato| e configurata/,
    );
    expect(italian).toMatch(/Sì| è |più|funzionalità/);
  });

  it('T013: xx pseudo-locale resolves representative contact surfaces to 11111', () => {
    const xx = readLocaleJson('xx', 'contacts');

    expect(getValue(xx, 'contactsPage.title')).toBe('11111');
    expect(getValue(xx, 'contactDetails.title')).toBe('11111');
    expect(getValue(xx, 'quickAddContact.title')).toBe('11111');
    expect(getValue(xx, 'contactPhoneNumbersEditor.title')).toBe('11111');
    expect(getValue(xx, 'contactPortalTab.title')).toBe('11111');
  });

  it('T020: asset locale files stay structurally aligned with English and preserve interpolation variables', () => {
    assertLocaleBundleMatchesEnglish('assets');
  });

  it('T022: Italian assets locale stays clear of dropped-accent patterns', () => {
    const italian = readLocaleText('it', 'assets');
    expect(italian).not.toMatch(
      /\b(puo|gia|verra|funzionalita|perche|cosi|piu)\b| e necessario| e possibile| e richiesto| e richiesta| e configurato| e configurata/,
    );
    expect(italian).toMatch(/Sì| è |più|funzionalità/);
  });

  it('T023: xx pseudo-locale resolves representative asset dashboard, drawer, tab, and panel surfaces to 11111', () => {
    const xx = readLocaleJson('xx', 'assets');

    expect(getValue(xx, 'assetDashboardClient.title')).toBe('11111');
    expect(getValue(xx, 'assetForm.title')).toBe('11111');
    expect(getValue(xx, 'assetDetailDrawer.title')).toBe('11111');
    expect(getValue(xx, 'maintenanceSchedulesTab.title')).toBe('11111');
    expect(getValue(xx, 'assetInfoPanel.title')).toBe('11111');
    expect(getValue(xx, 'assetNotesPanel.title')).toBe('11111');
  });

  it('T030: onboarding locale files stay structurally aligned with English and preserve interpolation variables', () => {
    assertLocaleBundleMatchesEnglish('onboarding');
  });

  it('T032: Italian onboarding locale stays clear of dropped-accent patterns', () => {
    const italian = readLocaleText('it', 'onboarding');
    expect(italian).not.toMatch(
      /\b(puo|gia|verra|funzionalita|perche|cosi|piu)\b| e necessario| e possibile| e richiesto| e richiesta| e configurato| e configurata/,
    );
    expect(italian).toMatch(/Sì| è |più|funzionalità|verrà/);
  });

  it('T033: xx pseudo-locale resolves representative onboarding wizard surfaces to 11111', () => {
    const xx = readLocaleJson('xx', 'onboarding');

    expect(getValue(xx, 'onboardingWizard.title')).toBe('11111');
    expect(getValue(xx, 'clientInfoStep.title')).toBe('11111');
    expect(getValue(xx, 'teamMembersStep.title')).toBe('11111');
    expect(getValue(xx, 'addClientStep.title')).toBe('11111');
    expect(getValue(xx, 'clientContactStep.title')).toBe('11111');
    expect(getValue(xx, 'billingSetupStep.title')).toBe('11111');
    expect(getValue(xx, 'ticketingConfigStep.title')).toBe('11111');
  });

  it('T034: onboarding namespace keys do not collide with msp/dashboard onboarding keys', () => {
    const dashboardKeys = new Set(
      collectLeafEntries(readJson('server/public/locales/en/msp/dashboard.json')).keys(),
    );
    const onboardingKeys = [...collectLeafEntries(readLocaleJson('en', 'onboarding')).keys()];

    expect(onboardingKeys.filter((key) => dashboardKeys.has(key))).toEqual([]);
  });

  it('T040: ROUTE_NAMESPACES loads the new MSP feature namespaces on the expected routes', () => {
    expect(ROUTE_NAMESPACES['/msp/clients']).toEqual(['common', 'msp/core', 'msp/clients']);
    expect(ROUTE_NAMESPACES['/msp/contacts']).toEqual(['common', 'msp/core', 'msp/contacts']);
    expect(ROUTE_NAMESPACES['/msp/assets']).toEqual(['common', 'msp/core', 'msp/assets']);
    expect(ROUTE_NAMESPACES['/msp/onboarding']).toEqual(['common', 'msp/core', 'msp/onboarding']);
  });

  it('T042: pseudo-locale files for all four namespaces mirror English key structure and keep representative fills', () => {
    for (const namespace of batchNamespaces) {
      const englishKeys = [
        ...collectLeafEntries(readLocaleJson('en', namespace)).keys(),
      ].sort();

      for (const locale of pseudoLocales) {
        const localeLeaves = collectLeafEntries(readLocaleJson(locale, namespace));
        expect([...localeLeaves.keys()].sort()).toEqual(englishKeys);
      }
    }

    expect(getValue(readLocaleJson('xx', 'clients'), 'clientsPage.title')).toBe('11111');
    expect(getValue(readLocaleJson('yy', 'contacts'), 'contactsPage.title')).toBe('55555');
    expect(getValue(readLocaleJson('xx', 'assets'), 'assetDashboardClient.title')).toBe('11111');
    expect(getValue(readLocaleJson('yy', 'onboarding'), 'onboardingWizard.title')).toContain('55555');
  });

  it('T044: MSP layout keeps locale loading behind the feature flag and representative surfaces keep English fallbacks', () => {
    const layout = readRepoFile('server/src/app/msp/layout.tsx');
    const layoutClient = readRepoFile('server/src/app/msp/MspLayoutClient.tsx');

    expect(layout).toContain("'msp-i18n-enabled'");
    expect(layout).toMatch(/const locale = isMspI18nEnabled \? await getHierarchicalLocaleAction\(\) : null;/);
    expect(layoutClient).toContain("initialLocale={i18nEnabled ? (initialLocale || undefined) : 'en'}");
    expect(layoutClient).toContain('showPseudoLocales={i18nEnabled}');

    const representativeFiles = [
      ['packages/clients/src/components/clients/Clients.tsx', "useTranslation('msp/clients')"],
      ['packages/clients/src/components/contacts/ContactDetails.tsx', "useTranslation('msp/contacts')"],
      ['packages/assets/src/components/AssetDashboardClient.tsx', "useTranslation('msp/assets')"],
      ['packages/onboarding/src/components/OnboardingWizard.tsx', "useTranslation('msp/onboarding')"],
    ] as const;

    for (const [file, namespaceCall] of representativeFiles) {
      const source = readRepoFile(file);
      expect(source).toContain(namespaceCall);
      expect(source).toContain('defaultValue:');
    }
  });

  it('T045: German copy stays within reasonable length thresholds for overflow-sensitive surfaces', () => {
    const germanClients = readLocaleJson('de', 'clients');
    const germanContacts = readLocaleJson('de', 'contacts');
    const germanAssets = readLocaleJson('de', 'assets');
    const germanOnboarding = readLocaleJson('de', 'onboarding');

    const lengthChecks: Array<[Record<string, unknown>, string, number]> = [
      [germanClients, 'quickAddClient.clientType', 20],
      [germanClients, 'clientDetails.clientLocations', 24],
      [germanClients, 'billingConfiguration.contractLineOverlaps', 40],
      [germanContacts, 'contactPhoneNumbersEditor.fields.customTypeSearchPlaceholder', 64],
      [germanContacts, 'contactPortalTab.history.description', 64],
      [germanAssets, 'assetDashboardClient.metrics.automationReady.title', 36],
      [germanAssets, 'assetDetailDrawer.tabs.configuration', 20],
      [germanOnboarding, 'onboardingWizard.steps.ticketing', 20],
      [germanOnboarding, 'billingSetupStep.serviceTypes.import.actions.importSelected', 40],
      [germanOnboarding, 'ticketingConfigStep.statuses.fields.board.placeholder', 24],
    ];

    for (const [source, key, maxLength] of lengthChecks) {
      expect(getValue(source, key).length).toBeLessThanOrEqual(maxLength);
    }
  });
});
