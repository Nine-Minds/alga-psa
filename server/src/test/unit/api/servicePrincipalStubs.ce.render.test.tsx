/**
 * T037 (CE build, oss entry) — component half.
 *
 * The @enterprise service-principal component stubs render null in CE. Kept apart
 * from the node-lane middleware half (servicePrincipalBoundary.ce.middleware.test.ts)
 * because it renders React and therefore belongs in the jsdom lane.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import * as servicePrincipalStubs from '../../../../../packages/ee/src/components/service-principals';

describe('T037: @enterprise service-principal component stubs render null', () => {
  const stubs = [
    'ServicePrincipalsSettingsTab',
    'ServicePrincipalUsageRow',
    'ViaPrincipalLabel',
    'ServiceAuthorBadge',
    'ApiKeyPrincipalCell',
  ] as const;

  it.each(stubs)('%s renders nothing', (name) => {
    const Component = (servicePrincipalStubs as Record<string, React.ComponentType<any>>)[name];
    expect(Component).toBeTypeOf('function');
    expect(renderToStaticMarkup(React.createElement(Component, { principalId: 'p', name: 'n' }))).toBe('');
    expect((Component as (props: object) => unknown)({})).toBeNull();
  });
});
