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
  description: string;
  icon: LucideIcon;
  ctaHref: string;
  ctaLabel: string;
  analyticsTarget: string;
}

export const STEP_DEFINITIONS: Record<OnboardingStepId, StepDefinition> = {
  identity_sso: {
    id: 'identity_sso',
    title: 'Secure Identity & SSO',
    description: 'Connect Google Workspace or Microsoft 365 so admins sign in with managed identities.',
    icon: ShieldCheck,
    ctaHref: '/msp/profile?tab=Single+Sign-On',
    ctaLabel: 'Connect SSO',
    analyticsTarget: 'identity_sso',
  },
  client_portal_domain: {
    id: 'client_portal_domain',
    title: 'Set Up Customer Portal',
    description: 'Configure your portal so customers can sign in on your domain with your branding.',
    icon: Globe,
    ctaHref: '/msp/settings?tab=client-portal',
    ctaLabel: 'Open Portal Settings',
    analyticsTarget: 'client_portal_domain',
  },
  data_import: {
    id: 'data_import',
    title: 'Import Core Data',
    description: 'Bring in assets, contacts, or reference data so workflows have something to run on.',
    icon: FileSpreadsheet,
    ctaHref: '/msp/settings?tab=import-export',
    ctaLabel: 'Open Import Tools',
    analyticsTarget: 'data_import',
  },
  calendar_sync: {
    id: 'calendar_sync',
    title: 'Calendar Sync',
    description: 'Connect Google or Outlook calendars to keep dispatch and client appointments aligned.',
    icon: CalendarCheck2,
    ctaHref: '/msp/settings?tab=integrations&category=calendar',
    ctaLabel: 'Configure Calendar',
    analyticsTarget: 'calendar_sync',
  },
  managed_email: {
    id: 'managed_email',
    title: 'Configure Email',
    description: 'Set up inbound ticket email and verify an outbound sending domain for reliable delivery.',
    icon: MailCheck,
    ctaHref: '/msp/settings?tab=email',
    ctaLabel: 'Configure Email',
    analyticsTarget: 'managed_email',
  },
};
