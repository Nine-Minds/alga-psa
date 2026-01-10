import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import logger from '@alga-psa/shared/core/logger';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { publishEvent } from '@alga-psa/shared/events/publisher';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import axios from 'axios';
import type { EmailMessageDetails } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const DEFAULT_REFRESH_MS = 60_000;
const DEFAULT_RECONNECT_BASE_MS = 2_000;
const DEFAULT_RECONNECT_MAX_MS = 60_000;
const DEFAULT_IDLE_POLL_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_LEASE_TTL_MS = 120_000;
const DEFAULT_MAX_CONNECTIONS_PER_TENANT = 5;
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_EMAILS_PER_SYNC = 5;

function stateLog(event: string, fields: Record<string, unknown> = {}) {
  try {
    const payload = {
      ts: new Date().toISOString(),
      event,
      ...fields,
    };
    // Simple console logging requested; keep a stable prefix for grepping.
    console.log('[IMAP_SM]', JSON.stringify(payload));
  } catch {
    // Never let logging break the service.
  }
}

interface ImapProviderRow {
  id: string;
  tenant: string;
  provider_name: string;
  mailbox: string;
  is_active: boolean;
  status: string;
  error_message?: string | null;
  last_sync_at?: string | null;
  host: string;
  port: number;
  secure: boolean;
  allow_starttls: boolean;
  auth_type: 'password' | 'oauth2';
  username: string;
  auto_process_emails: boolean;
  max_emails_per_sync: number;
  folder_filters: string[];
  oauth_authorize_url?: string | null;
  oauth_token_url?: string | null;
  oauth_client_id?: string | null;
  oauth_client_secret?: string | null;
  oauth_scopes?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expires_at?: string | null;
  uid_validity?: string | null;
  last_uid?: string | null;
  last_seen_at?: string | null;
  last_sync_at_cfg?: string | null;
  last_error?: string | null;
  folder_state?: Record<string, { uid_validity?: string; last_uid?: string; last_seen_at?: string }> | null;
  last_processed_message_id?: string | null;
  server_capabilities?: string | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  connection_timeout_ms?: number | null;
  socket_keepalive?: boolean | null;
}

interface FolderState {
  uid_validity?: string;
  last_uid?: string;
  last_seen_at?: string;
}

class ImapFolderListener {
  private running = false;
  private reconnectDelay = DEFAULT_RECONNECT_BASE_MS;
  private client: ImapFlow | null = null;
  private folderState: FolderState = {};
  private idleFailures = 0;
  private listenerId = uuidv4();

  constructor(
    private provider: ImapProviderRow,
    private folder: string
  ) {
    this.folderState = this.loadFolderState();
  }

  private loadFolderState(): FolderState {
    const folderState = this.provider.folder_state || {};
    return folderState[this.folder] || {
      uid_validity: this.provider.uid_validity || undefined,
      last_uid: this.provider.last_uid || undefined,
      last_seen_at: this.provider.last_seen_at || undefined,
    };
  }

  private async persistFolderState(update: Partial<FolderState>): Promise<void> {
    const db = await getAdminConnection();
    const currentState = this.provider.folder_state || {};
    const nextState = {
      ...currentState,
      [this.folder]: {
        ...currentState[this.folder],
        ...update,
      }
    };

    await db('imap_email_provider_config')
      .where({ email_provider_id: this.provider.id, tenant: this.provider.tenant })
      .update({
        folder_state: nextState,
        uid_validity: update.uid_validity || this.provider.uid_validity,
        last_uid: update.last_uid || this.provider.last_uid,
        last_seen_at: update.last_seen_at || this.provider.last_seen_at,
        updated_at: db.fn.now(),
      });

    this.provider.folder_state = nextState;
    this.folderState = nextState[this.folder];
  }

