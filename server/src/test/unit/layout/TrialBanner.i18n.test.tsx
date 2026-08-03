/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrialBanner } from '../../../components/layout/TrialBanner';

let tierState = {
  isTrialing: false,
  trialDaysLeft: 0,
  tier: 'pro',
  isPaymentFailed: false,
};

const translations: Record<string, string> = {
  'banners.trial.dayLeft': '1 jour restant',
  'banners.trial.daysLeft': '{{count}} jours restants',
  'banners.trial.stripeTrial': 'Essai {{tier}} : {{daysLabel}}',
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

vi.mock('@/context/TierContext', () => ({
  useTier: () => tierState,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      interpolate(translations[key] ?? String(options?.defaultValue ?? key), options),
  }),
}));

describe('TrialBanner i18n wiring', () => {
  beforeEach(() => {
    tierState = {
      isTrialing: false,
      trialDaysLeft: 0,
      tier: 'pro',
      isPaymentFailed: false,
    };
  });

  it('T034/T036: trial singular day label and wrapper message are translated', () => {
    tierState = {
      ...tierState,
      isTrialing: true,
      trialDaysLeft: 1,
    };

    render(<TrialBanner />);

    expect(screen.getByText('Essai Pro : 1 jour restant')).toBeInTheDocument();
  });

  it('T035: stripe trial plural day label preserves count interpolation', () => {
    tierState = {
      ...tierState,
      isTrialing: true,
      trialDaysLeft: 4,
      tier: 'pro',
    };

    render(<TrialBanner />);

    expect(screen.getByText('Essai Pro : 4 jours restants')).toBeInTheDocument();
  });

  it('T037: stripe trial preserves tier interpolation in the translated wrapper', () => {
    tierState = {
      ...tierState,
      isTrialing: true,
      trialDaysLeft: 2,
      tier: 'solo',
    };

    render(<TrialBanner />);

    expect(screen.getByText('Essai Solo : 2 jours restants')).toBeInTheDocument();
  });
});
