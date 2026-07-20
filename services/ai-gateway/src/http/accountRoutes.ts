import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Knex } from 'knex';

import {
  buildAccountSummary,
  grantConsent,
  listUsageEvents,
  loadAccount,
  revokeConsent,
  updateAutoTopup,
} from '../accounts/accountService.js';
import { adjustCredits } from '../ledger/ledger.js';
import { getAuthenticatedContext } from './authMiddleware.js';
import { HttpError } from './errors.js';
import { parseJsonInteger, readRequiredString, requireObject } from './input.js';

function asyncHandler(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request, response, next): void => {
    void handler(request, response).catch(next);
  };
}

function readDateQuery(value: unknown, fieldName: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_request', `${fieldName} must be an ISO 8601 string`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'invalid_request', `${fieldName} must be an ISO 8601 string`);
  }
  return date;
}

function readLimit(value: unknown): number {
  if (value === undefined) {
    return 50;
  }
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new HttpError(400, 'invalid_request', 'limit must be an integer');
  }
  return Math.min(200, Math.max(1, Number.parseInt(value, 10)));
}

function bearerToken(request: Request): string | undefined {
  return /^Bearer\s+([^\s]+)$/i.exec(request.get('authorization')?.trim() ?? '')?.[1];
}

function tokensEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export interface AccountRouteHandlers {
  getAccount: RequestHandler;
  getUsage: RequestHandler;
  setAutoTopup: RequestHandler;
  grantConsent: RequestHandler;
  revokeConsent: RequestHandler;
  requireAdmin: RequestHandler;
  grantAdminCredits: RequestHandler;
}

export function createAccountRouteHandlers(
  database: Knex,
  getAdminToken: () => string,
): AccountRouteHandlers {
  return {
    getAccount: asyncHandler(async (_request, response) => {
      const { account } = getAuthenticatedContext(response);
      response.status(200).json(await buildAccountSummary(database, account));
    }),

    getUsage: asyncHandler(async (request, response) => {
      const { account } = getAuthenticatedContext(response);
      const feature =
        request.query.feature === undefined
          ? undefined
          : readRequiredString(request.query.feature, 'feature');
      const cursor =
        request.query.cursor === undefined
          ? undefined
          : readRequiredString(request.query.cursor, 'cursor');
      try {
        response.status(200).json(
          await listUsageEvents(database, account.account_id, {
            from: readDateQuery(request.query.from, 'from'),
            to: readDateQuery(request.query.to, 'to'),
            feature,
            cursor,
            limit: readLimit(request.query.limit),
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.message === 'cursor is invalid') {
          throw new HttpError(400, 'invalid_request', error.message);
        }
        throw error;
      }
    }),

    setAutoTopup: asyncHandler(async (request, response) => {
      const { account } = getAuthenticatedContext(response);
      const body = requireObject(request.body);
      if (typeof body.enabled !== 'boolean') {
        throw new HttpError(400, 'invalid_request', 'enabled must be a boolean');
      }
      const thresholdCredits =
        body.thresholdCredits === undefined
          ? undefined
          : parseJsonInteger(body.thresholdCredits, 'thresholdCredits');
      if (thresholdCredits !== undefined && thresholdCredits < 0n) {
        throw new HttpError(400, 'invalid_request', 'thresholdCredits must not be negative');
      }
      const packPriceId =
        body.packPriceId === undefined
          ? undefined
          : readRequiredString(body.packPriceId, 'packPriceId');
      let updated;
      try {
        updated = await updateAutoTopup(database, account.account_id, {
          enabled: body.enabled,
          thresholdCredits,
          packPriceId,
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Enabling auto-topup')) {
          throw new HttpError(400, 'invalid_request', error.message);
        }
        throw error;
      }
      response.status(200).json(await buildAccountSummary(database, updated));
    }),

    grantConsent: asyncHandler(async (request, response) => {
      const { account, principal } = getAuthenticatedContext(response);
      if (principal.deploymentType !== 'appliance') {
        throw new HttpError(403, 'appliance_required', 'Consent is managed by appliance accounts.');
      }
      const body = requireObject(request.body);
      await grantConsent(
        database,
        account.account_id,
        readRequiredString(body.grantedBy, 'grantedBy'),
        readRequiredString(body.termsVersion, 'termsVersion'),
      );
      response.status(200).json(
        await buildAccountSummary(database, await loadAccount(database, account.account_id)),
      );
    }),

    revokeConsent: asyncHandler(async (_request, response) => {
      const { account, principal } = getAuthenticatedContext(response);
      if (principal.deploymentType !== 'appliance') {
        throw new HttpError(403, 'appliance_required', 'Consent is managed by appliance accounts.');
      }
      await revokeConsent(database, account.account_id, `appliance:${principal.tenantId}`);
      response.status(200).json(
        await buildAccountSummary(database, await loadAccount(database, account.account_id)),
      );
    }),

    requireAdmin: (request: Request, _response: Response, next: NextFunction): void => {
      const expectedToken = getAdminToken().trim();
      if (!expectedToken) {
        next(new HttpError(503, 'admin_not_configured', 'Gateway admin access is not configured.'));
        return;
      }
      const providedToken = bearerToken(request);
      if (!providedToken || !tokensEqual(providedToken, expectedToken)) {
        next(new HttpError(401, 'unauthorized', 'Invalid admin bearer token.'));
        return;
      }
      next();
    },

    grantAdminCredits: asyncHandler(async (request, response) => {
      const body = requireObject(request.body);
      const accountId = readRequiredString(body.accountId, 'accountId');
      const bucket = readRequiredString(body.bucket, 'bucket');
      if (bucket !== 'included' && bucket !== 'topup') {
        throw new HttpError(400, 'invalid_request', 'bucket must be included or topup');
      }
      const credits = parseJsonInteger(body.credits, 'credits');
      if (credits === 0n) {
        throw new HttpError(400, 'invalid_request', 'credits must not be zero');
      }
      const result = await adjustCredits(database, {
        accountId,
        credits,
        bucket,
        note: readRequiredString(body.note, 'note'),
      });
      response.status(201).json({
        accountId,
        entryId: result.entryId,
        bucket,
        credits: credits.toString(),
        balanceAfter: result.totalBalance.toString(),
      });
    }),
  };
}
