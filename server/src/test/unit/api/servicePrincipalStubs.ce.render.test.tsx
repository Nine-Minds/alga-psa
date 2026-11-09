/**
 * T037 (CE build, oss entry) — component half.
 *
 * The @enterprise service-principal component stubs hide EE content in CE. Kept apart
 * from the node-lane middleware half (servicePrincipalBoundary.ce.middleware.test.ts)
 * because it renders React and therefore belongs in the jsdom lane.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import * as servicePrincipalStubs from '../../../../../packages/ee/src/components/service-principals';

describe('T037: @enterprise service-principal component stubs hide EE content', () => {
  const stubs = [
    'ServicePrincipalsSettingsTab',
    'ServicePrincipalUsageRow',
    'ViaPrincipalLabel',
    'ServiceAuthorBadge',
    'ApiKeyPrincipalCell',
  ] as const;

  it.each(stubs)('%s renders nothing', (name) => {
    const Component = (servicePrincipalStubs as Record<string, React.ComponentType<any>>)[name];
    expect(renderToStaticMarkup(React.createElement(Component, { principalId: 'p', name: 'n' }))).toBe('');
  });

  it('ApiKeyPrincipalCell preserves the key owner fallback without service attribution', () => {
    expect(renderToStaticMarkup(
      <servicePrincipalStubs.ApiKeyPrincipalCell
        userType="service"
        displayName="Billing sync"
        fallback={<span>Ada Admin</span>}
      />,
    )).toBe('<span>Ada Admin</span>');
  });
});
