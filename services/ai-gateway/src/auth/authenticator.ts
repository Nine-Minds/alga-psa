import process from 'node:process';

import { createApplianceCredentialVerifierFromEnvironment, type ApplianceCredentialVerifier } from './applianceVerifier.js';
import { HostedJwtVerifier, type HostedTokenVerifier } from './hostedJwt.js';
import { AuthenticationError, type AuthenticatedPrincipal } from './types.js';

export interface GatewayAuthenticatorOptions {
  hostedTokenVerifier: HostedTokenVerifier;
  applianceCredentialVerifier: ApplianceCredentialVerifier;
}

export class GatewayAuthenticator {
  constructor(private readonly options: GatewayAuthenticatorOptions) {}

  async authenticateAuthorizationHeader(
    authorizationHeader: string | undefined,
  ): Promise<AuthenticatedPrincipal> {
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorizationHeader?.trim() ?? '');
    if (!match?.[1]) {
      throw new AuthenticationError('Bearer authentication is required');
    }

    const credential = match[1];
    if (credential.split('.').length === 3) {
      const hosted = this.options.hostedTokenVerifier.verify(credential);
      return {
        tenantId: hosted.tenantId,
        deploymentType: 'hosted',
      };
    }

    const appliance = await this.options.applianceCredentialVerifier.verify(credential);
    return {
      tenantId: appliance.tenantId,
      deploymentType: 'appliance',
      edition: appliance.edition,
    };
  }
}

export function createGatewayAuthenticatorFromEnvironment(): GatewayAuthenticator {
  return new GatewayAuthenticator({
    hostedTokenVerifier: new HostedJwtVerifier({
      secret: process.env.AI_GATEWAY_SERVICE_SECRET?.trim() || '',
    }),
    applianceCredentialVerifier: createApplianceCredentialVerifierFromEnvironment(),
  });
}
