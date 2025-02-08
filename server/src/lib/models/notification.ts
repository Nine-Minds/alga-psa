export interface NotificationSettings {
  id: number;
  tenant: string;
  is_enabled: boolean;
  rate_limit_per_minute: number;
  created_at: string;
  updated_at: string;
}

export interface SystemEmailTemplate {
  id: number;
  name: string;
  subject: string;
  html_content: string;
  text_content: string;
  created_at: string;
  updated_at: string;
}

export interface TenantEmailTemplate {
  id: number;
  tenant: string;
  name: string;
  subject: string;
  html_content: string;
  text_content: string;
  system_template_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationCategory {
  id: number;
  tenant: string;
  name: string;
  description: string | null;
  is_enabled: boolean;
  is_default_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationSubtype {
  id: number;
  category_id: number;
  name: string;
  description: string | null;
  is_enabled: boolean;
  is_default_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserNotificationPreference {
  id: number;
  user_id: string;
  subtype_id: number;
  is_enabled: boolean;
  email_address: string | null;
  frequency: 'realtime' | 'daily' | 'weekly';
  created_at: string;
  updated_at: string;
}

export interface NotificationLog {
  id: number;
  tenant: string;
  user_id: number;
  subtype_id: number;
  email_address: string;
  subject: string;
  status: 'sent' | 'failed' | 'bounced';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationService {
  getSettings(tenant: string): Promise<NotificationSettings>;
  updateSettings(tenant: string, settings: Partial<NotificationSettings>): Promise<NotificationSettings>;
  getSystemTemplate(name: string): Promise<SystemEmailTemplate>;
  getTenantTemplate(tenant: string, name: string): Promise<TenantEmailTemplate | null>;
  createTenantTemplate(tenant: string, template: Omit<TenantEmailTemplate, 'id' | 'created_at' | 'updated_at'>): Promise<TenantEmailTemplate>;
  updateTenantTemplate(tenant: string, id: number, template: Partial<TenantEmailTemplate>): Promise<TenantEmailTemplate>;
  getEffectiveTemplate(tenant: string, name: string): Promise<SystemEmailTemplate | TenantEmailTemplate>;
  getCategories(tenant: string): Promise<NotificationCategory[]>;
  getCategoryWithSubtypes(tenant: string, categoryId: number): Promise<NotificationCategory & { subtypes: NotificationSubtype[] }>;
  updateCategory(tenant: string, id: number, category: Partial<NotificationCategory>): Promise<NotificationCategory>;
  getUserPreferences(tenant: string, userId: string): Promise<UserNotificationPreference[]>;
  updateUserPreference(tenant: string, userId: string, preference: Partial<UserNotificationPreference>): Promise<UserNotificationPreference>;
}
