import { NextRequest, NextResponse } from 'next/server';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import { createTenantKnex, runWithTenant } from '../../../../../lib/db';
import {
  MicrosoftGraphAdapter,
  MicrosoftSubscriptionError,
} from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import {
  MicrosoftEmailIssuerError,
  MICROSOFT_EMAIL_ISSUER_ERRORS,
  resolveMicrosoftEmailIssuerChoice,
} from '@alga-psa/integrations/lib/microsoftEmailIssuerSelection';
import {
  getMicrosoftEmailOAuthSigningSecret,
  validateMicrosoftEmailOAuthState,
  type MicrosoftEmailOAuthStatePayload,
} from '@alga-psa/integrations/utils/email/microsoftEmailOAuthState';
import { consumeMicrosoftEmailOAuthNonce } from '@alga-psa/integrations/utils/email/microsoftEmailOAuthStateStore';
import { verifyMicrosoftEmailOAuthStateRelationships } from '@alga-psa/integrations/lib/microsoftEmailStateGuard';
import { persistMicrosoftEmailOAuthResult } from '../../../../../services/email/MicrosoftEmailOAuthResultPersistence';
import { getWebhookBaseUrl } from '../../../../../utils/email/webhookHelpers';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import axios from 'axios';
import {
  getMicrosoftTokenUrl,
  MICROSOFT_EMAIL_OAUTH_SCOPES,
} from '@alga-psa/shared/services/email/microsoftGraphEndpoints';
import { EmailWebhookMaintenanceService } from '@alga-psa/shared/services/email/EmailWebhookMaintenanceService';

export const dynamic = 'force-dynamic';

/**
 * Microsoft OAuth callback endpoint
 * Handles the authorization code exchange for access and refresh tokens
 *
 * The explicit issuer choice initiated by the form arrives here as a signed
 * state token. The callback revalidates ownership, eligibility, and client ID
 * server-side, consumes the single-use nonce, exchanges the code against the
 * selected app, and atomically persists tokens plus authoritative issuer
 * metadata. A failed callback preserves the previous working connection.
 */

type CallbackStateContext = {
  tenant?: string;
  providerId?: string;
  redirectUri?: string;
  issuer?: { kind: 'managed' | 'profile'; profileId?: string; clientId: string };
};

/**
 * Verify the OAuth state is one of our signed tokens. Every callback must pass
 * signature verification; legacy unsigned base64-encoded state is no longer
 * accepted — there is no backward-compat path that skips it.
 */
async function verifySignedState(state: string): Promise<MicrosoftEmailOAuthStatePayload | null> {
  const signingSecret = await getMicrosoftEmailOAuthSigningSecret();
  return validateMicrosoftEmailOAuthState({ token: state, secret: signingSecret });
}

/**
 * Load the provider row (plus its persisted refresh-token flag) that the state
 * names, exactly as the relationship guard needs it. Used by both the success
 * path and the guarded error path; returns `null` when the state names no
 * provider or the row is absent.
 */
