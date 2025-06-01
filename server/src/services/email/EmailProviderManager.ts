/**
 * Email Provider Manager - Handles multiple email providers with fallback support
 */

import logger from '@shared/core/logger.js';
import {
  IEmailProvider,
  IEmailProviderManager,
  EmailMessage,
  EmailSendResult,
  TenantEmailSettings,
  EmailProviderError,
  EmailProviderConfig
} from '../../types/email.types.js';

export class EmailProviderManager implements IEmailProviderManager {
  private providers: Map<string, IEmailProvider> = new Map();
  private tenantSettings: Map<string, TenantEmailSettings> = new Map();
  private providerStats: Map<string, {
    successCount: number;
    failureCount: number;
    lastFailure?: Date;
    consecutiveFailures: number;
  }> = new Map();

  constructor() {
    logger.info('[EmailProviderManager] Initializing email provider manager');
  }

  async initialize(tenantSettings: TenantEmailSettings): Promise<void> {
    const tenantId = tenantSettings.tenantId;
    logger.info(`[EmailProviderManager] Initializing for tenant: ${tenantId}`);
    
    this.tenantSettings.set(tenantId, tenantSettings);
    
    // Initialize providers based on tenant configuration
    for (const providerConfig of tenantSettings.providerConfigs) {
      if (providerConfig.isEnabled) {
        try {
          const provider = await this.createProvider(providerConfig);
          await provider.initialize(providerConfig.config);
          this.providers.set(provider.providerId, provider);
          
          // Initialize stats tracking
          this.providerStats.set(provider.providerId, {
            successCount: 0,
            failureCount: 0,
            consecutiveFailures: 0
          });
          
          logger.info(`[EmailProviderManager] Initialized provider: ${provider.providerId} (${provider.providerType})`);
        } catch (error: any) {
          logger.error(`[EmailProviderManager] Failed to initialize provider ${providerConfig.providerId}:`, error);
        }
      }
    }
    
    logger.info(`[EmailProviderManager] Initialized ${this.providers.size} providers for tenant ${tenantId}`);
  }

  async sendEmail(message: EmailMessage, tenantId: string): Promise<EmailSendResult> {
    const providers = await this.getOrderedProviders(tenantId);
    
    if (providers.length === 0) {
      throw new EmailProviderError(
        'No email providers available',
        'manager',
        'manager',
        false,
        'NO_PROVIDERS'
      );
    }

    let lastError: EmailProviderError | undefined;
    
    for (const provider of providers) {
      try {
        // Check if provider is healthy before attempting to send
        if (await this.isProviderHealthy(provider.providerId)) {
          logger.info(`[EmailProviderManager] Attempting to send email via ${provider.providerId}`);
          
          const result = await provider.sendEmail(message, tenantId);
          
          if (result.success) {
            this.recordSuccess(provider.providerId);
            logger.info(`[EmailProviderManager] Email sent successfully via ${provider.providerId}, messageId: ${result.messageId}`);
            return result;
          } else {
            this.recordFailure(provider.providerId);
            logger.warn(`[EmailProviderManager] Email send failed via ${provider.providerId}: ${result.error}`);
            lastError = new EmailProviderError(
              result.error || 'Unknown error',
              provider.providerId,
              provider.providerType,
              true
            );
          }
        } else {
          logger.warn(`[EmailProviderManager] Skipping unhealthy provider: ${provider.providerId}`);
        }
      } catch (error: any) {
        this.recordFailure(provider.providerId);
        logger.error(`[EmailProviderManager] Provider ${provider.providerId} threw exception:`, error);
        
        lastError = error instanceof EmailProviderError 
          ? error 
          : new EmailProviderError(
              error.message,
              provider.providerId,
              provider.providerType,
              true
            );
      }
    }
    
    // All providers failed
    const finalError = lastError || new EmailProviderError(
      'All email providers failed',
      'manager',
      'manager',
      false,
      'ALL_PROVIDERS_FAILED'
    );
    
    logger.error(`[EmailProviderManager] All providers failed for tenant ${tenantId}:`, finalError);
    throw finalError;
  }

