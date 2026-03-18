/**
 * Platform Notification Service - CE Empty Stub
 *
 * This is a stub implementation for Community Edition builds.
 * The actual implementation is in ee/server/src/lib/platformNotifications/
 */

export interface TargetAudienceFilters {
  roles?: string[];
  tenant_ids?: string[];
  user_types?: string[];
  email_search?: string;
}

export interface TargetAudience {
  filters: TargetAudienceFilters;
  excluded_user_ids?: string[];
  resolved_user_count?: number;
}

export interface PlatformNotification {
  notification_id: string;
  title: string;
  banner_content: string;
  detail_content: string;
  target_audience: TargetAudience;
  variant: string;
  starts_at: Date;
  expires_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  is_active: boolean;
}

export interface RecipientInput {
  user_id: string;
  tenant: string;
  excluded?: boolean;
}

export interface CreateNotificationInput {
  title: string;
  banner_content: string;
  detail_content: string;
  target_audience?: TargetAudience;
  variant?: string;
  starts_at?: string;
  expires_at?: string;
  recipients?: RecipientInput[];
}

export interface UpdateNotificationInput {
  title?: string;
  banner_content?: string;
  detail_content?: string;
  target_audience?: TargetAudience;
  variant?: string;
  starts_at?: string;
  expires_at?: string;
  is_active?: boolean;
  recipients?: RecipientInput[];
}

export interface NotificationStats {
  notification_id: string;
  total_recipients: number;
  total_dismissed: number;
  total_detail_viewed: number;
  reads_by_tenant: Array<{ tenant: string; tenant_name: string | null; total: number; dismissed: number; detail_viewed: number }>;
}

export interface ResolvedRecipient {
  user_id: string;
  tenant: string;
  tenant_name: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  roles: string[];
  user_type: string;
}

export class PlatformNotificationService {
  constructor(_masterTenantId: string) {
    // CE stub - no implementation
  }

  async listNotifications(_options?: { activeOnly?: boolean }): Promise<PlatformNotification[]> {
    return [];
  }

  async getNotification(_notificationId: string): Promise<PlatformNotification | null> {
    return null;
  }

  async createNotification(_input: CreateNotificationInput, _createdBy?: string): Promise<PlatformNotification> {
    throw new Error('Platform notifications are only available in Enterprise Edition');
  }

  async updateNotification(_notificationId: string, _input: UpdateNotificationInput): Promise<PlatformNotification | null> {
    return null;
  }

  async deleteNotification(_notificationId: string): Promise<boolean> {
    return false;
  }

  async getActiveNotificationsForUser(_tenantId: string, _userId: string, _userRoles: string[], _userType: string): Promise<PlatformNotification[]> {
    return [];
  }

  async dismissNotification(_tenantId: string, _notificationId: string, _userId: string): Promise<void> {}

  async recordDetailView(_tenantId: string, _notificationId: string, _userId: string): Promise<void> {}

  async resolveRecipients(_filters: TargetAudienceFilters, _emailSearch?: string): Promise<ResolvedRecipient[]> {
    return [];
  }

  async getNotificationStats(_notificationId: string): Promise<NotificationStats> {
    return { notification_id: _notificationId, total_recipients: 0, total_dismissed: 0, total_detail_viewed: 0, reads_by_tenant: [] };
  }
}
