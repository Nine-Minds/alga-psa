/**
 * Microsoft Graph outbound email diagnostics steps.
 *
 * These steps reuse the inbound adapter primitives (credential inspection,
 * token-claim decoding, authenticated identity, mailbox route) but supply
 * send-specific advice. They are not a method on the adapter.
 */

import type { DiagnosticsStepOutcome } from '@alga-psa/shared/services/diagnostics/diagnosticsRunner';
import {
  classifyGraphFailure,
  classifySendPermissionDenial,
  type OutboundGraphRecommendationInput,
  toDiagnosticsErrorMeta,
} from '@alga-psa/shared/services/email/microsoftGraphDiagnostics';
import type {
  OutboundDiagnosticsContext,
  OutboundStepData,
  OutboundStepDefinition,
} from './outboundTypes';

type MailboxRelation = 'self' | 'shared' | 'unknown';

function mailboxRelation(ctx: OutboundDiagnosticsContext): MailboxRelation {
  const configured = (ctx.provider.configuredMailbox || '').trim().toLowerCase();
  const authenticated = (ctx.authenticatedUserEmail || '').trim().toLowerCase();
  if (!configured) return 'self';
  if (!authenticated) return 'unknown';
  return configured === authenticated ? 'self' : 'shared';
}

/**
 * True only when both identities are known and differ. Unknown identity is NOT
 * treated as a shared mailbox (nor as self-send); see mailboxRelation.
 */
function isSharedMailbox(ctx: OutboundDiagnosticsContext): boolean {
  return mailboxRelation(ctx) === 'shared';
}

function isUnknownMailboxIdentity(ctx: OutboundDiagnosticsContext): boolean {
  return mailboxRelation(ctx) === 'unknown';
}

function requiredSendScopes(ctx: OutboundDiagnosticsContext): string[] {
  const scopes = ['Mail.Send'];
  // Mail.Send.Shared is required only for a confirmed different sending mailbox.
  if (isSharedMailbox(ctx)) {
    scopes.push('Mail.Send.Shared');
  }
  return scopes;
}

/** Administrator-facing advice for outbound failures; raw provider evidence stays in the report. */
export function microsoftOutboundRecommendations(args: OutboundGraphRecommendationInput): string[] {
  const recommendations: string[] = [];
  if (args.missingScopes?.length) {
    recommendations.push('Reconnect the Microsoft 365 mailbox and approve the requested email permissions. Your Microsoft 365 administrator may need to approve them.');
  }
  if (args.status === 401) {
    recommendations.push('Microsoft 365 could not sign in. Reconnect the mailbox in email settings.');
  }
  if (args.status === 403) {
    const denial = classifySendPermissionDenial(args.code);
    if (denial === 'send-as-denied') {
      recommendations.push('This Microsoft account does not have permission to send as the selected mailbox. Ask your Microsoft 365 administrator to grant it Send As permission for that mailbox in Exchange admin center.');
    } else if (denial === 'send-on-behalf-denied') {
      recommendations.push('This Microsoft account does not have permission to send on behalf of the selected mailbox. Ask your Microsoft 365 administrator to grant it Send on Behalf permission for that mailbox in Exchange admin center.');
    } else {
      recommendations.push('Microsoft 365 denied access but did not identify the missing permission. Ask your Microsoft 365 administrator to check this account’s email permissions and its access to the selected mailbox.');
    }
  }
  if (args.status === 404) {
    recommendations.push('Microsoft 365 could not find the sending mailbox. Check its address and confirm it can be opened in Outlook.');
  }
  if (args.status === 429) {
    recommendations.push('Microsoft 365 is receiving too many requests. Wait a few minutes before trying again.');
  }
  if (args.identityUnknown) {
    recommendations.push('The connected Microsoft account could not be identified. Reconnect the mailbox and run checks again.');
  }
  return recommendations;
}

