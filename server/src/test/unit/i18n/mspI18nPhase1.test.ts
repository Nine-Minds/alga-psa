import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import i18next from 'i18next';
import { settingsNavigationSections } from '../../../config/menuConfig';

const repoRoot = path.resolve(__dirname, '../../../../..');

const readRepoFile = (relativePathFromRepoRoot: string): string => {
  return fs.readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
};

const fileExists = (relativePathFromRepoRoot: string): boolean => {
  return fs.existsSync(path.join(repoRoot, relativePathFromRepoRoot));
};

const readJson = (relativePathFromRepoRoot: string): any => {
  return JSON.parse(readRepoFile(relativePathFromRepoRoot));
};

const locales = ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl'] as const;

const featureNamespaces = ['tickets', 'projects', 'billing', 'documents', 'appointments'] as const;

const clientPortalNamespaces = {
  'client-portal': ['nav', 'dashboard', 'auth', 'account', 'profile', 'clientSettings', 'notifications'],
} as const;

function collectKeyPaths(obj: any, prefix = ''): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    paths.push(currentPath);
    paths.push(...collectKeyPaths(value, currentPath));
  }
  return paths;
}

function findDuplicateKeys(jsonText: string): string[] {
  const duplicates: string[] = [];
  const stack: Array<{ type: 'object' | 'array'; keys?: Set<string> }> = [];
  let i = 0;

  const skipWhitespace = () => {
    while (i < jsonText.length && /\s/.test(jsonText[i])) i += 1;
  };

  const parseString = () => {
    let result = '';
    i += 1; // skip opening quote
    while (i < jsonText.length) {
      const ch = jsonText[i];
      if (ch === '\\') {
        const next = jsonText[i + 1];
        result += ch + next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        break;
      }
      result += ch;
      i += 1;
    }
    return result;
  };

  while (i < jsonText.length) {
    skipWhitespace();
    const ch = jsonText[i];

    if (ch === '{') {
      stack.push({ type: 'object', keys: new Set() });
      i += 1;
      continue;
    }

    if (ch === '[') {
      stack.push({ type: 'array' });
      i += 1;
      continue;
    }

    if (ch === '}' || ch === ']') {
      stack.pop();
      i += 1;
      continue;
    }

    if (ch === '"') {
      const startIndex = i;
      const key = parseString();
      const savedIndex = i;
      skipWhitespace();
      if (jsonText[i] === ':' && stack.length > 0) {
        const ctx = stack[stack.length - 1];
        if (ctx.type === 'object' && ctx.keys) {
          if (ctx.keys.has(key)) {
            duplicates.push(key);
          } else {
            ctx.keys.add(key);
          }
        }
      } else {
        i = savedIndex;
      }
      if (startIndex === i) {
        i += 1;
      }
      continue;
    }

    i += 1;
  }

  return duplicates;
}

