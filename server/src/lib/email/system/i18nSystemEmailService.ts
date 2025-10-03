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
import { getConnection } from '@/lib/db/db';
import { SupportedLocale, LOCALE_CONFIG, isSupportedLocale } from '@/lib/i18n/config';

// Extend BaseEmailParams for i18n system-specific parameters
export interface I18nSystemEmailParams extends BaseEmailParams {
  subject?: string;
  html?: string;
  text?: string;
  locale?: SupportedLocale;
  tenantId?: string;
  userId?: string;
}

/**
 * I18nSystemEmailService - Enhanced email service with language support
 *
 * This service extends SystemEmailService to support multi-language email templates
 * with proper fallback chains:
 * 1. Tenant-specific template in requested language
 * 2. Tenant-specific template in English
 * 3. System template in requested language
 * 4. System template in English
 * 5. Hardcoded template in requested language
 * 6. Hardcoded template in English
 */
export class I18nSystemEmailService extends BaseEmailService {
  private static instance: I18nSystemEmailService;
  private fromAddress: string | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): I18nSystemEmailService {
    if (!I18nSystemEmailService.instance) {
      I18nSystemEmailService.instance = new I18nSystemEmailService();
    }
    return I18nSystemEmailService.instance;
  }

  protected getServiceName(): string {
    return 'I18nSystemEmailService';
  }

  protected async getEmailProvider(): Promise<IEmailProvider | null> {
    this.fromAddress = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'noreply@localhost';
    return SystemEmailProviderFactory.createProvider();
  }

  protected getFromAddress(): string {
    return this.fromAddress || process.env.EMAIL_FROM || 'noreply@localhost';
  }

  /**
   * Get user's preferred locale
   */
  private async getUserLocale(userId?: string, tenantId?: string): Promise<SupportedLocale | null> {
    if (!userId) return null;

    try {
      if (!tenantId) return null;

      const knex = await getConnection(tenantId);
      const userPref = await knex('user_preferences')
        .where({ user_id: userId, setting_name: 'locale', tenant: tenantId })
        .first();

      if (userPref?.setting_value) {
        const locale = typeof userPref.setting_value === 'string'
          ? userPref.setting_value.replace(/"/g, '')
          : userPref.setting_value;
        return isSupportedLocale(locale) ? locale : null;
      }

      return null;
    } catch (error) {
      console.error('Error fetching user locale:', error);
      return null;
    }
  }

  /**
   * Get tenant's default locale
   */
  private async getTenantDefaultLocale(tenantId?: string): Promise<SupportedLocale | null> {
    if (!tenantId) return null;

    try {
      const knex = await getConnection(tenantId);
      const tenantSettings = await knex('tenant_settings')
        .where({ tenant: tenantId })
        .first();

      const defaultLocale = tenantSettings?.settings?.clientPortal?.defaultLocale;
      return isSupportedLocale(defaultLocale) ? defaultLocale : null;
    } catch (error) {
      console.error('Error fetching tenant locale:', error);
      return null;
    }
  }

  /**
   * Determine the best locale for the email
   */
  private async determineLocale(params: { locale?: SupportedLocale; tenantId?: string; userId?: string }): Promise<SupportedLocale> {
    // 1. Explicit locale parameter
    if (params.locale) {
      return params.locale;
    }

    // 2. User preference
    const userLocale = await this.getUserLocale(params.userId, params.tenantId);
    if (userLocale) {
      return userLocale;
    }

    // 3. Tenant default
    const tenantLocale = await this.getTenantDefaultLocale(params.tenantId);
    if (tenantLocale) {
      return tenantLocale;
    }

    // 4. System default
    return LOCALE_CONFIG.defaultLocale as SupportedLocale;
  }

  /**
   * Fetch email template from database with language fallback
   */
  private async fetchTemplate(
    templateName: string,
    locale: SupportedLocale,
    tenantId?: string
  ): Promise<SystemEmailTemplate | null> {
    if (!tenantId) return null;

    const knex = await getConnection(tenantId);

    // Try tenant-specific template first
    // Try requested language
    const tenantTemplate = await knex('tenant_email_templates')
        .where({
          tenant: tenantId,
          name: templateName,
          language_code: locale
        })
        .first();

      if (tenantTemplate) {
        return {
          subject: tenantTemplate.subject,
          html: tenantTemplate.html_content,
          text: tenantTemplate.text_content
        };
      }

    // Fallback to English for tenant
    if (locale !== 'en') {
      const tenantTemplateEn = await knex('tenant_email_templates')
        .where({
          tenant: tenantId,
          name: templateName,
          language_code: 'en'
        })
        .first();

      if (tenantTemplateEn) {
        return {
          subject: tenantTemplateEn.subject,
          html: tenantTemplateEn.html_content,
          text: tenantTemplateEn.text_content
        };
      }
    }

    // Try system template in requested language
    const systemTemplate = await knex('system_email_templates')
      .where({
        name: templateName,
        language_code: locale
      })
      .first();

    if (systemTemplate) {
      return {
        subject: systemTemplate.subject,
        html: systemTemplate.html_content,
        text: systemTemplate.text_content
      };
    }

    // Fallback to English for system
    if (locale !== 'en') {
      const systemTemplateEn = await knex('system_email_templates')
        .where({
          name: templateName,
          language_code: 'en'
        })
        .first();

      if (systemTemplateEn) {
        return {
          subject: systemTemplateEn.subject,
          html: systemTemplateEn.html_content,
          text: systemTemplateEn.text_content
        };
      }
    }

    return null;
  }

  /**
   * Override sendEmail to handle language detection
   */
  public async sendEmail(params: I18nSystemEmailParams): Promise<EmailSendResult> {
    const locale = await this.determineLocale({
      locale: params.locale,
      tenantId: params.tenantId,
      userId: params.userId
    });

    // Store locale for use in template generation
    const paramsWithLocale = {
      ...params,
      locale
    };

    return super.sendEmail(paramsWithLocale);
  }

  /**
   * Send email verification with i18n support
   */
  public async sendEmailVerification(
    data: EmailVerificationData,
    options?: { locale?: SupportedLocale; tenantId?: string; userId?: string }
  ): Promise<EmailSendResult> {
    const locale = await this.determineLocale({
      locale: options?.locale,
      tenantId: options?.tenantId,
      userId: options?.userId
    });

    // Try to fetch template from database
    const dbTemplate = await this.fetchTemplate(
      'email_verification',
      locale,
      options?.tenantId
    );

    let template: SystemEmailTemplate;

    if (dbTemplate) {
      // Use database template and replace variables
      template = {
        subject: this.replaceVariables(dbTemplate.subject, data),
        html: this.replaceVariables(dbTemplate.html, data),
        text: this.replaceVariables(dbTemplate.text || '', data)
      };
    } else {
      // Fall back to hardcoded template
      template = this.getEmailVerificationTemplate(data, locale);
    }

    return this.sendEmail({
      to: data.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      locale,
      tenantId: options?.tenantId,
      userId: options?.userId
    });
  }

  /**
   * Send password reset email with i18n support
   */
  public async sendPasswordReset(
    data: PasswordResetData,
    options?: { locale?: SupportedLocale; tenantId?: string; userId?: string }
  ): Promise<EmailSendResult> {
    const locale = await this.determineLocale({
      locale: options?.locale,
      tenantId: options?.tenantId,
      userId: options?.userId
    });

    // Try to fetch template from database
    const dbTemplate = await this.fetchTemplate(
      'password_reset',
      locale,
      options?.tenantId
    );

    let template: SystemEmailTemplate;

    if (dbTemplate) {
      // Use database template and replace variables
      template = {
        subject: this.replaceVariables(dbTemplate.subject, data),
        html: this.replaceVariables(dbTemplate.html, data),
        text: this.replaceVariables(dbTemplate.text || '', data)
      };
    } else {
      // Fall back to hardcoded template
      template = this.getPasswordResetTemplate(data, locale);
    }

    return this.sendEmail({
      to: data.username,
      subject: template.subject,
      html: template.html,
      text: template.text,
      locale,
      tenantId: options?.tenantId,
      userId: options?.userId
    });
  }

  /**
   * Replace template variables
   */
  private replaceVariables(template: string, data: Record<string, any>): string {
    let result = template;

    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      result = result.replace(regex, String(value || ''));
    }

    return result;
  }

  // Hardcoded templates with i18n support (fallback)
  private getEmailVerificationTemplate(data: EmailVerificationData, locale: SupportedLocale): SystemEmailTemplate {
    const templates = {
      en: {
        subject: `Verify your email${data.clientName ? ` for ${data.clientName}` : ''}`,
        html: `
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
        `,
        text: `Email Verification\n\nPlease verify your email address by visiting:\n${data.verificationUrl}\n\n${data.expirationTime ? `This link will expire in ${data.expirationTime}.` : ''}\n\nIf you didn't request this email, please ignore it.`
      },
      fr: {
        subject: `Vérifiez votre email${data.clientName ? ` pour ${data.clientName}` : ''}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Vérification d'email</h2>
            <p>Bonjour,</p>
            <p>Veuillez vérifier votre adresse email en cliquant sur le lien ci-dessous :</p>
            <p><a href="${data.verificationUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Vérifier l'email</a></p>
            <p>Ou copiez et collez ce lien dans votre navigateur :</p>
            <p>${data.verificationUrl}</p>
            ${data.expirationTime ? `<p><small>Ce lien expirera dans ${data.expirationTime}.</small></p>` : ''}
            <hr style="margin-top: 30px;">
            <p style="color: #666; font-size: 12px;">Si vous n'avez pas demandé cet email, veuillez l'ignorer.</p>
          </div>
        `,
        text: `Vérification d'email\n\nVeuillez vérifier votre adresse email en visitant :\n${data.verificationUrl}\n\n${data.expirationTime ? `Ce lien expirera dans ${data.expirationTime}.` : ''}\n\nSi vous n'avez pas demandé cet email, veuillez l'ignorer.`
      }
    };

    return templates[locale] || templates.en;
  }

  private getPasswordResetTemplate(data: PasswordResetData, locale: SupportedLocale): SystemEmailTemplate {
    const templates = {
      en: {
        subject: 'Password Reset Request',
        html: `
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
        `,
        text: `Password Reset Request\n\nHello ${data.username},\n\nYou requested to reset your password. Visit the following link:\n${data.resetUrl}\n\nThis link will expire in ${data.expirationTime}.\n\nIf you didn't request this password reset, please ignore this email.`
      },
      fr: {
        subject: 'Demande de réinitialisation du mot de passe',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Réinitialisation du mot de passe</h2>
            <p>Bonjour ${data.username},</p>
            <p>Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le lien ci-dessous pour continuer :</p>
            <p><a href="${data.resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #dc3545; color: white; text-decoration: none; border-radius: 5px;">Réinitialiser le mot de passe</a></p>
            <p>Ou copiez et collez ce lien dans votre navigateur :</p>
            <p>${data.resetUrl}</p>
            <p><small>Ce lien expirera dans ${data.expirationTime}.</small></p>
            <hr style="margin-top: 30px;">
            <p style="color: #666; font-size: 12px;">Si vous n'avez pas demandé cette réinitialisation de mot de passe, veuillez ignorer cet email. Votre mot de passe restera inchangé.</p>
          </div>
        `,
        text: `Demande de réinitialisation du mot de passe\n\nBonjour ${data.username},\n\nVous avez demandé à réinitialiser votre mot de passe. Visitez le lien suivant :\n${data.resetUrl}\n\nCe lien expirera dans ${data.expirationTime}.\n\nSi vous n'avez pas demandé cette réinitialisation, veuillez ignorer cet email.`
      }
    };

    return templates[locale] || templates.en;
  }
}

// Export singleton instance getter
export async function getI18nSystemEmailService(): Promise<I18nSystemEmailService> {
  const service = I18nSystemEmailService.getInstance();
  await service.initialize();
  return service;
}