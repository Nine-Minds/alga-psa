import type { LucideIcon } from 'lucide-react';
import {
  ShieldCheck,
  Globe,
  FileSpreadsheet,
  CalendarCheck2,
  MailCheck,
} from 'lucide-react';
import type { OnboardingStepId } from '../actions/onboarding-progress';

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
}

export const STEP_DEFINITIONS: Record<OnboardingStepId, StepDefinition> = {
  identity_sso: {
    id: 'identity_sso',
    title: 'Secure Identity & SSO',
    titleKey: 'onboarding.steps.identity.title',
    description: 'Connect Google Workspace or Microsoft 365 so admins sign in with managed identities.',
    descriptionKey: 'onboarding.steps.identity.description',
    icon: ShieldCheck,
    ctaHref: '/msp/profile?tab=Single+Sign-On',
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
  },
  calendar_sync: {
    id: 'calendar_sync',
    title: 'Calendar Sync',
    titleKey: 'onboarding.steps.calendar.title',
    description: 'Connect Google or Outlook calendars to keep dispatch and client appointments aligned.',
    descriptionKey: 'onboarding.steps.calendar.description',
    icon: CalendarCheck2,
    ctaHref: '/msp/settings?tab=integrations&category=calendar',
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
