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

// Mirrors the pre-init translator in packages/ui useTranslation: no resources
// yet, so the call site's fallback copy is all the page has.
const bootstrapTranslate = (key: string, options?: unknown): string => {
  if (typeof options === 'string') return options;
  const defaultValue = (options as { defaultValue?: unknown } | undefined)?.defaultValue;
  if (typeof defaultValue === 'string') return defaultValue;
  return key;
};

const translatorMode = { bootstrap: false };

const translate = (key: string, options?: unknown): string => {
  if (translatorMode.bootstrap) {
    return bootstrapTranslate(key, options);
  }
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

const loginFormProps = vi.fn();
vi.mock('./MspLoginForm', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    loginFormProps(props);
    return null;
  },
}));
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

const requestSignInLinks = vi.fn(async () => ({ success: true }));

afterEach(() => cleanup());

describe('MSP sign-in scoped organization', () => {
  beforeEach(() => {
    searchParamsState.value = new URLSearchParams();
    translatorMode.bootstrap = false;
    loginFormProps.mockClear();
  });

  it('names the organization and links back to the unscoped page keeping callbackUrl', () => {
    searchParamsState.value = new URLSearchParams({ callbackUrl: '/msp/tickets?x=1' });
    render(<MspSignIn requestSignInLinks={requestSignInLinks} scopedTenant={{ slug: 'abc123def456', name: 'Acme MSP' }} />);

    expect(screen.getByText('Signing in to Acme MSP')).toBeTruthy();
    const back = document.getElementById('msp-scoped-tenant-back-link') as HTMLAnchorElement;
    expect(back.getAttribute('href')).toBe('/auth/msp/signin?callbackUrl=%2Fmsp%2Ftickets%3Fx%3D1');
    expect(back.getAttribute('href')).not.toContain('tenant=');
    expect(loginFormProps).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: 'abc123def456' }));
  });

  it('keeps the banner generic, never showing the slug, when the organization has no name', () => {
    render(<MspSignIn requestSignInLinks={requestSignInLinks} scopedTenant={{ slug: 'abc123def456' }} />);

    expect(screen.getByText('Signing in to the organization from your link')).toBeTruthy();
    expect(screen.queryByText(/abc123def456/)).toBeNull();
    expect(loginFormProps).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: 'abc123def456' }));
  });

  it('renders no organization banner on the unscoped page', () => {
    render(<MspSignIn requestSignInLinks={requestSignInLinks} />);
    expect(screen.queryByText(/Signing in to/)).toBeNull();
    expect(loginFormProps).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: undefined }));
  });

  it('hands an SSO tenant_required failure to the form with the provider email', () => {
    searchParamsState.value = new URLSearchParams({
      error: 'AccessDenied',
      reason: 'tenant_required',
      providerEmail: 'dual@example.com',
    });
    render(<MspSignIn requestSignInLinks={requestSignInLinks} />);
    expect(loginFormProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialEmail: 'dual@example.com', initialTenantRequired: true })
    );
  });

  it('passes the injected links action through to the form', () => {
    render(<MspSignIn requestSignInLinks={requestSignInLinks} />);
    expect(loginFormProps).toHaveBeenCalledWith(
      expect.objectContaining({ requestSignInLinks })
    );
  });

  it('prefers the SSO providerEmail over a remembered email on the tenant_required hand-off', () => {
    searchParamsState.value = new URLSearchParams({
      error: 'AccessDenied',
      reason: 'tenant_required',
      providerEmail: 'b@x',
    });
    render(<MspSignIn requestSignInLinks={requestSignInLinks} initialEmail="a@x" />);
    expect(loginFormProps).toHaveBeenCalledWith(
      expect.objectContaining({ initialEmail: 'b@x', initialTenantRequired: true })
    );
    expect(loginFormProps).not.toHaveBeenCalledWith(expect.objectContaining({ initialEmail: 'a@x' }));
  });

  it('keeps the remembered email when the failure is not tenant_required', () => {
    searchParamsState.value = new URLSearchParams({
      error: 'AccessDenied',
      reason: 'no_match',
      providerEmail: 'b@x',
    });
    render(<MspSignIn requestSignInLinks={requestSignInLinks} initialEmail="a@x" />);
    expect(loginFormProps).toHaveBeenCalledWith(expect.objectContaining({ initialEmail: 'a@x' }));
  });
});
