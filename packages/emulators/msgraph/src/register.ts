import { z } from 'zod';
import type { ControlRegistry } from '@alga-psa/emulator-host';
import type { MsGraphCore } from './core';
import { deliverInboundBotActivity, deliverNotifications } from './notifier';

const directoryUserParams = {
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
  userType: z.enum(['Member', 'Guest']).optional(),
  externalUserState: z.string().nullable().optional(),
};

export function register(reg: ControlRegistry, core: MsGraphCore): void {
  reg.seeder({
    name: 'client',
    description:
      'Register an OAuth client id/secret pair, optionally with the admin-consented application permissions its app-only tokens carry in "roles"',
    params: z.object({
      clientId: z.string(),
      clientSecret: z.string(),
      appRoles: z.array(z.string()).optional(),
    }),
    run: ({ clientId, clientSecret, appRoles }) => {
      core.registerClient(clientId, clientSecret, appRoles ?? []);
      return { clientId, appRoles: appRoles ?? [] };
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
    params: z.object(directoryUserParams),
    run: (input) => core.addDirectoryUser(input),
  });

  reg.seeder({
    name: 'teams-user',
    description:
      'Add a Teams-addressable directory user (userType "Guest" seeds an external/guest identity) and return the bot identity fields to feed into "bot-activity"',
    params: z.object(directoryUserParams),
    run: (input) => {
      const user = core.addDirectoryUser({
        ...input,
        externalUserState:
          input.externalUserState ?? (input.userType === 'Guest' ? 'PendingAcceptance' : null),
      });
      return {
        ...user,
        botIdentity: { id: `29:${user.id}`, aadObjectId: user.id, name: user.displayName },
      };
    },
  });

  reg.seeder({
    name: 'teams-channel',
    description: 'Add a channel to a team (creating the team when teamId is new)',
    params: z.object({
      teamId: z.string().optional(),
      teamDisplayName: z.string().optional(),
      id: z.string().optional(),
      displayName: z.string().optional(),
      description: z.string().nullable().optional(),
      membershipType: z.enum(['standard', 'private', 'shared']).optional(),
    }),
    run: (input) => core.addTeamChannel(input),
  });

  reg.seeder({
    name: 'teams-chat',
    description: 'Add a Teams chat (with optional members and messages) served by Graph /chats',
    params: z.object({
      id: z.string().optional(),
      topic: z.string().nullable().optional(),
      chatType: z.enum(['oneOnOne', 'group', 'meeting']).optional(),
      members: z
        .array(
          z.object({
            id: z.string().optional(),
            displayName: z.string().optional(),
            userId: z.string().nullable().optional(),
          }),
        )
        .optional(),
      messages: z
        .array(
          z.object({
            id: z.string().optional(),
            from: z.string().optional(),
            fromName: z.string().optional(),
            content: z.string().optional(),
          }),
        )
        .optional(),
    }),
    run: (input) => core.addChat(input),
  });

  reg.seeder({
    name: 'bot-activity',
    description:
      "Sign and POST an inbound Bot Framework activity at the app's bot endpoint, returning the app's synchronous reply",
    params: z.object({
      type: z.enum(['message', 'invoke', 'conversationUpdate']).optional(),
      text: z.string().optional(),
      fromId: z.string().optional(),
      fromAadObjectId: z.string().optional(),
      fromName: z.string().optional(),
      conversationId: z.string().optional(),
      conversationType: z.enum(['personal', 'groupChat', 'channel']).optional(),
      tenantId: z.string().optional(),
      serviceUrl: z.string().optional(),
      value: z.record(z.unknown()).optional(),
      targetUrl: z.string().optional(),
      appId: z.string().optional(),
    }),
    run: (input) => deliverInboundBotActivity(core, input, core.env),
  });

  reg.action({
    name: 'clear-bot-activities',
    description: 'Drop every captured outbound Bot Framework activity',
    run: () => ({ cleared: core.clearBotActivities() }),
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
    description:
      'Tune token behavior (access token TTL, refresh-token rotation) and the inbound bot activity defaults',
    params: z.object({
      accessTokenTtlSeconds: z.number().int().positive().optional(),
      rotateRefreshTokens: z.boolean().optional(),
      botTargetUrl: z.string().optional(),
      botServiceUrl: z.string().optional(),
      botAppId: z.string().optional(),
    }),
    run: ({ accessTokenTtlSeconds, rotateRefreshTokens, botTargetUrl, botServiceUrl, botAppId }) => {
      if (accessTokenTtlSeconds !== undefined) core.accessTokenTtlSeconds = accessTokenTtlSeconds;
      if (rotateRefreshTokens !== undefined) core.rotateRefreshTokens = rotateRefreshTokens;
      if (botTargetUrl !== undefined) core.botConfig.targetUrl = botTargetUrl;
      if (botServiceUrl !== undefined) core.botConfig.serviceUrl = botServiceUrl;
      if (botAppId !== undefined) core.botConfig.appId = botAppId;
      return {
        accessTokenTtlSeconds: core.accessTokenTtlSeconds,
        rotateRefreshTokens: core.rotateRefreshTokens,
        bot: { ...core.botConfig },
      };
    },
  });

  reg.fault({
    name: 'operation-fault',
    description:
      'Fail a specific operation ("token", "<METHOD> <graph path>" like "GET /me", or "<METHOD> <connector path>" like "POST /v3/conversations") with a fixed response, optionally only N times',
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
    name: 'applications',
    description: 'Entra application registrations created through Graph',
    get: () => [...core.applications.values()],
  });

  reg.stateView({
    name: 'service-principals',
    description: 'Entra service principals created through Graph',
    get: () => [...core.servicePrincipals.values()],
  });

  reg.stateView({
    name: 'bot-activities',
    description: 'Outbound Bot Framework activities the bot pushed at the connector, newest last',
    get: () => [...core.capturedBotActivities],
  });

  reg.stateView({
    name: 'activity-notifications',
    description: 'Graph teamwork/sendActivityNotification calls',
    get: () => [...core.activityNotifications],
  });

  reg.stateView({
    name: 'teams',
    description: 'Teams and their channels',
    get: () => [...core.teams.values()],
  });

  reg.stateView({
    name: 'chats',
    description: 'Teams chats with their messages',
    get: () =>
      [...core.chats.values()].map((chat) => ({ ...chat, messages: core.chatMessages.get(chat.id) ?? [] })),
  });

  reg.stateView({
    name: 'faults',
    description: 'Armed operation faults',
    get: () => Object.fromEntries(core.faults),
  });

  reg.stateView({
    name: 'config',
    description: 'Token behavior and inbound bot activity configuration',
    get: () => ({
      accessTokenTtlSeconds: core.accessTokenTtlSeconds,
      rotateRefreshTokens: core.rotateRefreshTokens,
      bot: { ...core.botConfig },
    }),
  });
}
