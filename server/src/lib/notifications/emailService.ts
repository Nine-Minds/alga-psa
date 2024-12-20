import nodemailer from 'nodemailer';
import Handlebars from 'handlebars';

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
  private transporter: nodemailer.Transporter | null = null;
  private config: EmailConfig | null = null;

  constructor() {
    this.initializeConfig();
  }

  private initializeConfig() {
    const isEnabled = process.env.EMAIL_ENABLE === 'true';
    
    if (!isEnabled) {
      console.log('Email notifications are disabled via EMAIL_ENABLE environment variable');
      return;
    }

    const host = process.env.EMAIL_HOST;
    const port = parseInt(process.env.EMAIL_PORT || '587', 10);
    const username = process.env.EMAIL_USERNAME;
    const password = process.env.EMAIL_PASSWORD;
    const from = process.env.EMAIL_FROM;

    if (!host || !username || !password || !from) {
      console.error('Missing required email configuration. Check EMAIL_HOST, EMAIL_USERNAME, EMAIL_PASSWORD, and EMAIL_FROM environment variables.');
      return;
    }

    this.config = {
      host,
      port,
      username,
      password,
      from,
      isEnabled
    };

    this.initializeTransporter();
  }

  private initializeTransporter() {
    if (!this.config) return;

    this.transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.port === 465,
      auth: {
        user: this.config.username,
        pass: this.config.password
      }
    });
  }

  public async sendEmail(params: {
    to: string;
    subject: string;
    template?: string;
    data?: Record<string, any>;
    html?: string;
    text?: string;
  }): Promise<boolean> {
    if (!this.config?.isEnabled || !this.transporter) {
      console.log('Email service is not enabled or not properly configured');
      return false;
    }

    try {
      let html = params.html;
      let text = params.text;

      // If template is provided, compile it with data
      if (params.template && params.data) {
        const htmlTemplate = Handlebars.compile(params.template);
        html = htmlTemplate(params.data);
        
        // Generate text version by stripping HTML
        text = html.replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }

      if (!html || !text) {
        throw new Error('Either template or html/text content must be provided');
      }

      await this.transporter.sendMail({
        from: this.config.from,
        to: params.to,
        subject: params.subject,
        html,
        text
      });
      return true;
    } catch (error) {
      console.error('Failed to send email:', error);
      return false;
    }
  }

  public isConfigured(): boolean {
    return this.config?.isEnabled === true && this.transporter !== null;
  }
}

// Export singleton instance
export const emailService = new EmailService();
