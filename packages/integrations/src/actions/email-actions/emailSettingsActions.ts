/**
 * Server actions for email settings management
 */

'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { EmailAddress, EmailProviderConfig, TenantEmailSettings } from '@alga-psa/types';
import {
  resolveDefaultFromAddress,
  resolveTenantCompanyName,
  TenantEmailService,
} from '@alga-psa/email';
import { createDefaultProviderConfig } from '@alga-psa/email/providerConfig';
import {
  actionError,
  isActionMessageError,
  type ActionMessageError,
} from '@alga-psa/ui/lib/errorHandling';
import { isValidEmail } from '@alga-psa/validation';

type EmailSettingsUpdateInput = Omit<Partial<TenantEmailSettings>, 'defaultFromDomain' | 'ticketingFromEmail' | 'ticketingFromName'> & {
  defaultFromDomain?: string | null;
};

// getEmailSettings masks stored secrets as this sentinel so they are never
// sent to the browser. On save it means "unchanged" — restore the real value.
const SECRET_MASK = '***';
const SECRET_FIELDS = ['password', 'apiKey'] as const;
const EDITABLE_PROVIDER_TYPES = ['smtp', 'resend', 'microsoft'] as const;

export interface MicrosoftOutboundMailboxOption {
  providerId: string;
  mailbox: string;
  providerName: string;
  senderDisplayName?: string | null;
  status: 'connected' | 'disconnected' | 'error' | 'configuring';
}

export interface EmailSettingsView extends TenantEmailSettings {
  tenantCompanyName: string | null;
  effectiveNotificationFrom: EmailAddress;
}

function withEditableProviderConfigs(settings: TenantEmailSettings): TenantEmailSettings {
  const providerConfigs = [...(settings.providerConfigs ?? [])];

  for (const providerType of EDITABLE_PROVIDER_TYPES) {
    if (!providerConfigs.some(config => config.providerType === providerType)) {
      providerConfigs.push(createDefaultProviderConfig(providerType, {
        isEnabled: providerType === settings.emailProvider,
      }));
    }
  }

  return { ...settings, providerConfigs };
}

function mergeProviderSecrets(
  incoming: EmailProviderConfig[],
  existing: EmailProviderConfig[] | undefined
): EmailProviderConfig[] {
  const existingById = new Map((existing ?? []).map(config => [config.providerId, config]));

  return incoming.map(config => {
    const prior = existingById.get(config.providerId);
    const nextConfig: Record<string, any> = { ...(config.config ?? {}) };

    for (const field of SECRET_FIELDS) {
      if (nextConfig[field] !== SECRET_MASK) continue;
      // The client only ever held the mask, so this is not a real change.
      const priorValue = prior?.config?.[field];
      if (priorValue) {
        nextConfig[field] = priorValue;
      } else {
        delete nextConfig[field];
      }
    }

    return { ...config, config: nextConfig };
  });
}

function extractDomain(address?: string | null): string | null {
  if (!address) return null;
  const parts = address.split('@');
  if (parts.length !== 2) return null;
  return parts[1]?.trim().toLowerCase() || null;
}

function hasOwnUpdate<K extends keyof EmailSettingsUpdateInput>(
  updates: EmailSettingsUpdateInput,
  key: K
): boolean {
  return Object.prototype.hasOwnProperty.call(updates, key);
}

function normalizeOptionalString(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

async function toEmailSettingsView(
  settings: TenantEmailSettings,
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  tenant: string
): Promise<EmailSettingsView> {
  const tenantCompanyName = await resolveTenantCompanyName(knex, tenant);
  return {
    ...withEditableProviderConfigs(settings),
    tenantCompanyName,
    effectiveNotificationFrom: resolveDefaultFromAddress(settings, tenantCompanyName),
  };
}

export const getEmailSettings = withAuth(async (
  user,
  { tenant }
): Promise<EmailSettingsView | null | ActionMessageError> => {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'settings', 'read', knex)) return actionError('You do not have permission to read email settings', 'errors.permissionDenied');

  try {
    // Use TenantEmailService to get email settings
    const settings = await TenantEmailService.getTenantEmailSettings(tenant || '', knex);

    if (!settings) {
      // Return default settings if none exist
      const defaultSmtpConfig = createDefaultProviderConfig('smtp', { isEnabled: true });
      const defaultSettings: TenantEmailSettings = {
        tenantId: tenant || '',
        defaultFromDomain: process.env.EMAIL_FROM ? extractDomain(process.env.EMAIL_FROM) || undefined : undefined,
        customDomains: [],
        emailProvider: 'smtp',
        providerConfigs: [{
          ...defaultSmtpConfig,
          config: {
            ...defaultSmtpConfig.config,
            host: process.env.EMAIL_HOST || '',
            port: parseInt(process.env.EMAIL_PORT || '587'),
            username: process.env.EMAIL_USERNAME || '',
            password: '', // Don't expose password
            from: process.env.EMAIL_FROM || ''
          }
        }],
        trackingEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      return toEmailSettingsView(defaultSettings, knex, tenant || '');
    }

    // Don't expose sensitive data like passwords and API keys in full
    const sanitizedSettings = {
      ...settings,
      providerConfigs: settings.providerConfigs.map(config => ({
        ...config,
        config: {
          ...config.config,
          password: config.config.password ? '***' : '',
          apiKey: config.config.apiKey ? '***' : ''
        }
      }))
    };

    return toEmailSettingsView(sanitizedSettings, knex, tenant || '');
  } catch (error: any) {
    console.error('Error fetching email settings:', error);
    return actionError('Failed to fetch email settings', 'msp/email-providers:errors.settings.fetchFailed');
  }
});