describe('MSP i18n Phase 1', () => {
  it('T001: msp-i18n-enabled flag exists with default false', () => {
    const src = readRepoFile('server/src/lib/feature-flags/featureFlags.ts');
    expect(src).toContain("'msp-i18n-enabled': false");
  });

  it('T002/T003: standard MSP layout gates locale fetch and passes locale when enabled', () => {
    const src = readRepoFile('server/src/app/msp/layout.tsx');
    expect(src).toContain('isMspI18nEnabled');
    expect(src).toMatch(/const locale = isMspI18nEnabled \? await getHierarchicalLocaleAction\(\) : null;/);
    expect(src).toMatch(/initialLocale=\{locale\}/);
    expect(src).toMatch(/i18nEnabled=\{isMspI18nEnabled\}/);
  });

  it('T004/T005/T010: standard MspLayoutClient wraps with I18nWrapper and preserves onboarding guard', () => {
    const src = readRepoFile('server/src/app/msp/MspLayoutClient.tsx');
    expect(src).toContain('if (!i18nEnabled)');
    expect(src).toContain('I18nWrapper');
    expect(src).toContain('portal="msp"');
    const guardIndex = src.indexOf('if (needsOnboarding && !isOnboardingPage)');
    const wrapperIndex = src.indexOf('<I18nWrapper');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(wrapperIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(wrapperIndex);
  });

  it('T006/T007/T008: EE MSP layout gates locale fetch and wraps with I18nWrapper', () => {
    const layout = readRepoFile('ee/server/src/app/msp/layout.tsx');
    const client = readRepoFile('ee/server/src/app/msp/MspLayoutClient.tsx');
    expect(layout).toMatch(/const locale = isMspI18nEnabled \? await getHierarchicalLocaleAction\(\) : null;/);
    expect(layout).toMatch(/initialLocale=\{locale\}/);
    expect(layout).toMatch(/i18nEnabled=\{isMspI18nEnabled\}/);
    expect(client).toContain('if (!i18nEnabled)');
    expect(client).toContain('I18nWrapper');
    expect(client).toContain('portal="msp"');
  });

  it('T009: MSP pages can use translations when flag is on (I18nWrapper present)', () => {
    const client = readRepoFile('server/src/app/msp/MspLayoutClient.tsx');
    expect(client).toContain('<I18nWrapper portal="msp"');
  });

  it('T011-T016: feature namespace files exist for all locales and are flattened', () => {
    for (const locale of locales) {
      for (const ns of featureNamespaces) {
        const file = `server/public/locales/${locale}/features/${ns}.json`;
        expect(fileExists(file)).toBe(true);
        const json = readJson(file);
        expect(typeof json).toBe('object');
        expect(json).not.toHaveProperty(ns);
      }
    }
  });

  it('T017: i18n loadPath supports nested namespaces', () => {
    const src = readRepoFile('packages/core/src/lib/i18n/config.ts');
    expect(src).toContain('/locales/{{lng}}/{{ns}}.json');
    // Also verify the re-export in packages/ui re-exports TRANSLATION_PATHS
    const uiSrc = readRepoFile('packages/ui/src/lib/i18n/config.ts');
    expect(uiSrc).toContain('TRANSLATION_PATHS');
  });

  it('T018-T020: client-portal namespace file exists and includes required top-level keys', () => {
    for (const locale of locales) {
      const clientPortal = readJson(`server/public/locales/${locale}/client-portal.json`);
      for (const key of clientPortalNamespaces['client-portal']) {
        expect(clientPortal).toHaveProperty(key);
      }
    }
  });

  it('T021-T028: client portal components use new namespaces and avoid legacy clientPortal namespace', () => {
    const files = [
      'packages/client-portal/src/components/tickets/TicketDetailsContainer.tsx',
      'packages/client-portal/src/components/tickets/ClientAddTicket.tsx',
      'packages/client-portal/src/components/tickets/TicketList.tsx',
      'packages/client-portal/src/components/tickets/TicketDetails.tsx',
      'packages/client-portal/src/components/projects/ProjectPhaseTasksView.tsx',
      'packages/client-portal/src/components/projects/ProjectTasksSection.tsx',
      'packages/client-portal/src/components/projects/ProjectPhasesSection.tsx',
      'packages/client-portal/src/components/projects/ClientKanbanBoard.tsx',
      'packages/client-portal/src/components/projects/ClientTaskListView.tsx',
      'packages/client-portal/src/components/projects/ProjectsOverviewPage.tsx',
      'packages/client-portal/src/components/projects/ProjectDetailView.tsx',
      'packages/client-portal/src/components/projects/ProjectDetailsContainer.tsx',
      'packages/client-portal/src/components/billing/BillingOverview.tsx',
      'packages/client-portal/src/components/billing/BillingOverviewTab.tsx',
      'packages/client-portal/src/components/billing/InvoicesTab.tsx',
      'packages/client-portal/src/components/billing/InvoiceDetailsDialog.tsx',
      'packages/client-portal/src/components/billing/ContractLineDetailsDialog.tsx',
      'packages/client-portal/src/components/appointments/RequestAppointmentModal.tsx',
      'packages/client-portal/src/components/appointments/AppointmentsPage.tsx',
      'packages/client-portal/src/components/appointments/AppointmentRequestDetailsPage.tsx',
    ];

    for (const file of files) {
      const src = readRepoFile(file);
      expect(src).not.toContain("useTranslation('clientPortal')");
    }

    const tickets = readRepoFile('packages/client-portal/src/components/tickets/TicketDetails.tsx');
    expect(tickets).toContain("useTranslation('features/tickets')");
    expect(tickets).not.toContain("t('tickets.");

    const projects = readRepoFile('packages/client-portal/src/components/projects/ProjectDetailView.tsx');
    expect(projects).toContain("useTranslation('features/projects')");
    expect(projects).not.toContain("t('projects.");

    const billing = readRepoFile('packages/client-portal/src/components/billing/BillingOverview.tsx');
    expect(billing).toContain("useTranslation('features/billing')");
    expect(billing).not.toContain("t('billing.");

    const appointments = readRepoFile('packages/client-portal/src/components/appointments/AppointmentsPage.tsx');
    expect(appointments).toContain("useTranslation('features/appointments')");
    expect(appointments).not.toContain("t('appointments.");
  });

  it('T029: no legacy clientPortal namespace usage remains in client portal UI', () => {
    const portalLayout = readRepoFile('packages/client-portal/src/components/layout/ClientPortalLayout.tsx');
    expect(portalLayout).toContain("useTranslation('client-portal')");
    expect(portalLayout).not.toContain("useTranslation('clientPortal')");
  });

  it('T030: legacy clientPortal.json files are removed', () => {
    for (const locale of locales) {
      expect(fileExists(`server/public/locales/${locale}/clientPortal.json`)).toBe(false);
    }
  });

  it('T031-T033: msp/core.json exists for all locales with required sections', () => {
    for (const locale of locales) {
      const file = readJson(`server/public/locales/${locale}/msp/core.json`);
      expect(file).toHaveProperty('nav');
      expect(file).toHaveProperty('sidebar');
      expect(file).toHaveProperty('settings');
      expect(file).toHaveProperty('header');
    }
  });

  it('T032: msp/core.json nav items match menuConfig entries', () => {
    const mspCore = readJson('server/public/locales/en/msp/core.json');
    const nav = mspCore.nav;
    expect(nav.home).toBe('Home');
    expect(nav.tickets).toBe('Tickets');
    expect(nav.projects).toBe('Projects');
    expect(nav.clients).toBe('Clients');
    expect(nav.contacts).toBe('Contacts');
    expect(nav.documents).toBe('Documents');
    expect(nav.assets).toBe('Assets');
    expect(nav.billing).toBe('Billing');
    expect(nav.extensions).toBe('Extensions');

    const settingsItems = settingsNavigationSections.flatMap((section) => section.items);
    const hasLanguage = settingsItems.some((item) => item.name === 'Language');
    expect(hasLanguage).toBe(true);
  });

  it('T034: msp translations resolve correctly for English', async () => {
    const mspCore = readJson('server/public/locales/en/msp/core.json');
    await i18next.init({
      lng: 'en',
      resources: { en: { 'msp/core': mspCore } },
      interpolation: { escapeValue: false },
    });

    expect(i18next.t('nav.home', { ns: 'msp/core' })).toBe('Home');
    expect(i18next.t('header.signOut', { ns: 'msp/core' })).toBe('Sign out');
  });

  it('T035-T041: MSP profile language preference is gated and uses LanguagePreference behavior', () => {
    const profile = readRepoFile('server/src/components/settings/profile/UserProfile.tsx');
    expect(profile).toContain("useFeatureFlag('msp-i18n-enabled'");
    expect(profile).toContain('<LanguagePreference');
    expect(profile).toContain('showNoneOption={true}');
    expect(profile).toContain('updateUserLocaleAction');

    const languagePreference = readRepoFile('packages/ui/src/components/LanguagePreference.tsx');
    expect(languagePreference).toContain('newValue === \'none\'');
    expect(languagePreference).toContain('onChange(null)');
    expect(languagePreference).toContain('setLocale(newLocale)');
  });

  it('T042-T047: MSP language settings UI and persistence wiring are present', () => {
    const mspSettings = readRepoFile('server/src/components/settings/general/MspLanguageSettings.tsx');
    expect(mspSettings).toContain('CustomSelect');
    expect(mspSettings).toContain('Available Languages');
    expect(mspSettings).toContain('updateTenantMspLocaleSettingsAction');
    expect(mspSettings).toContain('getTenantMspLocaleSettingsAction');

    const settingsPage = readRepoFile('server/src/components/settings/SettingsPage.tsx');
    expect(settingsPage).toContain('MspLanguageSettings');
    expect(settingsPage).toContain("useFeatureFlag('msp-i18n-enabled'");

    const sidebar = readRepoFile('server/src/components/layout/Sidebar.tsx');
    expect(sidebar).toContain('item.name !== \'Language\'');
  });

  it('T048-T049: MSP locale tenant actions read and write mspPortal settings', () => {
    const actions = readRepoFile('packages/tenancy/src/actions/tenant-actions/tenantMspLocaleActions.ts');
    expect(actions).toContain('getTenantMspLocaleSettingsAction');
    expect(actions).toContain('updateTenantMspLocaleSettingsAction');
    expect(actions).toContain('mspPortal');
  });

  it('T050-T052: hierarchical locale resolution prefers MSP org defaults for internal users', () => {
    const src = readRepoFile('packages/tenancy/src/actions/locale-actions/getHierarchicalLocale.ts');
    expect(src).toContain('mspPortal');
    expect(src).toContain('System default');
  });

  it('T053-T055: namespace JSON files are valid, duplicate-free, and aligned across locales', () => {
    const namespacePaths: string[] = [];

    for (const locale of locales) {
      for (const ns of featureNamespaces) {
        namespacePaths.push(`server/public/locales/${locale}/features/${ns}.json`);
      }
      namespacePaths.push(`server/public/locales/${locale}/client-portal.json`);
      namespacePaths.push(`server/public/locales/${locale}/msp/core.json`);
    }

    for (const file of namespacePaths) {
      const content = readRepoFile(file);
      expect(() => JSON.parse(content)).not.toThrow();
      const duplicates = findDuplicateKeys(content);
      expect(duplicates).toHaveLength(0);
    }

    const keySetsByNamespace: Record<string, string[]> = {};
    for (const ns of featureNamespaces) {
      const base = readJson(`server/public/locales/en/features/${ns}.json`);
      keySetsByNamespace[`features/${ns}`] = collectKeyPaths(base).sort();
    }
    const clientPortalBase = readJson('server/public/locales/en/client-portal.json');
    keySetsByNamespace['client-portal'] = collectKeyPaths(clientPortalBase).sort();

    for (const locale of locales) {
      for (const ns of featureNamespaces) {
        const current = collectKeyPaths(readJson(`server/public/locales/${locale}/features/${ns}.json`)).sort();
        expect(current).toEqual(keySetsByNamespace[`features/${ns}`]);
      }
      const currentClientPortal = collectKeyPaths(readJson(`server/public/locales/${locale}/client-portal.json`)).sort();
      expect(currentClientPortal).toEqual(keySetsByNamespace['client-portal']);
    }
  });
});
