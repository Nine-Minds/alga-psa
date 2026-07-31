import jwt, { type JwtPayload } from 'jsonwebtoken';

import { AuthenticationError } from './types.js';

export interface HostedTokenVerifier {
  verify(token: string): { tenantId: string };
}

export interface HostedJwtVerifierOptions {
  secret: string;
  now?: () => Date;
}

export class HostedJwtVerifier implements HostedTokenVerifier {
  private readonly secret: string;
  private readonly now: () => Date;

  constructor(options: HostedJwtVerifierOptions) {
    this.secret = options.secret.trim();
    this.now = options.now ?? (() => new Date());
  }

  verify(token: string): { tenantId: string } {
    if (!this.secret) {
      throw new AuthenticationError('Hosted gateway authentication is not configured');
    }

    let payload: string | JwtPayload;
    try {
      payload = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        clockTimestamp: Math.floor(this.now().getTime() / 1_000),
      });
    } catch {
      throw new AuthenticationError();
    }

    if (
      typeof payload === 'string' ||
      typeof payload.tenant_id !== 'string' ||
      !payload.tenant_id.trim() ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      throw new AuthenticationError('Hosted gateway token is missing required claims');
    }

    return { tenantId: payload.tenant_id.trim() };
  }
}