export const updateEmailSettings = withAuth(async (
  user,
  { tenant },
  updates: EmailSettingsUpdateInput
): Promise<EmailSettingsView | ActionMessageError> => {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'settings', 'update', knex)) return actionError('You do not have permission to update email settings', 'errors.permissionDenied');

  try {
    const now = new Date();

    // Load current settings so we can merge partial updates safely
    const existingSettings = await TenantEmailService.getTenantEmailSettings(tenant || '', knex);
    let nextDefaultFromDomain = hasOwnUpdate(updates, 'defaultFromDomain')
      ? updates.defaultFromDomain?.trim() || undefined
      : existingSettings?.defaultFromDomain;

    let mergedProviderConfigs = updates.providerConfigs
      ? mergeProviderSecrets(updates.providerConfigs, existingSettings?.providerConfigs)
      : existingSettings?.providerConfigs ?? [];
    const selectedProviderType = updates.emailProvider ?? existingSettings?.emailProvider ?? 'smtp';

    if (selectedProviderType === 'microsoft') {
      const requested = mergedProviderConfigs.find(config => config.providerType === 'microsoft');
      const requestedProviderId = requested?.config?.inboundProviderId || requested?.providerId;
      if (!requestedProviderId || requestedProviderId === 'microsoft-provider') {
        return actionError('Choose a Microsoft 365 mailbox for outbound email', 'msp/email-providers:errors.settings.mailboxRequired');
      }

      const microsoftProvider = await tenantDb(knex, tenant).table('email_providers')
        .where({
          id: requestedProviderId,
          provider_type: 'microsoft',
          is_active: true,
        })
        .first('id', 'mailbox', 'provider_name', 'sender_display_name', 'status');

      if (!microsoftProvider) {
        return actionError('The selected Microsoft 365 mailbox is not active or no longer exists', 'msp/email-providers:errors.settings.mailboxInactive');
      }
      if (microsoftProvider.status !== 'connected') {
        return actionError('Reconnect the selected Microsoft 365 mailbox before using it for outbound email', 'msp/email-providers:errors.settings.mailboxReconnect');
      }

      const notificationFromName = normalizeOptionalString(
        requested?.config?.fromName ?? requested?.config?.from_name
      );

      const microsoftConfig: EmailProviderConfig = {
        providerId: microsoftProvider.id,
        providerType: 'microsoft',
        isEnabled: true,
        config: {
          inboundProviderId: microsoftProvider.id,
          mailbox: microsoftProvider.mailbox,
          from: microsoftProvider.mailbox,
          fromName: notificationFromName || undefined,
        },
      };
      mergedProviderConfigs = [
        ...mergedProviderConfigs.filter(config => config.providerType !== 'microsoft'),
        microsoftConfig,
      ];
      nextDefaultFromDomain = extractDomain(microsoftProvider.mailbox) || undefined;
    }

    const normalizedProviderConfigs = mergedProviderConfigs.map(config => ({
      ...config,
      isEnabled: config.providerType === selectedProviderType,
    }));

    const senderRows = await tenantDb(knex, tenant || '').table('email_sender_addresses').select('*');
    const invalidSenders: string[] = [];
    for (const sender of senderRows) {
      if (selectedProviderType === 'resend') {
        const domain = extractDomain(sender.email_address);
        const verifiedDomain = domain && await tenantDb(knex, tenant || '').table('email_domains')
          .where({ domain_name: domain, status: 'verified' }).first('domain_name');
        if (!verifiedDomain) invalidSenders.push(sender.email_address);
      } else if (selectedProviderType === 'microsoft') {
        const provider = sender.microsoft_provider_id && await tenantDb(knex, tenant || '').table('email_providers')
          .where({ id: sender.microsoft_provider_id, provider_type: 'microsoft', is_active: true, status: 'connected' }).first('id');
        if (!provider) invalidSenders.push(sender.email_address);
      } else if (selectedProviderType === 'smtp' && !isValidEmail(sender.email_address)) {
        invalidSenders.push(sender.email_address);
      }
    }
    if (invalidSenders.length) {
      return actionError(`Cannot change transport. These sender addresses would no longer work: ${invalidSenders.join(', ')}`, 'msp/email-providers:errors.settings.transportInvalidatesSenders', { senders: invalidSenders.join(', ') });
    }

    const mergedSettings: TenantEmailSettings = {
      tenantId: tenant || '',
      defaultFromDomain: nextDefaultFromDomain,
      customDomains: updates.customDomains ?? existingSettings?.customDomains ?? [],
      emailProvider: selectedProviderType,
      providerConfigs: normalizedProviderConfigs,
      trackingEnabled: updates.trackingEnabled ?? existingSettings?.trackingEnabled ?? false,
      maxDailyEmails: updates.maxDailyEmails ?? existingSettings?.maxDailyEmails,
      createdAt: existingSettings?.createdAt ?? now,
      updatedAt: now
    };

    // Reject malformed sender data before it persists: a junk config.from
    // propagates into default_from_domain and every synthesized fallback sender.
    // Only the fields present in this update are checked, so tenants carrying
    // legacy junk can still save unrelated settings.
    if (updates.providerConfigs) {
      // Provider switches resend stored configs verbatim, so an unchanged
      // (possibly legacy-junk) From must pass — only new values are checked.
      const existingFromByType = new Map(
        (existingSettings?.providerConfigs ?? []).map(config => [
          config.providerType,
          typeof config.config?.from === 'string' ? config.config.from.trim() : '',
        ])
      );
      for (const config of normalizedProviderConfigs) {
        const configFrom = typeof config.config?.from === 'string' ? config.config.from.trim() : '';
        if (!configFrom || isValidEmail(configFrom)) {
          continue;
        }
        if (configFrom === existingFromByType.get(config.providerType)) {
          continue;
        }
        return actionError(
          `The ${config.providerType} From address must be a valid email address`,
          'msp/email-providers:errors.settings.providerFromAddressInvalid',
          { provider: config.providerType },
        );
      }
    }
    const targetDomain = mergedSettings.defaultFromDomain?.trim().toLowerCase();
    // Same schema as the address checks: a domain is valid iff an address on it is.
    if (hasOwnUpdate(updates, 'defaultFromDomain') && targetDomain && !isValidEmail(`sender@${targetDomain}`)) {
      return actionError('Outbound sending domain must be a valid domain (e.g. example.com)', 'msp/email-providers:errors.settings.outboundDomainInvalid');
    }
    // Prepare data for database
    const settingsData = {
      tenant: tenant,
      default_from_domain: mergedSettings.defaultFromDomain ?? null,
      custom_domains: JSON.stringify(mergedSettings.customDomains || []),
      email_provider: mergedSettings.emailProvider,
      provider_configs: JSON.stringify(mergedSettings.providerConfigs || []),
      tracking_enabled: mergedSettings.trackingEnabled,
      max_daily_emails: mergedSettings.maxDailyEmails,
      updated_at: now
    };

    const settingsTable = () => tenantDb(knex, tenant).table('tenant_email_settings');

    // Check if settings exist
    const existing = await settingsTable().first();

    if (existing) {
      // Update existing settings
      await settingsTable().update(settingsData);
    } else {
      // Create new settings
      await settingsTable()
        .insert({
          ...settingsData,
          created_at: now
        });
    }

    // Refresh any process-local singleton immediately. TenantEmailService also
    // checks persisted settings before every send, covering other processes and
    // direct database updates without broad/global cache invalidation.
    await TenantEmailService.invalidateTenantSettings(tenant || '');

    // Re-fetch and return updated settings
    const updatedSettings = await getEmailSettings();
    if (isActionMessageError(updatedSettings)) {
      return updatedSettings;
    }
    if (!updatedSettings) {
      return actionError('Failed to retrieve updated settings', 'msp/email-providers:errors.settings.refreshFailed');
    }
    
    return updatedSettings;
  } catch (error: any) {
    console.error('Error updating email settings:', error);
    return actionError('Failed to update email settings', 'msp/email-providers:errors.settings.updateFailed');
  }
});

