/**
 * System Email Types
 * These types are used for platform-level emails that are NOT tenant-specific
 */

export interface SystemEmailConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  isEnabled: boolean;
}

export interface SystemEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: SystemEmailAttachment[];
  replyTo?: string;
}

export interface SystemEmailAttachment {
  filename: string;
  content?: Buffer | string;
  path?: string;
  contentType?: string;
}

export interface SystemEmailTemplate {
  subject: string;
  html: string;
  text?: string;
}

export interface SystemEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// Template data interfaces for specific system emails
export interface EmailVerificationData {
  email: string;
  verificationUrl: string;
  clientName?: string;
  expirationTime?: string;
}

export interface PasswordResetData {
  username: string;
  resetUrl: string;
  expirationTime: string;
}

export interface SystemNotificationData {
  title: string;
  message: string;
  actionUrl?: string;
  actionText?: string;
}

export interface PortalInvitationData {
  email: string;
  contactName: string;
  clientName: string;
  portalLink: string;
  expirationTime: string;
  clientLocationEmail: string;
  clientLocationPhone: string;
}
