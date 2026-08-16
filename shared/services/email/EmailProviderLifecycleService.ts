import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import type { EmailProviderConfig } from '../../interfaces/inbound-email.interfaces';
import { EmailWebhookMaintenanceService } from './EmailWebhookMaintenanceService';
import { buildMicrosoftEmailProviderConfig } from './microsoftEmailProviderConfig';
import { GmailAdapter } from './providers/GmailAdapter';
import { MicrosoftGraphAdapter } from './providers/MicrosoftGraphAdapter';
import { getEmailWebhookBaseUrl } from './webhookBaseUrl';
import { INBOUND_AUTH_FAILURE_PAUSE_THRESHOLD } from './InboundEmailAuthFailurePolicy';
import {
  dispatchInboundAuthPauseNotification,
} from './inboundAuthPauseNotifier';
import { persistIngressPointer } from './inboundEmailProducer';
import { enqueueUnifiedInboundEmailQueueJob } from './unifiedInboundEmailQueue';
import { refreshImapAccessToken } from './imapOauthToken';

export type InboundPauseReason = 'manual' | 'tenant_cancelled' | 'auth_failure';

export interface ResumeProviderResult {
  resumed: boolean;
  webhookRegistered: boolean;
  error?: string;
  reconciliation?: InboundAuthPauseReconciliation;
  /** True when the provider is paused for auth_failure and credentials must be re-established before resume. */
  reconnectRequired?: boolean;
}

export interface InboundAuthPauseReconciliation {
  /**
   * 'completed' — the whole paused interval was handed off durably.
   * 'started'  — provider-specific asynchronous reconciliation (IMAP cursor
   *              rescan) has been kicked off; the covering rescan is guaranteed
   *              by the reset cursors and dedupe, not awaited here.
   *
   * There is deliberately no 'partial': an auth-pause recovery may never
   * report success while paused-interval mail is knowingly unreconciled.
   * When the interval cannot be fully swept (e.g. reconciliation keeps
   * reporting more remaining), recovery fails and the provider stays paused
   * with a reconnect-required error.
   */
  status: 'started' | 'completed';
  queuedMessages: number;
}

export interface RecoverAuthPausedProviderOptions {
  /**
   * The reconnect path already proved the new credentials work (e.g. an OAuth
   * callback that just exchanged tokens, or a successful connection test).
   */
  credentialsValidated?: boolean;
  /**
   * The reconnect path already re-established delivery (e.g. webhook/watch
   * registration inside setup automation), so recovery must not double-register.
   */
  deliveryEstablished?: boolean;
  /**
   * Google only: the pre-watch history_id captured before the reconnect flow
   * replaced it with a new watch cursor. When omitted, recovery captures the
   * current cursor itself before any registration it performs.
   */
  savedHistoryId?: string | null;
}

export type RecoverAuthPausedProviderResult = ResumeProviderResult & {
  reconciliation?: InboundAuthPauseReconciliation;
};

export interface RecordUnrecoverableAuthFailureResult {
  count: number;
  autoPaused: boolean;
  providerType?: 'microsoft' | 'google' | 'imap';
  providerName?: string;
  mailbox?: string;
  pausedAt?: string;
}

/** Safe, secret-free provider-facing error for the auth_failure pause state. */
export const INBOUND_AUTH_FAILURE_PAUSE_ERROR_MESSAGE =
  'Sign-in was rejected by the email provider. Reconnect the mailbox to resume inbound email.';

/**
 * Upper bound on Microsoft recovery reconciliation passes. Each pass enqueues
 * at most the per-pass cap and reports whether Graph still holds more
 * unprocessed messages in the paused interval; recovery loops until the
 * interval is exhausted. The bound converts a pathological non-terminating
 * sweep into a failed recovery (provider stays paused) instead of a hang.
 */
const MICROSOFT_RECOVERY_MAX_PASSES = 500;

interface GooglePausedIntervalReconciliation {
  queuedMessages: number;
  usedFallbackQuery: boolean;
}

/** IMAP credential validation timeouts (mirror the queue processor defaults). */
const IMAP_VALIDATION_CONNECTION_TIMEOUT_MS = 10_000;
const IMAP_VALIDATION_SOCKET_TIMEOUT_MS = 30_000;

