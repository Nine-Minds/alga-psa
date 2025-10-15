/**
 * Server actions for email settings management
 */

'use server';

import { createTenantKnex } from '../../db';
import { getCurrentUser } from '../user-actions/userActions';
import { TenantEmailSettings, EmailProviderConfig } from '../../../types/email.types';
import { TenantEmailService } from '../../services/TenantEmailService';

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
    
    // Prepare data for database
    const settingsData = {
      tenant: tenant,
      default_from_domain: updates.defaultFromDomain,
      custom_domains: JSON.stringify(updates.customDomains || []),
      email_provider: updates.emailProvider,
      provider_configs: JSON.stringify(updates.providerConfigs || []),
      tracking_enabled: updates.trackingEnabled,
      max_daily_emails: updates.maxDailyEmails,
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