  private async updateProviderStatus(status: 'connected' | 'disconnected' | 'error', errorMessage?: string | null) {
    const prevStatus = this.provider.status;
    const prevError = this.provider.error_message;
    const db = await getAdminConnection();
    await db('email_providers')
      .where({ id: this.provider.id, tenant: this.provider.tenant })
      .update({
        status,
        error_message: errorMessage || null,
        updated_at: db.fn.now(),
      });
    await db('imap_email_provider_config')
      .where({ email_provider_id: this.provider.id, tenant: this.provider.tenant })
      .update({
        last_error: errorMessage || null,
        updated_at: db.fn.now(),
      });

    this.provider.status = status;
    this.provider.error_message = errorMessage || null;

    if (prevStatus !== status || prevError !== (errorMessage || null)) {
      stateLog('provider_status', {
        providerId: this.provider.id,
        tenant: this.provider.tenant,
        folder: this.folder,
        listenerId: this.listenerId,
        prevStatus,
        nextStatus: status,
        errorMessage: errorMessage || null,
      });
    }
  }

  private async updateLastSyncAt() {
    const db = await getAdminConnection();
    await db('email_providers')
      .where({ id: this.provider.id, tenant: this.provider.tenant })
      .update({
        last_sync_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
  }

  private async getPasswordSecret(): Promise<string | null> {
    const secretProvider = await getSecretProviderInstance();
    return (await secretProvider.getTenantSecret(this.provider.tenant, `imap_password_${this.provider.id}`)) ?? null;
  }

  private async getOauthSecrets(): Promise<{ clientSecret?: string | null; refreshToken?: string | null }> {
    const secretProvider = await getSecretProviderInstance();
    const clientSecret = (await secretProvider.getTenantSecret(this.provider.tenant, `imap_oauth_client_secret_${this.provider.id}`)) ?? null;
    const refreshToken = (await secretProvider.getTenantSecret(this.provider.tenant, `imap_refresh_token_${this.provider.id}`)) ?? null;
    return { clientSecret, refreshToken };
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.provider.oauth_token_url || !this.provider.oauth_client_id) {
      throw new Error('IMAP OAuth token URL or client ID missing');
    }

    const { clientSecret, refreshToken } = await this.getOauthSecrets();
    const effectiveRefreshToken = refreshToken || this.provider.refresh_token;
    if (!effectiveRefreshToken) {
      throw new Error('IMAP OAuth refresh token missing');
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', effectiveRefreshToken);
    params.append('client_id', this.provider.oauth_client_id);
    if (clientSecret) {
      params.append('client_secret', clientSecret);
    }

    let response;
    try {
      response = await axios.post(this.provider.oauth_token_url, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
    } catch (error: any) {
      const msg = error?.response?.data?.error || error?.message || 'OAuth token refresh failed';
      await this.updateProviderStatus('error', msg);
      throw error;
    }

    const accessToken = response.data.access_token;
    const expiresIn = Number(response.data.expires_in || 3600);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const db = await getAdminConnection();
    await db('imap_email_provider_config')
      .where({ email_provider_id: this.provider.id, tenant: this.provider.tenant })
      .update({
        access_token: accessToken,
        token_expires_at: expiresAt,
        updated_at: db.fn.now(),
      });

    this.provider.access_token = accessToken;
    this.provider.token_expires_at = expiresAt;

    logger.info('[IMAP] Refreshed OAuth access token', {
      providerId: this.provider.id,
      tenant: this.provider.tenant,
      folder: this.folder,
    });
    stateLog('oauth_refresh', {
      providerId: this.provider.id,
      tenant: this.provider.tenant,
      folder: this.folder,
      listenerId: this.listenerId,
      expiresAt,
    });
  }

  private isTokenExpired(): boolean {
    if (!this.provider.token_expires_at) return true;
    const expiresAt = new Date(this.provider.token_expires_at).getTime();
    return expiresAt - Date.now() < 5 * 60 * 1000;
  }

  private async buildClient(): Promise<ImapFlow> {
    if (this.provider.auth_type === 'oauth2') {
      if (this.isTokenExpired()) {
        await this.refreshAccessToken();
      }
    }

    const auth: any = {
      user: this.provider.username,
    };

    if (this.provider.auth_type === 'oauth2') {
      auth.accessToken = this.provider.access_token;
      auth.method = process.env.IMAP_OAUTH_AUTH_MECHANISM === 'OAUTHBEARER' ? 'OAUTHBEARER' : 'XOAUTH2';
    } else {
      auth.pass = await this.getPasswordSecret();
    }

    if (!auth.pass && !auth.accessToken) {
      throw new Error('IMAP credentials missing');
    }

    const secure = Boolean(this.provider.secure);

    const rejectUnauthorized = (process.env.IMAP_TLS_REJECT_UNAUTHORIZED || 'true') !== 'false';
    const tlsOptions = (secure || this.provider.allow_starttls)
      ? { rejectUnauthorized }
      : undefined;
    return new ImapFlow({
      host: this.provider.host,
      port: Number(this.provider.port),
      secure,
      auth,
      disableAutoIdle: true,
      logger: false,
      tls: tlsOptions,
    });
  }

  private async connectWithTimeout(client: ImapFlow) {
    const timeoutMs = Number(
      process.env.IMAP_CONNECTION_TIMEOUT_MS ||
      this.provider.connection_timeout_ms ||
      DEFAULT_CONNECTION_TIMEOUT_MS
    );
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('IMAP connection timeout')), timeoutMs)),
    ]);
  }

  private async resolveFolderName(client: ImapFlow): Promise<string> {
    try {
      const mailboxes = await client.list();
      const match = mailboxes.find((mbx: any) => mbx.path?.toLowerCase() === this.folder.toLowerCase());
      return match?.path || this.folder;
    } catch {
      return this.folder;
    }
  }

  private async syncNewMessages(client: ImapFlow) {
    const lock = await client.getMailboxLock(this.folder);
    try {
      const mailbox: any = (client as any).mailbox;
      const uidValidity: string | undefined = mailbox?.uidValidity?.toString();
      if (uidValidity && this.folderState.uid_validity && uidValidity !== this.folderState.uid_validity) {
        logger.warn('[IMAP] UIDVALIDITY changed; resetting last UID', {
          providerId: this.provider.id,
          tenant: this.provider.tenant,
          folder: this.folder,
          previous: this.folderState.uid_validity,
          next: uidValidity,
        });
        stateLog('uidvalidity_changed', {
          providerId: this.provider.id,
          tenant: this.provider.tenant,
          folder: this.folder,
          listenerId: this.listenerId,
          previous: this.folderState.uid_validity,
          next: uidValidity,
        });
        this.folderState.last_uid = undefined;
      }

      const maxEmailsPerSync = Number(
        process.env.IMAP_MAX_EMAILS_PER_SYNC ||
        this.provider.max_emails_per_sync ||
        DEFAULT_MAX_EMAILS_PER_SYNC
      );

      const uidNext: number | undefined = mailbox?.uidNext ? Number(mailbox.uidNext) : undefined;

      // When we have no cursor (initial connect or after manual resync), start from the most recent window
      // instead of replaying the entire mailbox from UID 1.
      const startUid = this.folderState.last_uid
        ? Number(this.folderState.last_uid) + 1
        : uidNext && uidNext > 1
          ? Math.max(1, uidNext - maxEmailsPerSync)
          : 1;

      const range = `${startUid}:*`;

      let processed = 0;
      let maxUid = this.folderState.last_uid ? Number(this.folderState.last_uid) : 0;

      let uids: number[] | string = range;
      try {
        const searchResult = await client.search({ uid: range });
        if (Array.isArray(searchResult) && searchResult.length > 0) {
          uids = searchResult;
        }
      } catch {
        // fallback to fetch range
      }

      for await (const message of client.fetch(uids, { uid: true, source: true })) {
        if (!message?.source) continue;
        if (message.uid && message.uid > maxUid) {
          maxUid = message.uid;
        }
        const raw = message.source.toString('utf8');
        const parsed = await simpleParser(raw);

        const emailData = this.mapParsedMessage(parsed, message.uid);
        if (!emailData.from?.email) {
          continue;
        }
        const isDuplicate = await this.isDuplicate(emailData.id);
        if (isDuplicate) {
          continue;
        }

        await publishEvent({
          eventType: 'INBOUND_EMAIL_RECEIVED',
          tenant: this.provider.tenant,
          correlationId: process.env.IMAP_EVENT_CHANNEL_BY_TENANT === 'true' ? this.provider.tenant : undefined,
          payload: {
            tenantId: this.provider.tenant,
            tenant: this.provider.tenant,
            providerId: this.provider.id,
            emailData,
          }
        });

        await this.recordLastProcessedMessageId(emailData.id);

        processed += 1;

        if (processed >= maxEmailsPerSync) {
          break;
        }

        const fetchDelay = Number(process.env.IMAP_FETCH_DELAY_MS || 0);
        if (fetchDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, fetchDelay));
        }
      }

      if (maxUid > 0) {
        await this.persistFolderState({
          uid_validity: uidValidity || this.folderState.uid_validity,
          last_uid: String(maxUid),
          last_seen_at: new Date().toISOString(),
        });
      }

      await this.updateLastSyncAt();
      if (processed > 0) {
        logger.info('[IMAP] Sync complete', {
          providerId: this.provider.id,
          tenant: this.provider.tenant,
          folder: this.folder,
          processed,
        });
        stateLog('sync_complete', {
          providerId: this.provider.id,
          tenant: this.provider.tenant,
          folder: this.folder,
          listenerId: this.listenerId,
          processed,
          lastUid: maxUid > 0 ? String(maxUid) : null,
        });
      }
    } finally {
      lock.release();
    }
  }

  private mapParsedMessage(parsed: any, uid?: number): EmailMessageDetails {
    const from = parsed.from?.value?.[0];
    const to = parsed.to?.value || [];
    const cc = parsed.cc?.value || [];
    const baseId = parsed.messageId || this.computeFallbackMessageId(parsed, uid);
    const attachmentLimit = Number(process.env.IMAP_MAX_ATTACHMENT_BYTES || 0);

    return {
      id: baseId,
      provider: 'imap',
      providerId: this.provider.id,
      tenant: this.provider.tenant,
      receivedAt: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
      from: {
        email: from?.address || '',
        name: from?.name,
      },
      to: to.map((entry: any) => ({
        email: entry.address || '',
        name: entry.name,
      })),
      cc: cc.length ? cc.map((entry: any) => ({
        email: entry.address || '',
        name: entry.name,
      })) : undefined,
      subject: parsed.subject || '',
      body: {
        text: parsed.text || '',
        html: parsed.html || undefined,
      },
      attachments: parsed.attachments
        ?.filter((att: any) => (attachmentLimit ? att.size <= attachmentLimit : true))
        .map((att: any) => ({
          id: att.contentId || att.checksum || uuidv4(),
          name: att.filename || 'attachment',
          contentType: att.contentType,
          size: att.size || 0,
          contentId: att.contentId,
        })),
      threadId: parsed.references?.[0],
      references: parsed.references || undefined,
      inReplyTo: parsed.inReplyTo || undefined,
      headers: parsed.headers ? Object.fromEntries(parsed.headers) : undefined,
    } as EmailMessageDetails;
  }

  private computeFallbackMessageId(parsed: any, uid?: number): string {
    const source = `${parsed.subject || ''}|${parsed.from?.text || ''}|${parsed.date || ''}|${parsed.text || ''}`;
    const hash = createHash('sha256').update(source).digest('hex');
    return `imap-hash-${hash}-${uid || uuidv4()}`;
  }

  private async recordLastProcessedMessageId(messageId: string) {
    const db = await getAdminConnection();
    await db('imap_email_provider_config')
      .where({ email_provider_id: this.provider.id, tenant: this.provider.tenant })
      .update({
        last_processed_message_id: messageId,
        updated_at: db.fn.now(),
      });
  }

  private async isDuplicate(messageId: string): Promise<boolean> {
    const db = await getAdminConnection();
    const tableExists = await db.schema.hasTable('email_processed_messages');
    if (!tableExists) return false;
    const existing = await db('email_processed_messages')
      .where({ message_id: messageId, provider_id: this.provider.id, tenant: this.provider.tenant })
      .first();
    return !!existing;
  }

  private async idleLoop(client: ImapFlow) {
    while (this.running) {
      try {
        await Promise.race([
          client.idle(),
          new Promise((resolve) => setTimeout(resolve, DEFAULT_IDLE_POLL_MS)).then(async () => {
            try {
              await client.noop();
            } catch {
              // ignore noop failures
            }
          })
        ]);
        if (!this.running) return;
        await this.syncNewMessages(client);
        this.idleFailures = 0;
      } catch (error: any) {
        logger.warn('[IMAP] IDLE loop error', {
          providerId: this.provider.id,
          tenant: this.provider.tenant,
          folder: this.folder,
          message: error?.message || error,
        });
        stateLog('idle_error', {
          providerId: this.provider.id,
          tenant: this.provider.tenant,
          folder: this.folder,
          listenerId: this.listenerId,
          message: error?.message || String(error),
          idleFailures: this.idleFailures + 1,
        });
        this.idleFailures += 1;
        if (this.idleFailures >= 3) {
          stateLog('idle_fallback_to_poll', {
            providerId: this.provider.id,
            tenant: this.provider.tenant,
            folder: this.folder,
            listenerId: this.listenerId,
            pollIntervalMs: Number(process.env.IMAP_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS),
          });
          await this.pollLoop(client);
          this.idleFailures = 0;
        } else {
          throw error;
        }
      }
    }
  }

  private async pollLoop(client: ImapFlow) {
    const intervalMs = Number(process.env.IMAP_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
    while (this.running) {
      await this.syncNewMessages(client);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async start() {
    this.running = true;
    stateLog('folder_listener_start', {
      providerId: this.provider.id,
      tenant: this.provider.tenant,
      folder: this.folder,
      listenerId: this.listenerId,
      host: this.provider.host,
      port: this.provider.port,
      authType: this.provider.auth_type,
      secure: this.provider.secure,
      allowStartTls: this.provider.allow_starttls,
    });
    while (this.running) {
      try {
        this.client = await this.buildClient();
        await this.connectWithTimeout(this.client);
        logger.info('[IMAP] Connected', { providerId: this.provider.id, tenant: this.provider.tenant, folder: this.folder });
        stateLog('connected', {
          providerId: this.provider.id,
          tenant: this.provider.tenant,
          folder: this.folder,
          listenerId: this.listenerId,
        });
        this.client.on('expunge', (seq) => {
          logger.info('[IMAP] Expunge received', { providerId: this.provider.id, tenant: this.provider.tenant, folder: this.folder, seq });
        });
        (this.client as any).on('bye', (message: any) => {
          logger.warn('[IMAP] Server BYE received', { providerId: this.provider.id, tenant: this.provider.tenant, folder: this.folder, message });
          stateLog('server_bye', {
            providerId: this.provider.id,
            tenant: this.provider.tenant,
            folder: this.folder,
            listenerId: this.listenerId,
            message,
          });
        });
        const resolvedFolder = await this.resolveFolderName(this.client);
        if (resolvedFolder !== this.folder) {
          stateLog('folder_resolved', {
            providerId: this.provider.id,
            tenant: this.provider.tenant,
            listenerId: this.listenerId,
            previousFolder: this.folder,
            resolvedFolder,
          });
          this.folder = resolvedFolder;
        }
        const keepaliveEnabled = (process.env.IMAP_SOCKET_KEEPALIVE || 'true') !== 'false';
        if (keepaliveEnabled) {
          const socket = (this.client as any).socket;
          if (socket?.setKeepAlive) {
            socket.setKeepAlive(true, 30000);
          }
        }
        if ((this.client as any).capabilities) {
          await this.persistServerCapabilities((this.client as any).capabilities);
        }
        await this.updateProviderStatus('connected', null);
        await this.client.mailboxOpen(this.folder, { readOnly: true });
        await this.syncNewMessages(this.client);
        await this.idleLoop(this.client);
      } catch (error: any) {
        logger.error('[IMAP] Folder listener error', {
          providerId: this.provider.id,
          tenant: this.provider.tenant,
          folder: this.folder,
          message: error?.message || error,
        });
        stateLog('folder_listener_error', {
          providerId: this.provider.id,
          tenant: this.provider.tenant,
          folder: this.folder,
          listenerId: this.listenerId,
          message: error?.message || String(error),
        });
        await this.updateProviderStatus('error', error?.message || 'IMAP connection error');
        await this.persistFolderState({ last_seen_at: new Date().toISOString() });
        await this.delayWithBackoff();
      } finally {
        if (this.client) {
          try {
            await this.client.logout();
          } catch {
            // ignore
          }
        }
      }
    }
  }

  async stop() {
    this.running = false;
    stateLog('folder_listener_stop', {
      providerId: this.provider.id,
      tenant: this.provider.tenant,
      folder: this.folder,
      listenerId: this.listenerId,
    });
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        // ignore
      }
    }
    await this.updateProviderStatus('disconnected', null);
  }

  private async delayWithBackoff() {
    const baseDelay = Math.min(this.reconnectDelay, DEFAULT_RECONNECT_MAX_MS);
    const jitter = Math.floor(Math.random() * 500);
    const delay = baseDelay + jitter;
    await new Promise((resolve) => setTimeout(resolve, delay));
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, DEFAULT_RECONNECT_MAX_MS);
  }

  private async persistServerCapabilities(capabilities: string[]) {
    const db = await getAdminConnection();
    await db('imap_email_provider_config')
      .where({ email_provider_id: this.provider.id, tenant: this.provider.tenant })
      .update({
        server_capabilities: capabilities,
        updated_at: db.fn.now(),
      });
  }
}

