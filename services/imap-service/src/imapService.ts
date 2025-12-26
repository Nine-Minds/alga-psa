import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { v4 as uuidv4 } from 'uuid';
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
    return await secretProvider.getTenantSecret(this.provider.tenant, `imap_password_${this.provider.id}`);
  }

  private async getOauthSecrets(): Promise<{ clientSecret?: string | null; refreshToken?: string | null }> {
    const secretProvider = await getSecretProviderInstance();
    const clientSecret = await secretProvider.getTenantSecret(this.provider.tenant, `imap_oauth_client_secret_${this.provider.id}`);
    const refreshToken = await secretProvider.getTenantSecret(this.provider.tenant, `imap_refresh_token_${this.provider.id}`);
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
    } else {
      auth.pass = await this.getPasswordSecret();
    }

    if (!auth.pass && !auth.accessToken) {
      throw new Error('IMAP credentials missing');
    }

    const secure = this.provider.secure || !this.provider.allow_starttls;
    return new ImapFlow({
      host: this.provider.host,
      port: Number(this.provider.port),
      secure,
      auth,
      disableAutoIdle: true,
      logger: false,
      tls: this.provider.allow_starttls ? { rejectUnauthorized: false } : undefined,
    });
  }

  private async syncNewMessages(client: ImapFlow) {
    const lock = await client.getMailboxLock(this.folder);
    try {
      const mailbox = client.mailbox;
      const uidValidity = mailbox?.uidValidity?.toString();
      if (uidValidity && this.folderState.uid_validity && uidValidity !== this.folderState.uid_validity) {
        logger.warn('[IMAP] UIDVALIDITY changed; resetting last UID', {
          providerId: this.provider.id,
          folder: this.folder,
          previous: this.folderState.uid_validity,
          next: uidValidity,
        });
        this.folderState.last_uid = undefined;
      }

      const startUid = this.folderState.last_uid ? Number(this.folderState.last_uid) + 1 : 1;
      const range = `${startUid}:*`;

      let processed = 0;
      let maxUid = this.folderState.last_uid ? Number(this.folderState.last_uid) : 0;

      for await (const message of client.fetch(range, { uid: true, source: true })) {
        if (!message?.source) continue;
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
          payload: {
            tenantId: this.provider.tenant,
            tenant: this.provider.tenant,
            providerId: this.provider.id,
            emailData,
          }
        });

        processed += 1;
        if (message.uid && message.uid > maxUid) {
          maxUid = message.uid;
        }

        if (processed >= (this.provider.max_emails_per_sync || 50)) {
          break;
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
    } finally {
      lock.release();
    }
  }

  private mapParsedMessage(parsed: any, uid?: number): EmailMessageDetails {
    const from = parsed.from?.value?.[0];
    const to = parsed.to?.value || [];
    const cc = parsed.cc?.value || [];

    return {
      id: parsed.messageId || `${this.provider.id}-${uid || uuidv4()}`,
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
      attachments: parsed.attachments?.map((att: any) => ({
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
      } catch (error: any) {
        logger.warn('[IMAP] IDLE loop error', {
          providerId: this.provider.id,
          folder: this.folder,
          message: error?.message || error,
        });
        throw error;
      }
    }
  }

  async start() {
    this.running = true;
    while (this.running) {
      try {
        this.client = await this.buildClient();
        await this.client.connect();
        await this.updateProviderStatus('connected', null);
        await this.client.mailboxOpen(this.folder, { readOnly: true });
        await this.syncNewMessages(this.client);
        await this.idleLoop(this.client);
      } catch (error: any) {
        logger.error('[IMAP] Folder listener error', {
          providerId: this.provider.id,
          folder: this.folder,
          message: error?.message || error,
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
}

class ImapProviderWorker {
  private listeners: ImapFolderListener[] = [];
  private running = false;
  private configSignature: string;

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

    this.listeners = folders.map(folder => new ImapFolderListener(this.provider, folder));
    for (const listener of this.listeners) {
      listener.start();
    }
  }

  async stop() {
    this.running = false;
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

  async start() {
    await this.refreshProviders();
    const refreshMs = Number(process.env.IMAP_PROVIDER_REFRESH_MS || DEFAULT_REFRESH_MS);
    this.refreshTimer = setInterval(() => {
      this.refreshProviders().catch((error) => {
        logger.error('[IMAP] Failed to refresh providers', error);
      });
    }, refreshMs);
  }

  async stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const worker of this.workers.values()) {
      await worker.stop();
    }
    this.workers.clear();
  }

  private async refreshProviders() {
    const db = await getAdminConnection();
    const rows = await db('email_providers as ep')
      .join('imap_email_provider_config as ic', function () {
        this.on('ep.id', '=', 'ic.email_provider_id')
          .andOn('ep.tenant', '=', 'ic.tenant');
      })
      .where('ep.provider_type', 'imap')
      .andWhere('ep.is_active', true)
      .andWhereNot('ep.status', 'error')
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
        'ic.folder_state'
      );

    const activeIds = new Set(rows.map((row: any) => row.id));

    for (const [providerId, worker] of this.workers.entries()) {
      if (!activeIds.has(providerId)) {
        await worker.stop();
        this.workers.delete(providerId);
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

      const existing = this.workers.get(row.id);
      if (!existing) {
        const worker = new ImapProviderWorker(row);
        this.workers.set(row.id, worker);
        await worker.start();
      } else if (existing.needsRestart(row)) {
        await existing.stop();
        existing.updateProvider(row);
        await existing.start();
      }
    }
  }
}
