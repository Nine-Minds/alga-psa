/** @vitest-environment jsdom */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

// Server render with the real translation hook and an uninitialised i18next
// instance, exactly what the MSP sign-in page has before hydration. The server
// unit setup replaces the hook with a passthrough, so undo that here.
vi.unmock('@alga-psa/ui/lib/i18n/client');
vi.unmock('react-i18next');

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt?: string }) => <img alt={alt} />,
}));
vi.mock('@alga-psa/ui/components', () => {
  const box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Card: box, CardContent: box, CardDescription: box, CardHeader: box, CardTitle: box };
});
vi.mock('./MspLoginForm', () => ({ __esModule: true, default: () => null }));
vi.mock('./TwoFA', () => ({ __esModule: true, default: () => null }));
vi.mock('./Alert', () => ({ __esModule: true, default: () => null }));

const { default: MspSignIn } = await import('./MspSignIn');

describe('MspSignIn server render', () => {
  it('interpolates the scoped organization name instead of emitting a literal {{name}}', () => {
    const html = renderToString(
      <MspSignIn
        requestSignInLinks={async () => ({ success: true })}
        scopedTenant={{ slug: 'abc123def456', name: 'Acme MSP' }}
      />
    );

    expect(html).toContain('Signing in to Acme MSP');
    expect(html).not.toContain('{{');
  });
});
