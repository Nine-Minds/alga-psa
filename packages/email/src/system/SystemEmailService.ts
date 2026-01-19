import {
  BaseEmailService,
  BaseEmailParams,
  EmailSendResult
} from '../BaseEmailService';
import {
  SystemEmailTemplate,
  EmailVerificationData,
  PasswordResetData,
  SystemNotificationData,
  AppointmentRequestReceivedData,
  AppointmentRequestApprovedData,
  AppointmentRequestDeclinedData,
  NewAppointmentRequestData
} from './types';
import { IEmailProvider } from '@alga-psa/types';
import { SystemEmailProviderFactory } from './SystemEmailProviderFactory';
import { getConnection } from '@alga-psa/db';
import { SupportedLocale, LOCALE_CONFIG, isSupportedLocale } from '@alga-psa/ui/lib/i18n/config';
import { resolveEmailLocale } from '../emailLocaleResolver';
import Handlebars from 'handlebars';

// Extend BaseEmailParams for system-specific parameters
export interface SystemEmailParams extends BaseEmailParams {
  subject?: string;
  html?: string;
  text?: string;
  locale?: SupportedLocale;
  tenantId?: string;
  userId?: string;
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
   * Determine the best locale for the email
   */
  private async determineLocale(
    email: string,
    options?: { locale?: SupportedLocale; tenantId?: string; userId?: string }
  ): Promise<SupportedLocale> {
    // 1. Explicit locale parameter
    if (options?.locale) {
      return options.locale;
    }

    // 2. Use emailLocaleResolver if we have tenant context
    if (options?.tenantId) {
      try {
        const recipientLocale = await resolveEmailLocale(options.tenantId, {
          email,
          userId: options.userId
        });
        return recipientLocale;
      } catch (error) {
        console.error('Error resolving email locale:', error);
      }
    }

    // 3. System default
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
    if (!tenantId) {
      // Without tenant context, we can only check system templates
      try {
        const knex = await getConnection();

        // Try system template in requested language
        const systemTemplate = await knex('system_email_templates')
          .where({ name: templateName, language_code: locale })
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
            .where({ name: templateName, language_code: 'en' })
            .first();

          if (systemTemplateEn) {
            return {
              subject: systemTemplateEn.subject,
              html: systemTemplateEn.html_content,
              text: systemTemplateEn.text_content
            };
          }
        }
      } catch (error) {
        console.error('Error fetching template from database:', error);
      }

      return null;
    }

