import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const localeRoot = path.join(repoRoot, 'server/public/locales');
const productionLocales = ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl'] as const;
const pseudoLocales = ['xx', 'yy'] as const;

const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));

const readLocaleJson = (locale: string) =>
  readJson(`server/public/locales/${locale}/msp/core.json`);

const readLocaleText = (locale: string) =>
  fs.readFileSync(path.join(localeRoot, locale, 'msp/core.json'), 'utf8');

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

const expectedPseudoValue = (value: string, fill: '11111' | '55555'): string => {
  const variables = extractVariables(value);
  if (variables.length === 0) {
    return fill;
  }

  return `${fill} ${variables.join(' ')} ${fill}`;
};

describe('MSP core locale batch 2b-1', () => {
  const english = readLocaleJson('en');
  const englishLeaves = collectLeafEntries(english);

  it('T052: English msp/core.json contains the full batch-2b core key set with expected values', () => {
    const expectedEntries: Record<string, string> = {
      'nav.documentsAll': 'All Documents',
      'nav.knowledgeBase': 'Knowledge Base',
      'nav.billing.label': 'Billing',
      'nav.billing.sections.contracts': 'Contracts',
      'nav.billing.sections.invoicing': 'Invoicing',
      'nav.billing.sections.pricing': 'Pricing',
      'nav.billing.sections.trackingReports': 'Tracking & Reports',
      'nav.billing.contractTemplates': 'Contract Templates',
      'nav.billing.clientContracts': 'Client Contracts',
      'nav.billing.contractLinePresets': 'Contract Line Presets',
      'nav.billing.invoicing': 'Invoicing',
      'nav.billing.invoiceTemplates': 'Invoice Templates',
      'nav.billing.billingCycles': 'Billing Cycles',
      'nav.billing.servicePeriods': 'Service Periods',
      'nav.billing.serviceCatalog': 'Service Catalog',
      'nav.billing.products': 'Products',
      'nav.billing.taxRates': 'Tax Rates',
      'nav.billing.usageTracking': 'Usage Tracking',
      'nav.billing.reports': 'Reports',
      'nav.billing.accountingExports': 'Accounting Exports',
      'nav.controlPanel': 'Control Panel',
      'nav.workflowEditor': 'Workflow Editor',
      'nav.systemMonitoring': 'System Monitoring',
      'nav.jobMonitoring': 'Job Monitoring',
      'sidebar.goToDashboard': 'Go to dashboard',
      'sidebar.logoAlt': 'AlgaPSA Logo',
      'sidebar.expandSidebar': 'Expand sidebar',
      'sidebar.collapseSidebar': 'Collapse sidebar',
      'settings.tabs.language': 'Language',
      'settings.tabs.sla': 'SLA',
      'header.quickCreate.ariaLabel': 'Open quick create',
      'header.quickCreate.title': 'Quick Create',
      'header.quickCreate.heading': 'Create',
      'header.quickCreate.options.ticket.label': 'Ticket',
      'header.quickCreate.options.ticket.description': 'Create a new support ticket',
      'header.quickCreate.options.client.label': 'Client',
      'header.quickCreate.options.client.description': 'Add a new client to your system',
      'header.quickCreate.options.contact.label': 'Contact',
      'header.quickCreate.options.contact.description': 'Add a new contact person',
      'header.quickCreate.options.project.label': 'Project',
      'header.quickCreate.options.project.description': 'Start a new project',
      'header.quickCreate.options.asset.label': 'Asset',
      'header.quickCreate.options.asset.description': 'Add a new device to your workspace',
      'header.quickCreate.options.service.label': 'Service',
      'header.quickCreate.options.service.description': 'Add a new billable service',
      'header.quickCreate.options.product.label': 'Product',
      'header.quickCreate.options.product.description': 'Add a new product to your catalog',
      'header.jobs.ariaLabel': 'View background job activity',
      'header.jobs.title': 'Background Jobs',
      'header.jobs.description': 'Track imports, automation runs, and scheduled work.',
      'header.jobs.active': 'Active jobs',
      'header.jobs.queued': 'Queued jobs',
      'header.jobs.failedLast24h': 'Failed last 24h',
      'header.jobs.openJobCenter': 'Open Job Center',
      'header.breadcrumb.home': 'Home',
      'header.breadcrumb.dashboard': 'Dashboard',
      'header.tenantBadge.ariaLabel': 'Active tenant {{tenant}}',
      'header.themeToggle.ariaLabel': 'Theme toggle',
      'header.themeToggle.light': 'Light',
      'header.themeToggle.dark': 'Dark',
      'header.themeToggle.system': 'System',
      'header.themeToggle.selected': 'Selected',
      'dialogs.aiInterrupt.navigate.title': 'Leave page and cancel AI response?',
      'dialogs.aiInterrupt.navigate.message': 'An AI response or tool action is still in progress. Leaving this page now will cancel it.',
      'dialogs.aiInterrupt.navigate.confirm': 'Leave page',
      'dialogs.aiInterrupt.navigate.cancel': 'Stay on page',
      'dialogs.aiInterrupt.closeChat.title': 'Close chat and cancel AI response?',
      'dialogs.aiInterrupt.closeChat.message': 'An AI response or tool action is still in progress. Closing the chat now will cancel it.',
      'dialogs.aiInterrupt.closeChat.confirm': 'Close chat',
      'dialogs.aiInterrupt.closeChat.cancel': 'Keep chat open',
      'banners.trial.premiumConfirmed': 'Premium confirmed — starts next billing cycle',
      'banners.trial.dayLeft': '1 day left',
      'banners.trial.daysLeft': '{{count}} days left',
      'banners.trial.premiumTrial': 'Premium Trial: {{daysLabel}} — confirm to keep',
      'banners.trial.stripeTrial': '{{tier}} Trial: {{daysLabel}}',
      'banners.paymentFailed.message': 'Payment failed — Update payment method',
      'banners.paymentFailed.portalError': 'Failed to open billing portal',
      'banners.platformNotification.learnMore': 'Learn More',
      'banners.platformNotification.dismiss': 'Dismiss notification',
      'quickCreate.success.asset': 'Asset created successfully',
      'quickCreate.success.ticket': 'Ticket #{{number}} created successfully',
      'quickCreate.success.client': 'Client "{{name}}" created successfully',
      'quickCreate.success.contact': '{{name}} added successfully',
      'quickCreate.success.project': 'Project "{{name}}" created successfully',
      'quickCreate.success.service': 'Service created successfully',
      'quickCreate.success.product': 'Product created successfully',
      'quickCreate.errors.loadClients': 'Failed to load clients',
      'quickCreate.errors.loadServiceTypes': 'Failed to load service types',
      'quickCreate.dialogTitles.contact': 'Add New Contact',
      'quickCreate.dialogTitles.project': 'Add New Project',
      'quickCreate.dialogTitles.service': 'Add New Service',
      'rightSidebar.title': 'Chat',
      'rightSidebar.enterpriseOnly': 'The chat feature is only available in the Enterprise Edition.',
    };

    for (const [key, value] of Object.entries(expectedEntries)) {
      expect(getValue(english, key)).toBe(value);
    }
  });

  it('T053/T065: production locale files are valid JSON and match the English key structure', () => {
    const englishKeys = [...englishLeaves.keys()].sort();

    for (const locale of productionLocales) {
      const content = readLocaleText(locale);
      expect(() => JSON.parse(content)).not.toThrow();

      const localeKeys = [...collectLeafEntries(readLocaleJson(locale)).keys()].sort();
      expect(localeKeys).toEqual(englishKeys);
    }
  });

  it('T054/T055: pseudo-locale files mirror English keys and preserve interpolation placeholders', () => {
    for (const locale of pseudoLocales) {
      const fill = locale === 'xx' ? '11111' : '55555';
      const localeLeaves = collectLeafEntries(readLocaleJson(locale));
      expect([...localeLeaves.keys()].sort()).toEqual([...englishLeaves.keys()].sort());

      for (const [key, value] of englishLeaves) {
        expect(localeLeaves.get(key)).toBe(expectedPseudoValue(value, fill));
      }
    }
  });

  it('T056: Italian accent audit keeps the expected accented forms in msp/core.json', () => {
    const italian = readLocaleText('it');
    expect(italian).toContain('funzionalità');
    expect(italian).toContain('è');
    expect(italian).toContain('verrà');
    expect(italian).not.toContain('funzionalita');
    expect(italian).not.toContain(' verra ');
  });

  it('T057: billing labels are populated consistently across all locales', () => {
    const billingPaths = [
      'nav.billing.label',
      'nav.billing.sections.contracts',
      'nav.billing.contractTemplates',
      'nav.billing.invoiceTemplates',
      'nav.billing.servicePeriods',
      'nav.billing.accountingExports',
      'settings.tabs.billing',
    ];

    for (const locale of productionLocales) {
      const localeJson = readLocaleJson(locale);
      for (const billingPath of billingPaths) {
        const value = getValue(localeJson, billingPath);
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it('T058-T061: xx pseudo-locale resolves representative sidebar, settings, billing, and quick-create keys to 11111', () => {
    const xx = readLocaleJson('xx');

    expect(getValue(xx, 'sidebar.goToDashboard')).toBe('11111');
    expect(getValue(xx, 'header.quickCreate.title')).toBe('11111');
    expect(getValue(xx, 'header.breadcrumb.home')).toBe('11111');
    expect(getValue(xx, 'settings.sections.organizationAccess')).toBe('11111');
    expect(getValue(xx, 'settings.tabs.language')).toBe('11111');
    expect(getValue(xx, 'nav.billing.sections.contracts')).toBe('11111');
    expect(getValue(xx, 'nav.billing.contractTemplates')).toBe('11111');
    expect(getValue(xx, 'nav.billing.servicePeriods')).toBe('11111');
    expect(getValue(xx, 'header.quickCreate.options.ticket.label')).toBe('11111');
    expect(getValue(xx, 'header.quickCreate.options.ticket.description')).toBe('11111');
  });

  it('T062: German overflow-sensitive labels stay within reasonable length thresholds', () => {
    const german = readLocaleJson('de');
    const lengthChecks: Array<[string, number]> = [
      ['sidebar.expandSidebar', 28],
      ['sidebar.collapseSidebar', 28],
      ['header.quickCreate.title', 24],
      ['header.jobs.openJobCenter', 24],
      ['nav.billing.contractLinePresets', 32],
      ['header.quickCreate.options.asset.description', 60],
    ];

    for (const [key, maxLength] of lengthChecks) {
      expect(getValue(german, key).length).toBeLessThanOrEqual(maxLength);
    }
  });

  it('T064: interpolation variables are preserved exactly across all production locales', () => {
    for (const locale of productionLocales.filter((locale) => locale !== 'en')) {
      const localeLeaves = collectLeafEntries(readLocaleJson(locale));
      for (const [key, englishValue] of englishLeaves) {
        expect(extractVariables(localeLeaves.get(key) ?? '')).toEqual(extractVariables(englishValue));
      }
    }
  });
});