export const getMicrosoftOutboundMailboxes = withAuth(async (
  _user,
  { tenant }
): Promise<{ mailboxes: MicrosoftOutboundMailboxOption[] } | ActionMessageError> => {
  try {
    const { knex } = await createTenantKnex();
    const rows = await tenantDb(knex, tenant).table('email_providers')
      .where({ provider_type: 'microsoft', is_active: true })
      .orderBy('provider_name', 'asc')
      .select('id', 'mailbox', 'provider_name', 'sender_display_name', 'status');

    return {
      mailboxes: rows.map(row => ({
        providerId: row.id,
        mailbox: row.mailbox,
        providerName: row.provider_name,
        senderDisplayName: row.sender_display_name,
        status: row.status,
      })),
    };
  } catch (error) {
    console.error('Error fetching Microsoft outbound mailboxes:', error);
    return actionError('Failed to load Microsoft 365 mailboxes', 'msp/email-providers:errors.settings.mailboxesLoadFailed');
  }
});

/**
 * Verify the saved outbound provider (and optionally send a test email to the
 * given address). Returns the real failure reason so admins can diagnose SMTP
 * problems from the Outbound Email tab without reading server logs.
 */
export const testOutboundEmail = withAuth(async (
  _user,
  { tenant },
  toAddress?: string
): Promise<{ success: boolean; message?: string; error?: string }> => {
  try {
    const recipient = toAddress?.trim() || undefined;
    return await TenantEmailService.testConnection(tenant || '', recipient);
  } catch (error: any) {
    console.error('Error testing outbound email:', error);
    return { success: false, error: 'Failed to test outbound email' };
  }
});