async function loadStateProviderRow(stateContext: CallbackStateContext) {
  if (!stateContext.providerId || !stateContext.tenant) return null;
  const db = tenantDb(
    (await createTenantKnex()).knex,
    stateContext.tenant
  );
  const providerRow = await db.table('email_providers')
    .where('id', stateContext.providerId)
    .select('id', 'tenant', 'provider_type', 'status')
    .first();
  if (!providerRow) return null;
  const configRow = await db.table('microsoft_email_provider_config')
    .where('email_provider_id', stateContext.providerId)
    .select('refresh_token')
    .first();
  return {
    id: providerRow.id,
    tenant: providerRow.tenant,
    provider_type: providerRow.provider_type,
    status: providerRow.status,
    refresh_token: configRow?.refresh_token ?? null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Helper: return a safe HTML page that posts a base64-encoded payload to the opener and closes
    const respondWithPostMessage = (payload: any) => {
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const html = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Microsoft OAuth Callback</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Helvetica, Arial, sans-serif; padding: 24px; }
            .container { max-width: 640px; margin: 0 auto; }
            .status { margin-top: 12px; color: #444; }
            pre { background: #f6f8fa; padding: 12px; overflow: auto; border-radius: 6px; }
            .ok { color: #0a7f2e; }
            .err { color: #b00020; }
            button { margin-top: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h3>Microsoft OAuth ${payload.success ? 'Success' : 'Error'}</h3>
            <div id="status" class="status">Completing sign-in…</div>
            <div id="details-wrap" style="display:none">
              <p class="${payload.success ? 'ok' : 'err'}">${payload.success ? 'Authorized successfully.' : 'Authorization failed.'}</p>
              <pre id="details"></pre>
              <button onclick="window.close()">Close window</button>
            </div>
          </div>
          <script>
            (function(){
              try {
                var payload = JSON.parse(atob('${encoded}'));
                var target = window.opener || window.parent;
                if (target && target !== window) {
                  target.postMessage(payload, '*');
                }
              } catch (e) { /* ignore */ }
              try { window.close(); } catch (_) {}
              // If the window didn't close (popup blockers), show details for the user
              setTimeout(function(){
                if (!window.closed) {
                  document.getElementById('status').textContent = 'You can close this window.';
                  var wrap = document.getElementById('details-wrap');
                  var pre = document.getElementById('details');
                  wrap.style.display = 'block';
                  try { pre.textContent = JSON.stringify(JSON.parse(atob('${encoded}')), null, 2); } catch(_) { pre.textContent = 'Unable to display details.'; }
                }
              }, 100);
            })();
          </script>
          <noscript>
            <div class="status">JavaScript is required to complete sign-in. Please close this window.</div>
          </noscript>
        </body>
      </html>`;
      return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    };

    const persistProviderError = async (stateData: CallbackStateContext, errorCode: string, description?: string | null) => {
      if (!stateData?.providerId || !stateData?.tenant) {
        return;
      }

      const sessionUser = await getCurrentUser();
      if (!sessionUser?.tenant || sessionUser.tenant !== stateData.tenant) {
        console.error('[MS OAuth] Skipping provider error persistence because session tenant does not match state tenant', {
          hasSession: Boolean(sessionUser?.tenant),
          stateTenant: stateData.tenant,
        });
        return;
      }

      const message = [errorCode, description].filter(Boolean).join(': ');
      await runWithTenant(stateData.tenant, async () => {
        const { knex } = await createTenantKnex();
        await tenantDb(knex, stateData.tenant)
          .table('email_providers')
          .where({ id: stateData.providerId })
          .update({
            status: 'error',
            error_message: message,
            updated_at: knex.fn.now(),
          });
      });
    };

    // Handle OAuth errors. Microsoft rejected the authorization before any
    // token exchange. We may attribute the failure to a provider only when the
    // echoed state is one of our signed tokens AND every relationship the state
    // asserts still holds — the same guard chain as the success path: single-use
    // nonce, session ownership, purpose, provider existence/tenant/type, and
    // issuer readiness. A forged, replayed, or mismatched error callback must
    // change nothing.
    if (error) {
      const errorPayload = state ? await verifySignedState(state) : null;

      // An error callback that echoes unsigned or tampered state is rejected
      // outright — the same no-dual-acceptance rule as the success path. It
      // must never be attributed to a provider.
      if (state && !errorPayload) {
        console.error('[MS OAuth] OAuth error callback rejected: unsigned or tampered state', {
          error,
          hasState: Boolean(state),
        });
        return respondWithPostMessage({
          type: 'oauth-callback',
          provider: 'microsoft',
          success: false,
          error: MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_STATE,
          errorDescription: 'This Microsoft authorization request is invalid or tampered with. Start again from the mailbox form.'
        });
      }

      if (errorPayload) {
        // Single-use: consume the nonce so neither this nor a replayed error
        // callback can ever be attributed again (and the state can never be
        // reused for a later success).
        const consumed = await consumeMicrosoftEmailOAuthNonce(errorPayload.nonce);

        if (consumed) {
          const errorContext: CallbackStateContext = {
            tenant: errorPayload.tenant,
            providerId: errorPayload.providerId,
          };

          let stateProvider: Awaited<ReturnType<typeof loadStateProviderRow>> = null;
          if (errorPayload.providerId) {
            try {
              stateProvider = await runWithTenant(errorPayload.tenant, () =>
                loadStateProviderRow(errorContext)
              );
            } catch (providerError: any) {
              console.error('[MS OAuth] Failed to load state provider for error-callback verification', {
                providerId: errorPayload.providerId,
                error: providerError?.message || String(providerError),
              });
              stateProvider = null;
            }
          }

          const guard = verifyMicrosoftEmailOAuthStateRelationships({
            payload: errorPayload,
            sessionUser: await getCurrentUser(),
            provider: stateProvider,
          });

          // Issuer readiness is part of the guard: an app that can no longer
          // authorize mailboxes makes this callback "mismatched", so it must
          // not change the provider.
          let issuerReady = false;
          if (guard.ok && errorContext.tenant) {
            try {
              await resolveMicrosoftEmailIssuerChoice(errorContext.tenant, {
                kind: errorPayload.issuerKind,
                profileId: errorPayload.issuerProfileId,
                clientId: errorPayload.clientId,
              });
              issuerReady = true;
            } catch (issuerError: any) {
              console.error('[MS OAuth] OAuth error callback issuer revalidation failed', {
                code: issuerError instanceof MicrosoftEmailIssuerError ? issuerError.code : 'unknown',
              });
              issuerReady = false;
            }
          }

          if (guard.ok && issuerReady && errorPayload.providerId) {
            try {
              await persistProviderError(
                { tenant: errorPayload.tenant, providerId: errorPayload.providerId },
                error,
                errorDescription || ''
              );
            } catch (persistError: any) {
              console.warn('⚠️ Failed to persist Microsoft OAuth error:', persistError?.message || persistError);
            }
          } else {
            console.error('[MS OAuth] OAuth error callback rejected before any provider mutation', {
              guardCode: guard.ok ? undefined : guard.code,
              issuerReady,
              purpose: errorPayload.purpose,
              providerId: errorPayload.providerId,
            });
          }
        } else {
          // A replayed error callback: the nonce was already consumed by an
          // earlier callback. Never attribute it.
          console.error('[MS OAuth] Replayed OAuth error callback ignored', {
            nonce: errorPayload.nonce,
            providerId: errorPayload.providerId,
          });
        }
      }

      console.error('[MS OAuth] OAuth error from Microsoft:', {
        error,
        errorDescription: errorDescription || '',
        code: searchParams.get('code'),
        state: searchParams.get('state')
      });
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error,
        errorDescription: 'Microsoft authorization failed. Please try again.'
      });
    }

    // Validate required parameters
    if (!code || !state) {
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: 'missing_parameters',
        errorDescription: 'Authorization code or state parameter is missing'
      });
    }

    /**
     * The state must be the signed token issued by the explicit-selection flow
     * (`base64url(payload).signature`). Legacy unsigned base64-encoded state is
     * no longer accepted: every callback must pass signature verification and
     * relationship checks or fail with a stable error code.
     */
    const signedPayload = await verifySignedState(state);
    if (!signedPayload) {
      // Distinguish an expired token from a tampered/invalid one.
      const [payloadEncoded] = state.split('.');
      let expired = false;
      try {
        const decoded = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8')) as {
          expiresAt?: number;
        };
        expired = typeof decoded.expiresAt === 'number' && decoded.expiresAt <= Math.floor(Date.now() / 1000);
      } catch {
        // fall through to invalid_state
      }
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: expired ? MICROSOFT_EMAIL_ISSUER_ERRORS.EXPIRED_STATE : MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_STATE,
        errorDescription: expired
          ? 'This Microsoft authorization request expired. Start again from the mailbox form.'
          : 'This Microsoft authorization request is invalid or tampered with. Start again from the mailbox form.'
      });
    }

    // Single-use nonce: the same signed state cannot complete twice.
    const consumed = await consumeMicrosoftEmailOAuthNonce(signedPayload.nonce);
    if (!consumed) {
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: MICROSOFT_EMAIL_ISSUER_ERRORS.REPLAYED_STATE,
        errorDescription: 'This Microsoft authorization request has already been used. Start again from the mailbox form.'
      });
    }

    const stateContext: CallbackStateContext = {
      tenant: signedPayload.tenant,
      providerId: signedPayload.providerId,
      redirectUri: signedPayload.redirectUri,
      issuer: {
        kind: signedPayload.issuerKind,
        profileId: signedPayload.issuerProfileId,
        clientId: signedPayload.clientId,
      },
    };

    // The state parameter is not trusted on its own. Require an authenticated
    // session whose tenant matches the state tenant before writing any tokens —
    // otherwise a forged callback could overwrite another tenant's credentials.
    const sessionUser = await getCurrentUser();
    if (!sessionUser?.tenant || sessionUser.tenant !== stateContext.tenant) {
      console.error('[MS OAuth] Session tenant does not match state tenant', {
        hasSession: Boolean(sessionUser?.tenant),
        stateTenant: stateContext.tenant,
      });
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: 'tenant_mismatch',
        errorDescription: 'Your session does not match the requested tenant. Please sign in and retry.'
      });
    }

    // Enforce every relationship signed into the state. A valid signature only
    // proves the token was issued by us; ownership, provider binding, and
    // purpose semantics must each be verified before any credential write.
    {
      let stateProvider: Awaited<ReturnType<typeof loadStateProviderRow>> = null;

      if (signedPayload.providerId) {
        try {
          stateProvider = await runWithTenant(stateContext.tenant!, () =>
            loadStateProviderRow(stateContext)
          );
        } catch (providerError: any) {
          console.error('[MS OAuth] Failed to load state provider for verification', {
            providerId: signedPayload.providerId,
            error: providerError?.message || String(providerError),
          });
          return respondWithPostMessage({
            type: 'oauth-callback',
            provider: 'microsoft',
            success: false,
            error: MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_STATE,
            errorDescription: 'This Microsoft authorization request is invalid or tampered with. Start again from the mailbox form.'
          });
        }
      }

      const guard = verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload,
        sessionUser,
        provider: stateProvider,
      });

      if (!guard.ok) {
        console.error('[MS OAuth] Signed state relationship verification failed', {
          code: guard.code,
          purpose: signedPayload.purpose,
          providerId: signedPayload.providerId,
        });
        // The prior connection is left untouched — these are authorization /
        // state-integrity failures, not provider failures, and writing an
        // error status would take a working mailbox offline.
        return respondWithPostMessage({
          type: 'oauth-callback',
          provider: 'microsoft',
          success: false,
          error: guard.code,
          errorDescription: guard.message,
        });
      }
    }

    // Get OAuth client credentials - prefer server-side NEXTAUTH_URL for hosted detection
    const secretProvider = await getSecretProviderInstance();
    const nextauthUrl = process.env.NEXTAUTH_URL || (await secretProvider.getAppSecret('NEXTAUTH_URL')) || '';
    const isHostedFlow = nextauthUrl.startsWith('https://algapsa.com');
    let clientId: string | null = null;
    let clientSecret: string | null = null;

    // Revalidate the explicit selection server-side: ownership, active status,
    // Email capability, readiness, and consent. Never trust the client's claim.
    let issuerResolution: Awaited<ReturnType<typeof resolveMicrosoftEmailIssuerChoice>> | null = null;
    try {
      issuerResolution = await resolveMicrosoftEmailIssuerChoice(stateContext.tenant!, {
        kind: signedPayload.issuerKind,
        profileId: signedPayload.issuerProfileId,
        clientId: signedPayload.clientId,
      });
      clientId = issuerResolution.clientId;
      clientSecret = issuerResolution.clientSecret;
    } catch (issuerError: any) {
      const code = issuerError instanceof MicrosoftEmailIssuerError
        ? issuerError.code
        : MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_STATE;
      console.error('[MS OAuth] Issuer revalidation failed', { code });
      try {
        await persistProviderError(stateContext, code, issuerError?.message || 'Issuer revalidation failed');
      } catch (persistError: any) {
        console.warn('⚠️ Failed to persist Microsoft OAuth issuer error:', persistError?.message || persistError);
      }
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: code,
        errorDescription: issuerError?.message || 'The selected Microsoft application is no longer eligible for mailbox authorization.'
      });
    }

    // Normalize whitespace just in case the secret was copied with spaces/newlines
    clientId = clientId?.trim() || null;
    clientSecret = clientSecret?.trim() || null;

    // Resolve redirect URI with priority:
    // CRITICAL: The redirect URI MUST match exactly what was used in the authorization URL
    const hostedRedirect = await secretProvider.getAppSecret('MICROSOFT_REDIRECT_URI');
    const tenantRedirect = await secretProvider.getTenantSecret(stateContext.tenant, 'microsoft_redirect_uri');
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) || 'http://localhost:3000';

    // Use state-provided redirectUri first (this is what was used in authorization URL)
    const redirectUri = stateContext.redirectUri || (
      isHostedFlow
        ? hostedRedirect
        : (process.env.MICROSOFT_REDIRECT_URI || tenantRedirect)
    ) || `${baseUrl}/api/auth/microsoft/callback`;

    // Log non-sensitive debug information to help diagnose invalid_client
    const maskedClientId = clientId ? `${clientId.substring(0, 4)}...${clientId.substring(clientId.length - 4)}` : 'null';
    console.log('[MS OAuth] Using credentials', {
      source: 'explicit-selection',
      clientId: maskedClientId,
      redirectUri,
      stateRedirectUri: stateContext.redirectUri,
      redirectUriSource: stateContext.redirectUri ? 'state' : 'env_or_tenant'
    });

    if (!clientId || !clientSecret) {
      console.error('Microsoft OAuth credentials not configured');
      try {
        await persistProviderError(stateContext, 'configuration_error', 'OAuth credentials not configured');
      } catch (persistError: any) {
        console.warn('⚠️ Failed to persist Microsoft OAuth configuration error:', persistError?.message || persistError);
      }
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: 'configuration_error',
        errorDescription: 'OAuth credentials not configured'
      });
    }

    // Exchange authorization code for tokens
    try {
      const tokenUrl = getMicrosoftTokenUrl('common');
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        scope: MICROSOFT_EMAIL_OAUTH_SCOPES.join(' ')
      });

      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token, expires_in } = response.data;

      // Calculate expiration time
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      // Persist tokens and initialize the webhook if we have provider context.
      // The write is atomic with webhook/subscription setup: any failure after
      // the token write restores the prior connection (old refresh token, old
      // client_id/profile pinning, old subscription state).
      if (stateContext.providerId && stateContext.tenant) {
        try {
          // The effective issuer metadata to persist comes from the signed
          // state's revalidated selection (issuerResolution is always non-null
          // here — this callback only runs with a verified signed state). It is
          // never re-resolved from the tenant binding after this point.
          const issuerMetadata = issuerResolution
            ? {
                client_id: issuerResolution.clientId,
                client_secret: issuerResolution.clientSecret,
                tenant_id: issuerResolution.microsoftTenantId || 'common',
                microsoft_profile_id: issuerResolution.profileId || null,
                client_secret_ref: issuerResolution.clientSecretRef || null,
              }
            : null;

          await runWithTenant(stateContext.tenant, async () => {
            await persistMicrosoftEmailOAuthResult({
              tenant: stateContext.tenant!,
              providerId: stateContext.providerId!,
              tokens: {
                accessToken: access_token,
                refreshToken: refresh_token || null,
                expiresAt,
              },
              issuerMetadata,
              setupWebhook: async (ctx) => {
                const { provider, config: msConfig } = ctx;
                if (!provider || !msConfig) return;

                const baseUrl = getWebhookBaseUrl();
                const webhookUrl = `${baseUrl}/api/email/webhooks/microsoft`;

                // Determine folder to monitor from saved config (first folder if multiple)
                const folderToMonitor = Array.isArray(msConfig.folder_filters)
                  ? (msConfig.folder_filters[0] || 'Inbox')
                  : (() => { try { const parsed = JSON.parse(msConfig.folder_filters || '[]'); return parsed[0] || 'Inbox'; } catch { return 'Inbox'; } })();

                const providerConfig: any = {
                  id: provider.id,
                  tenant: provider.tenant,
                  name: provider.provider_name || provider.mailbox,
                  provider_type: 'microsoft',
                  mailbox: provider.mailbox,
                  folder_to_monitor: folderToMonitor,
                  active: provider.is_active,
                  webhook_notification_url: webhookUrl,
                  // Persisted and looked up via microsoft vendor config
                  webhook_subscription_id: msConfig.webhook_subscription_id || null,
                  // Use tenant as verification token when none exists yet
                  webhook_verification_token: msConfig.webhook_verification_token || stateContext.tenant,
                  webhook_expires_at: msConfig.webhook_expires_at || null,
                  connection_status: provider.status || 'connected',
                  last_connection_test: provider.last_sync_at || null,
                  connection_error_message: provider.error_message || null,
                  created_at: provider.created_at,
                  updated_at: provider.updated_at,
                  provider_config: {
                    client_id: msConfig.client_id || ctx.clientId,
                    client_secret: msConfig.client_secret || ctx.clientSecret,
                    tenant_id: msConfig.tenant_id || null,
                    access_token: ctx.accessToken,
                    refresh_token: ctx.refreshToken || null,
                    token_expires_at: ctx.expiresAt.toISOString(),
                    microsoft_profile_id: msConfig.microsoft_profile_id || undefined,
                    client_secret_ref: msConfig.client_secret_ref || undefined,
                  },
                };

                const adapter = new MicrosoftGraphAdapter(providerConfig);
                // Record every Graph subscription the setup deletes or creates
                // so a later failure can compensate (delete new subs, avoid
                // resurrecting deleted ones).
                adapter.attachWebhookLifecycle({
                  onSubscriptionDeleted: (subscriptionId) =>
                    ctx.webhookCompensation.onSubscriptionDeleted(subscriptionId),
                  onSubscriptionCreated: (subscriptionId) =>
                    ctx.webhookCompensation.onSubscriptionCreated(subscriptionId),
                });
                try {
                  // Load credentials and authenticated user email before subscription
                  // This ensures mailbox path auto-detection works correctly
                  await adapter.connect();

                  // Context logging before attempting subscription
                  const maskedToken = providerConfig.webhook_verification_token
                    ? `${String(providerConfig.webhook_verification_token).slice(0, 4)}...(${String(providerConfig.webhook_verification_token).length})`
                    : 'none';
                  console.log('[MS OAuth Callback] Registering webhook subscription', {
                    tenant: provider.tenant,
                    providerId: provider.id,
                    mailbox: provider.mailbox,
                    url: webhookUrl,
                    clientState: maskedToken,
                  });

                  await adapter.registerWebhookSubscription();
                  await new EmailWebhookMaintenanceService().recordWebhookDeliveryMode({
                    providerId: provider.id,
                    tenant: provider.tenant,
                    reason: 'OAuth setup subscription succeeded',
                  });

                  console.log('[MS OAuth Callback] Webhook subscription registration attempted');
                } catch (subErr: any) {
                  if (subErr instanceof MicrosoftSubscriptionError && subErr.kind === 'validation') {
                    const nextProbeAt = await new EmailWebhookMaintenanceService().usePollingDelivery({
                      providerId: provider.id,
                      tenant: provider.tenant,
                      reason: subErr.message,
                    });
                    console.info('[MS OAuth Callback] Webhook endpoint validation failed; using polling delivery', {
                      tenant: provider.tenant,
                      providerId: provider.id,
                      nextProbeAt,
                    });
                    return;
                  }
                  console.warn('⚠️ Failed to register Microsoft webhook subscription in callback:', {
                    message: subErr?.message || String(subErr),
                    status: subErr?.status,
                    code: subErr?.code,
                    requestId: subErr?.requestId,
                  });
                  throw subErr;
                }
              },
              compensateWebhook: async (compLedger) => {
                // Delete every Graph subscription the failed setup created, so a
                // retry of the callback cannot duplicate subscriptions. The
                // database restore (run by persistMicrosoftEmailOAuthResult after
                // this hook) reverts the config/provider rows.
                if (!compLedger.createdSubscriptionIds.length) return;
                try {
                  const { knex: compKnex } = await createTenantKnex();
                  const compDb = tenantDb(compKnex, stateContext.tenant!);
                  const [compConfig, compProvider] = await Promise.all([
                    compDb.table('microsoft_email_provider_config')
                      .where('email_provider_id', stateContext.providerId)
                      .first(),
                    compDb.table('email_providers')
                      .where('id', stateContext.providerId)
                      .first(),
                  ]);
                  if (!compConfig || !compProvider) return;

                  const compAdapter = new MicrosoftGraphAdapter({
                    id: compProvider.id,
                    tenant: compProvider.tenant,
                    name: compProvider.provider_name || compProvider.mailbox,
                    provider_type: 'microsoft',
                    mailbox: compProvider.mailbox,
                    folder_to_monitor: 'Inbox',
                    active: compProvider.is_active,
                    provider_config: {
                      client_id: compConfig.client_id,
                      client_secret: compConfig.client_secret,
                      tenant_id: compConfig.tenant_id || null,
                      access_token,
                      refresh_token: refresh_token || null,
                      token_expires_at: expiresAt.toISOString(),
                      microsoft_profile_id: compConfig.microsoft_profile_id || undefined,
                      client_secret_ref: compConfig.client_secret_ref || undefined,
                    },
                  } as any);

                  for (const subscriptionId of compLedger.createdSubscriptionIds) {
                    try {
                      await compAdapter.deleteSubscription(subscriptionId);
                      console.info('[MS OAuth Callback] Deleted subscription created by failed webhook setup', { subscriptionId });
                    } catch (delErr: any) {
                      console.warn('[MS OAuth Callback] Failed to delete subscription created by failed webhook setup', {
                        subscriptionId,
                        error: delErr?.message || String(delErr),
                      });
                    }
                  }
                } catch (compErr: any) {
                  console.warn('[MS OAuth Callback] Graph compensation failed; leaving cleanup to the maintenance probe', {
                    error: compErr?.message || String(compErr),
                  });
                }
              },
            });
          });
        } catch (persistErr: any) {
          // `persistMicrosoftEmailOAuthResult` already compensated the Graph
          // side and restored the provider to its prior connected/polling
          // snapshot before throwing. Do NOT mark the provider `error` here —
          // that would clobber the restored state and take a working mailbox
          // offline. The user still sees the failed callback.
          console.warn('⚠️ Failed to persist Microsoft OAuth tokens or initialize webhook (provider restored to its prior state):', persistErr?.message || persistErr);
          return respondWithPostMessage({
            type: 'oauth-callback',
            provider: 'microsoft',
            success: false,
            error: MICROSOFT_EMAIL_ISSUER_ERRORS.CALLBACK_PERSISTENCE_FAILED,
            errorDescription: persistErr?.message || 'Failed to persist Microsoft OAuth tokens or initialize webhook'
          });
        }
      }

      // Return success with tokens back to the opener
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: true,
        data: {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: expiresAt.toISOString(),
          code,
          state
        }
      });
    } catch (tokenError: any) {
      const errorData = tokenError.response?.data || {};
      const errorMessage = errorData.error_description || errorData.error || tokenError.message;
      const errorCode = errorData.error || 'token_exchange_failed';

      console.error('[MS OAuth] Failed to exchange authorization code:', {
        error: errorCode,
        errorDescription: errorMessage,
        status: tokenError.response?.status,
        statusText: tokenError.response?.statusText,
        requestUrl: tokenError.config?.url,
        redirectUri: redirectUri,
        clientId: clientId ? `${clientId.substring(0, 4)}...${clientId.substring(clientId.length - 4)}` : 'null',
        hasCode: !!code,
        hasState: !!state
      });

      try {
        await persistProviderError(stateContext, errorCode, errorMessage);
      } catch (persistError: any) {
        console.warn('⚠️ Failed to persist Microsoft OAuth token exchange error:', persistError?.message || persistError);
      }

      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: errorCode,
        errorDescription: 'Microsoft authorization failed. Please try again.'
      });
    }
  } catch (error: any) {
    console.error('Unexpected error in Microsoft OAuth callback:', error);
    return new NextResponse(
      (() => {
        const encoded = Buffer.from(JSON.stringify({
          type: 'oauth-callback',
          provider: 'microsoft',
          success: false,
          error: 'unexpected_error',
          errorDescription: 'Microsoft authorization failed. Please try again.'
        })).toString('base64');
        return `<!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Microsoft OAuth Callback</title>
          </head>
          <body>
            <script>
              (function(){
                try { var payload = JSON.parse(atob('${encoded}')); (window.opener||window.parent).postMessage(payload, '*'); } catch(_) {}
                try { window.close(); } catch(_) {}
                setTimeout(function(){ if(!window.closed){ document.body.innerHTML = '<p>Authorization failed. You can close this window.</p>'; } }, 100);
              })();
            </script>
          </body>
        </html>`;
      })(),
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }
}
