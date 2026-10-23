/** @vitest-environment jsdom */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { React?: typeof React }).React = React;

// Resolve keys against the shipped en bundle so a renamed or missing key fails
// here instead of rendering a raw dotted key to the visitor.
function loadClientPortalMessages(): Map<string, string> {
  let dir = process.cwd();
  while (!fs.existsSync(path.join(dir, 'server/public/locales/en'))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Unable to locate server/public/locales/en');
    }
    dir = parent;
  }

  const bundle = JSON.parse(
    fs.readFileSync(path.join(dir, 'server/public/locales/en/client-portal.json'), 'utf8')
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

const messages = loadClientPortalMessages();

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

const { default: ClientPortalSsoFailureNotice } = await import('./ClientPortalSsoFailureNotice');

afterEach(() => cleanup());

describe('ClientPortalSsoFailureNotice', () => {
  beforeEach(() => {
    searchParamsState.value = new URLSearchParams();
  });

  it('names the provider email when no portal account matched', () => {
    searchParamsState.value = new URLSearchParams({
      error: 'AccessDenied',
      reason: 'no_matching_user',
      providerEmail: 'nd@computerbutlereurope.onmicrosoft.com',
    });

    render(<ClientPortalSsoFailureNotice />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('SSO sign-in failed');
    expect(alert.textContent).toContain(
      'No client portal account matches nd@computerbutlereurope.onmicrosoft.com.'
    );
  });

  it('falls back to the generic access-denied copy without a reason', () => {
    searchParamsState.value = new URLSearchParams({ error: 'AccessDenied' });

    render(<ClientPortalSsoFailureNotice />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Access Denied');
    expect(alert.textContent).toContain('You do not have permission to access the client portal.');
  });

  it('explains the Auth.js configuration failure in product copy', () => {
    searchParamsState.value = new URLSearchParams({ error: 'Configuration' });

    render(<ClientPortalSsoFailureNotice />);

    expect(screen.getByRole('alert').textContent).toContain('Sign-in failed');
  });

  it('renders nothing without a sign-in error', () => {
    searchParamsState.value = new URLSearchParams({ tenant: 'abcdef123456' });

    render(<ClientPortalSsoFailureNotice />);

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
