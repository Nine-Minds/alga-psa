import nodemailer from 'nodemailer';
import { getSecret } from '../utils/getSecret';
import { EMAIL_EVENT_CHANNEL, getEmailEventChannel as getEmailChannelConstant } from './emailChannel';

interface EmailConfig {
  // Email server configuration
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  isEnabled: boolean;
}

class EmailService {
  private static instance: EmailService;
  private transporter: nodemailer.Transporter | null = null;
  private config: EmailConfig | null = null;
  private initialized: boolean = false;

  private constructor() {} // Private constructor for singleton pattern

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  private async initializeConfig() {
    console.log('[EmailService] Starting email service configuration');
    const isEnabled = process.env.EMAIL_ENABLE === 'true';
    
    console.log('[EmailService] Email service enabled status:', {
      EMAIL_ENABLE: process.env.EMAIL_ENABLE,
      isEnabled
    });
    
    if (!isEnabled) {
      console.log('[EmailService] Email notifications are disabled via EMAIL_ENABLE environment variable');
      return;
    }

    const host = process.env.EMAIL_HOST;
    const port = parseInt(process.env.EMAIL_PORT || '587', 10);
    const username = process.env.EMAIL_USERNAME;
    const password = await getSecret('email_password', 'EMAIL_PASSWORD');
    const from = process.env.EMAIL_FROM;

    console.log('[EmailService] Email configuration values:', {
      host,
      port,
      username,
      from,
      hasPassword: !!password
    });

    const missingConfigs: string[] = [];
    if (!host) missingConfigs.push('EMAIL_HOST');
    if (!username) missingConfigs.push('EMAIL_USERNAME');
    if (!password) missingConfigs.push('EMAIL_PASSWORD');
    if (!from) missingConfigs.push('EMAIL_FROM');

    if (missingConfigs.length > 0) {
      console.error('[EmailService] Missing required email configuration:', {
        missingFields: missingConfigs.join(', '),
        availableEnvVars: Object.keys(process.env).filter(key => key.startsWith('EMAIL_'))
      });
      console.error('[EmailService] Please set all required environment variables to enable email functionality');
      return;
    }

    // We can safely assert these as strings since we've checked they exist above
    this.config = {
      host: host!,
      port,
      username: username!,
      password: password!,
      from: from!,
      isEnabled
    };

    this.initializeTransporter();
  }

  private async initializeTransporter() {
    if (!this.config) {
      console.log('[EmailService] Cannot initialize transporter - missing configuration');
      return;
    }

    console.log('[EmailService] Initializing email transporter:', {
      host: this.config.host,
      port: this.config.port,
      secure: this.config.port === 465,
      username: this.config.username
    });

    try {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.port === 465,
        auth: {
          user: this.config.username,
          pass: this.config.password
        }
      });

      // Verify transporter configuration
      console.log('[EmailService] Verifying transporter configuration...');
      await this.transporter.verify();
      console.log('[EmailService] Transporter verified successfully');
    } catch (error) {
      console.error('[EmailService] Failed to initialize transporter:', {
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      });
      this.transporter = null;
    }
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await this.initializeConfig();
    this.initialized = true;
  }

  public async sendEmail(params: {
    to: string;
    subject: string;
    template?: string;
    data?: Record<string, any>;
    html?: string;
    text?: string;
  }): Promise<boolean> {
    console.log('[EmailService] Attempting to send email:', {
      to: params.to,
      subject: params.subject,
      hasTemplate: !!params.template,
      hasData: !!params.data,
      hasHtml: !!params.html,
      hasText: !!params.text
    });

    // Enhanced diagnostics
    const diagnostics = {
      hasConfig: !!this.config,
      configIsEnabled: this.config?.isEnabled,
      hasTransporter: !!this.transporter,
      isInitialized: this.initialized,
      configDetails: this.config ? {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        from: this.config.from
      } : null
    };

    console.log('[EmailService - notifications] Service state diagnostics:', diagnostics);

    if (!this.config?.isEnabled) {
      console.log('[EmailService - notifications] Service disabled - config.isEnabled is false:', {
        EMAIL_ENABLE_ENV: process.env.EMAIL_ENABLE,
        configIsEnabled: this.config?.isEnabled,
        hasConfig: !!this.config
      });
      return false;
    }

    if (!this.transporter) {
      console.log('[EmailService - notifications] Service disabled - transporter is null:', {
        hasConfig: !!this.config,
        transporterValue: this.transporter,
        initializationAttempted: this.initialized
      });
      return false;
    }

    try {
      let html = params.html;
      let text = params.text;

      // If template is provided, compile it with data
      if (params.template && params.data) {
        console.log('[EmailService] Compiling template with data:', {
          template: params.template.substring(0, 100) + '...',
          dataKeys: Object.keys(params.data)
        });

        const { html: compiledHtml, text: compiledText } = await this.compileTemplate(params.template, params.data);
        html = compiledHtml;
        text = compiledText;

        console.log('[EmailService] Template compiled successfully:', {
          htmlLength: html.length,
          textLength: text.length
        });
      }

      if (!html || !text) {
        console.error('[EmailService] Missing content:', {
          hasHtml: !!html,
          hasText: !!text
        });
        throw new Error('Either template or html/text content must be provided');
      }

      console.log('[EmailService] Sending email via transporter:', {
        from: this.config.from,
        to: params.to,
        subject: params.subject,
        htmlLength: html.length,
        textLength: text.length
      });

      const result = await this.transporter.sendMail({
        from: this.config.from,
        to: params.to,
        subject: params.subject,
        html,
        text
      });

      console.log('[EmailService] Email sent successfully:', {
        messageId: result.messageId,
        response: result.response
      });

      return true;
    } catch (error) {
      console.error('Failed to send email:', error);
      return false;
    }
  }

  private async compileTemplate(template: string, data: Record<string, any>): Promise<{ html: string; text: string }> {
    // Dynamically import Handlebars only when needed
    const Handlebars = (await import('handlebars')).default;
    
    const htmlTemplate = Handlebars.compile(template);
    const html = htmlTemplate(data);
    
    // Generate text version by stripping HTML
    const text = html.replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
      
    return { html, text };
  }

  public isConfigured(): boolean {
    return this.config?.isEnabled === true && this.transporter !== null;
  }
}

// Singleton instance
export function getEmailService(): EmailService {
  return EmailService.getInstance();
}

export function getEmailEventChannel(): string {
  return getEmailChannelConstant();
}

// Re-export the event-based email sending function
export { sendEventEmail } from './sendEventEmail';

// Export types
export type { SendEmailParams } from './sendEventEmail';
