import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getAdminConnection } from '@alga-psa/db/admin';
import axios from 'axios';
import type {
  EmailMessageDetails,
  EmailProviderConfig,
  UnifiedInboundEmailQueueJob,
} from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { MicrosoftGraphAdapter } from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import {
  processInboundEmailInApp,
  type ProcessInboundEmailInAppDiagnostics,
} from '@alga-psa/shared/services/email/processInboundEmailInApp';
import { GmailAdapter } from '@alga-psa/shared/services/email/providers/GmailAdapter';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

export class SourceMessageUnavailableError extends Error {
  public readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = 'SourceMessageUnavailableError';
  }
}

export interface UnifiedInboundEmailQueueProcessResult {
  outcome: 'processed' | 'skipped';
  processedCount: number;
  dedupedCount: number;
  skippedCount: number;
  reason?: string;
}

const DEFAULT_IMAP_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_IMAP_SOCKET_TIMEOUT_MS = 30_000;
const DEFAULT_IMAP_FETCH_TIMEOUT_MS = 45_000;
const DEFAULT_IMAP_PARSE_TIMEOUT_MS = 30_000;
const DEFAULT_MESSAGE_SOURCE_FETCH_TIMEOUT_MS = 45_000;
const DEFAULT_MIME_PARSE_TIMEOUT_MS = 30_000;
const OAUTH_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timeout:${label}:${timeoutMs}`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function extractMessageIds(value: unknown): string[] {
  const entries: string[] = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : typeof value === 'string'
      ? [value]
      : [];

  const normalized = new Set<string>();
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const matches = trimmed.match(/<[^<>]+>/g);
    if (matches?.length) {
      for (const match of matches) {
        const cleaned = match.trim();
        if (cleaned.length > 2) normalized.add(cleaned);
      }
      continue;
    }
    if (trimmed.length > 2) normalized.add(trimmed);
  }
  return Array.from(normalized);
}

function normalizeExternalMessageIdentity(params: {
  provider: UnifiedInboundEmailQueueJob['provider'];
  messageId: string;
}): string {
  return `${params.provider}:${params.messageId}`;
}

function isLikelyMailboxEmailAddress(value: string): boolean {
  // Treat plain email-shaped values as mailbox address misconfigurations, not IMAP folders.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function resolveImapFolderFromFilters(value: unknown): string | null {
  let filters: unknown = value;
  if (typeof filters === 'string') {
    try {
      filters = JSON.parse(filters);
    } catch {
      filters = [filters];
    }
  }

  if (!Array.isArray(filters)) {
    return null;
  }

  for (const entry of filters) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

function applyOauthMechanismOverride(client: ImapFlow, mechanism: 'XOAUTH2' | 'OAUTHBEARER'): void {
  if (mechanism !== 'XOAUTH2') return;

  const anyClient = client as any;
  const commands: Map<string, any> | undefined = anyClient.commands;
  if (!commands?.get) return;

  const originalAuthenticate = commands.get('AUTHENTICATE');
  if (typeof originalAuthenticate !== 'function') return;

  const patchedCommands = new Map(commands);
  patchedCommands.set('AUTHENTICATE', async (connection: any, username: string, authOpts: any) => {
    if (authOpts?.accessToken) {
      const caps = connection?.capabilities;
      const hadOauthBearer = Boolean(caps?.has?.('AUTH=OAUTHBEARER'));
      const hasXoauth = Boolean(caps?.has?.('AUTH=XOAUTH') || caps?.has?.('AUTH=XOAUTH2'));

      if (hadOauthBearer && hasXoauth && caps?.delete && caps?.set) {
        caps.delete('AUTH=OAUTHBEARER');
        try {
          return await originalAuthenticate(connection, username, authOpts);
        } finally {
          caps.set('AUTH=OAUTHBEARER', true);
        }
      }
    }

    return await originalAuthenticate(connection, username, authOpts);
  });

  anyClient.commands = patchedCommands;
}

function isTokenExpired(tokenExpiresAt: unknown): boolean {
  if (typeof tokenExpiresAt !== 'string' || !tokenExpiresAt.trim()) return true;
  const expiresAtMs = new Date(tokenExpiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs - Date.now() < OAUTH_TOKEN_REFRESH_SKEW_MS;
}

function isImapAuthenticationError(error: any): boolean {
  if (!error) return false;
  if (error.authenticationFailed === true) return true;

  const serverCode = String(error.serverResponseCode || '').toUpperCase();
  if (serverCode.includes('AUTHENTICATIONFAILED')) return true;

  const responseStatus = String(error.responseStatus || '').toUpperCase();
  if (responseStatus === 'NO' && /invalid credentials/i.test(String(error.responseText || ''))) {
    return true;
  }

  return false;
}

async function getImapOauthSecrets(provider: {
  id: string;
  tenant: string;
}): Promise<{ clientSecret: string | null; refreshToken: string | null }> {
  const secretProvider = await getSecretProviderInstance();
  const clientSecret =
    (await secretProvider.getTenantSecret(provider.tenant, `imap_oauth_client_secret_${provider.id}`)) ?? null;
  const refreshToken =
    (await secretProvider.getTenantSecret(provider.tenant, `imap_refresh_token_${provider.id}`)) ?? null;
  return { clientSecret, refreshToken };
}

async function refreshImapAccessToken(params: {
  provider: {
    id: string;
    tenant: string;
    oauth_token_url?: string | null;
    oauth_client_id?: string | null;
    oauth_client_secret?: string | null;
    refresh_token?: string | null;
    access_token?: string | null;
    token_expires_at?: string | null;
  };
  db: Awaited<ReturnType<typeof getAdminConnection>>;
}): Promise<string> {
  const { provider, db } = params;
  if (!provider.oauth_token_url || !provider.oauth_client_id) {
    throw new Error('IMAP OAuth token URL or client ID missing');
  }

  const { clientSecret, refreshToken } = await getImapOauthSecrets({
    id: provider.id,
    tenant: provider.tenant,
  });
  const effectiveRefreshToken = refreshToken || provider.refresh_token;
  const effectiveClientSecret = clientSecret || provider.oauth_client_secret;
  if (!effectiveRefreshToken) {
    throw new Error('IMAP OAuth refresh token missing');
  }

  const paramsBody = new URLSearchParams();
  paramsBody.append('grant_type', 'refresh_token');
  paramsBody.append('refresh_token', effectiveRefreshToken);
  paramsBody.append('client_id', provider.oauth_client_id);
  if (effectiveClientSecret) {
    paramsBody.append('client_secret', effectiveClientSecret);
  }

  const response = await axios.post(provider.oauth_token_url, paramsBody, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const accessToken = asNonEmptyString(response?.data?.access_token);
  if (!accessToken) {
    throw new Error('IMAP OAuth refresh returned no access token');
  }

  const expiresInSeconds = Number(response?.data?.expires_in || 3600);
  const expiresAt = new Date(
    Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600) * 1000
  ).toISOString();

  await db('imap_email_provider_config')
    .where({ email_provider_id: provider.id, tenant: provider.tenant })
    .update({
      access_token: accessToken,
      token_expires_at: expiresAt,
      updated_at: db.fn.now(),
    });

  provider.access_token = accessToken;
  provider.token_expires_at = expiresAt;
  console.info('[UnifiedInboundEmailQueueJobProcessor] refreshed IMAP OAuth access token', {
    event: 'imap_oauth_refresh',
    tenantId: provider.tenant,
    providerId: provider.id,
    expiresAt,
  });

  return accessToken;
}

async function fetchMicrosoftProviderConfig(job: UnifiedInboundEmailQueueJob): Promise<EmailProviderConfig> {
  const db = await getAdminConnection();
  const row = await db('microsoft_email_provider_config as mc')
    .join('email_providers as ep', function () {
      this.on('mc.email_provider_id', '=', 'ep.id').andOn('mc.tenant', '=', 'ep.tenant');
    })
    .where('ep.id', job.providerId)
    .andWhere('ep.tenant', job.tenantId)
    .andWhere('ep.provider_type', 'microsoft')
    .first(
      'ep.*',
      db.raw('mc.client_id as mc_client_id'),
      db.raw('mc.client_secret as mc_client_secret'),
      db.raw('mc.tenant_id as mc_tenant_id'),
      db.raw('mc.access_token as mc_access_token'),
      db.raw('mc.refresh_token as mc_refresh_token'),
      db.raw('mc.token_expires_at as mc_token_expires_at'),
      db.raw('mc.webhook_subscription_id as mc_webhook_subscription_id'),
      db.raw('mc.webhook_expires_at as mc_webhook_expires_at'),
      db.raw('mc.folder_filters as mc_folder_filters')
    );

  if (!row) {
    throw new SourceMessageUnavailableError('microsoft_provider_not_found');
  }

  const baseUrl = process.env.NGROK_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const derivedWebhookUrl = `${baseUrl}/api/email/webhooks/microsoft`;
  const ff = (row as any).mc_folder_filters;
  const folderToMonitor = Array.isArray(ff)
    ? ff[0] || 'Inbox'
    : (() => {
        try {
          const parsed = JSON.parse(ff || '[]');
          return parsed[0] || 'Inbox';
        } catch {
          return 'Inbox';
        }
      })();

  return {
    id: row.id,
    tenant: row.tenant,
    name: row.provider_name || row.mailbox,
    provider_type: 'microsoft',
    mailbox: row.mailbox,
    folder_to_monitor: folderToMonitor,
    active: row.is_active,
    webhook_notification_url: (row as any).webhook_notification_url || derivedWebhookUrl,
    webhook_subscription_id: row.mc_webhook_subscription_id,
    webhook_expires_at: row.mc_webhook_expires_at,
    connection_status: (row as any).connection_status || row.status || 'connected',
    created_at: row.created_at,
    updated_at: row.updated_at,
    provider_config: {
      client_id: (row as any).mc_client_id,
      client_secret: (row as any).mc_client_secret,
      tenant_id: (row as any).mc_tenant_id,
      access_token: (row as any).mc_access_token,
      refresh_token: (row as any).mc_refresh_token,
      token_expires_at: (row as any).mc_token_expires_at,
    },
  } as any;
}

async function fetchGoogleProviderConfig(job: UnifiedInboundEmailQueueJob): Promise<{
  provider: any;
  googleConfig: any;
  config: EmailProviderConfig;
}> {
  const db = await getAdminConnection();
  const provider = await db('email_providers')
    .where({ id: job.providerId, tenant: job.tenantId, provider_type: 'google' })
    .first();
  if (!provider) {
    throw new SourceMessageUnavailableError('google_provider_not_found');
  }

  const googleConfig = await db('google_email_provider_config')
    .where({ email_provider_id: provider.id, tenant: provider.tenant })
    .first();
  if (!googleConfig) {
    throw new SourceMessageUnavailableError('google_provider_config_not_found');
  }

  const config: EmailProviderConfig = {
    id: provider.id,
    tenant: provider.tenant,
    name: provider.provider_name || provider.mailbox,
    provider_type: 'google',
    mailbox: provider.mailbox,
    folder_to_monitor: 'Inbox',
    active: provider.is_active,
    webhook_notification_url: provider.webhook_notification_url,
    connection_status: provider.connection_status || 'connected',
    created_at: provider.created_at,
    updated_at: provider.updated_at,
    provider_config: {
      project_id: googleConfig.project_id,
      pubsub_topic_name: googleConfig.pubsub_topic_name,
      pubsub_subscription_name: googleConfig.pubsub_subscription_name,
      client_id: googleConfig.client_id,
      client_secret: googleConfig.client_secret,
      access_token: googleConfig.access_token,
      refresh_token: googleConfig.refresh_token,
      token_expires_at: googleConfig.token_expires_at,
      history_id: googleConfig.history_id,
      watch_expiration: googleConfig.watch_expiration,
    },
  } as any;

  return { provider, googleConfig, config };
}

function mapParsedMimeToEmailMessageDetails(params: {
  provider: 'microsoft' | 'imap';
  providerId: string;
  tenant: string;
  rawMimeBuffer: Buffer;
  parsed: any;
  fallbackMessageId: string;
}): EmailMessageDetails {
  const from = params.parsed.from?.value?.[0];
  const to = params.parsed.to?.value || [];
  const cc = params.parsed.cc?.value || [];
  const messageId = asNonEmptyString(params.parsed.messageId) || params.fallbackMessageId;
  const references = extractMessageIds(params.parsed.references);
  const inReplyTo = extractMessageIds(params.parsed.inReplyTo)[0];
  const threadId = references[0] || inReplyTo;

  return {
    id: messageId,
    provider: params.provider,
    providerId: params.providerId,
    tenant: params.tenant,
    receivedAt: params.parsed.date ? new Date(params.parsed.date).toISOString() : new Date().toISOString(),
    from: {
      email: from?.address || '',
      name: from?.name || undefined,
    },
    to: to.map((item: any) => ({
      email: item?.address || '',
      name: item?.name || undefined,
    })),
    cc: cc.length
      ? cc.map((item: any) => ({
          email: item?.address || '',
          name: item?.name || undefined,
        }))
      : undefined,
    subject: params.parsed.subject || '',
    body: {
      text: params.parsed.text || '',
      html: params.parsed.html ? String(params.parsed.html) : undefined,
    },
    attachments: Array.isArray(params.parsed.attachments)
      ? params.parsed.attachments.map((attachment: any, index: number) => {
          const contentBuffer = Buffer.isBuffer(attachment?.content)
            ? attachment.content
            : Buffer.from(attachment?.content || '');
          return {
            id: String(attachment?.contentId || attachment?.checksum || `${messageId}-att-${index}`),
            name: String(attachment?.filename || `attachment-${index + 1}`),
            contentType: String(attachment?.contentType || 'application/octet-stream'),
            size: Number(attachment?.size || contentBuffer.length || 0),
            contentId: asNonEmptyString(attachment?.contentId) || undefined,
            isInline: Boolean(attachment?.contentDisposition === 'inline'),
            content: contentBuffer.toString('base64'),
          };
        })
      : [],
    threadId: threadId || undefined,
    references: references.length ? references : undefined,
    inReplyTo: inReplyTo || undefined,
    rawMimeBase64: params.rawMimeBuffer.toString('base64'),
  };
}

async function fetchMicrosoftMessageForPointer(job: UnifiedInboundEmailQueueJob): Promise<EmailMessageDetails> {
  if (job.provider !== 'microsoft') {
    throw new Error('invalid provider for microsoft fetch');
  }

  const sourceFetchTimeoutMs = parsePositiveInteger(
    process.env.INBOUND_EMAIL_SOURCE_FETCH_TIMEOUT_MS,
    DEFAULT_MESSAGE_SOURCE_FETCH_TIMEOUT_MS
  );
  const parseTimeoutMs = parsePositiveInteger(
    process.env.INBOUND_EMAIL_MIME_PARSE_TIMEOUT_MS,
    DEFAULT_MIME_PARSE_TIMEOUT_MS
  );

  const config = await fetchMicrosoftProviderConfig(job);
  const adapter = new MicrosoftGraphAdapter(config);
  await adapter.connect();

  let rawMimeBuffer: Buffer;
  try {
    rawMimeBuffer = await withTimeout(
      adapter.downloadMessageSource(job.pointer.messageId),
      sourceFetchTimeoutMs,
      'microsoft_message_source'
    );
  } catch (error: any) {
    if (Number(error?.status) === 404) {
      throw new SourceMessageUnavailableError('microsoft_message_not_found');
    }
    throw error;
  }

  const parsed: any = await withTimeout(
    simpleParser(rawMimeBuffer),
    parseTimeoutMs,
    'microsoft_mime_parse'
  );

  return mapParsedMimeToEmailMessageDetails({
    provider: 'microsoft',
    providerId: config.id,
    tenant: config.tenant,
    rawMimeBuffer,
    parsed,
    fallbackMessageId: job.pointer.messageId,
  });
}

async function fetchImapMessageForPointer(job: UnifiedInboundEmailQueueJob): Promise<EmailMessageDetails> {
  if (job.provider !== 'imap') {
    throw new Error('invalid provider for imap fetch');
  }
  const pointerUid = Number(job.pointer.uid);
  if (!Number.isFinite(pointerUid) || pointerUid <= 0) {
    throw new SourceMessageUnavailableError('imap_pointer_uid_invalid');
  }

  const db = await getAdminConnection();
  const provider = await db('imap_email_provider_config as ic')
    .join('email_providers as ep', function () {
      this.on('ic.email_provider_id', '=', 'ep.id').andOn('ic.tenant', '=', 'ep.tenant');
    })
    .where('ep.id', job.providerId)
    .andWhere('ep.tenant', job.tenantId)
    .andWhere('ep.provider_type', 'imap')
    .first(
      'ep.id',
      'ep.tenant',
      'ep.mailbox',
      'ic.folder_filters',
      'ic.host',
      'ic.port',
      'ic.secure',
      'ic.allow_starttls',
      'ic.auth_type',
      'ic.username',
      'ic.access_token',
      'ic.oauth_token_url',
      'ic.oauth_client_id',
      'ic.oauth_client_secret',
      'ic.refresh_token',
      'ic.token_expires_at'
    );
  if (!provider) {
    throw new SourceMessageUnavailableError('imap_provider_not_found');
  }

  const connectionTimeoutMs = parsePositiveInteger(
    process.env.IMAP_CONNECTION_TIMEOUT_MS,
    DEFAULT_IMAP_CONNECTION_TIMEOUT_MS
  );
  const socketTimeoutMs = parsePositiveInteger(
    process.env.IMAP_SOCKET_TIMEOUT_MS,
    Math.max(connectionTimeoutMs * 3, DEFAULT_IMAP_SOCKET_TIMEOUT_MS)
  );
  const fetchTimeoutMs = parsePositiveInteger(
    process.env.IMAP_FETCH_TIMEOUT_MS,
    Math.max(socketTimeoutMs, DEFAULT_IMAP_FETCH_TIMEOUT_MS)
  );
  const parseTimeoutMs = parsePositiveInteger(
    process.env.IMAP_PARSE_TIMEOUT_MS,
    Math.max(connectionTimeoutMs * 2, DEFAULT_IMAP_PARSE_TIMEOUT_MS)
  );

  const secure = Boolean(provider.secure);
  const rejectUnauthorized = (process.env.IMAP_TLS_REJECT_UNAUTHORIZED || 'true') !== 'false';
  const oauthMechanism: 'XOAUTH2' | 'OAUTHBEARER' =
    process.env.IMAP_OAUTH_AUTH_MECHANISM === 'OAUTHBEARER' ? 'OAUTHBEARER' : 'XOAUTH2';

  const password =
    provider.auth_type === 'oauth2'
      ? null
      : await (await getSecretProviderInstance()).getTenantSecret(provider.tenant, `imap_password_${provider.id}`);
  let accessToken = asNonEmptyString(provider.access_token);

  if (provider.auth_type === 'oauth2' && (!accessToken || isTokenExpired(provider.token_expires_at))) {
    accessToken = await refreshImapAccessToken({
      provider,
      db,
    });
  }

  for (let authAttempt = 0; authAttempt < 2; authAttempt += 1) {
    const auth: any = {
      user: provider.username,
    };
    if (provider.auth_type === 'oauth2') {
      auth.accessToken = accessToken;
      auth.method = oauthMechanism;
    } else {
      auth.pass = password;
    }

    if (!auth.pass && !auth.accessToken) {
      throw new SourceMessageUnavailableError('imap_credentials_missing');
    }

    const client = new ImapFlow({
      host: provider.host,
      port: Number(provider.port),
      secure,
      auth,
      disableAutoIdle: true,
      logger: false,
      connectionTimeout: connectionTimeoutMs,
      greetingTimeout: connectionTimeoutMs,
      socketTimeout: socketTimeoutMs,
      tls: secure || provider.allow_starttls ? { rejectUnauthorized } : undefined,
    });
    applyOauthMechanismOverride(client, oauthMechanism);
    client.on('error', (error: any) => {
      console.error('[UnifiedInboundEmailQueueJobProcessor] IMAP pointer fetch error', {
        event: 'imap_pointer_fetch_error',
        tenantId: job.tenantId,
        providerId: job.providerId,
        uid: job.pointer.uid,
        mailbox: job.pointer.mailbox,
        message: error?.message || String(error),
        code: error?.code || null,
      });
    });

    try {
      await withTimeout(client.connect(), connectionTimeoutMs + 5_000, 'imap_connect');
      const pointerMailbox = asNonEmptyString(job.pointer.mailbox);
      const providerFolder = resolveImapFolderFromFilters((provider as any).folder_filters);
      const mailbox =
        pointerMailbox && !isLikelyMailboxEmailAddress(pointerMailbox)
          ? pointerMailbox
          : providerFolder || 'INBOX';
      const lock = await withTimeout(client.getMailboxLock(mailbox), fetchTimeoutMs, 'imap_mailbox_lock');
      try {
        const fetched = await withTimeout(
          (async () => {
            let matched: any | null = null;
            for await (const msg of client.fetch(
              `${pointerUid}:${pointerUid}`,
              { uid: true, source: true },
              { uid: true }
            )) {
              if (Number(msg?.uid) === pointerUid && msg?.source) {
                matched = msg;
                break;
              }
            }
            return matched;
          })(),
          fetchTimeoutMs,
          'imap_message_fetch'
        );

        if (!fetched?.source) {
          throw new SourceMessageUnavailableError('imap_message_not_found');
        }

        const rawMimeBuffer = Buffer.isBuffer(fetched.source)
          ? fetched.source
          : Buffer.from(fetched.source);
        const parsed: any = await withTimeout(
          simpleParser(rawMimeBuffer),
          parseTimeoutMs,
          'imap_mime_parse'
        );
        return mapParsedMimeToEmailMessageDetails({
          provider: 'imap',
          providerId: provider.id,
          tenant: provider.tenant,
          rawMimeBuffer,
          parsed,
          fallbackMessageId: `imap-uid-${pointerUid}`,
        });
      } finally {
        lock.release();
      }
    } catch (error: any) {
      if (
        provider.auth_type === 'oauth2' &&
        authAttempt === 0 &&
        isImapAuthenticationError(error)
      ) {
        console.warn('[UnifiedInboundEmailQueueJobProcessor] IMAP auth failed, refreshing token and retrying once', {
          event: 'imap_oauth_auth_retry',
          tenantId: job.tenantId,
          providerId: job.providerId,
          uid: job.pointer.uid,
          mailbox: job.pointer.mailbox,
          message: error?.message || String(error),
          code: error?.code || null,
        });
        accessToken = await refreshImapAccessToken({
          provider,
          db,
        });
        continue;
      }
      throw error;
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

  throw new Error('imap_auth_retry_exhausted');
}

async function fetchEmailPayloadsForJob(job: UnifiedInboundEmailQueueJob): Promise<EmailMessageDetails[]> {
  if (job.provider === 'microsoft') {
    return [await fetchMicrosoftMessageForPointer(job)];
  }

  if (job.provider === 'google') {
    const db = await getAdminConnection();
    const { provider, googleConfig, config } = await fetchGoogleProviderConfig(job);
    const adapter = new GmailAdapter(config);
    await adapter.connect();
    const explicitMessageIds = Array.isArray(job.pointer.discoveredMessageIds)
      ? job.pointer.discoveredMessageIds.filter((value): value is string => typeof value === 'string')
      : [];
    const startHistoryId = String(
      googleConfig.history_id || Math.max((Number(job.pointer.historyId) || 1) - 1, 1)
    );
    const messageIds =
      explicitMessageIds.length > 0 ? explicitMessageIds : await adapter.listMessagesSince(startHistoryId);
    if (!messageIds.length) {
      return [];
    }
    const detailsList: EmailMessageDetails[] = [];
    for (const messageId of messageIds) {
      detailsList.push(await adapter.getMessageDetails(messageId));
    }
    return detailsList;
  }

  return [await fetchImapMessageForPointer(job)];
}

async function persistGoogleHistoryCursor(job: UnifiedInboundEmailQueueJob): Promise<void> {
  if (job.provider !== 'google') return;
  const historyId = asNonEmptyString(job.pointer.historyId);
  if (!historyId) return;

  const db = await getAdminConnection();
  await db('google_email_provider_config')
    .where({ tenant: job.tenantId, email_provider_id: job.providerId })
    .update({
      history_id: historyId,
      updated_at: db.fn.now(),
    });
}

async function insertProcessingRecord(params: {
  job: UnifiedInboundEmailQueueJob;
  externalIdentity: string;
  emailData?: EmailMessageDetails;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  const db = await getAdminConnection();
  try {
    await db('email_processed_messages').insert({
      message_id: params.externalIdentity,
      provider_id: params.job.providerId,
      tenant: params.job.tenantId,
      processed_at: new Date(),
      processing_status: 'processing',
      from_email: params.emailData?.from?.email || null,
      subject: params.emailData?.subject || null,
      received_at: params.emailData?.receivedAt ? new Date(params.emailData.receivedAt) : null,
      attachment_count: params.emailData?.attachments?.length || 0,
      metadata: JSON.stringify(
        params.metadata ?? {
          queueJobId: params.job.jobId,
          queueProvider: params.job.provider,
          pointer: params.job.pointer,
        }
      ),
    });
    return true;
  } catch (error: any) {
    if (error?.code === '23505') {
      return false;
    }
    throw error;
  }
}

async function updateProcessingRecord(params: {
  job: UnifiedInboundEmailQueueJob;
  externalIdentity: string;
  status: 'success' | 'partial' | 'failed';
  emailData?: EmailMessageDetails;
  ticketId?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = await getAdminConnection();
  await db('email_processed_messages')
    .where({
      message_id: params.externalIdentity,
      provider_id: params.job.providerId,
      tenant: params.job.tenantId,
    })
    .update({
      processing_status: params.status,
      ticket_id: params.ticketId ?? null,
      from_email: params.emailData?.from?.email || null,
      subject: params.emailData?.subject || null,
      received_at: params.emailData?.receivedAt ? new Date(params.emailData.receivedAt) : null,
      attachment_count: params.emailData?.attachments?.length || 0,
      error_message: params.errorMessage || null,
      metadata: JSON.stringify(
        params.metadata ?? {
          queueJobId: params.job.jobId,
          queueProvider: params.job.provider,
          pointer: params.job.pointer,
        }
      ),
    });
}

function buildProcessingMetadata(params: {
  job: UnifiedInboundEmailQueueJob;
  emailData?: EmailMessageDetails;
  diagnostics?: ProcessInboundEmailInAppDiagnostics | Record<string, unknown>;
}): Record<string, unknown> {
  return {
    queueJobId: params.job.jobId,
    queueProvider: params.job.provider,
    pointer: params.job.pointer,
    ...(params.emailData
      ? {
          headersSnapshot: {
            messageId: params.emailData.id,
            threadId: params.emailData.threadId ?? null,
            inReplyTo: params.emailData.inReplyTo ?? null,
            references: params.emailData.references ?? [],
            from: params.emailData.from?.email ?? null,
            to: (params.emailData.to ?? []).map((recipient) => recipient.email),
            subject: params.emailData.subject ?? null,
          },
        }
      : {}),
    ...(params.diagnostics ?? {}),
  };
}

export async function processUnifiedInboundEmailQueueJob(
  job: UnifiedInboundEmailQueueJob
): Promise<UnifiedInboundEmailQueueProcessResult> {
  let payloads: EmailMessageDetails[];
  try {
    payloads = await fetchEmailPayloadsForJob(job);
  } catch (error) {
    if (error instanceof SourceMessageUnavailableError) {
      const fallbackId =
        job.provider === 'microsoft'
          ? job.pointer.messageId
          : job.provider === 'google'
            ? job.pointer.historyId
            : job.pointer.messageId || `uid:${job.pointer.uid}`;
      const externalIdentity = normalizeExternalMessageIdentity({
        provider: job.provider,
        messageId: fallbackId,
      });
      const inserted = await insertProcessingRecord({
        job,
        externalIdentity,
        metadata: buildProcessingMetadata({
          job,
          diagnostics: {
            outcome: {
              kind: 'skipped',
              reason: `source_unavailable:${error.reason}`,
            },
          },
        }),
      });
      if (inserted) {
        await updateProcessingRecord({
          job,
          externalIdentity,
          status: 'partial',
          errorMessage: `source_unavailable:${error.reason}`,
          metadata: buildProcessingMetadata({
            job,
            diagnostics: {
              outcome: {
                kind: 'skipped',
                reason: `source_unavailable:${error.reason}`,
              },
            },
          }),
        });
      }
      return {
        outcome: 'skipped',
        processedCount: 0,
        dedupedCount: inserted ? 0 : 1,
        skippedCount: 1,
        reason: `source_unavailable:${error.reason}`,
      };
    }
    throw error;
  }

  if (payloads.length === 0) {
    return {
      outcome: 'skipped',
      processedCount: 0,
      dedupedCount: 0,
      skippedCount: 1,
      reason: 'no_messages_from_pointer',
    };
  }

  let processedCount = 0;
  let dedupedCount = 0;
  for (const emailData of payloads) {
    const identityBase = asNonEmptyString(emailData.id) || `${job.jobId}:${processedCount}`;
    const externalIdentity = normalizeExternalMessageIdentity({
      provider: job.provider,
      messageId: identityBase,
    });
    const inserted = await insertProcessingRecord({
      job,
      externalIdentity,
      emailData,
      metadata: buildProcessingMetadata({ job, emailData }),
    });
    if (!inserted) {
      dedupedCount += 1;
      continue;
    }

    try {
      const result = await processInboundEmailInApp({
        tenantId: job.tenantId,
        providerId: job.providerId,
        emailData,
      }, {
        collectDiagnostics: true,
      });
      const status = result.outcome === 'skipped' ? 'partial' : 'success';
      await updateProcessingRecord({
        job,
        externalIdentity,
        status,
        emailData,
        ticketId: result.outcome === 'created' || result.outcome === 'replied' ? result.ticketId : null,
        errorMessage: result.outcome === 'skipped' ? `skipped:${result.reason}` : null,
        metadata: buildProcessingMetadata({
          job,
          emailData,
          diagnostics: result.diagnostics,
        }),
      });
      processedCount += 1;
    } catch (error: any) {
      await updateProcessingRecord({
        job,
        externalIdentity,
        status: 'failed',
        emailData,
        errorMessage: error?.message || String(error),
        metadata: buildProcessingMetadata({
          job,
          emailData,
          diagnostics: {
            outcome: {
              kind: 'failed',
              error: error?.message || String(error),
            },
          },
        }),
      });
      throw error;
    }
  }

  if (payloads.length > 0) {
    await persistGoogleHistoryCursor(job);
  }

  return {
    outcome: processedCount > 0 ? 'processed' : 'skipped',
    processedCount,
    dedupedCount,
    skippedCount: processedCount > 0 ? 0 : payloads.length,
  };
}
