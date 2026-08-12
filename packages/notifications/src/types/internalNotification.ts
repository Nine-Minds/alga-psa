/**
 * Internal Notification Types
 *
 * For internal notifications (not email)
 */

export interface InternalNotificationCategory {
  internal_notification_category_id: number;
  name: string;
  description: string | null;
  is_enabled: boolean;
  is_default_enabled: boolean;
  available_for_client_portal: boolean;
  display_title?: string;
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
  available_for_client_portal: boolean;
  display_title?: string;
  /** System default priority for this subtype (from internal_notification_subtypes). */
  default_priority?: InternalNotificationPriority;
  /** Tenant admin override, if any (from tenant_internal_notification_subtype_settings). NULL = inherit default. */
  tenant_priority?: InternalNotificationPriority | null;
  /** Effective priority to display: tenant override ?? default. */
  effective_priority?: InternalNotificationPriority;
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

/**
 * Configurable priority tier for an in-app notification.
 * Resolved from user override ?? tenant override ?? subtype default ?? 'normal'
 * and stamped onto each notification at creation (task 29.8.46).
 */
export type InternalNotificationPriority = 'high' | 'normal' | 'low';

export type InternalNotificationDeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface InternalNotification {
  internal_notification_id: string;
  tenant: string;
  user_id: string;
  template_name: string;
  language_code: string;
  title: string;
  message: string;
  type: InternalNotificationType;
  priority: InternalNotificationPriority;
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

export interface CreateInternalNotificationRequest {
  tenant: string;
  user_id: string;
  template_name: string;
  data: Record<string, any>;
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
  notification_id: string;
}

export interface MarkAllAsReadRequest {
  tenant: string;
  user_id: string;
}

export interface InternalNotificationWithSubtype extends InternalNotification {
  subtype: InternalNotificationSubtype;
}

export interface InternalNotificationListResponse {
  notifications: InternalNotification[];
  total: number;
  unread_count: number;
  /** Unread count of `high`-priority notifications, so the bell badge can render high-only. */
  unread_high?: number;
  has_more: boolean;
}

export interface UnreadCountResponse {
  unread_count: number;
  by_category?: Record<string, number>;
  /**
   * Unread count split by priority tier so the bell can render a high-only
   * badge without a second round-trip. `high` is the unread-high count;
   * `total` mirrors `unread_count` for a symmetric `{ total, high }` shape.
   */
  total?: number;
  high?: number;
}

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

export interface UserInternalNotificationPreference {
  preference_id: number;
  tenant: string;
  user_id: string;
  category_id: number | null;
  subtype_id: number | null;
  is_enabled: boolean;
  /**
   * Per-user priority override. Meaningful on subtype rows only (subtype_id set);
   * category rows keep this NULL. NULL = inherit tenant override / subtype default.
   */
  priority?: InternalNotificationPriority | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateUserInternalNotificationPreferenceRequest {
  tenant: string;
  user_id: string;
  category_id?: number | null;
  subtype_id?: number | null;
  is_enabled: boolean;
  /**
   * When present, sets the per-user priority override on a subtype row.
   * Pass `null` to clear the override (reset to tenant/default). `undefined`
   * leaves any existing override untouched.
   */
  priority?: InternalNotificationPriority | null;
}

