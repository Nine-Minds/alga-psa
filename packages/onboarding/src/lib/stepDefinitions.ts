import type { LucideIcon } from 'lucide-react';
import {
  ShieldCheck,
  Globe,
  FileSpreadsheet,
  CalendarCheck2,
  MailCheck,
} from 'lucide-react';
import { CALENDAR_SETUP_ENTRY_PATH } from '@alga-psa/types';
import type { OnboardingStepId } from '../actions/onboarding-progress';

export type OnboardingProductCode = 'psa' | 'co_managed';

export interface StepDefinition {
  id: OnboardingStepId;
  title: string;
  titleKey: string;
  description: string;
  descriptionKey: string;
  icon: LucideIcon;
  ctaHref: string;
  ctaLabel: string;
  ctaLabelKey: string;
  analyticsTarget: string;
  /** Completion criterion shown under the description, when the substeps don't say it. */
  caption?: string;
  captionKey?: string;
}

export const STEP_DEFINITIONS: Record<OnboardingStepId, StepDefinition> = {
  identity_sso: {
    id: 'identity_sso',
    title: 'Secure Identity & SSO',
    titleKey: 'onboarding.steps.identity.title',
    description: 'Connect Google Workspace or Microsoft 365 so admins sign in with managed identities.',
    descriptionKey: 'onboarding.steps.identity.description',
    icon: ShieldCheck,
    ctaHref: '/msp/profile?tab=single-sign-on',
    ctaLabel: 'Connect SSO',
    ctaLabelKey: 'onboarding.steps.identity.cta',
    analyticsTarget: 'identity_sso',
  },
  client_portal_domain: {
    id: 'client_portal_domain',
    title: 'Set Up Customer Portal',
    titleKey: 'onboarding.steps.portal.title',
    description: 'Configure your portal so customers can sign in on your domain with your branding.',
    descriptionKey: 'onboarding.steps.portal.description',
    icon: Globe,
    ctaHref: '/msp/settings?tab=client-portal',
    ctaLabel: 'Open Portal Settings',
    ctaLabelKey: 'onboarding.steps.portal.cta',
    analyticsTarget: 'client_portal_domain',
  },
  data_import: {
    id: 'data_import',
    title: 'Import Core Data',
    titleKey: 'onboarding.steps.dataImport.title',
    description: 'Add contacts so you can start working for clients and keep workflows moving.',
    descriptionKey: 'onboarding.steps.dataImport.description',
    icon: FileSpreadsheet,
    ctaHref: '/msp/contacts',
    ctaLabel: 'Create Contacts',
    ctaLabelKey: 'onboarding.steps.dataImport.cta',
    analyticsTarget: 'data_import',
    caption: 'Complete your first import OR create 5 contacts',
    captionKey: 'onboarding.substeps.dataImport',
  },
  calendar_sync: {
    id: 'calendar_sync',
    title: 'Calendar Sync',
    titleKey: 'onboarding.steps.calendar.title',
    description: 'Connect Google or Outlook calendars to keep dispatch and client appointments aligned.',
    descriptionKey: 'onboarding.steps.calendar.description',
    icon: CalendarCheck2,
    // Product-neutral: the integrations page is denied to co-managed workspaces.
    ctaHref: CALENDAR_SETUP_ENTRY_PATH,
    ctaLabel: 'Configure Calendar',
    ctaLabelKey: 'onboarding.steps.calendar.cta',
    analyticsTarget: 'calendar_sync',
  },
  managed_email: {
    id: 'managed_email',
    title: 'Configure Email',
    titleKey: 'onboarding.steps.email.title',
    description: 'Set up inbound ticket email and verify an outbound sending domain for reliable delivery.',
    descriptionKey: 'onboarding.steps.email.description',
    icon: MailCheck,
    ctaHref: '/msp/settings?tab=email',
    ctaLabel: 'Configure Email',
    ctaLabelKey: 'onboarding.steps.email.cta',
    analyticsTarget: 'managed_email',
  },
};

type StepCopyOverride = Partial<Pick<StepDefinition,
  'title' | 'titleKey' | 'description' | 'descriptionKey' | 'caption' | 'captionKey'>>;

/**
 * A co-managed workspace is a customer's internal IT department: its portal
 * serves the organization's own employees (requesters), and its contacts are
 * those requesters rather than an MSP's clients. The steps and their
 * completion checks are the same; only the framing differs.
 */
const CO_MANAGED_STEP_OVERRIDES: Partial<Record<OnboardingStepId, StepCopyOverride>> = {
  client_portal_domain: {
    title: 'Set Up Requester Portal',
    titleKey: 'onboarding.steps.portal.coManagedTitle',
    description: 'Configure the portal where your employees submit and follow IT requests, on your domain with your branding.',
    descriptionKey: 'onboarding.steps.portal.coManagedDescription',
  },
  data_import: {
    title: 'Add Requesters',
    titleKey: 'onboarding.steps.dataImport.coManagedTitle',
    description: 'Add contacts for the people your IT team supports so their requests reach your team.',
    descriptionKey: 'onboarding.steps.dataImport.coManagedDescription',
    caption: 'Create 5 requester contacts',
    captionKey: 'onboarding.substeps.dataImportCoManaged',
  },
  calendar_sync: {
    description: 'Connect Google or Outlook calendars to keep your team\'s schedules and appointments aligned.',
    descriptionKey: 'onboarding.steps.calendar.coManagedDescription',
  },
};

export function getStepDefinitions(productCode: OnboardingProductCode = 'psa'): StepDefinition[] {
  const overrides = productCode === 'co_managed' ? CO_MANAGED_STEP_OVERRIDES : {};
  return Object.values(STEP_DEFINITIONS).map((definition) => ({ ...definition, ...overrides[definition.id] }));
}
