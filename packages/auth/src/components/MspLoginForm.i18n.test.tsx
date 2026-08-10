/** @vitest-environment jsdom */

import React from 'react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createInstance, type i18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

(globalThis as unknown as { React?: typeof React }).React = React;

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(async () => null),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@alga-psa/ui/components', () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Input: ({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Checkbox: ({
    label,
    id,
    checked,
    onChange,
  }: {
    label?: React.ReactNode;
    id?: string;
    checked?: boolean;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
  }) => (
    <div>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} />
      {label ? <label htmlFor={id}>{label}</label> : null}
    </div>
  ),
}));

vi.mock('@alga-psa/auth/sso/entry', () => ({
  __esModule: true,
  default: () => null,
}));

const { default: MspLoginForm } = await import('./MspLoginForm');

const localesDir = path.resolve(__dirname, '../../../../server/public/locales');

const loadAuthBundle = (locale: string) =>
  JSON.parse(readFileSync(path.join(localesDir, locale, 'msp', 'auth.json'), 'utf8'));

// The sign-in form is the most-seen unauthenticated screen in the product, and
// it sat fully hardcoded while the page title and SSO buttons around it
// localized correctly. Assert against the real shipped bundle so a leaf that
// loses its t() call — or a key that never lands in a locale — fails here.
describe('MspLoginForm localization', () => {
  // A private instance, never the i18next singleton: initializing the shared one
  // here leaks `lng: 'fr'` into every sibling test file in the same worker.
  let instance: i18n;

  beforeAll(async () => {
    instance = createInstance();
    await instance.use(initReactI18next).init({
      lng: 'fr',
      fallbackLng: 'en',
      ns: ['msp/auth'],
      defaultNS: 'msp/auth',
      interpolation: { escapeValue: false },
      resources: {
        fr: { 'msp/auth': loadAuthBundle('fr') },
        en: { 'msp/auth': loadAuthBundle('en') },
      },
    });
  });

  const renderForm = () =>
    render(
      <I18nextProvider i18n={instance}>
        <MspLoginForm callbackUrl="/msp/dashboard" onError={vi.fn()} onTwoFactorRequired={vi.fn()} />
      </I18nextProvider>
    );

  it('renders field labels in the app locale', () => {
    renderForm();

    const fr = loadAuthBundle('fr').signin.form;
    expect(screen.getByLabelText(fr.emailLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(fr.passwordLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(fr.publicWorkstation)).toBeInTheDocument();
  });

  it('renders the submit button and links in the app locale', () => {
    renderForm();

    const fr = loadAuthBundle('fr').signin.form;
    expect(screen.getByRole('button', { name: fr.submit })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: fr.forgotPassword })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: fr.signUp })).toBeInTheDocument();
  });

  it('leaves no English placeholder copy behind at a non-English locale', () => {
    const { container } = renderForm();

    const en = loadAuthBundle('en').signin.form;
    const text = container.textContent ?? '';
    for (const english of [en.submit, en.forgotPassword, en.publicWorkstation]) {
      expect(text).not.toContain(english);
    }
    expect(container.querySelector('#msp-email-field')).toHaveAttribute(
      'placeholder',
      loadAuthBundle('fr').signin.form.emailPlaceholder
    );
  });
});
