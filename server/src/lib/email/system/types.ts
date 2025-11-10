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

// Appointment request email template data interfaces
export interface AppointmentRequestReceivedData {
  requesterName?: string;
  requesterEmail: string;
  referenceNumber: string;
  serviceName: string;
  requestedDate: string;
  requestedTime: string;
  duration: number;
  preferredTechnician?: string;
  responseTime: string;
  contactEmail: string;
  contactPhone?: string;
  tenantName: string;
  currentYear: number;
}

export interface AppointmentRequestApprovedData {
  requesterName?: string;
  requesterEmail: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
  duration: number;
  technicianName?: string;
  technicianEmail?: string;
  technicianPhone?: string;
  calendarLink?: string;
  cancellationPolicy?: string;
  minimumNoticeHours: number;
  contactEmail: string;
  contactPhone?: string;
  tenantName: string;
  currentYear: number;
}

export interface AppointmentRequestDeclinedData {
  requesterName?: string;
  requesterEmail: string;
  serviceName: string;
  requestedDate: string;
  requestedTime: string;
  referenceNumber: string;
  declineReason?: string;
  requestNewAppointmentLink?: string;
  contactEmail: string;
  contactPhone?: string;
  tenantName: string;
  currentYear: number;
}

export interface NewAppointmentRequestData {
  requesterName: string;
  requesterEmail: string;
  requesterPhone?: string;
  companyName?: string;
  clientName?: string;
  referenceNumber: string;
  submittedAt: string;
  linkedTicket?: string;
  isAuthenticated: boolean;
  serviceName: string;
  requestedDate: string;
  requestedTime: string;
  duration: number;
  preferredTechnician?: string;
  description?: string;
  approvalLink?: string;
  tenantName: string;
  currentYear: number;
}
