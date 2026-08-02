import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CeSsoProviderButtons from '@alga-psa/auth/sso/entry';
import EeSsoProviderButtons from '../../../../ee/server/src/components/auth/SsoProviderButtons';

describe('SSO provider edition gate', () => {
  it('keeps the CE provider entry null while the EE implementation stays active', () => {
    const ceHtml = renderToStaticMarkup(
      React.createElement(CeSsoProviderButtons, { callbackUrl: '/msp' })
    );
    const eeHtml = renderToStaticMarkup(
      React.createElement(EeSsoProviderButtons, { callbackUrl: '/msp' })
    );

    expect(ceHtml).toBe('');
    expect(eeHtml).toContain('Sign in with Google');
    expect(eeHtml).toContain('Sign in with Microsoft');
  });
});
