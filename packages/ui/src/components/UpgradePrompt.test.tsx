/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpgradePrompt } from './UpgradePrompt';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock('./Button', () => ({
  Button: ({
    children,
    id,
    className,
  }: {
    children: React.ReactElement;
    id: string;
    className?: string;
  }) => React.cloneElement(children, { id, className } as React.HTMLAttributes<HTMLElement>),
}));

vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

describe('UpgradePrompt', () => {
  afterEach(cleanup);

  it('renders the feature pitch, upgrade link, and optional context', () => {
    render(
      <UpgradePrompt
        featureName="Microsoft Teams integration"
        pitch="Bring PSA work into Microsoft Teams."
        ctaId="upgrade-teams-button"
      >
        Tenant setup remains unchanged.
      </UpgradePrompt>,
    );

    expect(screen.getByText('Enterprise edition')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Microsoft Teams integration' })).toBeTruthy();
    expect(screen.getByText('Bring PSA work into Microsoft Teams.')).toBeTruthy();
    expect(screen.getByText('Tenant setup remains unchanged.')).toBeTruthy();

    const cta = screen.getByRole('link', { name: /Explore Enterprise/ });
    expect(cta.getAttribute('href')).toBe('/msp/account');
    expect(cta.getAttribute('id')).toBe('upgrade-teams-button');
  });
});