type ProviderRecord = {
  id: string;
  tenant: string;
  provider_type: 'microsoft' | 'google' | 'imap';
  provider_name: string;
  mailbox: string;
  is_active: boolean;
  status: EmailProviderConfig['connection_status'];
  inbound_paused_at?: string | Date | null;
  inbound_pause_reason?: InboundPauseReason | null;
  inbound_auth_failure_count?: number | null;
  inbound_auth_failure_code?: string | null;
  created_at: string;
  updated_at: string;
};

function isImapTokenExpired(tokenExpiresAt: unknown): boolean {
  if (typeof tokenExpiresAt !== 'string' || !tokenExpiresAt.trim()) return true;
  const expiresAtMs = new Date(tokenExpiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs - Date.now() < 5 * 60 * 1000;
}

function isGmailHistoryIdRejected(error: any): boolean {
  return error?.code === 'gmail.historyIdNotFound';
}

export class EmailProviderLifecycleService {
  private async loadProvider(providerId: string, tenant: string): Promise<{
    provider: ProviderRecord;
    vendorConfig: any;
  } | null> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    const provider = await db.table('email_providers')
      .where({ id: providerId })
      .first() as ProviderRecord | undefined;
    if (!provider) return null;

    const configTable = provider.provider_type === 'microsoft'
      ? 'microsoft_email_provider_config'
      : provider.provider_type === 'google'
        ? 'google_email_provider_config'
        : 'imap_email_provider_config';
    const vendorConfig = await db.table(configTable)
      .where({ email_provider_id: providerId })
      .first();
    return { provider, vendorConfig: vendorConfig || {} };
  }

  private toAdapterConfig(provider: ProviderRecord, vendorConfig: any): EmailProviderConfig {
    const baseUrl = getEmailWebhookBaseUrl();
    const webhookPath = provider.provider_type === 'microsoft'
      ? '/api/email/webhooks/microsoft'
      : provider.provider_type === 'google'
        ? '/api/email/webhooks/google'
        : '/api/email/webhooks/imap';

    return {
      id: provider.id,
      tenant: provider.tenant,
      name: provider.provider_name,
      provider_type: provider.provider_type,
      mailbox: provider.mailbox,
      folder_to_monitor: 'Inbox',
      active: provider.is_active,
      inboundPausedAt: provider.inbound_paused_at
        ? new Date(provider.inbound_paused_at).toISOString()
        : null,
      inboundPauseReason: provider.inbound_pause_reason || null,
      webhook_notification_url: `${baseUrl}${webhookPath}`,
      webhook_subscription_id: vendorConfig.webhook_subscription_id || undefined,
      webhook_verification_token: vendorConfig.webhook_verification_token || undefined,
      webhook_expires_at: vendorConfig.webhook_expires_at || undefined,
      delivery_mode: vendorConfig.delivery_mode || undefined,
      connection_status: provider.status || 'connected',
      connection_error_message: undefined,
      provider_config: vendorConfig,
      created_at: provider.created_at,
      updated_at: provider.updated_at,
    };
  }

  /**
   * Tear down external notification sources and clear local renewal cursors.
   * Failures are deliberately contained because the database ingestion gate is
   * authoritative and remote subscriptions expire naturally.
   */
  async teardownProviderSubscriptions(providerId: string, tenant: string): Promise<void> {
    const loaded = await this.loadProvider(providerId, tenant);
    if (!loaded) return;
    const { provider, vendorConfig } = loaded;
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);

    try {
      const adapterConfig = this.toAdapterConfig(provider, vendorConfig);
      if (provider.provider_type === 'microsoft' && vendorConfig.webhook_subscription_id) {
        const adapter = new MicrosoftGraphAdapter(
          await buildMicrosoftEmailProviderConfig(adapterConfig)
        );
        await adapter.deleteSubscription(vendorConfig.webhook_subscription_id);
      } else if (provider.provider_type === 'google') {
        await new GmailAdapter(adapterConfig).stopWatch();
      }
    } catch (error) {
      console.warn('[EmailProviderLifecycle] external subscription teardown failed', {
        tenant,
        providerId,
        providerType: provider.provider_type,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (provider.provider_type === 'microsoft') {
        await db.table('microsoft_email_provider_config')
          .where({ email_provider_id: providerId })
          .update({
            webhook_subscription_id: null,
            webhook_expires_at: null,
            updated_at: knex.fn.now(),
          });
      } else if (provider.provider_type === 'google') {
        await db.table('google_email_provider_config')
          .where({ email_provider_id: providerId })
          .update({
            watch_expiration: null,
            updated_at: knex.fn.now(),
          });
      }
    }
  }

  async pauseProvider(
    providerId: string,
    tenant: string,
    reason: InboundPauseReason
  ): Promise<boolean> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    const updated = await db.table('email_providers')
      .where({ id: providerId })
      .whereNull('inbound_paused_at')
      .update({
        inbound_paused_at: knex.fn.now(),
        inbound_pause_reason: reason,
        updated_at: knex.fn.now(),
      });

    if (Number(updated) === 0) {
      const exists = await db.table('email_providers').where({ id: providerId }).first('id');
      if (!exists) throw new Error('Provider not found');
      return false;
    }

    await this.teardownProviderSubscriptions(providerId, tenant);
    return true;
  }

  /**
   * Reset the consecutive auth-failure counter after any successful provider
   * source access — including a fetch that returned no new messages.
   */
  async recordSourceAccessSuccess(providerId: string, tenant: string): Promise<void> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    await db.table('email_providers')
      .where({ id: providerId })
      .where((builder: any) => {
        builder
          .where('inbound_auth_failure_count', '>', 0)
          .orWhereNotNull('inbound_auth_failure_last_at');
      })
      .update({
        inbound_auth_failure_count: 0,
        inbound_auth_failure_last_at: null,
        inbound_auth_failure_code: null,
        updated_at: knex.fn.now(),
      });
  }

  /**
   * Record one strictly classified unrecoverable auth failure. The provider
   * row is locked in a tenant-scoped transaction so the counter increment and
   * the pause transition are atomic; exactly one caller observes the
   * unpaused→paused transition and performs teardown + admin notification.
   * Concurrent failing jobs see the already-paused row and no-op.
   */
  async recordUnrecoverableAuthFailure(
    providerId: string,
    tenant: string,
    safeCode: string
  ): Promise<RecordUnrecoverableAuthFailureResult> {
    const knex = await getAdminConnection();
    const outcome = await knex.transaction(async (trx) => {
      const trxDb = tenantDb(trx, tenant);
      const row = await trxDb.table('email_providers')
        .where({ id: providerId })
        .forUpdate()
        .first() as ProviderRecord | undefined;
      if (!row) {
        throw new Error('Provider not found');
      }

      if (row.inbound_paused_at) {
        return {
          count: Number(row.inbound_auth_failure_count || 0),
          autoPaused: false,
        };
      }

      const nextCount = Number(row.inbound_auth_failure_count || 0) + 1;
      const nowIso = new Date().toISOString();
      const shouldPause = nextCount >= INBOUND_AUTH_FAILURE_PAUSE_THRESHOLD;

      await trxDb.table('email_providers')
        .where({ id: providerId })
        .update({
          inbound_auth_failure_count: nextCount,
          inbound_auth_failure_last_at: nowIso,
          inbound_auth_failure_code: safeCode,
          ...(shouldPause
            ? {
                inbound_paused_at: nowIso,
                inbound_pause_reason: 'auth_failure' as InboundPauseReason,
                status: 'error',
                error_message: INBOUND_AUTH_FAILURE_PAUSE_ERROR_MESSAGE,
              }
            : {}),
          updated_at: trx.fn.now(),
        });

      return {
        count: nextCount,
        autoPaused: shouldPause,
        providerType: row.provider_type,
        providerName: row.provider_name,
        mailbox: row.mailbox,
        pausedAt: shouldPause ? nowIso : undefined,
      };
    });

    // Only the transaction that flipped an unpaused row to paused may tear
    // down subscriptions and notify admins — exactly once per pause.
    if (outcome.autoPaused) {
      console.info('[EmailProviderLifecycle] auto-paused provider after repeated auth failures', {
        tenant,
        providerId,
        providerType: outcome.providerType,
        authFailureCode: safeCode,
        count: outcome.count,
        pausedAt: outcome.pausedAt,
      });
      try {
        await this.teardownProviderSubscriptions(providerId, tenant);
      } catch (error) {
        console.warn('[EmailProviderLifecycle] teardown after auth-failure pause failed', {
          tenant,
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await dispatchInboundAuthPauseNotification({
        tenant,
        providerId,
        providerName: outcome.providerName || '',
        mailbox: outcome.mailbox || '',
        providerType: outcome.providerType || 'microsoft',
        authFailureCode: safeCode,
        pausedAt: outcome.pausedAt || new Date().toISOString(),
      });
    }

    return outcome;
  }

  async resumeProvider(providerId: string, tenant: string): Promise<ResumeProviderResult> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    const current = await db.table('email_providers')
      .where({ id: providerId })
      .first('id', 'inbound_paused_at', 'inbound_pause_reason') as
      | { id: string; inbound_paused_at: string | null; inbound_pause_reason: InboundPauseReason | null }
      | undefined;

    if (!current) throw new Error('Provider not found');

    // A provider paused because its credentials were rejected must not be
    // resumed bare: dead credentials would immediately recreate the failure
    // loop. Route through validate → re-establish → reconcile → clear.
    if (current.inbound_paused_at && current.inbound_pause_reason === 'auth_failure') {
      return await this.recoverAuthPausedProvider(providerId, tenant);
    }

    const updated = await db.table('email_providers')
      .where({ id: providerId })
      .whereNotNull('inbound_paused_at')
      .update({
        inbound_paused_at: null,
        inbound_pause_reason: null,
        // A manual resume is a fresh start: any stale auth-failure count from
        // before the pause must not arm the next single failure to auto-pause.
        inbound_auth_failure_count: 0,
        inbound_auth_failure_last_at: null,
        inbound_auth_failure_code: null,
        updated_at: knex.fn.now(),
      });
    if (Number(updated) === 0) {
      const exists = await db.table('email_providers').where({ id: providerId }).first('id');
      if (!exists) throw new Error('Provider not found');
      return { resumed: false, webhookRegistered: false };
    }

    const loaded = await this.loadProvider(providerId, tenant);
    if (!loaded) throw new Error('Provider not found');
    const { provider, vendorConfig } = loaded;
    const shouldRegister = provider.is_active && (
      provider.provider_type === 'google'
      || (provider.provider_type === 'microsoft' && vendorConfig.delivery_mode === 'webhook')
    );
    if (!shouldRegister) {
      return { resumed: true, webhookRegistered: false };
    }

    try {
      const webhookRegistered = await this.establishProviderDelivery(providerId, tenant, provider, vendorConfig);
      return { resumed: true, webhookRegistered };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.table('email_providers').where({ id: providerId }).update({
        status: 'error',
        error_message: message,
        updated_at: knex.fn.now(),
      });
      return { resumed: true, webhookRegistered: false, error: message };
    }
  }

  /**
   * Re-establish delivery for a provider after its pause columns were already
   * cleared. Shared by manual resume and the auth-failure recovery path.
   * Returns whether a webhook/watch was registered.
   */
  private async establishProviderDelivery(
    providerId: string,
    tenant: string,
    provider: ProviderRecord,
    vendorConfig: any
  ): Promise<boolean> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    const adapterConfig = this.toAdapterConfig(provider, vendorConfig);
    if (provider.provider_type === 'microsoft') {
      const adapter = new MicrosoftGraphAdapter(
        await buildMicrosoftEmailProviderConfig(adapterConfig)
      );
      const result = await adapter.initializeWebhook(adapterConfig.webhook_notification_url);
      if (!result.success && result.errorKind === 'validation') {
        // Same degradation as initializeProviderWebhook: an unreachable
        // endpoint means polling, not a dead provider.
        await new EmailWebhookMaintenanceService().usePollingDelivery({
          providerId,
          tenant,
          reason: result.error || 'Microsoft webhook endpoint validation failed on resume',
        });
        await db.table('email_providers').where({ id: providerId }).update({
          status: 'connected',
          error_message: null,
          updated_at: knex.fn.now(),
        });
        return false;
      }
      if (!result.success) throw new Error(result.error || 'Microsoft webhook registration failed');
      await db.table('microsoft_email_provider_config')
        .where({ email_provider_id: providerId })
        .update({
          webhook_subscription_id: result.subscriptionId || null,
          updated_at: knex.fn.now(),
        });
      await new EmailWebhookMaintenanceService().recordWebhookDeliveryMode({
        providerId,
        tenant,
        reason: 'inbound pause resumed; webhook re-registered',
      });
    } else {
      await new GmailAdapter(adapterConfig).registerWebhookSubscription();
    }
    await db.table('email_providers').where({ id: providerId }).update({
      status: 'connected',
      error_message: null,
      updated_at: knex.fn.now(),
    });
    return true;
  }

  /**
   * Recovery path for providers auto-paused for auth_failure.
   *
   * Order is deliberate and matches the approved plan: save the pause
   * boundary and old vendor cursor, validate credentials while still paused,
   * re-establish delivery, reconcile the paused interval durably, and only
   * then clear the pause and auth-failure counters. A failure at any step
   * leaves/reinststates the pause and returns a reconnect-required error.
   */
  async recoverAuthPausedProvider(
    providerId: string,
    tenant: string,
    options: RecoverAuthPausedProviderOptions = {}
  ): Promise<RecoverAuthPausedProviderResult> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    const provider = await db.table('email_providers')
      .where({ id: providerId })
      .first() as ProviderRecord | undefined;
    if (!provider) throw new Error('Provider not found');

    if (!provider.inbound_paused_at || provider.inbound_pause_reason !== 'auth_failure') {
      return { resumed: false, webhookRegistered: false };
    }

    // 1. Pause boundary snapshot — before any registration can overwrite
    //    cursors. For Google this MUST capture the pre-watch history_id: a
    //    new watch registration persists its own newer cursor, and listing
    //    from that cursor would silently accept the paused interval as empty.
    const pausedAt = new Date(provider.inbound_paused_at);
    let savedHistoryId = options.savedHistoryId !== undefined ? options.savedHistoryId : null;
    if (provider.provider_type === 'google' && savedHistoryId === null) {
      const googleConfig = await db.table('google_email_provider_config')
        .where({ email_provider_id: providerId })
        .first('history_id');
      savedHistoryId = googleConfig?.history_id ? String(googleConfig.history_id) : null;
    }

    const failRecovery = async (error: unknown): Promise<RecoverAuthPausedProviderResult> => {
      const message = error instanceof Error ? error.message : String(error);
      await db.table('email_providers').where({ id: providerId }).update({
        status: 'error',
        error_message: INBOUND_AUTH_FAILURE_PAUSE_ERROR_MESSAGE,
        updated_at: knex.fn.now(),
      });
      console.warn('[EmailProviderLifecycle] auth-failure recovery rejected; provider stays paused', {
        tenant,
        providerId,
        error: message,
      });
      return {
        resumed: false,
        webhookRegistered: false,
        reconnectRequired: true,
        error: message,
      };
    };

    // 2. Validate credentials while the ingestion pause is still active.
    if (!options.credentialsValidated) {
      try {
        await this.validateProviderCredentials(provider, tenant);
      } catch (error) {
        return await failRecovery(error);
      }
    }

    // 3. Re-establish the notification source (unless the reconnect path
    //    already did it — never double-register a webhook/watch).
    let webhookRegistered = false;
    if (!options.deliveryEstablished) {
      const loaded = await this.loadProvider(providerId, tenant);
      if (!loaded) throw new Error('Provider not found');
      const shouldRegister = loaded.provider.is_active && (
        loaded.provider.provider_type === 'google'
        || (loaded.provider.provider_type === 'microsoft' && loaded.vendorConfig.delivery_mode === 'webhook')
      );
      if (shouldRegister) {
        try {
          webhookRegistered = await this.establishProviderDelivery(
            providerId,
            tenant,
            loaded.provider,
            loaded.vendorConfig
          );
        } catch (error) {
          return await failRecovery(error);
        }
      }
    }

    // 4. Reconcile from the saved pause boundary with the durable dedupe path.
    //    The interval must be FULLY handed off before the pause clears — a
    //    recovery may never report success over a known gap.
    let reconciliation: InboundAuthPauseReconciliation;
    try {
      if (provider.provider_type === 'microsoft') {
        const result = await this.reconcileMicrosoftPausedInterval({
          providerId,
          tenant,
          since: pausedAt,
        });
        reconciliation = {
          status: 'completed',
          queuedMessages: result.queuedMessages,
        };
      } else if (provider.provider_type === 'google') {
        const result = await this.reconcileGooglePausedInterval({
          providerId,
          tenant,
          pausedAt,
          savedHistoryId,
        });
        reconciliation = {
          status: 'completed',
          queuedMessages: result.queuedMessages,
        };
      } else {
        const result = await this.reconcileImapPausedInterval({ providerId, tenant });
        reconciliation = { status: 'started', queuedMessages: result.queuedMessages };
      }
    } catch (error) {
      return await failRecovery(error);
    }

    // 5. The reconciliation handoff is durable; clear the pause and counters.
    await this.clearAuthPause(providerId, tenant);

    console.info('[EmailProviderLifecycle] auth-failure recovery completed', {
      tenant,
      providerId,
      providerType: provider.provider_type,
      webhookRegistered,
      reconciliation,
    });

    return { resumed: true, webhookRegistered, reconciliation };
  }

  private async clearAuthPause(providerId: string, tenant: string): Promise<void> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    await db.table('email_providers')
      .where({ id: providerId })
      .update({
        inbound_paused_at: null,
        inbound_pause_reason: null,
        inbound_auth_failure_count: 0,
        inbound_auth_failure_last_at: null,
        inbound_auth_failure_code: null,
        status: 'connected',
        error_message: null,
        updated_at: knex.fn.now(),
      });
  }

  /**
   * Credential validation for the recovery path. Deliberately read-only: it
   * proves the stored credentials can access the mailbox without registering
   * anything or clearing the pause.
   */
  private async validateProviderCredentials(provider: ProviderRecord, tenant: string): Promise<void> {
    const loaded = await this.loadProvider(provider.id, tenant);
    if (!loaded) throw new Error('Provider not found');
    const adapterConfig = this.toAdapterConfig(loaded.provider, loaded.vendorConfig);

    if (loaded.provider.provider_type === 'microsoft') {
      const adapter = new MicrosoftGraphAdapter(
        await buildMicrosoftEmailProviderConfig(adapterConfig)
      );
      const test = await adapter.testConnection();
      if (!test.success) {
        throw new Error(test.error || 'Microsoft Graph connection test failed');
      }
      return;
    }

    if (loaded.provider.provider_type === 'google') {
      const adapter = new GmailAdapter(adapterConfig);
      const test = await adapter.testConnection();
      if (!test.success) {
        throw new Error(test.error || 'Gmail connection test failed');
      }
      return;
    }

    await this.validateImapCredentials(provider.id, tenant, loaded.vendorConfig);
  }

  private async validateImapCredentials(
    providerId: string,
    tenant: string,
    imapConfig: any
  ): Promise<void> {
    if (!imapConfig?.host) {
      throw new Error('IMAP provider config not found');
    }

    const knex = await getAdminConnection();
    let accessToken = typeof imapConfig.access_token === 'string' && imapConfig.access_token.trim()
      ? imapConfig.access_token
      : null;

    if (imapConfig.auth_type === 'oauth2' && (!accessToken || isImapTokenExpired(imapConfig.token_expires_at))) {
      accessToken = await refreshImapAccessToken({ provider: imapConfig, db: knex });
    }

    const auth: any = { user: imapConfig.username };
    if (imapConfig.auth_type === 'oauth2') {
      auth.accessToken = accessToken;
      auth.method = process.env.IMAP_OAUTH_AUTH_MECHANISM === 'OAUTHBEARER' ? 'OAUTHBEARER' : 'XOAUTH2';
    } else {
      const { getSecretProviderInstance } = await import('@alga-psa/core/secrets');
      const secretProvider = await getSecretProviderInstance();
      auth.pass = await secretProvider.getTenantSecret(tenant, `imap_password_${providerId}`);
    }

    if (!auth.pass && !auth.accessToken) {
      throw new Error('IMAP credentials missing');
    }

    const { ImapFlow } = await import('imapflow');
    const client = new ImapFlow({
      host: imapConfig.host,
      port: Number(imapConfig.port),
      secure: Boolean(imapConfig.secure),
      auth,
      disableAutoIdle: true,
      logger: false,
      connectionTimeout: IMAP_VALIDATION_CONNECTION_TIMEOUT_MS,
      greetingTimeout: IMAP_VALIDATION_CONNECTION_TIMEOUT_MS,
      socketTimeout: IMAP_VALIDATION_SOCKET_TIMEOUT_MS,
      tls: imapConfig.secure || imapConfig.allow_starttls ? { rejectUnauthorized: (process.env.IMAP_TLS_REJECT_UNAUTHORIZED || 'true') !== 'false' } : undefined,
    });

    try {
      await client.connect();
    } finally {
      try {
        await client.logout();
      } catch {
        try {
          client.close();
        } catch {
          // best effort
        }
      }
    }
  }

  /**
   * Microsoft reconciliation: loop `reconcileProviderMessages` passes until
   * the paused interval is exhausted. Each pass enqueues at most the per-pass
   * cap (the maintenance algorithm's cursor lock, safety margin, and overflow
   * handling stay authoritative) and reports whether Graph still holds more
   * unprocessed messages; ids handed off by earlier passes are seeded into
   * the next pass so re-listed messages are recognized as covered in every
   * durable mode. Durable dedupe makes re-enqueueing safe.
   *
   * If the sweep cannot exhaust the interval within the pass bound, this
   * throws so the caller fails the recovery and the provider stays paused —
   * never "resumed with a known gap".
   */
  private async reconcileMicrosoftPausedInterval(params: {
    providerId: string;
    tenant: string;
    since: Date;
  }): Promise<{ queuedMessages: number }> {
    const maintenance = new EmailWebhookMaintenanceService();
    const handedOffIds = new Set<string>();
    let queuedMessages = 0;
    for (let pass = 1; pass <= MICROSOFT_RECOVERY_MAX_PASSES; pass += 1) {
      const result = await maintenance.reconcileProviderMessages({
        providerId: params.providerId,
        tenant: params.tenant,
        since: params.since,
        handedOffIds,
      });
      queuedMessages += result.queuedMessages;
      for (const id of result.enqueuedMessageIds || []) handedOffIds.add(id);
      if (!result.moreRemaining) {
        return { queuedMessages };
      }
      console.info('[EmailProviderLifecycle] Microsoft auth-pause reconciliation pass complete; more paused-interval mail remains', {
        tenant: params.tenant,
        providerId: params.providerId,
        pass,
        queuedSoFar: queuedMessages,
      });
    }
    throw new Error(
      `microsoft_auth_pause_reconcile_unexhausted_after_${MICROSOFT_RECOVERY_MAX_PASSES}_passes`
    );
  }

  /**
   * Google reconciliation: list changes from the pre-watch history cursor and
   * enqueue the resulting message ids through the unified durable path. If
   * Gmail rejects the old cursor, fall back to a mailbox query bounded by the
   * pause timestamp rather than silently accepting a gap.
   *
   * Both listing paths paginate the FULL paused interval — there is no batch
   * cap to truncate it. Every discovered id is handed off through the durable
   * dedupe path, so a large backlog is reconciled completely and re-running
   * the reconciliation is safe.
   */
  private async reconcileGooglePausedInterval(params: {
    providerId: string;
    tenant: string;
    pausedAt: Date;
    savedHistoryId?: string | null;
  }): Promise<GooglePausedIntervalReconciliation> {
    const loaded = await this.loadProvider(params.providerId, params.tenant);
    if (!loaded) throw new Error('Provider not found');

    // LIST from the pre-watch cursor, but carry the CURRENT (post-watch)
    // cursor on the enqueued pointers: the queue processor persists
    // pointer.historyId after processing, and regressing it below the fresh
    // watch cursor would make the next sync re-scan the whole interval.
    const currentHistoryId = loaded.vendorConfig?.history_id
      ? String(loaded.vendorConfig.history_id)
      : null;
    const savedHistoryId = params.savedHistoryId
      ? String(params.savedHistoryId)
      : null;

    const adapter = new GmailAdapter(this.toAdapterConfig(loaded.provider, loaded.vendorConfig));
    let messageIds: string[] = [];
    let usedFallbackQuery = false;
    if (savedHistoryId) {
      try {
        messageIds = await adapter.listMessagesSince(savedHistoryId);
      } catch (error) {
        if (!isGmailHistoryIdRejected(error)) throw error;
        console.info('[EmailProviderLifecycle] Gmail paused-interval cursor rejected; falling back to pause-bounded query', {
          tenant: params.tenant,
          providerId: params.providerId,
          savedHistoryId,
        });
        usedFallbackQuery = true;
        messageIds = await adapter.listMessageIdsSinceTime(params.pausedAt, undefined, { paginateAll: true });
      }
    } else {
      usedFallbackQuery = true;
      messageIds = await adapter.listMessageIdsSinceTime(params.pausedAt, undefined, { paginateAll: true });
    }

    let queuedMessages = 0;
    for (const messageId of messageIds) {
      const durable = await persistIngressPointer({
        tenant: params.tenant,
        providerId: params.providerId,
        providerType: 'google',
        // The enforce-mode pointer must carry exactly what the direct-enqueue
        // branch carries: the POST-watch cursor (the staging worker persists
        // pointer.historyId back to google_email_provider_config after
        // staging, and the pre-watch cursor would regress it below the fresh
        // watch), the mailbox identity, and the discovered message id (the
        // staging worker only downloads ids it finds in the pointer — without
        // them it re-lists from the post-watch cursor and finds nothing from
        // the paused interval). pubsubMessageId keeps one ingress row per
        // reconciled message (the deterministic key is
        // `history:<historyId>:<pubsubMessageId>`), so re-reconciles are
        // idempotent and a terminally failed row is revived, not skipped.
        reviveTerminal: true,
        pointer: {
          providerType: 'google',
          historyId: currentHistoryId || savedHistoryId,
          pubsubMessageId: `auth-pause-reconcile:${messageId}`,
          mailbox: loaded.provider.mailbox,
          extra: {
            resource: 'auth-pause-reconcile',
            emailAddress: loaded.provider.mailbox,
            discoveredMessageIds: [messageId],
          },
        },
      });
      if (!(durable.mode === 'enforce' && durable.ingressId)) {
        await enqueueUnifiedInboundEmailQueueJob({
          tenantId: params.tenant,
          providerId: params.providerId,
          provider: 'google',
          pointer: {
            historyId: currentHistoryId || savedHistoryId || '',
            emailAddress: loaded.provider.mailbox,
            discoveredMessageIds: [messageId],
          },
        });
      }
      queuedMessages += 1;
    }

    return {
      queuedMessages,
      usedFallbackQuery,
    };
  }

  /**
   * IMAP reconciliation: arm the covering resync (the existing resync
   * contract, made gap-free) so the poller scans the mailbox from UID 1 and
   * normal dedupe suppresses already-processed mail. Only reachable after
   * credentials validated.
   *
   * Cursor semantics: `last_uid = '0'` is the explicit "scan from the
   * beginning" marker — a NULL cursor would make the email-service listener
   * resume from the most recent window (uidNext - max_emails_per_sync) and
   * silently skip paused-interval mail older than that window. '0' makes the
   * listener's start-uid resolution scan from UID 1, covering the entire
   * paused interval; the scan then advances the cursor back to the newest
   * UID. Because IMAP workers are gated on the pause in provider discovery,
   * the rescan runs on the fresh listener started after the pause clears.
   */
  private async reconcileImapPausedInterval(params: {
    providerId: string;
    tenant: string;
  }): Promise<{ queuedMessages: number }> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, params.tenant);
    await db.table('imap_email_provider_config')
      .where({ email_provider_id: params.providerId })
      .update({
        uid_validity: null,
        last_uid: '0',
        last_processed_message_id: null,
        folder_state: {},
        last_error: null,
        updated_at: knex.fn.now(),
      });
    return { queuedMessages: 0 };
  }

  async deleteProvider(providerId: string, tenant: string): Promise<void> {
    const loaded = await this.loadProvider(providerId, tenant);
    if (!loaded) throw new Error('Provider not found');
    await this.teardownProviderSubscriptions(providerId, tenant);

    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    const configTable = loaded.provider.provider_type === 'microsoft'
      ? 'microsoft_email_provider_config'
      : loaded.provider.provider_type === 'google'
        ? 'google_email_provider_config'
        : 'imap_email_provider_config';
    await db.table(configTable).where({ email_provider_id: providerId }).del();
    await db.table('email_providers').where({ id: providerId }).del();
  }
}
