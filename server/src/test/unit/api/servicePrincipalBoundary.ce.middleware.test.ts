/**
 * T037 (CE build, oss entry) — middleware half.
 *
 * With the CE stub bound to '@product/service-principals/entry':
 *  - buildAuthenticatedApiContext rejects a key owned by a user that is neither
 *    internal nor client (the boundary returns null),
 *  - the internal path is unchanged and gains only the default generic fields,
 *  - the @enterprise service-principal component stubs render null.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUserByIdForApi: vi.fn(),
}));

vi.mock('@alga-psa/users/actions', () => ({ findUserByIdForApi: mocks.findUserByIdForApi }));
vi.mock('@alga-psa/auth', () => ({ runWithApiKeyUser: vi.fn() }));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({ ApiKeyServiceForApi: {} }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ runAsSystem: vi.fn() }));
vi.mock('@/lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: vi.fn() }));
vi.mock('../../../lib/auth/rbac', () => ({ hasPermission: vi.fn() }));

import {
  UnauthorizedError,
  assertApiPrincipal,
  buildAuthenticatedApiContext,
} from '../../../lib/api/middleware/apiMiddleware';
import * as ossEntry from '../../../../../packages/product-service-principals/oss/entry';
import * as servicePrincipalStubs from '../../../../../packages/ee/src/components/service-principals';

const keyRecord = { api_key_id: 'key-1', user_id: 'owner-1', tenant: 'tenant-1' };

describe('T037: CE service-principal boundary (oss entry) — API context', () => {
  beforeEach(() => {
    mocks.findUserByIdForApi.mockReset();
  });

  it('the oss entry stubs are inert', async () => {
    await expect(
      ossEntry.resolveServicePrincipalApiContext(keyRecord, { user_type: 'service' }, new Request('http://localhost'))
    ).resolves.toBeNull();
    await expect(
      ossEntry.servicePrincipalKeyGate({ user_id: 'owner-1', tenant: 'tenant-1', user_type: 'service' })
    ).resolves.toBe(false);
    const error = new Error('x');
    expect(ossEntry.mapServicePrincipalError(error)).toBe(error);
  });

  it.each(['service', 'agent', undefined, null])(
    'rejects a key owned by a user of type %s (neither internal nor client)',
    async (userType) => {
      mocks.findUserByIdForApi.mockResolvedValue({ user_id: 'owner-1', tenant: 'tenant-1', user_type: userType });

      await expect(buildAuthenticatedApiContext(keyRecord)).rejects.toThrow(UnauthorizedError);
      await expect(buildAuthenticatedApiContext(keyRecord)).rejects.toThrow('Invalid API key');
    }
  );

  it('still rejects client owners and missing users', async () => {
    mocks.findUserByIdForApi.mockResolvedValue({ user_id: 'owner-1', user_type: 'client' });
    await expect(buildAuthenticatedApiContext(keyRecord)).rejects.toThrow('Invalid API key');
    mocks.findUserByIdForApi.mockResolvedValue(null);
    await expect(buildAuthenticatedApiContext(keyRecord)).rejects.toThrow('User not found');
  });

  it('the internal path is unchanged and generic fields default to the key owner', async () => {
    const user = { user_id: 'owner-1', tenant: 'tenant-1', user_type: 'internal' };
    mocks.findUserByIdForApi.mockResolvedValue(user);

    const context = await buildAuthenticatedApiContext(keyRecord);

    expect(context).toMatchObject({
      userId: 'owner-1',
      tenant: 'tenant-1',
      apiKeyId: 'key-1',
      user,
      kind: 'user',
      principal: { userId: 'owner-1', userType: 'internal', kind: 'user' },
      effectiveUserId: 'owner-1',
    });
    expect(context.actAsUserId ?? null).toBeNull();
    expect(context.rateLimitConfig).toBeUndefined();
    expect(context.userId).toBe(context.effectiveUserId);
  });

  it('assertApiPrincipal ignores a self-declared service principal on a context', () => {
    const forged: any = {
      userId: 'x',
      tenant: 't',
      user: { user_type: 'service' },
      principal: { userId: 'x', userType: 'service', kind: 'service' },
    };
    expect(() => assertApiPrincipal(forged)).toThrow(UnauthorizedError);
    expect(() => assertApiPrincipal({ user_type: 'internal' } as any)).not.toThrow();
  });
});

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
