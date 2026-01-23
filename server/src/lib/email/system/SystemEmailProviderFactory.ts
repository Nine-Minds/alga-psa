import logger from '@alga-psa/core/logger';
import { IEmailProvider, EmailProviderConfig } from '../../../types/email.types';
import { SMTPEmailProvider } from '../../../services/email/providers/SMTPEmailProvider';
import { ResendEmailProvider } from '@alga-psa/integrations/email/domains/providers/ResendEmailProvider';

export interface SystemEmailProviderConfig {
  providerType: 'smtp' | 'resend';
  config: Record<string, any>;
}

/**
 * Factory for creating email providers for the system email service
 * Uses environment variables to determine which provider to create
 */
export class SystemEmailProviderFactory {
  /**
   * Create an email provider based on environment configuration
   */
  static async createProvider(): Promise<IEmailProvider | null> {
    const isEnabled = process.env.EMAIL_ENABLE === 'true';
    console.log('EMAIL_ENABLE: ', process.env.EMAIL_ENABLE);
    
    if (!isEnabled) {
      logger.info('[SystemEmailProviderFactory] Email service is disabled');
      return null;
    }

    const providerType = process.env.EMAIL_PROVIDER_TYPE || this.detectProviderType();
    const providerId = 'system-email-provider';

    logger.info(`[SystemEmailProviderFactory] Creating ${providerType} provider`);

    try {
      let provider: IEmailProvider;

      switch (providerType) {
        case 'resend':
          provider = await this.createResendProvider(providerId);
          break;
        case 'smtp':
        default:
          provider = await this.createSMTPProvider(providerId);
          break;
      }

      logger.info(`[SystemEmailProviderFactory] Successfully created ${providerType} provider`);
      return provider;
    } catch (error) {
      logger.error('[SystemEmailProviderFactory] Failed to create provider:', error);
      throw error;
    }
  }

  /**
   * Detect provider type based on environment variables
   */
  private static detectProviderType(): 'smtp' | 'resend' {
    // If Resend API key is present, use Resend
    if (process.env.RESEND_API_KEY) {
      return 'resend';
    }

    // Default to SMTP
    return 'smtp';
  }

  /**
   * Create SMTP provider from environment variables
   */
  private static async createSMTPProvider(providerId: string): Promise<IEmailProvider> {
    const config = {
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_PORT === '465',
      username: process.env.EMAIL_USERNAME || process.env.EMAIL_USER,
      password: process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS,
      from: process.env.EMAIL_FROM || 'noreply@example.com',
      rejectUnauthorized: process.env.EMAIL_REJECT_UNAUTHORIZED !== 'false',
      requireTLS: process.env.EMAIL_REQUIRE_TLS === 'true'
    };

    // Validate required fields
    if (!config.host || !config.username || !config.password) {
      throw new Error('Missing required SMTP configuration: host, username, and password are required');
    }

    const provider = new SMTPEmailProvider(providerId);
    await provider.initialize(config);
    return provider;
  }

  /**
   * Create Resend provider from environment variables
   */
  private static async createResendProvider(providerId: string): Promise<IEmailProvider> {
    const apiKey = process.env.RESEND_API_KEY;
    
    if (!apiKey) {
      throw new Error('Missing required Resend API key. Please set RESEND_API_KEY environment variable.');
    }

    const config = {
      apiKey,
      baseUrl: process.env.RESEND_BASE_URL,
      defaultFromDomain: this.extractDomainFromEmail(process.env.EMAIL_FROM)
    };

    const provider = new ResendEmailProvider(providerId);
    await provider.initialize(config);
    return provider;
  }

  /**
   * Extract domain from email address
   */
  private static extractDomainFromEmail(email?: string): string | undefined {
    if (!email) return undefined;
    const match = email.match(/@(.+)$/);
    return match ? match[1] : undefined;
  }

  /**
   * Get provider configuration for logging (with sensitive data masked)
   */
  static getProviderConfigSummary(): Record<string, any> {
    const isEnabled = process.env.EMAIL_ENABLE === 'true';
    
    if (!isEnabled) {
      return { enabled: false };
    }

    const providerType = process.env.EMAIL_PROVIDER_TYPE || this.detectProviderType();
    
    const summary: Record<string, any> = {
      enabled: true,
      providerType,
      from: process.env.EMAIL_FROM
    };

    if (providerType === 'smtp') {
      summary.host = process.env.EMAIL_HOST;
      summary.port = process.env.EMAIL_PORT;
      summary.secure = process.env.EMAIL_PORT === '465';
      summary.username = process.env.EMAIL_USERNAME || process.env.EMAIL_USER;
    } else if (providerType === 'resend') {
      summary.hasApiKey = !!process.env.RESEND_API_KEY;
      summary.defaultFromDomain = this.extractDomainFromEmail(process.env.EMAIL_FROM);
    }

    return summary;
  }
}
