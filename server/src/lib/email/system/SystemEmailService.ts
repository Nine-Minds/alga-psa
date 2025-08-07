import { 
  BaseEmailService,
  BaseEmailParams,
  EmailSendResult
} from '../BaseEmailService';
import { 
  SystemEmailTemplate,
  EmailVerificationData,
  PasswordResetData,
  SystemNotificationData
} from './types';
import { IEmailProvider } from '../../../types/email.types';
import { SystemEmailProviderFactory } from './SystemEmailProviderFactory';

// Extend BaseEmailParams for system-specific parameters
export interface SystemEmailParams extends BaseEmailParams {
  subject?: string;
  html?: string;
  text?: string;
}

/**
 * SystemEmailService - Handles platform-level emails using environment variables
 * 
 * This service is used for system emails that are NOT tenant-specific, such as:
 * - User registration/email verification
 * - Password reset
 * - System notifications
 * - Admin alerts
 * 
 * For tenant-specific business emails (invoices, portal invitations, etc.),
 * use TenantEmailService instead.
 */
export class SystemEmailService extends BaseEmailService {
  private static instance: SystemEmailService;
  private fromAddress: string | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): SystemEmailService {
    if (!SystemEmailService.instance) {
      SystemEmailService.instance = new SystemEmailService();
    }
    return SystemEmailService.instance;
  }

  protected getServiceName(): string {
    return 'SystemEmailService';
  }

  protected async getEmailProvider(): Promise<IEmailProvider | null> {
    // Set from address from environment
    this.fromAddress = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'noreply@localhost';
    
    // Create provider using factory
    return SystemEmailProviderFactory.createProvider();
  }

  protected getFromAddress(): string {
    return this.fromAddress || process.env.EMAIL_FROM || 'noreply@localhost';
  }

  /**
   * Override sendEmail to handle both direct params and template processor
   */
  public async sendEmail(params: SystemEmailParams): Promise<EmailSendResult> {
    // SystemEmailService can accept subject/html/text directly
    return super.sendEmail(params);
  }

  /**
   * Send email verification
   */
  public async sendEmailVerification(data: EmailVerificationData): Promise<EmailSendResult> {
    const template = this.getEmailVerificationTemplate(data);
    
    return this.sendEmail({
      to: data.email,
      subject: template.subject,
      html: template.html,
      text: template.text
    });
  }

  /**
   * Send password reset email
   */
  public async sendPasswordReset(data: PasswordResetData): Promise<EmailSendResult> {
    const template = this.getPasswordResetTemplate(data);
    
    return this.sendEmail({
      to: data.username, // Assuming username is email
      subject: template.subject,
      html: template.html,
      text: template.text
    });
  }

  /**
   * Send system notification
   */
  public async sendSystemNotification(to: string | string[], data: SystemNotificationData): Promise<EmailSendResult> {
    const template = this.getSystemNotificationTemplate(data);
    
    return this.sendEmail({
      to,
      subject: template.subject,
      html: template.html,
      text: template.text
    });
  }

  // Template methods
  private getEmailVerificationTemplate(data: EmailVerificationData): SystemEmailTemplate {
    const subject = `Verify your email${data.companyName ? ` for ${data.companyName}` : ''}`;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Email Verification</h2>
        <p>Hello,</p>
        <p>Please verify your email address by clicking the link below:</p>
        <p><a href="${data.verificationUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
        <p>Or copy and paste this link into your browser:</p>
        <p>${data.verificationUrl}</p>
        ${data.expirationTime ? `<p><small>This link will expire in ${data.expirationTime}.</small></p>` : ''}
        <hr style="margin-top: 30px;">
        <p style="color: #666; font-size: 12px;">If you didn't request this email, please ignore it.</p>
      </div>
    `;

    const text = `
Email Verification

Please verify your email address by visiting:
${data.verificationUrl}

${data.expirationTime ? `This link will expire in ${data.expirationTime}.` : ''}

If you didn't request this email, please ignore it.
    `.trim();

    return { subject, html, text };
  }

  private getPasswordResetTemplate(data: PasswordResetData): SystemEmailTemplate {
    const subject = 'Password Reset Request';
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset</h2>
        <p>Hello ${data.username},</p>
        <p>You requested to reset your password. Click the link below to proceed:</p>
        <p><a href="${data.resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
        <p>Or copy and paste this link into your browser:</p>
        <p>${data.resetUrl}</p>
        <p><small>This link will expire in ${data.expirationTime}.</small></p>
        <hr style="margin-top: 30px;">
        <p style="color: #666; font-size: 12px;">If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
      </div>
    `;

    const text = `
Password Reset Request

Hello ${data.username},

You requested to reset your password. Visit the following link:
${data.resetUrl}

This link will expire in ${data.expirationTime}.

If you didn't request this password reset, please ignore this email.
    `.trim();

    return { subject, html, text };
  }

  private getSystemNotificationTemplate(data: SystemNotificationData): SystemEmailTemplate {
    const subject = data.title;
    
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${data.title}</h2>
        <p>${data.message}</p>
        ${data.actionUrl ? `
          <p><a href="${data.actionUrl}" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 5px;">${data.actionText || 'View Details'}</a></p>
        ` : ''}
        <hr style="margin-top: 30px;">
        <p style="color: #666; font-size: 12px;">This is an automated system notification.</p>
      </div>
    `;

    const text = `
${data.title}

${data.message}

${data.actionUrl ? `${data.actionText || 'View Details'}: ${data.actionUrl}` : ''}

This is an automated system notification.
    `.trim();

    return { subject, html, text };
  }
}

// Export singleton instance getter
export async function getSystemEmailService(): Promise<SystemEmailService> {
  const service = SystemEmailService.getInstance();
  await service.initialize();
  return service;
}