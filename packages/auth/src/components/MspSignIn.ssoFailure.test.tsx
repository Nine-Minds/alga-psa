/** @vitest-environment jsdom */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

// Resolve keys against the shipped en bundle so a renamed or missing key fails
// here instead of rendering a raw dotted key to the operator.
function loadMspAuthMessages(): Map<string, string> {
  let dir = process.cwd();
  while (!fs.existsSync(path.join(dir, 'server/public/locales/en'))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Unable to locate server/public/locales/en');
    }
    dir = parent;
  }

  const bundle = JSON.parse(
    fs.readFileSync(path.join(dir, 'server/public/locales/en/msp/auth.json'), 'utf8')
  ) as Record<string, unknown>;

  const flat = new Map<string, string>();
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const qualified = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value as Record<string, unknown>, qualified);
      } else if (typeof value === 'string') {
        flat.set(qualified, value);
      }
    }
  };
  walk(bundle, '');
  return flat;
}

const messages = loadMspAuthMessages();

const translate = (key: string, options?: unknown): string => {
  const template = messages.get(key);
  if (template === undefined) {
    return typeof options === 'string' ? options : key;
  }
  const values = (typeof options === 'object' && options !== null ? options : {}) as Record<
    string,
    unknown
  >;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    values[name] === undefined ? match : String(values[name])
  );
};

const searchParamsState = { value: new URLSearchParams() };

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsState.value,
}));

vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt?: string }) => <img alt={alt} />,
}));

vi.mock('@alga-psa/ui/components', () => ({
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./MspLoginForm', () => ({ __esModule: true, default: () => null }));
vi.mock('./TwoFA', () => ({ __esModule: true, default: () => null }));

vi.mock('./Alert', () => ({
  __esModule: true,
  default: ({
    title,
    message,
    isOpen,
  }: {
    title?: string;
    message?: string;
    isOpen?: boolean;
  }) =>
    isOpen ? (
      <div role="alert">
        <span>{title}</span>
        <span>{message}</span>
      </div>
    ) : null,
}));

const { default: MspSignIn } = await import('./MspSignIn');

afterEach(() => cleanup());

describe('MSP sign-in SSO failure messages', () => {
  beforeEach(() => {
    searchParamsState.value = new URLSearchParams();
  });

  it('names the provider email when no AlgaPSA account matched', () => {
    searchParamsState.value = new URLSearchParams({
      error: 'AccessDenied',
      reason: 'no_matching_user',
      providerEmail: 'nd@computerbutlereurope.onmicrosoft.com',
    });

    render(<MspSignIn />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('SSO sign-in failed');
    expect(alert.textContent).toContain(
      'No AlgaPSA account matches nd@computerbutlereurope.onmicrosoft.com.'
    );
  });

  it('keeps the generic access-denied copy when no reason is supplied', () => {
    searchParamsState.value = new URLSearchParams({ error: 'AccessDenied' });

    render(<MspSignIn />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Access Denied');
    expect(alert.textContent).toContain('You do not have permission to access the MSP dashboard.');
  });

  it('ignores a reason code it does not recognize', () => {
    searchParamsState.value = new URLSearchParams({
      error: 'AccessDenied',
      reason: 'something_new',
      providerEmail: 'someone@example.com',
    });

    render(<MspSignIn />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Access Denied');
    expect(alert.textContent).not.toContain('signIn.alerts.ssoNoMatch');
  });

  it('explains the Auth.js configuration failure in product copy', () => {
    searchParamsState.value = new URLSearchParams({ error: 'Configuration' });

    render(<MspSignIn />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Sign-in failed');
    expect(alert.textContent).toContain('Please try again or contact support.');
  });
});
