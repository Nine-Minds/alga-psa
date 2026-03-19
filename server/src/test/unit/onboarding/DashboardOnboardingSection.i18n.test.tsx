/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DashboardOnboardingSection from '../../../../../packages/onboarding/src/components/dashboard/DashboardOnboardingSection';
import type { OnboardingStepServerState } from '@alga-psa/onboarding/actions';

const dismissDashboardOnboardingStep = vi.fn();
const restoreDashboardOnboardingStep = vi.fn();

const translations: Record<string, string> = {
  'onboarding.completeTitle': 'Termine FR',
  'onboarding.incompleteTitle': 'Configurer FR',
  'onboarding.completeDescription': 'Description complete FR',
  'onboarding.incompleteDescription': 'Description incomplete FR',
  'onboarding.badges.complete': 'Complete FR',
  'onboarding.badges.notStarted': 'Pas commence FR',
  'onboarding.badges.inProgress': 'En cours FR',
  'onboarding.badges.blocked': 'Bloque FR',
  'onboarding.progress.label': 'PROGRESSION FR',
  'onboarding.progress.steps': '{{completed}} sur {{total}} etapes FR',
  'onboarding.progress.messageStart': 'Debut FR',
  'onboarding.progress.messageComplete': 'Fini FR',
  'onboarding.progress.messageInProgress': 'Continue FR',
  'onboarding.stepLabel': 'ETAPE {{index}} FR',
  'onboarding.substeps.dataImport': 'Sous-etape import FR',
  'onboarding.cta.completed': 'Termine CTA FR',
  'onboarding.cta.hiding': 'Masquage FR',
  'onboarding.cta.hide': 'Masquer FR',
  'onboarding.cta.dismiss': 'Masquer {{title}} FR',
  'onboarding.cta.restoring': 'Restauration FR',
  'onboarding.hidden.title': 'Cartes cachees {{count}} FR',
  'onboarding.hidden.subtitle': 'Sous-titre cache FR',
  'onboarding.steps.identity.title': 'Identite FR',
  'onboarding.steps.identity.description': 'Description identite FR',
  'onboarding.steps.identity.cta': 'CTA identite FR',
  'onboarding.steps.portal.title': 'Portail FR',
  'onboarding.steps.portal.description': 'Description portail FR',
  'onboarding.steps.portal.cta': 'CTA portail FR',
  'onboarding.steps.dataImport.title': 'Import FR',
  'onboarding.steps.dataImport.description': 'Description import FR',
  'onboarding.steps.dataImport.cta': 'CTA import FR',
  'onboarding.steps.calendar.title': 'Calendrier FR',
  'onboarding.steps.calendar.description': 'Description calendrier FR',
  'onboarding.steps.calendar.cta': 'CTA calendrier FR',
  'onboarding.steps.email.title': 'Email FR',
  'onboarding.steps.email.description': 'Description email FR',
  'onboarding.steps.email.cta': 'CTA email FR',
};

const interpolate = (template: string, values: Record<string, unknown> = {}) =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => String(values[key] ?? ''));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({
    capture: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      interpolate(translations[key] ?? String(options?.defaultValue ?? key), options),
  }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
}));

vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: {},
  }),
}));

vi.mock('@alga-psa/onboarding/actions', () => ({
  dismissDashboardOnboardingStep: (...args: unknown[]) => dismissDashboardOnboardingStep(...args),
  restoreDashboardOnboardingStep: (...args: unknown[]) => restoreDashboardOnboardingStep(...args),
}));

const mixedSteps: OnboardingStepServerState[] = [
  { id: 'identity_sso', status: 'complete', lastUpdated: null, progressValue: 100, blocker: null, meta: {}, substeps: [], dismissed: false },
  { id: 'client_portal_domain', status: 'not_started', lastUpdated: null, progressValue: 0, blocker: null, meta: {}, substeps: [], dismissed: false },
  {
    id: 'data_import',
    status: 'in_progress',
    lastUpdated: null,
    progressValue: 40,
    blocker: null,
    meta: {},
    substeps: [],
    dismissed: false,
  },
  {
    id: 'calendar_sync',
    status: 'blocked',
    lastUpdated: null,
    progressValue: 0,
    blocker: 'Blocked reason',
    meta: {},
    substeps: [],
    dismissed: false,
  },
  { id: 'managed_email', status: 'not_started', lastUpdated: null, progressValue: 0, blocker: null, meta: {}, substeps: [], dismissed: true },
];

