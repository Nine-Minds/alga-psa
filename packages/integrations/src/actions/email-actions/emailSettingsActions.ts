/**
 * Server actions for email settings management
 */

'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { EmailProviderConfig, TenantEmailSettings } from '@alga-psa/types';
import { TenantEmailService } from '@alga-psa/email';

type EmailSettingsUpdateInput = Partial<TenantEmailSettings> & {
  defaultFromDomain?: string | null;
  ticketingFromEmail?: string | null;
  ticketingFromName?: string | null;
};

// getEmailSettings masks stored secrets as this sentinel so they are never
// sent to the browser. On save it means "unchanged" — restore the real value.
const SECRET_MASK = '***';
const SECRET_FIELDS = ['password', 'apiKey'] as const;

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

export const getEmailSettings = withAuth(async (
  _user,
  { tenant }
): Promise<TenantEmailSettings | null> => {
  const { knex } = await createTenantKnex();

  try {
    // Use TenantEmailService to get email settings
    const settings = await TenantEmailService.getTenantEmailSettings(tenant || '', knex);

    if (!settings) {
      // Return default settings if none exist
      const defaultSettings: TenantEmailSettings = {
        tenantId: tenant || '',
        defaultFromDomain: process.env.EMAIL_FROM ? extractDomain(process.env.EMAIL_FROM) || undefined : undefined,
        ticketingFromEmail: undefined,
        ticketingFromName: null,
        customDomains: [],
        emailProvider: 'smtp',
        providerConfigs: [
          {
            providerId: 'default-smtp',
            providerType: 'smtp',
            isEnabled: true,
            config: {
              host: process.env.EMAIL_HOST || '',
              port: parseInt(process.env.EMAIL_PORT || '587'),
              username: process.env.EMAIL_USERNAME || '',
              password: '', // Don't expose password
              from: process.env.EMAIL_FROM || ''
            }
          }
        ],
        trackingEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      return defaultSettings;
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

    return sanitizedSettings;
  } catch (error: any) {
    console.error('Error fetching email settings:', error);
    throw new Error('Failed to fetch email settings');
  }
});

export const updateEmailSettings = withAuth(async (
  _user,
  { tenant },
  updates: EmailSettingsUpdateInput
): Promise<TenantEmailSettings> => {
  const { knex } = await createTenantKnex();

  try {
    const now = new Date();

    // Load current settings so we can merge partial updates safely
    const existingSettings = await TenantEmailService.getTenantEmailSettings(tenant || '', knex);
    const nextDefaultFromDomain = hasOwnUpdate(updates, 'defaultFromDomain')
      ? updates.defaultFromDomain?.trim() || undefined
      : existingSettings?.defaultFromDomain;
    const nextTicketingFromEmail = hasOwnUpdate(updates, 'ticketingFromEmail')
      ? updates.ticketingFromEmail?.trim() || null
      : existingSettings?.ticketingFromEmail ?? null;
    const nextTicketingFromName = hasOwnUpdate(updates, 'ticketingFromName')
      ? normalizeOptionalString(updates.ticketingFromName)
      : existingSettings?.ticketingFromName ?? null;

    const mergedSettings: TenantEmailSettings = {
      tenantId: tenant || '',
      defaultFromDomain: nextDefaultFromDomain,
      ticketingFromEmail: nextTicketingFromEmail,
      ticketingFromName: nextTicketingFromName,
      customDomains: updates.customDomains ?? existingSettings?.customDomains ?? [],
      emailProvider: updates.emailProvider ?? existingSettings?.emailProvider ?? 'smtp',
      providerConfigs: updates.providerConfigs
        ? mergeProviderSecrets(updates.providerConfigs, existingSettings?.providerConfigs)
        : existingSettings?.providerConfigs ?? [],
      trackingEnabled: updates.trackingEnabled ?? existingSettings?.trackingEnabled ?? false,
      maxDailyEmails: updates.maxDailyEmails ?? existingSettings?.maxDailyEmails,
      createdAt: existingSettings?.createdAt ?? now,
      updatedAt: now
    };

    const targetDomain = mergedSettings.defaultFromDomain?.trim().toLowerCase();
    if (mergedSettings.ticketingFromEmail) {
      if (!targetDomain) {
        throw new Error('Configure an outbound domain before choosing a ticketing From address');
      }

      const fromDomain = extractDomain(mergedSettings.ticketingFromEmail);
      if (!fromDomain || fromDomain !== targetDomain) {
        throw new Error('Ticketing From address must use the configured outbound domain');
      }
    }

    // Prepare data for database
    const settingsData = {
      tenant: tenant,
      default_from_domain: mergedSettings.defaultFromDomain ?? null,
      ticketing_from_email: mergedSettings.ticketingFromEmail || null,
      ticketing_from_name: mergedSettings.ticketingFromName || null,
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

    // Re-fetch and return updated settings
    const updatedSettings = await getEmailSettings();
    if (!updatedSettings) {
      throw new Error('Failed to retrieve updated settings');
    }
    
    return updatedSettings;
  } catch (error: any) {
    console.error('Error updating email settings:', error);
    throw new Error('Failed to update email settings');
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
    return { success: false, error: error?.message || 'Failed to test outbound email' };
  }
});