    // With tenant context, check tenant and system templates
    try {
      const knex = await getConnection(tenantId);

      // Try tenant-specific template in requested language
      const tenantTemplate = await knex('tenant_email_templates')
        .where({ tenant: tenantId, name: templateName, language_code: locale })
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
          .where({ tenant: tenantId, name: templateName, language_code: 'en' })
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
        .where({ name: templateName, language_code: locale })
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
          .where({ name: templateName, language_code: 'en' })
          .first();

        if (systemTemplateEn) {
          return {
            subject: systemTemplateEn.subject,
            html: systemTemplateEn.html_content,
            text: systemTemplateEn.text_content
          };
        }
      }
    } catch (error) {
      console.error('Error fetching template from database:', error);
    }

    return null;
  }

  /**
   * Replace template variables using Handlebars
   */
  private replaceVariables(template: string, data: Record<string, any>): string {
    try {
      const compiledTemplate = Handlebars.compile(template);
      return compiledTemplate(data);
    } catch (error) {
      console.error('[SystemEmailService] Error compiling template with Handlebars:', error);
      // Fallback to simple replacement if Handlebars fails
      let result = template;
      for (const [key, value] of Object.entries(data)) {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        result = result.replace(regex, String(value || ''));
      }
      return result;
    }
  }

  /**
   * Override sendEmail to handle both direct params and template processor
   */
  public async sendEmail(params: SystemEmailParams): Promise<EmailSendResult> {
    // SystemEmailService can accept subject/html/text directly
    return super.sendEmail(params);
  }

  /**
   * Send email verification with i18n support
   */
  public async sendEmailVerification(
    data: EmailVerificationData,
    options?: { locale?: SupportedLocale; tenantId?: string; userId?: string }
  ): Promise<EmailSendResult> {
    const locale = await this.determineLocale(data.email, options);

    // Try to fetch template from database
    const dbTemplate = await this.fetchTemplate('email-verification', locale, options?.tenantId);

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
      console.warn('[SystemEmailService] Using emergency fallback template for email-verification');
      template = this.getEmailVerificationTemplate(data);
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
    const locale = await this.determineLocale(data.username, options);

    // Try to fetch template from database
    const dbTemplate = await this.fetchTemplate('password-reset', locale, options?.tenantId);

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
      console.warn('[SystemEmailService] Using emergency fallback template for password-reset');
      template = this.getPasswordResetTemplate(data);
    }

    return this.sendEmail({
      to: data.username, // Assuming username is email
      subject: template.subject,
      html: template.html,
      text: template.text,
      locale,
      tenantId: options?.tenantId,
      userId: options?.userId
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

  /**
   * Send appointment request received confirmation
   */
  public async sendAppointmentRequestReceived(
    data: AppointmentRequestReceivedData,
    options?: { locale?: SupportedLocale; tenantId?: string }
  ): Promise<EmailSendResult> {
    const locale = await this.determineLocale(data.requesterEmail, options);

    // Try to fetch template from database
    const dbTemplate = await this.fetchTemplate('appointment-request-received', locale, options?.tenantId);

    let template: SystemEmailTemplate;

    if (dbTemplate) {
      // Use database template and replace variables
      template = {
        subject: this.replaceVariables(dbTemplate.subject, data),
        html: this.replaceVariables(dbTemplate.html, data),
        text: this.replaceVariables(dbTemplate.text || '', data)
      };
    } else {
      // Fall back to basic template
      console.warn('[SystemEmailService] Using emergency fallback template for appointment-request-received');
      template = this.getAppointmentRequestReceivedFallback(data);
    }

    return this.sendEmail({
      to: data.requesterEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      locale,
      tenantId: options?.tenantId
    });
  }

  /**
   * Send appointment request approved notification
   */
  public async sendAppointmentRequestApproved(
    data: AppointmentRequestApprovedData,
    options?: { locale?: SupportedLocale; tenantId?: string; icsAttachment?: { filename: string; content: Buffer } }
  ): Promise<EmailSendResult> {
    const locale = await this.determineLocale(data.requesterEmail, options);

    // Try to fetch template from database
    const dbTemplate = await this.fetchTemplate('appointment-request-approved', locale, options?.tenantId);

    let template: SystemEmailTemplate;

    if (dbTemplate) {
      // Use database template and replace variables
      template = {
        subject: this.replaceVariables(dbTemplate.subject, data),
        html: this.replaceVariables(dbTemplate.html, data),
        text: this.replaceVariables(dbTemplate.text || '', data)
      };
    } else {
      // Fall back to basic template
      console.warn('[SystemEmailService] Using emergency fallback template for appointment-request-approved');
      template = this.getAppointmentRequestApprovedFallback(data);
    }

    // Prepare attachments array
    const attachments = options?.icsAttachment ? [{
      filename: options.icsAttachment.filename,
      content: options.icsAttachment.content,
      contentType: 'text/calendar; charset=utf-8; method=REQUEST'
    }] : undefined;

    return this.sendEmail({
      to: data.requesterEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      locale,
      tenantId: options?.tenantId,
      attachments
    });
  }

  /**
   * Send appointment request declined notification
   */
  public async sendAppointmentRequestDeclined(
    data: AppointmentRequestDeclinedData,
    options?: { locale?: SupportedLocale; tenantId?: string }
  ): Promise<EmailSendResult> {
    const locale = await this.determineLocale(data.requesterEmail, options);

    // Try to fetch template from database
    const dbTemplate = await this.fetchTemplate('appointment-request-declined', locale, options?.tenantId);

    let template: SystemEmailTemplate;

    if (dbTemplate) {
      // Use database template and replace variables
      template = {
        subject: this.replaceVariables(dbTemplate.subject, data),
        html: this.replaceVariables(dbTemplate.html, data),
        text: this.replaceVariables(dbTemplate.text || '', data)
      };
    } else {
      // Fall back to basic template
      console.warn('[SystemEmailService] Using emergency fallback template for appointment-request-declined');
      template = this.getAppointmentRequestDeclinedFallback(data);
    }

    return this.sendEmail({
      to: data.requesterEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      locale,
      tenantId: options?.tenantId
    });
  }

  /**
   * Send new appointment request notification to MSP staff
   */
  public async sendNewAppointmentRequest(
    to: string | string[],
    data: NewAppointmentRequestData,
    options?: { locale?: SupportedLocale; tenantId?: string }
  ): Promise<EmailSendResult> {
    // For MSP staff, use default locale unless specified
    const locale = options?.locale || LOCALE_CONFIG.defaultLocale as SupportedLocale;

    // Try to fetch template from database
    const dbTemplate = await this.fetchTemplate('new-appointment-request', locale, options?.tenantId);

    let template: SystemEmailTemplate;

    if (dbTemplate) {
      // Use database template and replace variables
      template = {
        subject: this.replaceVariables(dbTemplate.subject, data),
        html: this.replaceVariables(dbTemplate.html, data),
        text: this.replaceVariables(dbTemplate.text || '', data)
      };
    } else {
      // Fall back to basic template
      console.warn('[SystemEmailService] Using emergency fallback template for new-appointment-request');
      template = this.getNewAppointmentRequestFallback(data);
    }

    return this.sendEmail({
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      locale,
      tenantId: options?.tenantId
    });
  }

  // Template methods
  private getEmailVerificationTemplate(data: EmailVerificationData): SystemEmailTemplate {
    const subject = `Verify your email${data.clientName ? ` for ${data.clientName}` : ''}`;
    
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

  // Appointment email fallback templates (used only if database template is not available)
  private getAppointmentRequestReceivedFallback(data: AppointmentRequestReceivedData): SystemEmailTemplate {
    const subject = `Appointment Request Received - ${data.serviceName}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Request Received</h2>
        <p>Hello${data.requesterName ? ` ${data.requesterName}` : ''},</p>
        <p>Thank you for submitting your appointment request. We have received your request and our team will review it shortly.</p>
        <p><strong>Reference Number:</strong> ${data.referenceNumber}</p>
        <h3>Request Details</h3>
        <p><strong>Service:</strong> ${data.serviceName}</p>
        <p><strong>Requested Date:</strong> ${data.requestedDate}</p>
        <p><strong>Requested Time:</strong> ${data.requestedTime}</p>
        <p><strong>Duration:</strong> ${data.duration} minutes</p>
        ${data.preferredTechnician ? `<p><strong>Preferred Technician:</strong> ${data.preferredTechnician}</p>` : ''}
        <hr style="margin-top: 30px;">
        <p style="color: #666; font-size: 12px;">We typically respond within ${data.responseTime}. If you have questions, contact us at ${data.contactEmail}${data.contactPhone ? ` or ${data.contactPhone}` : ''}.</p>
      </div>
    `;

    const text = `
Appointment Request Received

Hello${data.requesterName ? ` ${data.requesterName}` : ''},

Thank you for submitting your appointment request. We have received your request and our team will review it shortly.

Reference Number: ${data.referenceNumber}

REQUEST DETAILS:
Service: ${data.serviceName}
Requested Date: ${data.requestedDate}
Requested Time: ${data.requestedTime}
Duration: ${data.duration} minutes
${data.preferredTechnician ? `Preferred Technician: ${data.preferredTechnician}` : ''}

We typically respond within ${data.responseTime}. If you have questions, contact us at ${data.contactEmail}${data.contactPhone ? ` or ${data.contactPhone}` : ''}.
    `.trim();

    return { subject, html, text };
  }

  private getAppointmentRequestApprovedFallback(data: AppointmentRequestApprovedData): SystemEmailTemplate {
    const subject = `Appointment Confirmed - ${data.serviceName} on ${data.appointmentDate}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Appointment Confirmed</h2>
        <p>Hello${data.requesterName ? ` ${data.requesterName}` : ''},</p>
        <p>Great news! Your appointment request has been approved and confirmed.</p>
        <h3>Your Appointment</h3>
        <p><strong>Service:</strong> ${data.serviceName}</p>
        <p><strong>Date:</strong> ${data.appointmentDate}</p>
        <p><strong>Time:</strong> ${data.appointmentTime}</p>
        <p><strong>Duration:</strong> ${data.duration} minutes</p>
        ${data.technicianName ? `<p><strong>Assigned Technician:</strong> ${data.technicianName}</p>` : ''}
        ${data.calendarLink ? `<p><a href="${data.calendarLink}" style="display: inline-block; padding: 10px 20px; background-color: #8a4dea; color: white; text-decoration: none; border-radius: 5px;">Add to Calendar</a></p>` : ''}
        <hr style="margin-top: 30px;">
        <p style="color: #666; font-size: 12px;">If you need to reschedule or cancel, please contact us at least ${data.minimumNoticeHours} hours in advance at ${data.contactEmail}${data.contactPhone ? ` or ${data.contactPhone}` : ''}.</p>
      </div>
    `;

    const text = `
Appointment Confirmed

Hello${data.requesterName ? ` ${data.requesterName}` : ''},

Great news! Your appointment request has been approved and confirmed.

YOUR APPOINTMENT:
Service: ${data.serviceName}
Date: ${data.appointmentDate}
Time: ${data.appointmentTime}
Duration: ${data.duration} minutes
${data.technicianName ? `Assigned Technician: ${data.technicianName}` : ''}

${data.calendarLink ? `Add to Calendar: ${data.calendarLink}` : ''}

If you need to reschedule or cancel, please contact us at least ${data.minimumNoticeHours} hours in advance at ${data.contactEmail}${data.contactPhone ? ` or ${data.contactPhone}` : ''}.
    `.trim();

    return { subject, html, text };
  }

  private getAppointmentRequestDeclinedFallback(data: AppointmentRequestDeclinedData): SystemEmailTemplate {
    const subject = `Appointment Request Update - ${data.serviceName}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Appointment Request Update</h2>
        <p>Hello${data.requesterName ? ` ${data.requesterName}` : ''},</p>
        <p>Thank you for your interest in scheduling an appointment with us. Unfortunately, we are unable to accommodate your request at the requested time.</p>
        <h3>Original Request</h3>
        <p><strong>Service:</strong> ${data.serviceName}</p>
        <p><strong>Requested Date:</strong> ${data.requestedDate}</p>
        <p><strong>Requested Time:</strong> ${data.requestedTime}</p>
        <p><strong>Reference:</strong> ${data.referenceNumber}</p>
        ${data.declineReason ? `<p><strong>Reason:</strong> ${data.declineReason}</p>` : ''}
        <p>We encourage you to submit a new request for an alternative date and time.</p>
        ${data.requestNewAppointmentLink ? `<p><a href="${data.requestNewAppointmentLink}" style="display: inline-block; padding: 10px 20px; background-color: #8a4dea; color: white; text-decoration: none; border-radius: 5px;">Request Another Time</a></p>` : ''}
        <hr style="margin-top: 30px;">
        <p style="color: #666; font-size: 12px;">If you have questions or need assistance, please contact us at ${data.contactEmail}${data.contactPhone ? ` or ${data.contactPhone}` : ''}.</p>
      </div>
    `;

    const text = `
Appointment Request Update

Hello${data.requesterName ? ` ${data.requesterName}` : ''},

Thank you for your interest in scheduling an appointment with us. Unfortunately, we are unable to accommodate your request at the requested time.

ORIGINAL REQUEST:
Service: ${data.serviceName}
Requested Date: ${data.requestedDate}
Requested Time: ${data.requestedTime}
Reference: ${data.referenceNumber}

${data.declineReason ? `Reason: ${data.declineReason}` : ''}

We encourage you to submit a new request for an alternative date and time.

${data.requestNewAppointmentLink ? `Request Another Time: ${data.requestNewAppointmentLink}` : ''}

If you have questions or need assistance, please contact us at ${data.contactEmail}${data.contactPhone ? ` or ${data.contactPhone}` : ''}.
    `.trim();

    return { subject, html, text };
  }

  private getNewAppointmentRequestFallback(data: NewAppointmentRequestData): SystemEmailTemplate {
    const subject = `New Appointment Request - ${data.clientName || data.requesterName}${data.serviceName ? ` - ${data.serviceName}` : ''}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>New Appointment Request</h2>
        <p>Team,</p>
        <p>A new appointment request has been submitted and requires your review and approval.</p>
        <h3>Requester Information</h3>
        <p><strong>Name:</strong> ${data.requesterName}</p>
        <p><strong>Email:</strong> ${data.requesterEmail}</p>
        ${data.requesterPhone ? `<p><strong>Phone:</strong> ${data.requesterPhone}</p>` : ''}
        ${data.companyName ? `<p><strong>Company:</strong> ${data.companyName}</p>` : ''}
        ${data.clientName ? `<p><strong>Client:</strong> ${data.clientName}</p>` : ''}
        <p><strong>Type:</strong> ${data.isAuthenticated ? 'Client Portal Request' : 'Public Request'}</p>
        <h3>Appointment Details</h3>
        <p><strong>Service:</strong> ${data.serviceName}</p>
        <p><strong>Requested Date:</strong> ${data.requestedDate}</p>
        <p><strong>Requested Time:</strong> ${data.requestedTime}</p>
        <p><strong>Duration:</strong> ${data.duration} minutes</p>
        ${data.preferredTechnician ? `<p><strong>Preferred Technician:</strong> ${data.preferredTechnician}</p>` : ''}
        <p><strong>Reference:</strong> ${data.referenceNumber}</p>
        <p><strong>Submitted:</strong> ${data.submittedAt}</p>
        ${data.linkedTicket ? `<p><strong>Linked Ticket:</strong> #${data.linkedTicket}</p>` : ''}
        ${data.description ? `<p><strong>Notes:</strong> "${data.description}"</p>` : ''}
        ${data.approvalLink ? `<p><a href="${data.approvalLink}" style="display: inline-block; padding: 10px 20px; background-color: #8a4dea; color: white; text-decoration: none; border-radius: 5px;">Review & Approve</a></p>` : ''}
        <hr style="margin-top: 30px;">
        <p style="color: #666; font-size: 12px;">Please review this request and take appropriate action.</p>
      </div>
    `;

    const text = `
New Appointment Request - Action Required

Team,

A new appointment request has been submitted and requires your review and approval.

REQUESTER INFORMATION:
Name: ${data.requesterName}
Email: ${data.requesterEmail}
${data.requesterPhone ? `Phone: ${data.requesterPhone}` : ''}
${data.companyName ? `Company: ${data.companyName}` : ''}
${data.clientName ? `Client: ${data.clientName}` : ''}
Type: ${data.isAuthenticated ? 'Client Portal Request' : 'Public Request'}

APPOINTMENT DETAILS:
Service: ${data.serviceName}
Requested Date: ${data.requestedDate}
Requested Time: ${data.requestedTime}
Duration: ${data.duration} minutes
${data.preferredTechnician ? `Preferred Technician: ${data.preferredTechnician}` : ''}
Reference: ${data.referenceNumber}
Submitted: ${data.submittedAt}
${data.linkedTicket ? `Linked Ticket: #${data.linkedTicket}` : ''}

${data.description ? `NOTES:\n"${data.description}"` : ''}

${data.approvalLink ? `REVIEW & APPROVE:\n${data.approvalLink}` : ''}

Please review this request and take appropriate action.
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
