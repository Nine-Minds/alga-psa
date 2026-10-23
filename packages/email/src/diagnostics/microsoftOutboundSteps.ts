/**
 * Microsoft Graph outbound email diagnostics steps.
 *
 * These steps reuse the inbound adapter primitives (credential inspection,
 * token-claim decoding, authenticated identity, mailbox route) but supply
 * send-specific advice. They are not a method on the adapter.
 */

import type { DiagnosticsStepOutcome } from '@alga-psa/shared/services/diagnostics';
import {
  classifySendPermissionDenial,
  normalizeOutboundGraphFailure,
  type OutboundGraphRecommendationInput,
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

/**
 * Administrator-facing message for a failed Sent Items lookup. Raw Graph
 * messages can carry mailbox content, so only a status-derived, sanitized
 * message is exposed; status/code/correlation ids remain as evidence.
 */
function sanitizedSentItemsMessage(status?: number): string {
  if (status === 401) return 'Microsoft Graph rejected the saved credentials for the Sent Items lookup.';
  if (status === 403) return 'Microsoft Graph denied the Sent Items folder lookup.';
  if (status === 404) return 'Microsoft Graph could not find the Sent Items folder.';
  if (status !== undefined && status >= 500) return 'Microsoft Graph could not complete the Sent Items lookup.';
  return 'The Sent Items folder could not be inspected.';
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
          recommendations: route.isSharedOrDelegated
            ? [
                'Sending as a mailbox other than the authenticated user additionally requires Exchange Send As (or Send on Behalf) on the target mailbox; Microsoft Graph Mail.Send consent alone is not sufficient. Send on Behalf appears as "<sender> on behalf of <mailbox>", which is not the same as Send As.',
              ]
            : undefined,
        };
      },
    },
    {
      id: 'send_as_probe',
      title: 'Exchange Send As verification',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const relation = mailboxRelation(ctx);
        if (relation === 'self') {
          return {
            status: 'skip',
            detail: 'Not applicable: sending as the authenticated user (/me).',
            data: { isSharedMailbox: false, mailboxRelation: 'self', requiresSendAs: false },
          };
        }
        if (relation === 'unknown') {
          return {
            status: 'warn',
            detail: 'Authenticated identity is unknown, so whether Exchange Send As is required cannot be determined.',
            data: {
              isSharedMailbox: false,
              mailboxRelation: 'unknown',
              requiresSendAs: null,
              authoritative: false,
              draftProbePerformed: false,
              limitation:
                'The configured mailbox could not be compared to the authenticated user, so self-send is not confirmed and neither is a shared/delegated send. A draft-create probe requires Mail.ReadWrite, which this delegated scope set does not request.',
            },
            recommendations: [
              'Confirm the authenticated Microsoft identity before concluding whether Exchange Send As (or Send on Behalf) is required, then re-run diagnostics.',
            ],
          };
        }
        return {
          status: 'warn',
          detail: 'Sending as this mailbox has not been verified. Exchange Send As has not been confirmed.',
          data: {
            isSharedMailbox: true,
            mailboxRelation: 'shared',
            requiresSendAs: true,
            authoritative: false,
            draftProbePerformed: false,
            requiredExchangePermission: 'Exchange Send As (or Send on Behalf)',
            limitation:
              'A draft-create probe requires Mail.ReadWrite, which this delegated scope set does not request; a draft denial would not isolate Exchange Send As from a Graph write-scope denial. No authoritative verdict is available without real-tenant validation.',
          },
          recommendations: [
            'Sending as a mailbox other than the authenticated user additionally requires Exchange Send As (or Send on Behalf) on the target mailbox. Diagnostics have not verified this permission. Grant it in Exchange admin center, then confirm with an explicit test email. Send on Behalf appears as "<sender> on behalf of <mailbox>", which is not the same as Send As.',
          ],
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
            status: 'warn',
            detail: 'The Sent Items folder is readable, but this check does not verify the ability to write or save sent messages.',
            http: folder.http,
            data: {
              mailboxBasePath: route.basePath,
              displayName: folder.displayName ?? null,
              totalItemCount: folder.totalItemCount ?? null,
              writabilityVerified: false,
              saveToSentItems: true,
            },
            recommendations: [
              'The Sent Items folder was readable, but that does not prove sent messages can be saved. Confirm with a test email that a copy appears in the sending mailbox’s Sent Items folder.',
            ],
          };
        } catch (error) {
          const failure = normalizeOutboundGraphFailure(error);
          return {
            status: 'warn',
            detail: 'Sent Items could not be checked, so saving sent messages remains unverified. After sending a test email, check the mailbox’s Sent Items folder for a copy.',
            http: {
              method: 'GET',
              path: `${route.basePath}/mailFolders/sentitems`,
              ...(failure.status !== undefined ? { status: failure.status } : {}),
              ...(failure.requestId ? { requestId: failure.requestId } : {}),
              ...(failure.clientRequestId ? { clientRequestId: failure.clientRequestId } : {}),
            },
            data: {
              writabilityVerified: false,
              saveToSentItems: true,
              mailboxBasePath: route.basePath,
              accessCheckStatus: failure.status ?? null,
              accessCheckCode: failure.code ?? null,
            },
            // Sanitized administrator-facing message only: status/code/correlation
            // ids are the evidence, never the raw Graph message or response body.
            error: {
              message: sanitizedSentItemsMessage(failure.status),
              status: failure.status,
              code: failure.code,
              requestId: failure.requestId,
              clientRequestId: failure.clientRequestId,
            },
            recommendations: [
              'Sent Items could not be read, so saving sent messages remains unverified. After sending a test email, check the mailbox’s Sent Items folder for a copy.',
            ],
          };
        }
      },
    },
  ];
}