class ImapProviderWorker {
  private listeners: ImapFolderListener[] = [];
  private running = false;
  private configSignature = '';
  private workerId = uuidv4();

  constructor(private provider: ImapProviderRow) {}

  async start() {
    if (this.running) return;
    this.running = true;
    this.configSignature = JSON.stringify({
      host: this.provider.host,
      port: this.provider.port,
      secure: this.provider.secure,
      allow_starttls: this.provider.allow_starttls,
      auth_type: this.provider.auth_type,
      username: this.provider.username,
      folder_filters: this.provider.folder_filters,
      max_emails_per_sync: this.provider.max_emails_per_sync,
    });

    const folders = this.provider.folder_filters?.length
      ? this.provider.folder_filters
      : ['INBOX'];

    stateLog('worker_start', {
      providerId: this.provider.id,
      tenant: this.provider.tenant,
      workerId: this.workerId,
      folders,
      host: this.provider.host,
      port: this.provider.port,
      authType: this.provider.auth_type,
    });

    this.listeners = folders.map(folder => new ImapFolderListener(this.provider, folder));
    for (const listener of this.listeners) {
      listener.start();
    }
  }

  async stop() {
    this.running = false;
    stateLog('worker_stop', {
      providerId: this.provider.id,
      tenant: this.provider.tenant,
      workerId: this.workerId,
    });
    for (const listener of this.listeners) {
      await listener.stop();
    }
    this.listeners = [];
  }

