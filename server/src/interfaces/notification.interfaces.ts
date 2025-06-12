export interface CreateNotificationData {
  type: string;
  category: string;
  title: string;
  message?: string;
  data?: Record<string, any>;
  actionUrl?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  expiresAt?: Date;
}

export interface Notification {
  tenant: string;
  id: string;
  user_id: number;
  type: string;
  category: string;
  title: string;
  message?: string;
  data?: Record<string, any>;
  action_url?: string;
  priority: string;
  read_at?: Date;
  archived_at?: Date;
  created_at: Date;
  expires_at?: Date;
}

export interface NotificationListResult {
  notifications: Notification[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
  };
}

export interface DirectMessage {
  tenant: string;
  id: string;
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

export interface MessageThread {
  thread_id: string;
  participants: number[];
  last_message: string;
  last_message_at: Date;
  unread_count: number;
}

export interface NotificationPreference {
  tenant: string;
  user_id: number;
  notification_type: string;
  channel: 'in_app' | 'email' | 'sms';
  enabled: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
}

export interface NotificationTemplate {
  tenant: string;
  id: string;
  type: string;
  title_template?: string;
  message_template?: string;
  action_template?: string;
  default_priority?: string;
  variables?: Record<string, any>;
}

export interface SSEEvent {
  event?: string;
  data: any;
  id?: string;
}

export interface NotificationEvent {
  id: string;
  tenant: string;
  userId: number;
  type: string;
  category: string;
  title: string;
  message?: string;
  data?: Record<string, any>;
  actionUrl?: string;
  priority?: string;
}