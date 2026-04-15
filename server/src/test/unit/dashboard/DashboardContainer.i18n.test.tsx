/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DashboardContainer from '../../../components/dashboard/DashboardContainer';

const capture = vi.fn();
const toastSuccess = vi.fn();
let isEnterpriseMode = true;

const translations: Record<string, string> = {
  'welcome.title': 'Bienvenue MSP',
  'welcome.description': 'Description entreprise FR',
  'welcome.titleCommunity': 'Bon retour FR',
  'welcome.descriptionCommunity': 'Description communaute FR',
  'features.heading': 'Fonctions FR',
  'features.comingSoon': 'Bientot FR',
  'features.tickets.title': 'Tickets FR',
  'features.tickets.description': 'Description tickets FR',
  'features.monitoring.title': 'Monitoring FR',
  'features.monitoring.description': 'Description monitoring FR',
  'features.security.title': 'Securite FR',
  'features.security.description': 'Description securite FR',
  'features.projects.title': 'Projets FR',
  'features.projects.description': 'Description projets FR',
  'features.reports.title': 'Rapports FR',
  'features.reports.description': 'Description rapports FR',
  'features.schedule.title': 'Planning FR',
  'features.schedule.description': 'Description planning FR',
  'knowledgeBase.title': 'Base FR',
  'knowledgeBase.description': 'Description base FR',
  'knowledgeBase.cta': 'Visiter FR',
};

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({
    capture,
  }),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/analytics/client', () => ({
  usePerformanceTracking: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => translations[key] ?? options?.defaultValue ?? key,
  }),
}));

vi.mock('@/lib/features', () => ({
  get isEnterprise() {
    return isEnterpriseMode;
  },
}));

describe('DashboardContainer i18n wiring', () => {
  beforeEach(() => {
    capture.mockReset();
    toastSuccess.mockReset();
    isEnterpriseMode = true;
  });

  afterEach(() => {
    cleanup();
  });

  it('T071: enterprise welcome banner title and description are translated', () => {
    render(<DashboardContainer onboardingSection={<div>Onboarding slot</div>} />);

    expect(screen.getByText('Bienvenue MSP')).toBeInTheDocument();
    expect(screen.getByText('Description entreprise FR')).toBeInTheDocument();
  });

  it('T072: community welcome banner title and description are translated', () => {
    isEnterpriseMode = false;
    render(<DashboardContainer />);

    expect(screen.getByText('Bon retour FR')).toBeInTheDocument();
    expect(screen.getByText('Description communaute FR')).toBeInTheDocument();
  });

  it('T073-T076: feature heading, card copy, and knowledge-base content are translated', () => {
    render(<DashboardContainer onboardingSection={<div>Onboarding slot</div>} />);

    expect(screen.getByText('Fonctions FR')).toBeInTheDocument();
    expect(screen.getByText('Tickets FR')).toBeInTheDocument();
    expect(screen.getByText('Description tickets FR')).toBeInTheDocument();
    expect(screen.getByText('Monitoring FR')).toBeInTheDocument();
    expect(screen.getByText('Securite FR')).toBeInTheDocument();
    expect(screen.getByText('Projets FR')).toBeInTheDocument();
    expect(screen.getByText('Rapports FR')).toBeInTheDocument();
    expect(screen.getByText('Planning FR')).toBeInTheDocument();
    expect(screen.getByText('Base FR')).toBeInTheDocument();
    expect(screen.getByText('Description base FR')).toBeInTheDocument();
    expect(screen.getByText('Visiter FR')).toBeInTheDocument();
  });

  it('T077: coming-soon toast is translated', () => {
    render(<DashboardContainer onboardingSection={<div>Onboarding slot</div>} />);

    fireEvent.click(screen.getByText('Rapports FR'));

    expect(toastSuccess).toHaveBeenCalledWith('Bientot FR');
  });
});
