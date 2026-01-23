/**
 * Server actions for email settings management
 */

'use server';

import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/users/actions';
import type { TenantEmailSettings } from '@alga-psa/types';
import { TenantEmailService } from '@alga-psa/email';

function extractDomain(address?: string | null): string | null {
  if (!address) return null;
  const parts = address.split('@');
  if (parts.length !== 2) return null;
  return parts[1]?.trim().toLowerCase() || null;
}

export async function getEmailSettings(): Promise<TenantEmailSettings | null> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();

  try {
    // Use TenantEmailService to get email settings
    const settings = await TenantEmailService.getTenantEmailSettings(tenant || '', knex);

    if (!settings) {
      // Return default settings if none exist
      const defaultSettings: TenantEmailSettings = {
        tenantId: tenant || '',
        defaultFromDomain: process.env.EMAIL_FROM ? extractDomain(process.env.EMAIL_FROM) || undefined : undefined,
        ticketingFromEmail: undefined,
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
}

export async function updateEmailSettings(updates: Partial<TenantEmailSettings>): Promise<TenantEmailSettings> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();

  try {
    const now = new Date();

    // Load current settings so we can merge partial updates safely
    const existingSettings = await TenantEmailService.getTenantEmailSettings(tenant || '', knex);

    const mergedSettings: TenantEmailSettings = {
      tenantId: tenant || '',
      defaultFromDomain: updates.defaultFromDomain ?? existingSettings?.defaultFromDomain,
      ticketingFromEmail: updates.ticketingFromEmail ?? existingSettings?.ticketingFromEmail ?? null,
      customDomains: updates.customDomains ?? existingSettings?.customDomains ?? [],
      emailProvider: updates.emailProvider ?? existingSettings?.emailProvider ?? 'smtp',
      providerConfigs: updates.providerConfigs ?? existingSettings?.providerConfigs ?? [],
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
      custom_domains: JSON.stringify(mergedSettings.customDomains || []),
      email_provider: mergedSettings.emailProvider,
      provider_configs: JSON.stringify(mergedSettings.providerConfigs || []),
      tracking_enabled: mergedSettings.trackingEnabled,
      max_daily_emails: mergedSettings.maxDailyEmails,
      updated_at: now
    };

    // Check if settings exist
    const existing = await knex('tenant_email_settings')
      .where({ tenant: tenant })
      .first();

    if (existing) {
      // Update existing settings
      await knex('tenant_email_settings')
        .where({ tenant: tenant })
        .update(settingsData);
    } else {
      // Create new settings
      await knex('tenant_email_settings')
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
}
