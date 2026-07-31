import { z } from 'zod';
import type { ControlRegistry } from '@alga-psa/emulator-host';
import type { MsGraphCore } from './core';
import { deliverNotifications } from './notifier';

export function register(reg: ControlRegistry, core: MsGraphCore): void {
  reg.seeder({
    name: 'client',
    description: 'Register an OAuth client id/secret pair',
    params: z.object({ clientId: z.string(), clientSecret: z.string() }),
    run: ({ clientId, clientSecret }) => {
      core.registerClient(clientId, clientSecret);
      return { clientId };
    },
  });

  reg.seeder({
    name: 'message',
    description: 'Add a mailbox message and push change notifications to live subscriptions',
    params: z.object({
      id: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      receivedDateTime: z.string().optional(),
    }),
    run: async (input) => {
      const message = core.addMessage(input);
      await deliverNotifications(core, message, core.env);
      return message;
    },
  });

  reg.seeder({
    name: 'organization',
    description: 'Add an Entra organization returned by Graph /organization',
    params: z.object({
      id: z.string().optional(),
      displayName: z.string().optional(),
      primaryDomain: z.string().optional(),
    }),
    run: (input) => core.addOrganization(input),
  });

  reg.seeder({
    name: 'directory-user',
    description: 'Add an Entra directory user returned by Graph /users',
    params: z.object({
      id: z.string().optional(),
      displayName: z.string().optional(),
      givenName: z.string().nullable().optional(),
      surname: z.string().nullable().optional(),
      mail: z.string().nullable().optional(),
      userPrincipalName: z.string().optional(),
      accountEnabled: z.boolean().optional(),
      jobTitle: z.string().nullable().optional(),
      mobilePhone: z.string().nullable().optional(),
      businessPhones: z.array(z.string()).optional(),
    }),
    run: (input) => core.addDirectoryUser(input),
  });

  reg.action({
    name: 'expire-access-tokens',
    description: 'Expire every issued access token so the next Graph call 401s',
    run: () => ({ expired: core.expireAccessTokens() }),
  });

  reg.action({
    name: 'revoke-refresh-token',
    description: 'Revoke a refresh token so the next refresh grant fails with invalid_grant',
    params: z.object({ refreshToken: z.string() }),
    run: ({ refreshToken }) => ({ revoked: core.revokeRefreshToken(refreshToken) }),
  });

  reg.action({
    name: 'configure',
    description: 'Tune token behavior: access token TTL and refresh-token rotation',
    params: z.object({
      accessTokenTtlSeconds: z.number().int().positive().optional(),
      rotateRefreshTokens: z.boolean().optional(),
    }),
    run: ({ accessTokenTtlSeconds, rotateRefreshTokens }) => {
      if (accessTokenTtlSeconds !== undefined) core.accessTokenTtlSeconds = accessTokenTtlSeconds;
      if (rotateRefreshTokens !== undefined) core.rotateRefreshTokens = rotateRefreshTokens;
      return {
        accessTokenTtlSeconds: core.accessTokenTtlSeconds,
        rotateRefreshTokens: core.rotateRefreshTokens,
      };
    },
  });

  reg.fault({
    name: 'operation-fault',
    description:
      'Fail a specific operation ("token", or "<METHOD> <graph path>" like "GET /me") with a fixed response, optionally only N times',
    params: z.object({
      operation: z.string(),
      status: z.number().int().min(400).max(599).default(500),
      body: z.unknown().optional(),
      remaining: z.number().int().positive().optional(),
    }),
    arm: ({ operation, status, body, remaining }) => {
      core.injectOperationFault(operation, { status: status ?? 500, body: body ?? { error: 'injected_fault' }, remaining });
    },
    disarm: () => core.clearOperationFaults(),
  });

  reg.stateView({
    name: 'messages',
    description: 'Mailbox messages',
    get: () => [...core.messages.values()],
  });

  reg.stateView({
    name: 'subscriptions',
    description: 'Change-notification subscriptions (including owning client)',
    get: () => [...core.subscriptions.values()],
  });

  reg.stateView({
    name: 'organizations',
    description: 'Entra organizations',
    get: () => core.listOrganizations(),
  });

  reg.stateView({
    name: 'directory-users',
    description: 'Entra directory users',
    get: () => core.listDirectoryUsers(),
  });

  reg.stateView({
    name: 'faults',
    description: 'Armed operation faults',
    get: () => Object.fromEntries(core.faults),
  });

  reg.stateView({
    name: 'config',
    description: 'Token behavior configuration',
    get: () => ({
      accessTokenTtlSeconds: core.accessTokenTtlSeconds,
      rotateRefreshTokens: core.rotateRefreshTokens,
    }),
  });
}
