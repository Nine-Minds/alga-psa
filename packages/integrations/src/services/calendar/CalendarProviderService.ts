// @ts-nocheck
// TODO: This file needs refactoring - model method signatures have changed
/**
 * Calendar Provider Service
 * Handles CRUD operations for calendar provider configurations
 */

import crypto from 'crypto';
import type { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import type { CalendarProviderConfig } from '@alga-psa/types';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

// Helper to get secret with provider instance
async function getSecret(secretName: string): Promise<string | null> {
  const provider = await getSecretProviderInstance();
  return provider.getSecret(secretName);
}

export interface CreateCalendarProviderData {
  tenant: string;
  userId: string; // The user who owns this calendar sync
  providerType: 'google' | 'microsoft';
  providerName: string;
  calendarId: string;
  isActive: boolean;
  syncDirection: 'bidirectional' | 'to_external' | 'from_external';
  vendorConfig: any;
}

export interface UpdateCalendarProviderData {
  providerName?: string;
  calendarId?: string;
  isActive?: boolean;
  syncDirection?: 'bidirectional' | 'to_external' | 'from_external';
  vendorConfig?: any;
}

export interface GetCalendarProvidersFilter {
  tenant: string;
  userId?: string; // Filter to providers owned by this user
  providerType?: 'google' | 'microsoft';
  isActive?: boolean;
  calendarId?: string;
}

export interface CalendarProviderStatus {
  status: 'connected' | 'disconnected' | 'error' | 'configuring';
  errorMessage?: string | null;
  lastSyncAt?: string;
}

export class CalendarProviderService {
  private static readonly GOOGLE_VENDOR_KEY_MAP: Record<string, string> = {
    clientId: 'client_id',
    client_id: 'client_id',
    clientSecret: 'client_secret',
    client_secret: 'client_secret',
    projectId: 'project_id',
    project_id: 'project_id',
    redirectUri: 'redirect_uri',
    redirect_uri: 'redirect_uri',
    pubsubTopicName: 'pubsub_topic_name',
    pubsub_topic_name: 'pubsub_topic_name',
    pubsubSubscriptionName: 'pubsub_subscription_name',
    pubsub_subscription_name: 'pubsub_subscription_name',
    pubsubInitialisedAt: 'pubsub_initialised_at',
    pubsub_initialised_at: 'pubsub_initialised_at',
    webhookNotificationUrl: 'webhook_notification_url',
    webhook_notification_url: 'webhook_notification_url',
    webhookVerificationToken: 'webhook_verification_token',
    webhook_verification_token: 'webhook_verification_token',
    webhookSubscriptionId: 'webhook_subscription_id',
    webhook_subscription_id: 'webhook_subscription_id',
    webhookExpiresAt: 'webhook_expires_at',
    webhook_expires_at: 'webhook_expires_at',
    webhookResourceId: 'webhook_resource_id',
    webhook_resource_id: 'webhook_resource_id',
    calendarId: 'calendar_id',
    calendar_id: 'calendar_id',
    accessToken: 'access_token',
    access_token: 'access_token',
    refreshToken: 'refresh_token',
    refresh_token: 'refresh_token',
    tokenExpiresAt: 'token_expires_at',
    token_expires_at: 'token_expires_at',
    syncToken: 'sync_token',
    sync_token: 'sync_token',
  };

  private static readonly MICROSOFT_VENDOR_KEY_MAP: Record<string, string> = {
    clientId: 'client_id',
    client_id: 'client_id',
    clientSecret: 'client_secret',
    client_secret: 'client_secret',
    tenantId: 'tenant_id',
    tenant_id: 'tenant_id',
    redirectUri: 'redirect_uri',
    redirect_uri: 'redirect_uri',
    webhookSubscriptionId: 'webhook_subscription_id',
    webhook_subscription_id: 'webhook_subscription_id',
    webhookExpiresAt: 'webhook_expires_at',
    webhook_expires_at: 'webhook_expires_at',
    webhookNotificationUrl: 'webhook_notification_url',
    webhook_notification_url: 'webhook_notification_url',
    webhookVerificationToken: 'webhook_verification_token',
    webhook_verification_token: 'webhook_verification_token',
    calendarId: 'calendar_id',
    calendar_id: 'calendar_id',
    accessToken: 'access_token',
    access_token: 'access_token',
    refreshToken: 'refresh_token',
    refresh_token: 'refresh_token',
    tokenExpiresAt: 'token_expires_at',
    token_expires_at: 'token_expires_at',
    deltaLink: 'delta_link',
    delta_link: 'delta_link',
  };

  private static readonly GOOGLE_ALLOWED_COLUMNS = new Set(
    Object.values(CalendarProviderService.GOOGLE_VENDOR_KEY_MAP),
  );

  private static readonly MICROSOFT_ALLOWED_COLUMNS = new Set(
    Object.values(CalendarProviderService.MICROSOFT_VENDOR_KEY_MAP),
  );

  private static encryptionKeyPromise: Promise<Buffer> | null = null;

  private async getDb() {
    const { knex } = await createTenantKnex();
    return knex;
  }

  /**
   * Generate webhook URL with proper environment-aware base URL
   */
  private generateWebhookUrl(path: string): string {
    const baseUrl = process.env.NGROK_URL || 
                    process.env.NEXT_PUBLIC_BASE_URL || 
                    process.env.NEXTAUTH_URL ||
                    'http://localhost:3000';
    return `${baseUrl}${path}`;
  }

  /**
   * Get calendar providers based on filters
   */
  async getProviders(filters: GetCalendarProvidersFilter): Promise<CalendarProviderConfig[]> {
    try {
      const db = await this.getDb();
      let query = db('calendar_providers')
        .where('tenant', filters.tenant)
        .orderBy('created_at', 'desc');

      if (filters.userId) {
        query = query.where('user_id', filters.userId);
      }

      if (filters.providerType) {
        query = query.where('provider_type', filters.providerType);
      }

      if (filters.isActive !== undefined) {
        query = query.where('is_active', filters.isActive);
      }

      if (filters.calendarId) {
        query = query.where('calendar_id', filters.calendarId);
      }

      const providers = await query;

      // Load vendor configs for each provider
      const providersWithConfig = await Promise.all(providers.map(async (provider) => {
        const vendorConfig = await this.getVendorConfig(
          db,
          provider.provider_type,
          provider.id,
          filters.tenant,
        );
        return this.buildProviderConfig(provider, vendorConfig, { includeSecrets: false });
      }));

      return providersWithConfig;
    } catch (error: any) {
      console.error('Error fetching calendar providers:', error);
      throw new Error(`Failed to fetch calendar providers: ${error.message}`);
    }
  }

  /**
   * Get a single calendar provider by ID
   */
  async getProvider(
    providerId: string,
    tenant?: string,
    options: { includeSecrets?: boolean } = {}
  ): Promise<CalendarProviderConfig | null> {
    try {
      const db = await this.getDb();
      const provider = await db('calendar_providers')
        .where('id', providerId)
        .modify((builder) => {
          if (tenant) {
            builder.andWhere('tenant', tenant);
          }
        })
        .first();

      if (!provider) {
        return null;
      }

      // Load vendor-specific configuration
      const vendorConfig = await this.getVendorConfig(
        db,
        provider.provider_type,
        provider.id,
        provider.tenant,
      );

      const includeSecrets = options.includeSecrets ?? true;
      return this.buildProviderConfig(provider, vendorConfig, { includeSecrets });
    } catch (error: any) {
      console.error(`Error fetching calendar provider ${providerId}:`, error);
      throw new Error(`Failed to fetch calendar provider: ${error.message}`);
    }
  }

  /**
   * Create a new calendar provider
   */
  async createProvider(data: CreateCalendarProviderData): Promise<CalendarProviderConfig> {
    try {
      const db = await this.getDb();
      
      // Create main provider record
      const [provider] = await db('calendar_providers')
        .insert({
          id: db.raw('gen_random_uuid()'),
          tenant: data.tenant,
          user_id: data.userId,
          provider_type: data.providerType,
          provider_name: data.providerName,
          calendar_id: data.calendarId,
          is_active: data.isActive,
          sync_direction: data.syncDirection,
          status: 'configuring',
          created_at: db.fn.now(),
          updated_at: db.fn.now()
        })
        .returning('*');

      const { encrypted: vendorInsert, normalized: normalizedVendorConfig } =
        await this.prepareVendorConfigForStorage(data.providerType, data.vendorConfig);

      const hasVendorData = Object.keys(normalizedVendorConfig).length > 0;
      const vendorHasRequiredFields = this.hasRequiredVendorFields(
        data.providerType,
        normalizedVendorConfig
      );

      if (hasVendorData && !vendorHasRequiredFields) {
        console.warn(
          `[CalendarProviderService] Skipping vendor config insert for ${data.providerType} provider ${provider.id} because required credentials are missing`
        );
      }

      if (vendorHasRequiredFields) {
        const vendorRecord = {
          calendar_provider_id: provider.id,
          tenant: data.tenant,
          ...vendorInsert,
          created_at: db.fn.now(),
          updated_at: db.fn.now()
        };

        if (data.providerType === 'google') {
          await db('google_calendar_provider_config').insert(vendorRecord);
        } else if (data.providerType === 'microsoft') {
          await db('microsoft_calendar_provider_config').insert(vendorRecord);
        }
      }

      console.log(`✅ Created calendar provider: ${provider.provider_name} (${provider.id})`);
      
      // Fetch the complete provider with vendor config
      const createdProvider = await this.getProvider(provider.id, data.tenant, { includeSecrets: false });
      if (!createdProvider) {
        throw new Error('Failed to fetch created provider');
      }
      
      return createdProvider;
    } catch (error: any) {
      console.error('Error creating calendar provider:', error);
      throw new Error(`Failed to create calendar provider: ${error.message}`);
    }
  }

  /**
   * Update an existing calendar provider
   */
  async updateProvider(
    providerId: string,
    tenant: string,
    data: UpdateCalendarProviderData
  ): Promise<CalendarProviderConfig> {
    try {
      const db = await this.getDb();
      
      // Get existing provider to determine type and current config
      const existingProvider = await this.getProvider(providerId, tenant);
      if (!existingProvider) {
        throw new Error('Provider not found');
      }

      if (existingProvider.tenant !== tenant) {
        throw new Error('Provider not found');
      }

      // Update main provider table
      const mainUpdateData: any = {
        updated_at: db.fn.now()
      };

      if (data.providerName !== undefined) {
        mainUpdateData.provider_name = data.providerName;
      }

      if (data.calendarId !== undefined) {
        mainUpdateData.calendar_id = data.calendarId;
      }

      if (data.isActive !== undefined) {
        mainUpdateData.is_active = data.isActive;
      }

      if (data.syncDirection !== undefined) {
        mainUpdateData.sync_direction = data.syncDirection;
      }

      // Update main provider record
      await db('calendar_providers')
        .where('id', providerId)
        .andWhere('tenant', tenant)
        .update(mainUpdateData);

      // Update vendor-specific configuration if provided
      if (data.vendorConfig !== undefined) {
        const { encrypted: vendorUpdate, normalized: normalizedVendorConfig } =
          await this.prepareVendorConfigForStorage(
            existingProvider.provider_type,
            data.vendorConfig
          );

        const vendorTable =
          existingProvider.provider_type === 'google'
            ? 'google_calendar_provider_config'
            : 'microsoft_calendar_provider_config';

        const existingVendorRecord = await db(vendorTable)
          .where('calendar_provider_id', providerId)
          .andWhere('tenant', tenant)
          .first();

        if (existingVendorRecord) {
          const updatePayload =
            Object.keys(vendorUpdate).length > 0
              ? { ...vendorUpdate, updated_at: db.fn.now() }
              : { updated_at: db.fn.now() };

          await db(vendorTable)
            .where('calendar_provider_id', providerId)
            .andWhere('tenant', tenant)
            .update(updatePayload);
        } else if (this.hasRequiredVendorFields(existingProvider.provider_type, normalizedVendorConfig)) {
          await db(vendorTable).insert({
            calendar_provider_id: providerId,
            tenant,
            ...vendorUpdate,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
          });
        } else if (Object.keys(normalizedVendorConfig).length > 0) {
          throw new Error(
            `${existingProvider.provider_type} vendor configuration is missing required credentials`
          );
        }
      }

      // Fetch updated provider with vendor config
      const updatedProvider = await this.getProvider(providerId, tenant, { includeSecrets: false });
      if (!updatedProvider) {
        throw new Error('Failed to fetch updated provider');
      }

      console.log(`✅ Updated calendar provider: ${updatedProvider.name} (${updatedProvider.id})`);
      
      return updatedProvider;
    } catch (error: any) {
      console.error(`Error updating calendar provider ${providerId}:`, error);
      throw new Error(`Failed to update calendar provider: ${error.message}`);
    }
  }

  /**
   * Update provider status
   */
  async updateProviderStatus(providerId: string, status: CalendarProviderStatus): Promise<void> {
    try {
      const db = await this.getDb();
      const updateData: any = {
        status: status.status,
        updated_at: db.fn.now()
      };

      if (status.errorMessage !== undefined) {
        updateData.error_message = status.errorMessage;
      }

      if (status.lastSyncAt) {
        updateData.last_sync_at = status.lastSyncAt;
      }

      await db('calendar_providers')
        .where('id', providerId)
        .update(updateData);

      console.log(`✅ Updated calendar provider status: ${providerId} -> ${status.status}`);
    } catch (error: any) {
      console.error(`Error updating calendar provider status ${providerId}:`, error);
      throw new Error(`Failed to update calendar provider status: ${error.message}`);
    }
  }

  /**
   * Delete a calendar provider
   */
  async deleteProvider(providerId: string, tenant: string): Promise<void> {
    try {
      const db = await this.getDb();
      
      // Get provider info to determine type for cleanup
      const provider = await db('calendar_providers')
        .where('id', providerId)
        .andWhere('tenant', tenant)
        .first();

      if (!provider) {
        throw new Error('Provider not found');
      }

      // Delete vendor-specific configuration first
      if (provider.provider_type === 'google') {
        await db('google_calendar_provider_config')
          .where('calendar_provider_id', providerId)
          .andWhere('tenant', provider.tenant)
          .del();
      } else if (provider.provider_type === 'microsoft') {
        await db('microsoft_calendar_provider_config')
          .where('calendar_provider_id', providerId)
          .andWhere('tenant', provider.tenant)
          .del();
      }

      // Delete calendar event mappings
      await db('calendar_event_mappings')
        .where('calendar_provider_id', providerId)
        .andWhere('tenant', provider.tenant)
        .del();

      // Delete main provider record
      const deleted = await db('calendar_providers')
        .where('id', providerId)
        .andWhere('tenant', tenant)
        .del();

      if (deleted === 0) {
        throw new Error('Provider not found');
      }

      console.log(`✅ Deleted calendar provider: ${providerId}`);
    } catch (error: any) {
      console.error(`Error deleting calendar provider ${providerId}:`, error);
      throw new Error(`Failed to delete calendar provider: ${error.message}`);
    }
  }

  private async buildProviderConfig(
    row: any,
    vendorConfig: any,
    options: { includeSecrets: boolean }
  ): Promise<CalendarProviderConfig> {
    const providerConfig = options.includeSecrets
      ? await this.toVendorConfig(row.provider_type, row.tenant, vendorConfig)
      : undefined;

    return {
      id: row.id,
      tenant: row.tenant,
      user_id: row.user_id,
      name: row.provider_name,
      provider_type: row.provider_type,
      calendar_id: row.calendar_id,
      active: row.is_active,
      sync_direction: row.sync_direction,
      connection_status: row.status || 'configuring',
      last_sync_at: row.last_sync_at || undefined,
      error_message: row.error_message || undefined,
      provider_config: providerConfig,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private async toVendorConfig(
    providerType: 'google' | 'microsoft',
    _tenant: string,
    vendorConfig: any
  ) {
    if (!vendorConfig) {
      return undefined;
    }

    const decrypted = await this.decryptVendorConfigRow(vendorConfig);
    if (providerType === 'google') {
      return this.stripUndefinedValues({
        clientId: decrypted.client_id,
        clientSecret: decrypted.client_secret,
        projectId: decrypted.project_id,
        redirectUri: decrypted.redirect_uri,
        accessToken: decrypted.access_token,
        refreshToken: decrypted.refresh_token,
        tokenExpiresAt: this.toIsoString(decrypted.token_expires_at),
        pubsubTopicName: decrypted.pubsub_topic_name,
        pubsubSubscriptionName: decrypted.pubsub_subscription_name,
        pubsubInitialisedAt: this.toIsoString(decrypted.pubsub_initialised_at),
        webhookNotificationUrl: decrypted.webhook_notification_url,
        webhookVerificationToken: decrypted.webhook_verification_token,
        webhookSubscriptionId: decrypted.webhook_subscription_id,
        webhookExpiresAt: this.toIsoString(decrypted.webhook_expires_at),
        webhookResourceId: decrypted.webhook_resource_id,
        calendarId: decrypted.calendar_id,
        syncToken: decrypted.sync_token,
      });
    }

    return this.stripUndefinedValues({
      clientId: decrypted.client_id,
      clientSecret: decrypted.client_secret,
      tenantId: decrypted.tenant_id,
      redirectUri: decrypted.redirect_uri,
      accessToken: decrypted.access_token,
      refreshToken: decrypted.refresh_token,
      tokenExpiresAt: this.toIsoString(decrypted.token_expires_at),
      webhookSubscriptionId: decrypted.webhook_subscription_id,
      webhookExpiresAt: this.toIsoString(decrypted.webhook_expires_at),
      webhookNotificationUrl: decrypted.webhook_notification_url,
      webhookVerificationToken: decrypted.webhook_verification_token,
      calendarId: decrypted.calendar_id,
      deltaLink: decrypted.delta_link,
    });
  }

  private async prepareVendorConfigForStorage(
    providerType: 'google' | 'microsoft',
    rawConfig: any
  ): Promise<{
    normalized: Record<string, unknown>;
    encrypted: Record<string, unknown>;
  }> {
    if (!rawConfig) {
      return {
        normalized: {},
        encrypted: {}
      };
    }

    const normalized = this.normalizeVendorConfigInput(providerType, rawConfig);
    const encrypted = await this.encryptVendorConfig(normalized);
    return {
      normalized,
      encrypted: this.stripUndefinedValues(encrypted)
    };
  }

  private stripUndefinedValues<T extends Record<string, unknown>>(obj: T): T {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result as T;
  }

  private hasRequiredVendorFields(
    providerType: 'google' | 'microsoft',
    config: Record<string, unknown>
  ): boolean {
    if (!config || Object.keys(config).length === 0) {
      return false;
    }

    const requiredFields =
      providerType === 'google'
        ? ['calendar_id']
        : ['client_id', 'client_secret', 'tenant_id', 'redirect_uri', 'calendar_id'];

    return requiredFields.every((field) => {
      const value = config[field];
      if (value === undefined || value === null) {
        return false;
      }
      return typeof value === 'string' ? value.trim().length > 0 : true;
    });
  }

  private async encryptVendorConfig(
    config: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined) {
        continue;
      }

      if (this.isSensitiveVendorKey(key)) {
        if (value === null || value === '') {
          result[key] = null;
        } else {
          result[key] = await this.encryptValue(String(value));
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private async decryptVendorConfigRow(config: any): Promise<any> {
    const decrypted: Record<string, unknown> = { ...config };
    for (const [key, value] of Object.entries(decrypted)) {
      if (
        this.isSensitiveVendorKey(key) &&
        typeof value === 'string' &&
        value &&
        this.isEncryptedValue(value)
      ) {
        decrypted[key] = await this.decryptValue(value);
      }
    }
    return decrypted;
  }

  private toIsoString(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }

    const date = value instanceof Date ? value : new Date(value as string);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    return date.toISOString();
  }

  private isSensitiveVendorKey(column: string): boolean {
    return (
      column === 'client_secret' ||
      column === 'access_token' ||
      column === 'refresh_token' ||
      column === 'webhook_verification_token' ||
      column === 'sync_token' ||
      column === 'delta_link'
    );
  }

  private isEncryptedValue(value: string): boolean {
    return value.startsWith('enc:');
  }

  private async encryptValue(plainText: string): Promise<string> {
    if (!plainText) {
      return plainText;
    }

    try {
      const key = await this.getEncryptionKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64');
      return `enc:${payload}`;
    } catch (error) {
      console.error('Failed to encrypt calendar provider secret:', (error as Error).message);
      throw error;
    }
  }

  private async decryptValue(value: string): Promise<string> {
    if (!this.isEncryptedValue(value)) {
      return value;
    }

    try {
      const key = await this.getEncryptionKey();
      const payload = value.slice(4);
      const buffer = Buffer.from(payload, 'base64');

      if (buffer.length < 28) {
        throw new Error('Encrypted payload is malformed');
      }

      const iv = buffer.subarray(0, 12);
      const authTag = buffer.subarray(12, 28);
      const ciphertext = buffer.subarray(28);

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (error) {
      console.error('Failed to decrypt calendar provider secret:', (error as Error).message);
      // Fallback to returning the original value to avoid hard failure.
      return value;
    }
  }

  private async getEncryptionKey(): Promise<Buffer> {
    if (!CalendarProviderService.encryptionKeyPromise) {
      CalendarProviderService.encryptionKeyPromise = (async () => {
        const secret = await getSecret(
          'calendar_oauth_encryption_key',
          'CALENDAR_OAUTH_ENCRYPTION_KEY'
        );
        const fallback = secret || process.env.NEXTAUTH_SECRET || '';
        if (!fallback) {
          throw new Error(
            'Calendar integrations encryption key is not configured. Set CALENDAR_OAUTH_ENCRYPTION_KEY or NEXTAUTH_SECRET.'
          );
        }

        return crypto.createHash('sha256').update(fallback).digest();
      })();
    }

    return CalendarProviderService.encryptionKeyPromise;
  }

  private async getVendorConfig(
    db: Knex,
    providerType: 'google' | 'microsoft',
    providerId: string,
    tenant: string
  ): Promise<any> {
    const table =
      providerType === 'google'
        ? 'google_calendar_provider_config'
        : 'microsoft_calendar_provider_config';

    return db(table)
      .where('calendar_provider_id', providerId)
      .andWhere('tenant', tenant)
      .first();
  }

  private normalizeVendorConfigInput(
    providerType: 'google' | 'microsoft',
    input: Record<string, unknown> | undefined
  ): Record<string, unknown> {
    if (!input) {
      return {};
    }

    const normalized: Record<string, unknown> = {};
    const allowedColumns =
      providerType === 'google'
        ? CalendarProviderService.GOOGLE_ALLOWED_COLUMNS
        : CalendarProviderService.MICROSOFT_ALLOWED_COLUMNS;
    const keyMap =
      providerType === 'google'
        ? CalendarProviderService.GOOGLE_VENDOR_KEY_MAP
        : CalendarProviderService.MICROSOFT_VENDOR_KEY_MAP;

    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) {
        continue;
      }

      const normalizedKey = this.normalizeVendorConfigKey(keyMap, allowedColumns, key);
      if (!normalizedKey) {
        continue;
      }

      normalized[normalizedKey] = this.normalizeVendorValue(normalizedKey, value);
    }

    return normalized;
  }

  private normalizeVendorConfigKey(
    keyMap: Record<string, string>,
    allowedColumns: Set<string>,
    key: string
  ): string | null {
    if (keyMap[key]) {
      return keyMap[key];
    }

    const snakeKey = this.toSnakeCase(key);
    if (keyMap[snakeKey]) {
      return keyMap[snakeKey];
    }

    return allowedColumns.has(snakeKey) ? snakeKey : null;
  }

  private toSnakeCase(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .toLowerCase();
  }

  private normalizeVendorValue(column: string, value: unknown): unknown {
    if (value === '') {
      return null;
    }

    if (
      column === 'token_expires_at' ||
      column === 'pubsub_initialised_at' ||
      column === 'webhook_expires_at'
    ) {
      if (value instanceof Date || value === null) {
        return value;
      }

      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : parsed;
      }
    }

    return value;
  }
}

/**
 * Global function to get calendar provider configurations (used by other services)
 */
export async function getCalendarProviderConfigs(filters?: Partial<GetCalendarProvidersFilter>): Promise<CalendarProviderConfig[]> {
  const service = new CalendarProviderService();
  return service.getProviders(filters as GetCalendarProvidersFilter);
}
