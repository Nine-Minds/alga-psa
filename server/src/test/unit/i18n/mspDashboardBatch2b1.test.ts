import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTE_NAMESPACES } from '@alga-psa/core/i18n/config';
import { STEP_DEFINITIONS } from '@alga-psa/onboarding/lib';

const repoRoot = path.resolve(__dirname, '../../../../..');
const productionLocales = ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl'] as const;
const pseudoLocales = ['xx', 'yy'] as const;

const readJson = (relativePath: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));

const readLocaleJson = (locale: string) =>
  readJson(`server/public/locales/${locale}/msp/dashboard.json`);

const readLocaleText = (locale: string) =>
  fs.readFileSync(path.join(repoRoot, `server/public/locales/${locale}/msp/dashboard.json`), 'utf8');

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

  return variables.map((v) => `${fill} ${v}`).join(' ') + ` ${fill}`;
};

describe('MSP dashboard locale batch 2b-1', () => {
  const english = readLocaleJson('en');
  const englishLeaves = collectLeafEntries(english);

  it('T070: English msp/dashboard.json contains the expected dashboard and onboarding keys', () => {
    const expectedEntries: Record<string, string> = {
      'welcome.title': 'Welcome to Your MSP Command Center',
      'welcome.description': 'Track onboarding progress, configure critical services, and keep every client experience consistent.',
      'welcome.titleCommunity': 'Welcome back',
      'welcome.descriptionCommunity': 'Jump into tickets, scheduling, projects, and reporting from your dashboard.',
      'features.heading': 'Platform Features',
      'features.comingSoon': 'Coming soon!',
      'features.tickets.title': 'Ticket Management',
      'features.tickets.description': 'Streamline support with routing, SLA tracking, and guided workflows.',
      'features.monitoring.title': 'System Monitoring',
      'features.monitoring.description': 'Watch critical signals across clients and trigger automation when needed.',
      'features.security.title': 'Security Management',
      'features.security.description': 'Manage policies, approvals, and audit responses in one place.',
      'features.projects.title': 'Project Management',
      'features.projects.description': 'Organize delivery plans, tasks, and milestones for every engagement.',
      'features.reports.title': 'Reporting & Analytics',
      'features.reports.description': 'Build rollups on utilization, SLA attainment, and profitability.',
      'features.schedule.title': 'Schedule Management',
      'features.schedule.description': 'Coordinate onsite visits and remote sessions with bi-directional sync.',
      'knowledgeBase.title': 'Need a deeper dive?',
      'knowledgeBase.description': 'Explore deployment runbooks and best practices in the knowledge base.',
      'knowledgeBase.cta': 'Visit resources',
      'onboarding.completeTitle': 'Onboarding complete',
      'onboarding.incompleteTitle': 'Complete your setup',
      'onboarding.completeDescription': "You're ready to use the full MSP dashboard experience.",
      'onboarding.incompleteDescription': 'Work through each step to unlock the full MSP dashboard experience.',
      'onboarding.stepLabel': 'STEP {{index}}',
      'onboarding.badges.complete': 'Complete',
      'onboarding.badges.notStarted': 'Not Started',
      'onboarding.badges.inProgress': 'In Progress',
      'onboarding.badges.blocked': 'Blocked',
      'onboarding.progress.label': 'PROGRESS',
      'onboarding.progress.steps': '{{completed}} of {{total}} Steps',
      'onboarding.progress.messageStart': 'Just getting started!',
      'onboarding.progress.messageComplete': 'All set - great job!',
      'onboarding.progress.messageInProgress': "Keep going - you've got this!",
      'onboarding.substeps.dataImport': 'Complete your first import OR create 5 contacts',
      'onboarding.substeps.identity.addProvider': 'Add an SSO provider',
      'onboarding.substeps.identity.linkTeamMember': 'Link the first team member',
      'onboarding.substeps.portal.customDomain': 'Portal custom domain',
      'onboarding.substeps.portal.branding': 'Portal color and logo customizations',
      'onboarding.substeps.portal.inviteFirstContact': 'Invite your first contact to the portal',
      'onboarding.substeps.createContacts': 'Create your first 5 contacts',
      'onboarding.substeps.calendar.addProvider': 'Add a calendar provider',
      'onboarding.substeps.calendar.connectAuthorize': 'Connect and authorize the provider',
      'onboarding.substeps.email.configureInbound': 'Configure inbound email',
      'onboarding.substeps.email.configureOutboundDomain': 'Configure outbound custom email domain',
      'onboarding.cta.completed': 'Completed',
      'onboarding.cta.hiding': 'Hiding...',
      'onboarding.cta.hide': 'Hide',
      'onboarding.cta.dismiss': 'Dismiss {{title}}',
      'onboarding.cta.restoring': 'Restoring...',
      'onboarding.hidden.title': 'Hidden setup cards ({{count}})',
      'onboarding.hidden.subtitle': 'Restore any card if you need it later.',
      'onboarding.checklist.title': 'Onboarding checklist',
      'onboarding.checklist.progress': '{{completed}} of {{total}} tasks complete',
      'onboarding.checklist.completeTitle': 'Configuration complete',
      'onboarding.checklist.completeDescription': 'Invite clients to experience your branded portal.',
      'onboarding.checklist.inviteCta': 'Invite clients',
      'onboarding.checklist.viewButton': 'View onboarding checklist',
      'onboarding.steps.identity.title': 'Secure Identity & SSO',
      'onboarding.steps.identity.description': 'Connect Google Workspace or Microsoft 365 so admins sign in with managed identities.',
      'onboarding.steps.identity.cta': 'Connect SSO',
      'onboarding.steps.portal.title': 'Set Up Customer Portal',
      'onboarding.steps.portal.description': 'Configure your portal so customers can sign in on your domain with your branding.',
      'onboarding.steps.portal.cta': 'Open Portal Settings',
      'onboarding.steps.dataImport.title': 'Import Core Data',
      'onboarding.steps.dataImport.description': 'Add contacts so you can start working for clients and keep workflows moving.',
      'onboarding.steps.dataImport.cta': 'Create Contacts',
      'onboarding.steps.calendar.title': 'Calendar Sync',
      'onboarding.steps.calendar.description': 'Connect Google or Outlook calendars to keep dispatch and client appointments aligned.',
      'onboarding.steps.calendar.cta': 'Configure Calendar',
      'onboarding.steps.email.title': 'Configure Email',
      'onboarding.steps.email.description': 'Set up inbound ticket email and verify an outbound sending domain for reliable delivery.',
      'onboarding.steps.email.cta': 'Configure Email',
      'onboarding.blockers.identity.linkedAccountsUnavailable': 'Unable to verify linked team members right now.',
      'onboarding.blockers.identity.noLinkedUsers': 'No users are linked to an identity provider yet. Ask an MSP admin to connect Google or Microsoft.',
      'onboarding.blockers.identity.addProviderCredentials': 'Add Google Workspace or Microsoft 365 credentials to enable SSO for your team.',
      'onboarding.blockers.identity.configurationUnavailable': 'SSO provider configuration is unavailable in this environment.',
      'onboarding.blockers.identity.loadFailed': 'Unable to load SSO configuration status.',
      'onboarding.blockers.portal.loadFailed': 'Unable to load client portal domain status.',
      'onboarding.blockers.import.loadFailed': 'Unable to load import history.',
      'onboarding.blockers.calendar.providerAttention': '{{provider}} requires attention before syncing can resume.',
      'onboarding.blockers.calendar.loadFailed': 'Unable to load calendar integrations.',
      'onboarding.blockers.email.enterpriseOnly': 'Managed email domains are only available in the Enterprise edition.',
      'onboarding.blockers.email.tenantRequired': 'Tenant context is required to load email onboarding status.',
      'onboarding.blockers.email.loadFailed': 'Unable to load managed email domains.',
      'onboarding.blockers.email.verificationFailed': 'Verification for {{domain}} failed.',
      'onboarding.errors.dismissFailed': 'Failed to dismiss onboarding step.',
      'onboarding.errors.restoreFailed': 'Failed to restore onboarding step.',
    };

    for (const [key, value] of Object.entries(expectedEntries)) {
      expect(getValue(english, key)).toBe(value);
    }
  });

  it('T088-T090: step definitions expose translation keys for all five step titles, descriptions, and CTAs', () => {
    expect(Object.values(STEP_DEFINITIONS).map((step) => step.titleKey)).toEqual([
      'onboarding.steps.identity.title',
      'onboarding.steps.portal.title',
      'onboarding.steps.dataImport.title',
      'onboarding.steps.calendar.title',
      'onboarding.steps.email.title',
    ]);

    expect(Object.values(STEP_DEFINITIONS).map((step) => step.descriptionKey)).toEqual([
      'onboarding.steps.identity.description',
      'onboarding.steps.portal.description',
      'onboarding.steps.dataImport.description',
      'onboarding.steps.calendar.description',
      'onboarding.steps.email.description',
    ]);

    expect(Object.values(STEP_DEFINITIONS).map((step) => step.ctaLabelKey)).toEqual([
      'onboarding.steps.identity.cta',
      'onboarding.steps.portal.cta',
      'onboarding.steps.dataImport.cta',
      'onboarding.steps.calendar.cta',
      'onboarding.steps.email.cta',
    ]);
  });

  it('T091/T092: ROUTE_NAMESPACES loads msp/dashboard for /msp and /msp/dashboard', () => {
    expect(ROUTE_NAMESPACES['/msp']).toEqual(['common', 'msp/core', 'msp/dashboard']);
    expect(ROUTE_NAMESPACES['/msp/dashboard']).toEqual(['common', 'msp/core', 'msp/dashboard']);
  });

  it('T093/T100: production dashboard locale files are valid JSON and match the English key structure', () => {
    const englishKeys = [...englishLeaves.keys()].sort();

    for (const locale of productionLocales) {
      const content = readLocaleText(locale);
      expect(() => JSON.parse(content)).not.toThrow();
      expect([...collectLeafEntries(readLocaleJson(locale)).keys()].sort()).toEqual(englishKeys);
    }
  });

  it('T094/T095: pseudo dashboard locale files mirror English keys and preserve interpolation placeholders', () => {
    for (const locale of pseudoLocales) {
      const fill = locale === 'xx' ? '11111' : '55555';
      const localeLeaves = collectLeafEntries(readLocaleJson(locale));
      expect([...localeLeaves.keys()].sort()).toEqual([...englishLeaves.keys()].sort());

      for (const [key, value] of englishLeaves) {
        expect(localeLeaves.get(key)).toBe(expectedPseudoValue(value, fill));
      }
    }
  });

  it('T096: Italian dashboard locale keeps accented forms intact', () => {
    const italian = readLocaleText('it');
    expect(italian).toContain('Funzionalità');
    expect(italian).not.toContain('Funzionalita');
  });

  it('T097: xx pseudo-locale resolves representative dashboard keys to 11111', () => {
    const xx = readLocaleJson('xx');
    expect(getValue(xx, 'welcome.title')).toBe('11111');
    expect(getValue(xx, 'features.tickets.title')).toBe('11111');
    expect(getValue(xx, 'knowledgeBase.cta')).toBe('11111');
    expect(getValue(xx, 'onboarding.completeTitle')).toBe('11111');
    expect(getValue(xx, 'onboarding.checklist.title')).toBe('11111');
  });

  it('T098: German dashboard copy stays within reasonable length thresholds for cards and onboarding text', () => {
    const german = readLocaleJson('de');
    const lengthChecks: Array<[string, number]> = [
      ['features.tickets.title', 24],
      ['features.reports.title', 28],
      ['features.schedule.description', 95],
      ['onboarding.incompleteTitle', 40],
      ['onboarding.substeps.dataImport', 80],
      ['onboarding.checklist.viewButton', 40],
    ];

    for (const [key, maxLength] of lengthChecks) {
      expect(getValue(german, key).length).toBeLessThanOrEqual(maxLength);
    }
  });

  it('T099: interpolation variables are preserved exactly across all production locales', () => {
    for (const locale of productionLocales.filter((locale) => locale !== 'en')) {
      const localeLeaves = collectLeafEntries(readLocaleJson(locale));
      for (const [key, englishValue] of englishLeaves) {
        expect(extractVariables(localeLeaves.get(key) ?? '')).toEqual(extractVariables(englishValue));
      }
    }
  });
});
