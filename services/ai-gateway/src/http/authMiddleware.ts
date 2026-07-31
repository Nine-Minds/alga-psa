import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Knex } from 'knex';

import { findOrCreateAccount } from '../accounts/accounts.js';
import type { GatewayAuthenticator } from '../auth/authenticator.js';
import type { AuthenticatedPrincipal } from '../auth/types.js';
import type { AiAccountRow } from '../db/types.js';
import type { TierConfigLoader } from '../tier/tierConfig.js';

export interface AuthenticatedAccountContext {
  principal: AuthenticatedPrincipal;
  account: AiAccountRow;
}

interface GatewayLocals {
  gatewayContext?: AuthenticatedAccountContext;
}

export function getAuthenticatedContext(response: Response): AuthenticatedAccountContext {
  const context = (response.locals as GatewayLocals).gatewayContext;
  if (!context) {
    throw new Error('Authenticated gateway context is missing');
  }
  return context;
}

export function createAuthenticationMiddleware(
  database: Knex,
  authenticator: GatewayAuthenticator,
  getTierConfig: TierConfigLoader,
): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    void (async () => {
      const principal = await authenticator.authenticateAuthorizationHeader(
        request.get('authorization'),
      );
      const account = await findOrCreateAccount(
        database,
        {
          tenantId: principal.tenantId,
          deploymentType: principal.deploymentType,
        },
        getTierConfig,
      );
      (response.locals as GatewayLocals).gatewayContext = { principal, account };
      next();
    })().catch(next);
  };
}
