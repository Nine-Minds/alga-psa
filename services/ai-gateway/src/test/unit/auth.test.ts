import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

import {
  CachingApplianceCredentialVerifier,
  HttpApplianceCredentialVerifier,
  StubApplianceCredentialVerifier,
} from '../../auth/applianceVerifier.js';
import { GatewayAuthenticator } from '../../auth/authenticator.js';
import { HostedJwtVerifier } from '../../auth/hostedJwt.js';
import { AuthenticationError } from '../../auth/types.js';

const SECRET = 'test-service-secret-with-enough-entropy';
const NOW = new Date('2026-07-20T12:00:00.000Z');

function hostedToken(tenantId: string, secret = SECRET, expiresInSeconds = 300): string {
  return jwt.sign({ tenant_id: tenantId }, secret, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  });
}

describe('gateway authentication', () => {
  it('verifies a valid hosted HS256 token with the required claims', () => {
    const tenantId = randomUUID();
    const token = jwt.sign(
      {
        tenant_id: tenantId,
        iat: Math.floor(NOW.getTime() / 1_000) - 1,
        exp: Math.floor(NOW.getTime() / 1_000) + 299,
      },
      SECRET,
      { algorithm: 'HS256' },
    );

    expect(new HostedJwtVerifier({ secret: SECRET, now: () => NOW }).verify(token)).toEqual({
      tenantId,
    });
  });

  it('rejects an expired hosted token', () => {
    const token = jwt.sign(
      {
        tenant_id: randomUUID(),
        iat: Math.floor(NOW.getTime() / 1_000) - 600,
        exp: Math.floor(NOW.getTime() / 1_000) - 1,
      },
      SECRET,
      { algorithm: 'HS256' },
    );

    expect(() => new HostedJwtVerifier({ secret: SECRET, now: () => NOW }).verify(token)).toThrow(
      AuthenticationError,
    );
  });

  it('rejects a hosted token signed with the wrong secret', () => {
    const verifier = new HostedJwtVerifier({ secret: SECRET });
    expect(() => verifier.verify(hostedToken(randomUUID(), 'wrong-secret'))).toThrow(
      AuthenticationError,
    );
  });

  it('authenticates a non-JWT bearer through the appliance stub', async () => {
    const tenantId = randomUUID();
    const authenticator = new GatewayAuthenticator({
      hostedTokenVerifier: new HostedJwtVerifier({ secret: SECRET }),
      applianceCredentialVerifier: new StubApplianceCredentialVerifier(
        tenantId,
        'enterprise',
      ),
    });

    await expect(
      authenticator.authenticateAuthorizationHeader('Bearer appliance-credential'),
    ).resolves.toEqual({
      tenantId,
      deploymentType: 'appliance',
      edition: 'enterprise',
    });
  });

  it('calls alga-license with service authentication and caches by credential hash', async () => {
    const tenantId = randomUUID();
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ tenant_id: tenantId, edition: 'enterprise' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const verifier = new CachingApplianceCredentialVerifier(
      new HttpApplianceCredentialVerifier({
        licenseUrl: 'https://license.example.test/',
        serviceToken: 'license-service-token',
        fetchImplementation,
      }),
    );

    await expect(verifier.verify('private-appliance-credential')).resolves.toEqual({
      tenantId,
      edition: 'enterprise',
    });
    await verifier.verify('private-appliance-credential');

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://license.example.test/verify-appliance',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer license-service-token' }),
        body: JSON.stringify({ credential: 'private-appliance-credential' }),
      }),
    );
  });
});