  needsRestart(nextProvider: ImapProviderRow): boolean {
    const nextSignature = JSON.stringify({
      host: nextProvider.host,
      port: nextProvider.port,
      secure: nextProvider.secure,
      allow_starttls: nextProvider.allow_starttls,
      auth_type: nextProvider.auth_type,
      username: nextProvider.username,
      folder_filters: nextProvider.folder_filters,
      max_emails_per_sync: nextProvider.max_emails_per_sync,
    });
    return nextSignature !== this.configSignature;
  }

  updateProvider(nextProvider: ImapProviderRow) {
    this.provider = nextProvider;
  }
}

export class ImapService {
  private workers = new Map<string, ImapProviderWorker>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private instanceId = uuidv4();

  async start() {
    stateLog('service_start', {
      instanceId: this.instanceId,
      refreshMs: Number(process.env.IMAP_PROVIDER_REFRESH_MS || DEFAULT_REFRESH_MS),
      leaseTtlMs: Number(process.env.IMAP_LEASE_TTL_MS || DEFAULT_LEASE_TTL_MS),
      maxConnectionsPerTenant: Number(process.env.IMAP_MAX_CONNECTIONS_PER_TENANT || DEFAULT_MAX_CONNECTIONS_PER_TENANT),
    });
    await this.refreshProviders();
    const refreshMs = Number(process.env.IMAP_PROVIDER_REFRESH_MS || DEFAULT_REFRESH_MS);
    this.refreshTimer = setInterval(() => {
      this.refreshProviders().catch((error) => {
        logger.error('[IMAP] Failed to refresh providers', error);
        stateLog('refresh_error', { instanceId: this.instanceId, message: error?.message || String(error) });
      });
    }, refreshMs);
    this.heartbeatTimer = setInterval(() => {
      logger.info('[IMAP] Heartbeat', { activeProviders: this.workers.size });
      stateLog('heartbeat', { instanceId: this.instanceId, activeProviders: this.workers.size });
    }, 60_000);
  }

