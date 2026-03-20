import { describe, expect, it } from 'vitest';
import type { NavigationSection, MenuItem } from '../../../config/menuConfig';
import {
  billingNavigationSections,
  bottomMenuItems,
  extensionsNavigationSections,
  navigationSections,
  settingsNavigationSections,
} from '../../../config/menuConfig';
import { Home } from 'lucide-react';

const flattenItems = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((item) => [item, ...(item.subItems ? flattenItems(item.subItems) : [])]);

const collectSectionItems = (sections: NavigationSection[]): MenuItem[] =>
  sections.flatMap((section) => flattenItems(section.items));

describe('menuConfig i18n metadata', () => {
  it('T001: MenuItem accepts an optional translationKey field', () => {
    const item: MenuItem = {
      name: 'Home',
      translationKey: 'nav.home',
      icon: Home,
      href: '/msp/dashboard',
    };

    expect(item.translationKey).toBe('nav.home');
  });

  it('T002: NavigationSection accepts an optional translationKey field', () => {
    const section: NavigationSection = {
      title: 'Contracts',
      translationKey: 'nav.billing.sections.contracts',
      items: [],
    };

    expect(section.translationKey).toBe('nav.billing.sections.contracts');
  });

  it('T003: all top-level main navigation items have the expected nav.* translation keys', () => {
    const expectedKeys = [
      'nav.home',
      'nav.userActivities',
      'nav.tickets',
      'nav.surveys',
      'nav.projects',
      'nav.clients',
      'nav.contacts',
      'nav.documents',
      'nav.assets',
      'nav.timeManagement',
      'nav.billing.label',
      'nav.schedule',
      'nav.technicianDispatch',
      'nav.workflows',
      'nav.systemMonitoring',
      'nav.extensions',
    ];

    expect(navigationSections).toHaveLength(1);
    expect(navigationSections[0].items.map((item) => item.translationKey)).toEqual(expectedKeys);
  });

  it('T004: all main navigation sub-items have translation keys', () => {
    const keyedSubItems = navigationSections[0].items
      .filter((item) => item.subItems)
      .flatMap((item) => item.subItems ?? []);

    expect(keyedSubItems.map((item) => item.translationKey)).toEqual([
      'nav.projectsAll',
      'nav.projectsTemplates',
      'nav.documentsAll',
      'nav.knowledgeBase',
      'nav.timeEntry',
      'nav.approvals',
      'nav.controlPanel',
      'nav.workflowEditor',
      'nav.jobMonitoring',
      'nav.emailLogs',
    ]);
  });

  it('T005: bottom menu items and sub-items have translation keys', () => {
    expect(flattenItems(bottomMenuItems).map((item) => item.translationKey)).toEqual([
      'sidebar.settings',
      'settings.tabs.general',
      'settings.tabs.profile',
      'settings.tabs.security',
      'sidebar.support',
    ]);
  });

  it('T006: settings navigation sections use settings.sections.* translation keys', () => {
    expect(settingsNavigationSections.map((section) => section.translationKey)).toEqual([
      'settings.sections.organizationAccess',
      'settings.sections.workManagement',
      'settings.sections.timeBilling',
      'settings.sections.communication',
      'settings.sections.dataIntegration',
      'settings.sections.experimental',
    ]);
  });

  it('T007: settings navigation items including Language and SLA use settings.tabs.* translation keys', () => {
    expect(collectSectionItems(settingsNavigationSections).map((item) => item.translationKey)).toEqual([
      'settings.tabs.general',
      'settings.tabs.users',
      'settings.tabs.teams',
      'settings.tabs.language',
      'settings.tabs.clientPortal',
      'settings.tabs.ticketing',
      'settings.tabs.sla',
      'settings.tabs.projects',
      'settings.tabs.interactions',
      'settings.tabs.timeEntry',
      'settings.tabs.billing',
      'settings.tabs.notifications',
      'settings.tabs.email',
      'settings.tabs.secrets',
      'settings.tabs.importExport',
      'settings.tabs.integrations',
      'settings.tabs.extensions',
      'settings.tabs.experimentalFeatures',
    ]);
  });

  it('T008: billing navigation section titles use nav.billing.sections.* translation keys', () => {
    expect(billingNavigationSections.map((section) => section.translationKey)).toEqual([
      'nav.billing.sections.contracts',
      'nav.billing.sections.invoicing',
      'nav.billing.sections.pricing',
      'nav.billing.sections.trackingReports',
    ]);
  });

  it('T009: billing navigation items use nav.billing.* translation keys', () => {
    expect(collectSectionItems(billingNavigationSections).map((item) => item.translationKey)).toEqual([
      'nav.billing.contractTemplates',
      'nav.billing.clientContracts',
      'nav.billing.contractLinePresets',
      'nav.billing.invoicing',
      'nav.billing.invoiceTemplates',
      'nav.billing.billingCycles',
      'nav.billing.serviceCatalog',
      'nav.billing.products',
      'nav.billing.taxRates',
      'nav.billing.usageTracking',
      'nav.billing.reports',
      'nav.billing.accountingExports',
    ]);
  });

  it('F006 wiring: extensions navigation item exposes sidebar settings translation key', () => {
    expect(extensionsNavigationSections[0].items.map((item) => item.translationKey)).toEqual([
      'sidebar.settings',
    ]);
  });
});