export function buildMicrosoftOutboundSteps(): OutboundStepDefinition[] {
  return [
    {
      id: 'tokens_present',
      title: 'Saved Microsoft 365 connection',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const adapter = ctx.provider.adapter;
        if (!adapter) {
          return {
            status: 'fail',
            error: { message: 'The Microsoft 365 connection is unavailable. Reconnect the mailbox.' },
            recommendations: ['Reconnect the Microsoft 365 mailbox.'],
          };
        }
        const credentials = await adapter.inspectStoredCredentials();
        ctx.checkedCapabilities.push('oauth_tokens');
        if (!credentials.accessTokenPresent) {
          return {
            status: 'fail',
            data: {
              accessTokenPresent: false,
              refreshTokenPresent: credentials.refreshTokenPresent,
            },
            detail: 'The Microsoft 365 mailbox is not connected.',
            error: { message: 'The Microsoft 365 mailbox is not connected.' },
            recommendations: [
              'Reconnect the Microsoft 365 mailbox in email settings.',
            ],
          };
        }
        return {
          status: 'pass',
          data: {
            accessTokenPresent: true,
            refreshTokenPresent: credentials.refreshTokenPresent,
            accessTokenFingerprint: credentials.accessTokenFingerprint,
            refreshTokenFingerprint: credentials.refreshTokenFingerprint,
            tokenExpiresAt: credentials.tokenExpiresAt,
          },
        };
      },
    },
    {
      id: 'token_claims',
      title: 'Microsoft 365 app permissions',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const adapter = ctx.provider.adapter;
        if (!adapter) {
          return {
            status: 'fail',
            error: { message: 'The Microsoft 365 connection is unavailable. Reconnect the mailbox.' },
          };
        }
        const claims = await adapter.decodeCurrentAccessTokenClaims();
        const relation = mailboxRelation(ctx);
        const shared = relation === 'shared';
        const required = requiredSendScopes(ctx);

        if (!claims.decoded) {
          return {
            status: 'warn',
            detail: 'Email permissions could not be checked. Send a test email to check whether this account can send.',
            data: {
              decoded: false,
              scopesAvailable: false,
              reason: 'The access token is missing, opaque, or is not a decodable JWT.',
              required,
              isSharedMailbox: shared,
              mailboxRelation: relation,
            },

          };
        }

        if (!claims.scopesAvailable) {
          return {
            status: 'warn',
            detail: 'Email permissions could not be checked. Send a test email to check whether this account can send.',
            data: {
              decoded: true,
              scopesAvailable: false,
              reason: 'The decoded token has no usable scp claim, so delegated scopes are unavailable.',
              scp: claims.scopes,
              required,
              isSharedMailbox: shared,
              mailboxRelation: relation,
            },

          };
        }

        ctx.checkedCapabilities.push(...claims.scopes.filter((scope) => scope.startsWith('Mail.')));
        const missing = required.filter((scope) => !claims.scopes.includes(scope));
        const data = {
          decoded: true,
          scopesAvailable: true,
          scp: claims.scopes,
          required,
          missing,
          isSharedMailbox: shared,
          mailboxRelation: relation,
          authenticatedUserEmail: ctx.authenticatedUserEmail ?? null,
        };

        if (missing.length > 0) {
          return {
            status: 'fail',
            data,
            detail: 'The Microsoft 365 connection is missing permission to send email.',
            error: { message: 'The Microsoft 365 connection is missing permission to send email.' },
            recommendations: microsoftOutboundRecommendations({
              missingScopes: missing,
              message: '',
              sharedMailbox: shared,
            }),
          };
        }

        if (relation === 'unknown') {
          // Mail.Send is present, so Graph send consent is satisfied. Mail.Send.Shared
          // is only required for a *confirmed* different mailbox, so unknown
          // identity stays a pass here with an explicit note; mailbox_base_path
          // surfaces the identity uncertainty as a warn.
          return {
            status: 'pass',
            data: {
              ...data,
              note: 'Authenticated identity is unknown, so the Mail.Send.Shared requirement for a different mailbox was not evaluated.',
            },
            detail: 'Permission to send from a different mailbox could not be checked because the connected account could not be identified.',
          };
        }

        return { status: 'pass', data };
      },
    },
    {
      id: 'graph_me',
      title: 'Connected Microsoft account',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const preflight = ctx.identityPreflight;
        if (!preflight) {
          return {
            status: 'warn',
            detail: 'The connected Microsoft account could not be checked.',
            data: { reason: 'Identity preflight was not performed.' },
          };
        }
        if (preflight.ok) {
          return {
            status: 'pass',
            http: preflight.http,
            data: preflight.data,
          };
        }
        throw preflight.error;
      },
    },
    {
      id: 'mailbox_base_path',
      title: 'Sending mailbox',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const adapter = ctx.provider.adapter;
        if (!adapter) {
          return {
            status: 'fail',
            error: { message: 'The Microsoft 365 connection is unavailable. Reconnect the mailbox.' },
          };
        }
        const route = adapter.getMailboxRoute();
        ctx.mailboxBasePath = route.basePath;
        const data = {
          configuredMailbox: route.configuredMailbox,
          authenticatedUserEmail: route.authenticatedUserEmail ?? null,
          mailboxBasePath: route.basePath,
          relation: route.relation,
          isSharedOrDelegated: route.isSharedOrDelegated,
          rationale: route.rationale,
        };

        if (route.relation === 'unknown') {
          return {
            status: 'warn',
            data,
            recommendations: [
              'The connected Microsoft account could not be identified. Reconnect the mailbox and run checks again.',
            ],
          };
        }

        return {
          status: 'pass',
          data,
        };
      },
    },
    {
      id: 'sent_items_writable',
      title: 'Sent Items folder',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const adapter = ctx.provider.adapter;
        if (!adapter) {
          return {
            status: 'warn',
            detail: 'Sent Items could not be checked because the Microsoft 365 connection is unavailable.',
            data: { writabilityVerified: false, saveToSentItems: true },
          };
        }
        const route = adapter.getMailboxRoute();
        try {
          const folder = await adapter.fetchSentItemsFolder();
          return {
            status: 'pass',
            detail: 'The Sent Items folder is accessible.',
            http: folder.http,
            data: {
              mailboxBasePath: route.basePath,
              displayName: folder.displayName ?? null,
              totalItemCount: folder.totalItemCount ?? null,
              writabilityVerified: false,
              saveToSentItems: true,
            },
          };
        } catch (error) {
          const failure = classifyGraphFailure(error);
            return {
            status: 'warn',
            detail: 'Sent Items could not be checked. After sending a test email, check the mailbox’s Sent Items folder for a copy.',
            data: {
              writabilityVerified: false,
              saveToSentItems: true,
              accessCheckStatus: failure.status ?? null,
            },
            error: toDiagnosticsErrorMeta(failure),

          };
        }
      },
    },
  ];
}