  async stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const worker of this.workers.values()) {
      await worker.stop();
    }
    this.workers.clear();
    await this.releaseLeases();
  }

  private async refreshProviders() {
    stateLog('refresh_start', { instanceId: this.instanceId, currentWorkers: this.workers.size });
    const db = await getAdminConnection();
    const rows = await db('email_providers as ep')
      .join('imap_email_provider_config as ic', function (this: any) {
        this.on('ep.id', '=', 'ic.email_provider_id')
          .andOn('ep.tenant', '=', 'ic.tenant');
      })
      .where('ep.provider_type', 'imap')
      .andWhere('ep.is_active', true)
      .select(
        'ep.id',
        'ep.tenant',
        'ep.provider_name',
        'ep.mailbox',
        'ep.is_active',
        'ep.status',
        'ep.error_message',
        'ep.last_sync_at',
        'ic.host',
        'ic.port',
        'ic.secure',
        'ic.allow_starttls',
        'ic.auth_type',
        'ic.username',
        'ic.auto_process_emails',
        'ic.max_emails_per_sync',
        'ic.folder_filters',
        'ic.oauth_authorize_url',
        'ic.oauth_token_url',
        'ic.oauth_client_id',
        'ic.oauth_client_secret',
        'ic.oauth_scopes',
        'ic.access_token',
        'ic.refresh_token',
        'ic.token_expires_at',
        'ic.uid_validity',
        'ic.last_uid',
        'ic.last_seen_at',
        'ic.last_sync_at as last_sync_at_cfg',
        'ic.last_error',
        'ic.folder_state',
        'ic.last_processed_message_id',
        'ic.server_capabilities',
        'ic.lease_owner',
        'ic.lease_expires_at',
        'ic.connection_timeout_ms',
        'ic.socket_keepalive'
      );

    stateLog('refresh_loaded', {
      instanceId: this.instanceId,
      candidates: rows.length,
      tenants: Array.from(new Set((rows as any[]).map((r) => r.tenant))).length,
    });

    const activeIds = new Set(rows.map((row: any) => row.id));
    const tenantCounts = new Map<string, number>();

    for (const [providerId, worker] of this.workers.entries()) {
      if (!activeIds.has(providerId)) {
        stateLog('worker_remove_inactive', { instanceId: this.instanceId, providerId });
        await worker.stop();
        this.workers.delete(providerId);
      }
    }

    for (const [providerId] of this.workers.entries()) {
      const row = (rows as any[]).find((entry) => entry.id === providerId);
      if (row) {
        tenantCounts.set(row.tenant, (tenantCounts.get(row.tenant) || 0) + 1);
      }
    }

    for (const row of rows as ImapProviderRow[]) {
      if (typeof row.folder_filters === 'string') {
        try {
          row.folder_filters = JSON.parse(row.folder_filters as any) || [];
        } catch {
          row.folder_filters = [];
        }
      } else {
        row.folder_filters = row.folder_filters || [];
      }
      if (typeof row.folder_state === 'string') {
        try {
          row.folder_state = JSON.parse(row.folder_state as any);
        } catch {
          row.folder_state = {};
        }
      }

      const maxConnectionsPerTenant = Number(process.env.IMAP_MAX_CONNECTIONS_PER_TENANT || DEFAULT_MAX_CONNECTIONS_PER_TENANT);
      const currentCount = tenantCounts.get(row.tenant) || 0;
      if (currentCount >= maxConnectionsPerTenant) {
        stateLog('provider_skipped_tenant_cap', {
          instanceId: this.instanceId,
          providerId: row.id,
          tenant: row.tenant,
          currentCount,
          maxConnectionsPerTenant,
        });
        continue;
      }

      const existing = this.workers.get(row.id);
      if (!existing) {
        const leaseAcquired = await this.acquireLease(row.id, row.tenant);
        if (!leaseAcquired) {
          stateLog('provider_skipped_lease', {
            instanceId: this.instanceId,
            providerId: row.id,
            tenant: row.tenant,
          });
          continue;
        }
        const worker = new ImapProviderWorker(row);
        this.workers.set(row.id, worker);
        tenantCounts.set(row.tenant, currentCount + 1);
        stateLog('worker_created', {
          instanceId: this.instanceId,
          providerId: row.id,
          tenant: row.tenant,
        });
        await worker.start();
      } else if (existing.needsRestart(row)) {
        stateLog('worker_restart', { instanceId: this.instanceId, providerId: row.id, tenant: row.tenant });
        await existing.stop();
        existing.updateProvider(row);
        const renewed = await this.renewLease(row.id, row.tenant);
        if (!renewed) {
          stateLog('lease_lost_on_restart', { instanceId: this.instanceId, providerId: row.id, tenant: row.tenant });
          this.workers.delete(row.id);
          continue;
        }
        await existing.start();
      } else {
        const renewed = await this.renewLease(row.id, row.tenant);
        if (!renewed) {
          stateLog('lease_lost', { instanceId: this.instanceId, providerId: row.id, tenant: row.tenant });
          await existing.stop();
          this.workers.delete(row.id);
          continue;
        }
      }
    }

    stateLog('refresh_end', { instanceId: this.instanceId, activeWorkers: this.workers.size });
  }

  private async acquireLease(providerId: string, tenant: string): Promise<boolean> {
    const db = await getAdminConnection();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Number(process.env.IMAP_LEASE_TTL_MS || DEFAULT_LEASE_TTL_MS));
    const updated = await db('imap_email_provider_config')
      .where({ email_provider_id: providerId, tenant })
      .andWhere(function (this: any) {
        this.whereNull('lease_expires_at').orWhere('lease_expires_at', '<', now.toISOString());
      })
      .update({
        lease_owner: this.instanceId,
        lease_expires_at: expiresAt.toISOString(),
        updated_at: db.fn.now(),
      });
    stateLog('lease_acquire', {
      instanceId: this.instanceId,
      providerId,
      tenant,
      acquired: updated > 0,
      expiresAt: expiresAt.toISOString(),
    });
    return updated > 0;
  }

  private async renewLease(providerId: string, tenant: string): Promise<boolean> {
    const db = await getAdminConnection();
    const expiresAt = new Date(Date.now() + Number(process.env.IMAP_LEASE_TTL_MS || DEFAULT_LEASE_TTL_MS));
    const updated = await db('imap_email_provider_config')
      .where({ email_provider_id: providerId, tenant, lease_owner: this.instanceId })
      .update({
        lease_expires_at: expiresAt.toISOString(),
        updated_at: db.fn.now(),
      });
    if (updated === 0) {
      stateLog('lease_renew_failed', { instanceId: this.instanceId, providerId, tenant });
      return false;
    }
    return true;
  }

  private async releaseLeases() {
    const db = await getAdminConnection();
    const updated = await db('imap_email_provider_config')
      .where({ lease_owner: this.instanceId })
      .update({
        lease_owner: null,
        lease_expires_at: null,
        updated_at: db.fn.now(),
      });
    stateLog('lease_release_all', { instanceId: this.instanceId, released: updated });
  }
}
