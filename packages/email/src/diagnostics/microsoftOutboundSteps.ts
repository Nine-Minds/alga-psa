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
  mapOutboundRecommendations,
  toDiagnosticsErrorMeta,
} from '@alga-psa/shared/services/email/microsoftGraphDiagnostics';
import type {
  OutboundDiagnosticsContext,
  OutboundStepData,
  OutboundStepDefinition,
} from './outboundTypes';

function isSharedMailbox(ctx: OutboundDiagnosticsContext): boolean {
  const configured = (ctx.provider.configuredMailbox || '').trim().toLowerCase();
  const authenticated = (ctx.authenticatedUserEmail || '').trim().toLowerCase();
  return Boolean(configured) && Boolean(authenticated) && configured !== authenticated;
}

function requiredSendScopes(ctx: OutboundDiagnosticsContext): string[] {
  const scopes = ['Mail.Send'];
  if (isSharedMailbox(ctx)) {
    scopes.push('Mail.Send.Shared');
  }
  return scopes;
}

export function buildMicrosoftOutboundSteps(): OutboundStepDefinition[] {
  return [
    {
      id: 'tokens_present',
      title: 'Microsoft Graph OAuth tokens present',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const adapter = ctx.provider.adapter;
        if (!adapter) {
          return {
            status: 'fail',
            error: { message: 'Microsoft Graph adapter was not constructed' },
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
            error: { message: 'No Microsoft OAuth access token is available for this provider.' },
            recommendations: [
              'No usable Microsoft OAuth tokens are available. Reconnect the Microsoft 365 mailbox to generate tokens.',
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
      title: 'Decode delegated token scopes',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const adapter = ctx.provider.adapter;
        if (!adapter) {
          return {
            status: 'fail',
            error: { message: 'Microsoft Graph adapter was not constructed' },
          };
        }
        const claims = await adapter.decodeCurrentAccessTokenClaims();
        const shared = isSharedMailbox(ctx);
        const required = requiredSendScopes(ctx);

        if (!claims.decoded) {
          return {
            status: 'warn',
            data: {
              decoded: false,
              reason: 'The access token could not be decoded or has no usable scp claim.',
              required,
              isSharedMailbox: shared,
            },
            recommendations: [
              'The access token could not be decoded to inspect delegated scopes, so Mail.Send consent cannot be confirmed. Reconnect the Microsoft 365 mailbox.',
            ],
          };
        }

        ctx.checkedCapabilities.push(...claims.scopes.filter((scope) => scope.startsWith('Mail.')));
        const missing = required.filter((scope) => !claims.scopes.includes(scope));
        const data = {
          decoded: true,
          scp: claims.scopes,
          required,
          missing,
          isSharedMailbox: shared,
          authenticatedUserEmail: ctx.authenticatedUserEmail ?? null,
        };

        if (missing.length > 0) {
          return {
            status: 'fail',
            data,
            error: { message: `Missing required delegated scopes: ${missing.join(', ')}` },
            recommendations: mapOutboundRecommendations({
              missingScopes: missing,
              message: '',
              sharedMailbox: shared,
            }),
          };
        }

        if (!ctx.authenticatedUserEmail) {
          return {
            status: 'pass',
            data: {
              ...data,
              note: 'Authenticated identity is unknown, so the Mail.Send.Shared requirement for a different mailbox was not evaluated.',
            },
            recommendations: [
              'The authenticated identity could not be confirmed, so the requirement for Mail.Send.Shared when sending as a shared mailbox was not evaluated.',
            ],
          };
        }

        return { status: 'pass', data };
      },
    },
    {
      id: 'graph_me',
      title: 'Authenticated Microsoft identity',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const preflight = ctx.identityPreflight;
        if (!preflight) {
          return {
            status: 'warn',
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
      title: 'Mailbox routing decision (/me vs /users/{mailbox})',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const adapter = ctx.provider.adapter;
        if (!adapter) {
          return {
            status: 'fail',
            error: { message: 'Microsoft Graph adapter was not constructed' },
          };
        }
        const route = adapter.getMailboxRoute();
        ctx.mailboxBasePath = route.basePath;
        return {
          status: 'pass',
          data: {
            configuredMailbox: route.configuredMailbox,
            authenticatedUserEmail: route.authenticatedUserEmail ?? null,
            mailboxBasePath: route.basePath,
            isSharedOrDelegated: route.isSharedOrDelegated,
            rationale: route.rationale,
          },
          recommendations: route.isSharedOrDelegated
            ? [
                'Sending as a mailbox other than the authenticated user additionally requires Exchange Send As (or Send on Behalf) on the target mailbox; Graph Mail.Send consent alone is not sufficient.',
              ]
            : undefined,
        };
      },
    },
    {
      id: 'send_as_probe',
      title: 'Exchange Send As verification',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        if (!isSharedMailbox(ctx)) {
          return {
            status: 'skip',
            detail: 'Not applicable: sending as the authenticated user (/me).',
            data: { isSharedMailbox: false, requiresSendAs: false },
          };
        }
        return {
          status: 'warn',
          detail: 'Exchange Send As has not been verified.',
          data: {
            isSharedMailbox: true,
            requiresSendAs: true,
            authoritative: false,
            draftProbePerformed: false,
            requiredExchangePermission: 'Send As (or Send on Behalf)',
            limitation:
              'A draft-create probe requires Mail.ReadWrite, which this delegated scope set does not request; a draft 403 would not isolate Exchange Send As from a Graph write-scope denial. No authoritative verdict is available without real-tenant validation.',
          },
          recommendations: [
            'Grant the sending identity Exchange Send As (or Send on Behalf) on the shared mailbox, then confirm with an explicit live send test.',
          ],
        };
      },
    },
    {
      id: 'sent_items_writable',
      title: 'Sent Items accessibility',
      run: async (ctx): Promise<DiagnosticsStepOutcome<OutboundStepData>> => {
        const adapter = ctx.provider.adapter;
        if (!adapter) {
          return {
            status: 'warn',
            data: { writabilityVerified: false, saveToSentItems: true },
          };
        }
        const route = adapter.getMailboxRoute();
        try {
          const folder = await adapter.fetchSentItemsFolder();
          return {
            status: 'warn',
            detail: 'Sent Items folder is addressable, but writability is not independently proven.',
            http: folder.http,
            data: {
              mailboxBasePath: route.basePath,
              displayName: folder.displayName ?? null,
              totalItemCount: folder.totalItemCount ?? null,
              writabilityVerified: false,
              saveToSentItems: true,
            },
            recommendations: [
              'Microsoft Graph sendMail saves to Sent Items when saveToSentItems is true; folder readability does not prove that write succeeds. Confirm with a live send.',
            ],
          };
        } catch (error) {
          const failure = classifyGraphFailure(error);
          const forbidden = failure.status === 403;
          return {
            status: 'warn',
            detail: forbidden
              ? 'Sent Items folder lookup was denied; this does not prove sendMail cannot save to Sent Items.'
              : 'Sent Items folder could not be inspected; writability remains unverified.',
            data: {
              writabilityVerified: false,
              saveToSentItems: true,
              accessCheckStatus: failure.status ?? null,
            },
            error: toDiagnosticsErrorMeta(failure),
            recommendations: [
              forbidden
                ? 'Sent Items folder read was forbidden, which is an access-check result and not evidence about sendMail persistence. Confirm with a live send.'
                : 'Sent Items inventory could not be inspected; treat writability as unverified.',
            ],
          };
        }
      },
    },
  ];
}
