/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OnboardingChecklist } from '../../../../../packages/onboarding/src/components/dashboard/OnboardingChecklist';
import { STEP_DEFINITIONS } from '@alga-psa/onboarding/lib';
import type { OnboardingStep } from '../../../../../packages/onboarding/src/hooks/useOnboardingProgress';

const translations: Record<string, string> = {
  'onboarding.checklist.title': 'Checklist FR',
  'onboarding.checklist.progress': '{{completed}} sur {{total}} taches FR',
  'onboarding.checklist.completeTitle': 'Configuration FR',
  'onboarding.checklist.completeDescription': 'Description configuration FR',
  'onboarding.checklist.inviteCta': 'Inviter FR',
  'onboarding.checklist.viewButton': 'Voir checklist FR',
  'onboarding.badges.complete': 'Complete FR',
  'onboarding.badges.inProgress': 'En cours FR',
  'onboarding.badges.notStarted': 'Pas commence FR',
  'onboarding.badges.blocked': 'Bloque FR',
  'onboarding.substeps.identity.addProvider': 'Ajouter un fournisseur SSO FR',
  'onboarding.substeps.createContacts': 'Sous-etape contacts FR',
  'onboarding.blockers.identity.noLinkedUsers': 'Aucun utilisateur lie FR',
  'onboarding.cta.completed': 'Termine CTA FR',
  'onboarding.steps.identity.title': 'Identite FR',
  'onboarding.steps.identity.description': 'Description identite FR',
  'onboarding.steps.identity.cta': 'CTA identite FR',
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

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      interpolate(translations[key] ?? String(options?.defaultValue ?? key), options),
  }),
}));

const checklistStep = {
  ...STEP_DEFINITIONS.identity_sso,
  status: 'complete',
  lastUpdated: null,
  blocker: null,
  progressValue: 100,
  meta: {},
  isActionable: false,
  substeps: [],
} satisfies OnboardingStep;

const checklistStepWithSubstep = {
  ...STEP_DEFINITIONS.identity_sso,
  status: 'in_progress',
  lastUpdated: null,
  blocker: 'No users are linked to an identity provider yet. Ask an MSP admin to connect Google or Microsoft.',
  blockerKey: 'onboarding.blockers.identity.noLinkedUsers',
  blockerValues: {},
  progressValue: 50,
  meta: {},
  isActionable: true,
  substeps: [
    {
      id: 'identity_provider_configured',
      title: 'Add an SSO provider',
      titleKey: 'onboarding.substeps.identity.addProvider',
      status: 'complete',
      lastUpdated: null,
    },
  ],
} satisfies OnboardingStep;

describe('OnboardingChecklist i18n wiring', () => {
  afterEach(() => {
    cleanup();
  });

  it('T085/T086: checklist title and progress subtitle are translated', () => {
    render(
      <OnboardingChecklist
        steps={[checklistStep]}
        summary={{ completed: 1, total: 5, remaining: 4, allComplete: false }}
      />
    );

    expect(screen.getByText('Checklist FR')).toBeInTheDocument();
    expect(screen.getByText('1 sur 5 taches FR')).toBeInTheDocument();
    expect(screen.getByText('Identite FR')).toBeInTheDocument();
  });

  it('T087: completion banner heading, description, invite CTA, and drawer button are translated', () => {
    render(
      <OnboardingChecklist
        steps={[checklistStep]}
        summary={{ completed: 1, total: 1, remaining: 0, allComplete: true }}
      />
    );

    expect(screen.getByText('Configuration FR')).toBeInTheDocument();
    expect(screen.getByText('Description configuration FR')).toBeInTheDocument();
    expect(screen.getByText('Inviter FR')).toBeInTheDocument();
    expect(screen.getAllByText('Voir checklist FR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Termine CTA FR').length).toBeGreaterThan(0);
  });

  it('translates keyed substeps and blocker text from step state', () => {
    render(
      <OnboardingChecklist
        steps={[checklistStepWithSubstep]}
        summary={{ completed: 0, total: 1, remaining: 1, allComplete: false }}
      />
    );

    expect(screen.getByText('Ajouter un fournisseur SSO FR')).toBeInTheDocument();
    expect(screen.getByText('Aucun utilisateur lie FR')).toBeInTheDocument();
  });
});
