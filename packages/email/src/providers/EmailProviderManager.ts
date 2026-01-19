/**
 * Email Provider Manager - Handles email provider configuration and sending
 */

import logger from '@alga-psa/core/logger';
import {
  IEmailProvider,
  IEmailProviderManager,
  EmailMessage,
  EmailSendResult,
  TenantEmailSettings,
  EmailProviderError,
  EmailProviderConfig,
} from '@alga-psa/types';

export class EmailProviderManager implements IEmailProviderManager {
  private providers: Map<string, IEmailProvider> = new Map(); // Key: tenantId (Active provider)
  private providerCache: Map<string, IEmailProvider> = new Map(); // Key: providerId (All initialized providers)
  private tenantSettings: Map<string, TenantEmailSettings> = new Map();

  constructor() {
    logger.info('[EmailProviderManager] Initializing email provider manager');
  }

  async initialize(tenantSettings: TenantEmailSettings): Promise<void> {
    const tenantId = tenantSettings.tenantId;
    logger.info(`[EmailProviderManager] Initializing for tenant: ${tenantId}`);
    
    this.tenantSettings.set(tenantId, tenantSettings);
    
    // Clear cache for this tenant's providers to ensure fresh config
    if (tenantSettings.providerConfigs) {
      for (const config of tenantSettings.providerConfigs) {
        this.providerCache.delete(config.providerId);
      }
    }
    
    // Find the first enabled provider
    const enabledConfig = tenantSettings.providerConfigs.find(config => config.isEnabled);
    
    if (enabledConfig) {
      try {
        logger.debug(`[EmailProviderManager] Initializing provider: ${enabledConfig.providerId} (${enabledConfig.providerType})`);
        
        const provider = await this.createProvider(enabledConfig);
        await provider.initialize(enabledConfig.config);
        this.providers.set(tenantId, provider);
        this.providerCache.set(enabledConfig.providerId, provider);
        
        logger.info(`[EmailProviderManager] Initialized provider: ${provider.providerId} (${provider.providerType}) for tenant ${tenantId}`);
      } catch (error: any) {
        logger.error(`[EmailProviderManager] Failed to initialize provider ${enabledConfig.providerId}:`, error);
        throw error;
      }
    } else {
      logger.warn(`[EmailProviderManager] No enabled provider found for tenant ${tenantId}`);
    }
  }

  async sendEmail(message: EmailMessage, tenantId: string): Promise<EmailSendResult> {
    const provider = this.providers.get(tenantId);
    
    if (!provider) {
      throw new EmailProviderError(
        'No email provider configured',
        'manager',
        'manager',
        false,
        'NO_PROVIDER'
      );
    }

    try {
      logger.info(`[EmailProviderManager] Sending email via ${provider.providerId}`);
      
      const result = await provider.sendEmail(message, tenantId);
      
      if (result.success) {
        logger.info(`[EmailProviderManager] Email sent successfully via ${provider.providerId}, messageId: ${result.messageId}`);
      } else {
        logger.warn(`[EmailProviderManager] Email send failed via ${provider.providerId}: ${result.error}`);
      }
      
      return result;
    } catch (error: any) {
      logger.error(`[EmailProviderManager] Provider ${provider.providerId} threw exception:`, error);
      
      throw error instanceof EmailProviderError 
        ? error 
        : new EmailProviderError(
            error.message,
            provider.providerId,
            provider.providerType,
            true
          );
    }
  }

  async sendBulkEmails(messages: EmailMessage[], tenantId: string): Promise<EmailSendResult[]> {
    const provider = this.providers.get(tenantId);
    
    if (!provider) {
      throw new EmailProviderError(
        'No email provider configured',
        'manager',
        'manager',
        false,
        'NO_PROVIDER'
      );
    }

    try {
      logger.info(`[EmailProviderManager] Attempting bulk send via ${provider.providerId} (${messages.length} messages)`);
      
      let results: EmailSendResult[];
      
      if (provider.sendBulkEmails && provider.capabilities.supportsBulkSending) {
        results = await provider.sendBulkEmails(messages, tenantId);
      } else {
        // Send individually if bulk not supported
        results = [];
        for (const message of messages) {
          try {
            const result = await provider.sendEmail(message, tenantId);
            results.push(result);
          } catch (error: any) {
            results.push({
              success: false,
              providerId: provider.providerId,
              providerType: provider.providerType,
              error: error.message,
              sentAt: new Date()
            });
          }
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;
      
      logger.info(`[EmailProviderManager] Bulk send completed via ${provider.providerId}: ${successCount} success, ${failureCount} failures`);
      
      return results;
    } catch (error: any) {
      logger.error(`[EmailProviderManager] Bulk send failed via ${provider.providerId}:`, error);
      throw error;
    }
  }

  async getAvailableProviders(tenantId: string): Promise<IEmailProvider[]> {
    const provider = this.providers.get(tenantId);
    return provider ? [provider] : [];
  }

  async getProvidersHealth(tenantId: string): Promise<Array<{
    providerId: string;
    healthy: boolean;
    details?: string;
  }>> {
    const provider = this.providers.get(tenantId);
    
    if (!provider) {
      return [];
    }
    
    try {
      const health = await provider.healthCheck();
      return [{
        providerId: provider.providerId,
        healthy: health.healthy,
        details: health.details
      }];
    } catch (error: any) {
      return [{
        providerId: provider.providerId,
        healthy: false,
        details: `Health check failed: ${error.message}`
      }];
    }
  }

  async updateTenantSettings(tenantId: string, settings: Partial<TenantEmailSettings>): Promise<void> {
    const currentSettings = this.tenantSettings.get(tenantId);
    if (!currentSettings) {
      throw new Error(`No settings found for tenant: ${tenantId}`);
    }
    
    const updatedSettings: TenantEmailSettings = {
      ...currentSettings,
      ...settings,
      updatedAt: new Date()
    };
    
    this.tenantSettings.set(tenantId, updatedSettings);
    
    // Re-initialize provider if provider configs changed
    if (settings.providerConfigs) {
      await this.initialize(updatedSettings);
    }
    
    logger.info(`[EmailProviderManager] Updated settings for tenant: ${tenantId}`);
  }

  private async createProvider(config: EmailProviderConfig): Promise<IEmailProvider> {
    // Dynamic provider creation based on type
    switch (config.providerType) {
      case 'smtp':
        const { SMTPEmailProvider } = await import('./SMTPEmailProvider');
        return new SMTPEmailProvider(config.providerId);
      
      case 'resend':
        // Prevent Vite/Vitest from trying to resolve this optional EE-only deep import at build time.
        const { ResendEmailProvider } = await import(
          /* @vite-ignore */ '@alga-psa/integrations/email/domains/providers/ResendEmailProvider'
        );
        return new ResendEmailProvider(config.providerId);
      
      default:
        throw new Error(`Unsupported provider type: ${config.providerType}`);
    }
  }
}