const allNotStarted: OnboardingStepServerState[] = [
  { id: 'identity_sso', status: 'not_started', lastUpdated: null, progressValue: 0, blocker: null, meta: {}, substeps: [], dismissed: false },
  { id: 'client_portal_domain', status: 'not_started', lastUpdated: null, progressValue: 0, blocker: null, meta: {}, substeps: [], dismissed: false },
  { id: 'data_import', status: 'not_started', lastUpdated: null, progressValue: 0, blocker: null, meta: {}, substeps: [], dismissed: false },
  { id: 'calendar_sync', status: 'not_started', lastUpdated: null, progressValue: 0, blocker: null, meta: {}, substeps: [], dismissed: false },
  { id: 'managed_email', status: 'not_started', lastUpdated: null, progressValue: 0, blocker: null, meta: {}, substeps: [], dismissed: false },
];

const allComplete: OnboardingStepServerState[] = [
  { id: 'identity_sso', status: 'complete', lastUpdated: null, progressValue: 100, blocker: null, meta: {}, substeps: [], dismissed: false },
  { id: 'client_portal_domain', status: 'complete', lastUpdated: null, progressValue: 100, blocker: null, meta: {}, substeps: [], dismissed: false },
  { id: 'data_import', status: 'complete', lastUpdated: null, progressValue: 100, blocker: null, meta: {}, substeps: [], dismissed: false },
  { id: 'calendar_sync', status: 'complete', lastUpdated: null, progressValue: 100, blocker: null, meta: {}, substeps: [], dismissed: false },
  { id: 'managed_email', status: 'complete', lastUpdated: null, progressValue: 100, blocker: null, meta: {}, substeps: [], dismissed: false },
];

describe('DashboardOnboardingSection i18n wiring', () => {
  beforeEach(() => {
    dismissDashboardOnboardingStep.mockReset();
    restoreDashboardOnboardingStep.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('T101: renders without initialDismissedStepIds prop and does not enter a rerender loop', () => {
    render(<DashboardOnboardingSection steps={mixedSteps} />);

    expect(screen.getByText('Configurer FR')).toBeInTheDocument();
    expect(screen.getByText('Cartes cachees 1 FR')).toBeInTheDocument();
  });

  it('T078/T079/T081/T082/T083/T084: incomplete state uses translated headings, progress, badges, actions, and hidden panel copy', () => {
    render(<DashboardOnboardingSection steps={mixedSteps} />);

    expect(screen.getByText('Configurer FR')).toBeInTheDocument();
    expect(screen.getByText('Description incomplete FR')).toBeInTheDocument();
    expect(screen.getByText('PROGRESSION FR')).toBeInTheDocument();
    expect(screen.getByText('2 sur 5 etapes FR')).toBeInTheDocument();
    expect(screen.getByText('Pas commence FR')).toBeInTheDocument();
    expect(screen.getByText('En cours FR')).toBeInTheDocument();
    expect(screen.getByText('Bloque FR')).toBeInTheDocument();
    expect(screen.getByText('ETAPE 1 FR')).toBeInTheDocument();
    expect(screen.getAllByText('Termine CTA FR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Masquer FR').length).toBeGreaterThan(0);
    expect(screen.getByText('Cartes cachees 1 FR')).toBeInTheDocument();
    expect(screen.getByText('Sous-titre cache FR')).toBeInTheDocument();
  });

  it('T080: motivational start message is translated when no steps are complete', () => {
    render(<DashboardOnboardingSection steps={allNotStarted} />);

    expect(screen.getByText('Debut FR')).toBeInTheDocument();
  });

  it('T078/T080: complete state uses translated complete heading, description, and message', () => {
    render(<DashboardOnboardingSection steps={allComplete} />);

    expect(screen.getByText('Termine FR')).toBeInTheDocument();
    expect(screen.getByText('Description complete FR')).toBeInTheDocument();
    expect(screen.getByText('Fini FR')).toBeInTheDocument();
    expect(screen.getByText('Complete FR')).toBeInTheDocument();
  });
});