  async sendBulkEmails(messages: EmailMessage[], tenantId: string): Promise<EmailSendResult[]> {
    const providers = await this.getOrderedProviders(tenantId);
    
    if (providers.length === 0) {
      throw new EmailProviderError(
        'No email providers available',
        'manager',
        'manager',
        false,
        'NO_PROVIDERS'
      );
    }

    // For bulk emails, try to use providers that support bulk operations first
    const bulkProviders = providers.filter(p => p.capabilities.supportsBulkSending);
    const singleProviders = providers.filter(p => !p.capabilities.supportsBulkSending);
    
    const orderedProviders = [...bulkProviders, ...singleProviders];
    
    for (const provider of orderedProviders) {
      try {
        if (await this.isProviderHealthy(provider.providerId)) {
          logger.info(`[EmailProviderManager] Attempting bulk send via ${provider.providerId} (${messages.length} messages)`);
          
          let results: EmailSendResult[];
          
          if (provider.sendBulkEmails && provider.capabilities.supportsBulkSending) {
            results = await provider.sendBulkEmails(messages, tenantId);
          } else {
            // Fallback to individual sends
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
          
          // Update stats
          this.updateStats(provider.providerId, successCount, failureCount);
          
          return results;
        }
      } catch (error: any) {
        this.recordFailure(provider.providerId);
        logger.error(`[EmailProviderManager] Bulk send failed via ${provider.providerId}:`, error);
      }
    }
    
    throw new EmailProviderError(
      'All providers failed for bulk email send',
      'manager',
      'manager',
      false,
      'BULK_SEND_FAILED'
    );
  }

  async getAvailableProviders(tenantId: string): Promise<IEmailProvider[]> {
    const settings = this.tenantSettings.get(tenantId);
    if (!settings) {
      return [];
    }
    
    const availableProviders: IEmailProvider[] = [];
    
    for (const config of settings.providerConfigs) {
      if (config.isEnabled) {
        const provider = this.providers.get(config.providerId);
        if (provider) {
          availableProviders.push(provider);
        }
      }
    }
    
    return availableProviders;
  }

  async getProvidersHealth(tenantId: string): Promise<Array<{
    providerId: string;
    healthy: boolean;
    details?: string;
  }>> {
    const providers = await this.getAvailableProviders(tenantId);
    const healthStatus: Array<{
      providerId: string;
      healthy: boolean;
      details?: string;
    }> = [];
    
    for (const provider of providers) {
      try {
        const health = await provider.healthCheck();
        healthStatus.push({
          providerId: provider.providerId,
          healthy: health.healthy,
          details: health.details
        });
      } catch (error: any) {
        healthStatus.push({
          providerId: provider.providerId,
          healthy: false,
          details: `Health check failed: ${error.message}`
        });
      }
    }
    
    return healthStatus;
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
    
    // Re-initialize providers if provider configs changed
    if (settings.providerConfigs) {
      await this.initialize(updatedSettings);
    }
    
    logger.info(`[EmailProviderManager] Updated settings for tenant: ${tenantId}`);
  }

  private async createProvider(config: EmailProviderConfig): Promise<IEmailProvider> {
    // Dynamic provider creation based on type
    switch (config.providerType) {
      case 'smtp':
        const { SMTPEmailProvider } = await import('./providers/SMTPEmailProvider.js');
        return new SMTPEmailProvider(config.providerId);
      
      case 'resend':
        const { ResendEmailProvider } = await import('./providers/ResendEmailProvider.js');
        return new ResendEmailProvider(config.providerId);
      
      default:
        throw new Error(`Unsupported provider type: ${config.providerType}`);
    }
  }

  private async getOrderedProviders(tenantId: string): Promise<IEmailProvider[]> {
    const settings = this.tenantSettings.get(tenantId);
    if (!settings) {
      return [];
    }
    
    const availableProviders: Array<{
      provider: IEmailProvider;
      config: EmailProviderConfig;
      stats: any;
    }> = [];
    
    for (const config of settings.providerConfigs) {
      if (config.isEnabled) {
        const provider = this.providers.get(config.providerId);
        const stats = this.providerStats.get(config.providerId);
        
        if (provider && stats) {
          availableProviders.push({ provider, config, stats });
        }
      }
    }
    
    // Sort by priority first, then by health/reliability
    availableProviders.sort((a, b) => {
      // Primary sort: priority (lower number = higher priority)
      if (a.config.priority !== b.config.priority) {
        return a.config.priority - b.config.priority;
      }
      
      // Secondary sort: consecutive failures (fewer failures = higher priority)
      return a.stats.consecutiveFailures - b.stats.consecutiveFailures;
    });
    
    return availableProviders.map(item => item.provider);
  }

  private async isProviderHealthy(providerId: string): Promise<boolean> {
    const stats = this.providerStats.get(providerId);
    if (!stats) return false;
    
    // Consider provider unhealthy if it has more than 3 consecutive failures
    if (stats.consecutiveFailures > 3) {
      return false;
    }
    
    // Consider provider unhealthy if last failure was recent (within 5 minutes)
    if (stats.lastFailure && (Date.now() - stats.lastFailure.getTime()) < 5 * 60 * 1000) {
      return false;
    }
    
    return true;
  }

  private recordSuccess(providerId: string): void {
    const stats = this.providerStats.get(providerId);
    if (stats) {
      stats.successCount++;
      stats.consecutiveFailures = 0;
      this.providerStats.set(providerId, stats);
    }
  }

  private recordFailure(providerId: string): void {
    const stats = this.providerStats.get(providerId);
    if (stats) {
      stats.failureCount++;
      stats.consecutiveFailures++;
      stats.lastFailure = new Date();
      this.providerStats.set(providerId, stats);
    }
  }

  private updateStats(providerId: string, successCount: number, failureCount: number): void {
    const stats = this.providerStats.get(providerId);
    if (stats) {
      stats.successCount += successCount;
      stats.failureCount += failureCount;
      
      if (failureCount > 0) {
        stats.consecutiveFailures += failureCount;
        stats.lastFailure = new Date();
      } else {
        stats.consecutiveFailures = 0;
      }
      
      this.providerStats.set(providerId, stats);
    }
  }
}