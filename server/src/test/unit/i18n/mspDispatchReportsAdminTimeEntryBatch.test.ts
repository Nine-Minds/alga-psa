import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_NAMESPACES } from '@alga-psa/core/i18n/config';

const repoRoot = path.resolve(__dirname, '../../../../..');
const productionLocales = ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl'] as const;
const pseudoLocales = ['xx', 'yy'] as const;
const batchNamespaces = ['dispatch', 'reports', 'admin', 'time-entry'] as const;

const readRepoFile = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(readRepoFile(relativePath));

const readLocaleJson = (locale: string, namespace: (typeof batchNamespaces)[number]) =>
  readJson(`server/public/locales/${locale}/msp/${namespace}.json`);

const readLocaleText = (locale: string, namespace: (typeof batchNamespaces)[number]) =>
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

describe('MSP dispatch/reports/admin/time-entry locale batch', () => {
  it('T014/T024/T034/T035/T041: pseudo-locale files mirror English keys and xx exposes representative QA coverage', () => {
    const representativeXXKeys: Array<[(typeof batchNamespaces)[number], string]> = [
      ['reports', 'contractReports.tabs.revenue'],
      ['reports', 'reportsPage.cards.timeUtilization.title'],
      ['admin', 'telemetry.page.title'],
      ['admin', 'email.tabs.inbound'],
      ['time-entry', 'timePeriodList.title'],
      ['time-entry', 'timeEntryForm.labels.service'],
      ['time-entry', 'workItemList.pagination.previous'],
      ['time-entry', 'timeSheetHeader.title'],
      ['time-entry', 'workItemPicker.actions.createAdHocEntry'],
      ['time-entry', 'approval.sections.summary'],
      ['time-entry', 'managerDashboard.title'],
      ['time-entry', 'managerDashboard.access.title'],
    ];

    for (const namespace of batchNamespaces) {
      const englishLeaves = collectLeafEntries(readLocaleJson('en', namespace));
      const englishKeys = [...englishLeaves.keys()].sort();

      for (const locale of pseudoLocales) {
        const localeLeaves = collectLeafEntries(readLocaleJson(locale, namespace));
        expect([...localeLeaves.keys()].sort()).toEqual(englishKeys);
      }
    }

    const xx = {
      reports: readLocaleJson('xx', 'reports'),
      admin: readLocaleJson('xx', 'admin'),
      timeEntry: readLocaleJson('xx', 'time-entry'),
    };

    expect(getValue(xx.reports, 'contractReports.tabs.revenue')).toBe('11111');
    expect(getValue(xx.reports, 'reportsPage.cards.timeUtilization.title')).toBe('11111');
    expect(getValue(xx.admin, 'telemetry.page.title')).toBe('11111');
    expect(getValue(xx.admin, 'email.tabs.inbound')).toBe('11111');
    expect(getValue(xx.timeEntry, 'timePeriodList.title')).toBe('11111');
    expect(getValue(xx.timeEntry, 'timeEntryForm.labels.service')).toBe('11111');
    expect(getValue(xx.timeEntry, 'workItemList.pagination.previous')).toBe('11111');
    expect(getValue(xx.timeEntry, 'timeSheetHeader.title')).toBe('11111');
    expect(getValue(xx.timeEntry, 'workItemPicker.actions.createAdHocEntry')).toBe('11111');
    expect(getValue(xx.timeEntry, 'approval.sections.summary')).toBe('11111');
    expect(getValue(xx.timeEntry, 'managerDashboard.title')).toBe('11111');
    expect(getValue(xx.timeEntry, 'managerDashboard.access.title')).toBe('11111');

    for (const [namespace, key] of representativeXXKeys) {
      const localeJson = readLocaleJson('xx', namespace);
      expect(getValue(localeJson, key)).toContain('11111');
    }
  });

  it('T022/T032: ROUTE_NAMESPACES loads admin, time-entry, and reused ticket namespaces on the expected MSP routes', () => {
    expect(ROUTE_NAMESPACES['/msp/settings']).toEqual([
      'common',
      'msp/core',
      'msp/settings',
      'msp/admin',
      'msp/email-providers',
      'features/projects',
      'features/tickets',
    ]);

    expect(ROUTE_NAMESPACES['/msp/service-requests']).toEqual([
      'common',
      'msp/core',
      'features/tickets',
    ]);
    expect(ROUTE_NAMESPACES['/msp/time-entry']).toEqual(['common', 'msp/core', 'msp/time-entry']);
    expect(ROUTE_NAMESPACES['/msp/time-sheet-approvals']).toEqual([
      'common',
      'msp/core',
      'msp/time-entry',
    ]);
    expect(ROUTE_NAMESPACES['/msp/time-management']).toEqual([
      'common',
      'msp/core',
      'msp/time-entry',
    ]);
  });

  it('T023/T033: Italian admin and time-entry locale files stay clear of the accent-audit anti-patterns', () => {
    const accentAuditPattern = / e [a-z]| puo | gia | verra | funzionalita| necessario/;

    expect(readLocaleText('it', 'admin')).not.toMatch(accentAuditPattern);
    expect(readLocaleText('it', 'time-entry')).not.toMatch(accentAuditPattern);
  });

  it('T043: MSP layout keeps locale loading behind the feature flag and representative translated surfaces keep English default values', () => {
    const layout = readRepoFile('server/src/app/msp/layout.tsx');
    const layoutClient = readRepoFile('server/src/app/msp/MspLayoutClient.tsx');

    expect(layout).toContain("'msp-i18n-enabled'");
    expect(layout).toMatch(/const locale = isMspI18nEnabled \? await getHierarchicalLocaleAction\(\) : null;/);
    expect(layoutClient).toContain("initialLocale={i18nEnabled ? (initialLocale || undefined) : 'en'}");
    expect(layoutClient).toContain('showPseudoLocales={i18nEnabled}');

    const representativeFiles = [
      ['packages/scheduling/src/components/technician-dispatch/WorkItemListPanel.tsx', "useTranslation('msp/dispatch')"],
      ['packages/billing/src/components/billing-dashboard/reports/ContractReports.tsx', "useTranslation('msp/reports')"],
      ['packages/ui/src/components/settings/admin/TenantTelemetrySettings.tsx', "useTranslation('msp/admin')"],
      ['packages/scheduling/src/components/time-management/time-entry/TimePeriodList.tsx', "useTranslation('msp/time-entry')"],
    ] as const;

    for (const [file, namespaceCall] of representativeFiles) {
      const source = readRepoFile(file);
      expect(source).toContain(namespaceCall);
      expect(source).toContain('defaultValue:');
    }
  });

  it('T044: German copy stays within reasonable length thresholds for overflow-sensitive MSP surfaces', () => {
    const germanDispatch = readLocaleJson('de', 'dispatch');
    const germanReports = readLocaleJson('de', 'reports');
    const germanAdmin = readLocaleJson('de', 'admin');
    const germanTimeEntry = readLocaleJson('de', 'time-entry');

    const lengthChecks: Array<[Record<string, unknown>, string, number]> = [
      [germanDispatch, 'schedule.showInactive', 30],
      [germanDispatch, 'workItems.filterPlaceholder', 28],
      [germanReports, 'contractReports.table.daysUntilExpiration', 24],
      [germanReports, 'contractReports.table.monthlyRecurring', 28],
      [germanAdmin, 'telemetry.toggles.allowUserOptOut.title', 30],
      [germanAdmin, 'email.providerConfig.options.smtp', 40],
      [germanTimeEntry, 'timePeriodList.columns.hoursEntered', 24],
      [germanTimeEntry, 'timeSheetHeader.labels.showIntervals', 24],
    ];

    for (const [source, key, maxLength] of lengthChecks) {
      expect(getValue(source, key).length).toBeLessThanOrEqual(maxLength);
    }
  });

  it('production locale files for reports, admin, and time-entry remain structurally aligned with English', () => {
    for (const namespace of ['reports', 'admin', 'time-entry'] as const) {
      const englishLeaves = collectLeafEntries(readLocaleJson('en', namespace));
      const englishKeys = [...englishLeaves.keys()].sort();

      for (const locale of productionLocales) {
        const localeLeaves = collectLeafEntries(readLocaleJson(locale, namespace));
        expect([...localeLeaves.keys()].sort()).toEqual(englishKeys);
      }
    }
  });
});
