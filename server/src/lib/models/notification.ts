import { ISO8601String } from '../../types/types.d';

export interface NotificationSettings {
  id: number;
  tenant: string;
  is_enabled: boolean;
  rate_limit_per_minute: number;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface SystemEmailTemplate {
  id: number;
  name: string;
  subject: string;
  html_content: string;
  text_content: string;
  version: number;
  is_active: boolean;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface TenantEmailTemplate {
  id: number;
  tenant: string;
  system_template_id?: number;
  name: string;
  subject: string;
  html_content: string;
  text_content: string;
  version: number;
  is_active: boolean;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface NotificationCategory {
  id: number;
  tenant: string;
  name: string;
  description?: string;
  is_enabled: boolean;
  is_default_enabled: boolean;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface NotificationSubtype {
  id: number;
  category_id: number;
  name: string;
  description?: string;
  is_enabled: boolean;
  is_default_enabled: boolean;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface UserNotificationPreference {
  id: number;
  user_id: number;
  subtype_id: number;
  is_enabled: boolean;
  email_address?: string;
  frequency: 'realtime' | 'daily' | 'weekly';
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface NotificationLog {
  id: number;
  tenant: string;
  user_id: number;
  subtype_id: number;
  email_address: string;
  subject: string;
  status: 'sent' | 'failed' | 'bounced';
  error_message?: string;
  created_at: ISO8601String;
  updated_at: ISO8601String;
}

export interface NotificationService {
  // Global settings
  getSettings(tenant: string): Promise<NotificationSettings>;
  updateSettings(tenant: string, settings: Partial<NotificationSettings>): Promise<NotificationSettings>;
  
  // Template management
  getSystemTemplate(name: string): Promise<SystemEmailTemplate>;
  getTenantTemplate(tenant: string, name: string): Promise<TenantEmailTemplate | null>;
  createTenantTemplate(
    tenant: string, 
    template: Omit<TenantEmailTemplate, 'id' | 'created_at' | 'updated_at'>
  ): Promise<TenantEmailTemplate>;
  updateTenantTemplate(
    tenant: string,
    id: number, 
    template: Partial<TenantEmailTemplate>
  ): Promise<TenantEmailTemplate>;
  getEffectiveTemplate(tenant: string, name: string): Promise<SystemEmailTemplate | TenantEmailTemplate>;
  
  // Category management
  getCategories(tenant: string): Promise<NotificationCategory[]>;
  getCategoryWithSubtypes(tenant: string, categoryId: number): Promise<NotificationCategory & { subtypes: NotificationSubtype[] }>;
  updateCategory(tenant: string, id: number, category: Partial<NotificationCategory>): Promise<NotificationCategory>;
  
  // User preferences
  getUserPreferences(tenant: string, userId: number): Promise<UserNotificationPreference[]>;
  updateUserPreference(
    tenant: string,
    userId: number,
    preference: Partial<UserNotificationPreference>
  ): Promise<UserNotificationPreference>;
  
  // Notification sending
  sendNotification(params: {
    tenant: string;
    userId: number;
    subtypeId: number;
    emailAddress: string;
    templateName: string;
    data: Record<string, any>;
  }): Promise<void>;
  
  // Logging
  getLogs(tenant: string, filters: {
    userId?: number;
    subtypeId?: number;
    status?: 'sent' | 'failed' | 'bounced';
    startDate?: ISO8601String;
    endDate?: ISO8601String;
  }): Promise<NotificationLog[]>;
}
