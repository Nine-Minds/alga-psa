import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import CeSsoProviderButtons from '@alga-psa/auth/sso/entry';
import EeSsoProviderButtons from '../../../../ee/server/src/components/auth/SsoProviderButtons';

const savedEdition = process.env.NEXT_PUBLIC_EDITION;

describe('SSO provider edition gate', () => {
  afterEach(() => {
    if (savedEdition === undefined) delete process.env.NEXT_PUBLIC_EDITION;
    else process.env.NEXT_PUBLIC_EDITION = savedEdition;
  });

  it('offers Keycloak only on the CE MSP sign-in and nothing on the CE client portal', () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';

    const mspHtml = renderToStaticMarkup(
      React.createElement(CeSsoProviderButtons, { callbackUrl: '/msp' })
    );
    expect(mspHtml).toContain('Sign in with Keycloak');
    expect(mspHtml).not.toContain('Sign in with Google');
    expect(mspHtml).not.toContain('Sign in with Microsoft');

    const portalHtml = renderToStaticMarkup(
      React.createElement(CeSsoProviderButtons, { callbackUrl: '/client-portal', authSurface: 'client_portal' })
    );
    expect(portalHtml).toBe('');
  });

  it('keeps Google, Microsoft and Keycloak active on EE', () => {
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const eeHtml = renderToStaticMarkup(
      React.createElement(EeSsoProviderButtons, { callbackUrl: '/msp' })
    );
    expect(eeHtml).toContain('Sign in with Google');
    expect(eeHtml).toContain('Sign in with Microsoft');
    expect(eeHtml).toContain('Sign in with Keycloak');
  });
});
