import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AccountManagement from '@/empty/components/settings/account/AccountManagement';

describe('CE account management stub', () => {
  it('renders the hosted upgrade explanation without duplicating the page heading', () => {
    const html = renderToStaticMarkup(React.createElement(AccountManagement));

    expect(html).toContain('Account management and billing features are available in Pro');
    expect(html).toContain('Self-hosted Community Edition has unlimited users');
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('<h2');
  });
});
