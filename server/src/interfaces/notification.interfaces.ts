// Represents the data needed to create a new notification.
export interface CreateNotificationData {
  user_id?: number; // Optional: defaults to the current user in the action
  type_id: string;
  title: string;
  message?: string;
  data?: Record<string, any>;
  action_url?: string;
  priority_id?: string;
  expires_at?: Date;
}

// Represents a notification record in the 'internal_notifications' table.
export interface InternalNotification {
  internal_notification_id: string;
  tenant: string;
  user_id: number;
  type_id: string;
  title: string;
  message?: string;
  data?: Record<string, any>;
  action_url?: string;
  priority_id?: string;
  read_at?: Date;
  archived_at?: Date;
  created_at: Date;
  expires_at?: Date;
}

// Represents a notification object enriched with details for frontend display.
export interface EnrichedNotification extends Omit<InternalNotification, 'type_id' | 'priority_id'> {
  type: {
    internal_notification_type_id: string;
    type_name: string;
    category_name: string;
  };
  priority?: {
    priority_id: string;
    priority_name: string;
    color: string;
  };
}

export interface NotificationListResult {
  notifications: EnrichedNotification[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
  };
}

// Represents a record in the 'direct_messages' table.
export interface DirectMessage {
  direct_message_id: string;
  tenant: string;
  sender_id: number;
  recipient_id: number;
  thread_id?: string;
  message: string;
  attachments?: Record<string, any>;
  read_at?: Date;
  created_at: Date;
  edited_at?: Date;
  deleted_at?: Date;
}

export interface CreateDirectMessageData {
  recipientId: number;
  message: string;
  threadId?: string;
  attachments?: Record<string, any>;
}

// Represents a record in the 'internal_notification_preferences' table.
export interface NotificationPreference {
  tenant: string;
  user_id: number;
  internal_notification_type_id: string;
  channel: 'in_app' | 'email' | 'sms';
  enabled: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
}

// Represents a record in the 'internal_notification_templates' table.
export interface NotificationTemplate {
  internal_notification_template_id: string;
  type_id: string;
  title_template?: string;
  message_template?: string;
  action_template?: string;
  default_priority_id?: string;
  variables?: Record<string, any>;
}

// Represents a Server-Sent Event payload.
export interface SSEEvent {
  event?: string;
  data: any;
  id?: string;
}

// This is the event payload sent over SSE, denormalized for client convenience.
export interface NotificationSseEvent {
  internal_notification_id: string;
  tenant: string;
  user_id: number;
  title: string;
  message?: string;
  data?: Record<string, any>;
  action_url?: string;
  created_at: string;
  // Denormalized fields
  type_name: string;
  category_name: string;
  priority_name?: string;
  priority_color?: string;
}
