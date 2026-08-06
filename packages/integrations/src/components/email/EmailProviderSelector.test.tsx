/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailProviderSelector } from './EmailProviderSelector';

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
  CardHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 {...props}>{children}</h3>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id: string }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/components/UpgradePrompt', () => ({
  UpgradePrompt: ({ featureName, pitch, ctaId }: { featureName: string; pitch: string; ctaId: string }) => (
    <div data-testid="upgrade-prompt">
      <h2>{featureName}</h2>
      <p>{pitch}</p>
      <a id={ctaId} href="https://www.nineminds.com/documentation/community-vs-enterprise-edition">
        Explore Enterprise
      </a>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

describe('EmailProviderSelector edition gates', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();

    if (originalEdition === undefined) delete process.env.EDITION;
    else process.env.EDITION = originalEdition;

    if (originalPublicEdition === undefined) delete process.env.NEXT_PUBLIC_EDITION;
    else process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
  });

  it('shows Gmail, Microsoft 365, and IMAP setup cards in CE', () => {
    process.env.EDITION = 'community';
    process.env.NEXT_PUBLIC_EDITION = 'community';

    render(<EmailProviderSelector onProviderSelected={vi.fn()} />);

    expect(document.getElementById('setup-google-provider-button')).toBeTruthy();
    expect(document.getElementById('setup-microsoft-provider-button')).toBeTruthy();
    expect(document.getElementById('setup-imap-provider-button')).toBeTruthy();
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });

  it('fires the selection callback when the Microsoft 365 card is selected in CE', () => {
    process.env.EDITION = 'community';
    process.env.NEXT_PUBLIC_EDITION = 'community';

    const onProviderSelected = vi.fn();
    render(<EmailProviderSelector onProviderSelected={onProviderSelected} />);

    fireEvent.click(document.getElementById('microsoft-provider-selector-card')!);

    expect(onProviderSelected).toHaveBeenCalledTimes(1);
    expect(onProviderSelected).toHaveBeenCalledWith('microsoft');
  });

  it('still fires the selection callback for the Microsoft 365 card in Enterprise Edition', () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const onProviderSelected = vi.fn();
    render(<EmailProviderSelector onProviderSelected={onProviderSelected} />);

    fireEvent.click(document.getElementById('microsoft-provider-selector-card')!);

    expect(onProviderSelected).toHaveBeenCalledTimes(1);
    expect(onProviderSelected).toHaveBeenCalledWith('microsoft');
  });

  it('still shows Gmail, Microsoft 365, and IMAP setup cards in Enterprise Edition', () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    render(<EmailProviderSelector onProviderSelected={vi.fn()} />);

    expect(document.getElementById('setup-google-provider-button')).toBeTruthy();
    expect(document.getElementById('setup-microsoft-provider-button')).toBeTruthy();
    expect(document.getElementById('setup-imap-provider-button')).toBeTruthy();
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });
});
