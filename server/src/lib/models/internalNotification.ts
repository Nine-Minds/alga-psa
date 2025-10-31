/**
 * Internal Notification Types
 *
 * For in-app/internal notifications (not email)
 */

export interface InternalNotificationCategory {
  internal_notification_category_id: number;
  name: string;
  description: string | null;
  is_enabled: boolean;
  is_default_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface InternalNotificationSubtype {
  internal_notification_subtype_id: number;
  internal_category_id: number;
  name: string;
  description: string | null;
  is_enabled: boolean;
  is_default_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface InternalNotificationTemplate {
  internal_notification_template_id: number;
  name: string;
  language_code: string;
  title: string;
  message: string;
  subtype_id: number;
  created_at: string;
  updated_at: string;
}

export type InternalNotificationType = 'info' | 'success' | 'warning' | 'error';

export type InternalNotificationDeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface InternalNotification {
  internal_notification_id: number;
  tenant: string;
  user_id: string;
  template_name: string;
  language_code: string;
  title: string;
  message: string;
  type: InternalNotificationType;
  category: string | null;
  link: string | null;
  metadata: Record<string, any> | null;
  is_read: boolean;
  read_at: string | null;
  deleted_at: string | null;
  delivery_status: InternalNotificationDeliveryStatus;
  delivery_attempts: number;
  last_delivery_attempt: string | null;
  delivery_error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Request types for creating notifications
 */
export interface CreateInternalNotificationRequest {
  tenant: string;
  user_id: string;
  template_name: string;
  data: Record<string, any>; // Template rendering data
  type?: InternalNotificationType;
  category?: string;
  link?: string;
  metadata?: Record<string, any>;
}

export interface GetInternalNotificationsRequest {
  tenant: string;
  user_id: string;
  is_read?: boolean;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface MarkAsReadRequest {
  tenant: string;
  user_id: string;
  notification_id: number;
}

export interface MarkAllAsReadRequest {
  tenant: string;
  user_id: string;
}

/**
 * Response types
 */
export interface InternalNotificationWithSubtype extends InternalNotification {
  subtype: InternalNotificationSubtype;
}

export interface InternalNotificationListResponse {
  notifications: InternalNotification[];
  total: number;
  unread_count: number;
  has_more: boolean;
}

export interface UnreadCountResponse {
  unread_count: number;
  by_category?: Record<string, number>;
}

/**
 * Template rendering types
 */
export interface TemplateRenderContext {
  tenant: string;
  user_id: string;
  language_code: string;
  data: Record<string, any>;
}

export interface RenderedTemplate {
  title: string;
  message: string;
  language_code: string;
}
