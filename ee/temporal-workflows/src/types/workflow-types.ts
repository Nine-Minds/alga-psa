// Define ISO8601String locally to avoid import issues
export type ISO8601String = string;

export interface TenantCreationInput {
  tenantName: string;
  adminUser: {
    firstName: string;
    lastName: string;
    email: string;
  };
  companyName?: string;
  billingPlan?: string;
  licenseCount?: number; // Number of licenses for the tenant
  checkoutSessionId?: string; // Stripe checkout session ID for status updates
}

export interface TenantCreationResult {
  tenantId: string;
  adminUserId: string;
  companyId?: string;
  temporaryPassword: string;
  emailSent: boolean;
  success: boolean;
  createdAt: ISO8601String;
  // Customer tracking information
  customerCompanyId?: string;
  customerContactId?: string;
}

export interface CreateTenantActivityInput {
  tenantName: string;
  email: string;
  companyName?: string;
  licenseCount?: number; // Number of licenses for the tenant
}

export interface CreateTenantActivityResult {
  tenantId: string;
  companyId?: string;
}

export interface CreateAdminUserActivityInput {
  tenantId: string;
  firstName: string;
  lastName: string;
  email: string;
  companyId?: string;
}

export interface CreateAdminUserActivityResult {
  userId: string;
  roleId: string;
  temporaryPassword: string;
}

export interface SetupTenantDataActivityInput {
  tenantId: string;
  adminUserId: string;
  companyId?: string;
  billingPlan?: string;
}

export interface SetupTenantDataActivityResult {
  setupSteps: string[];
}

export interface SendWelcomeEmailActivityInput {
  tenantId: string;
  tenantName: string;
  adminUser: {
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  temporaryPassword: string;
  companyName?: string;
}

export interface SendWelcomeEmailActivityResult {
  emailSent: boolean;
  messageId?: string;
  error?: string;
}

// Workflow execution state for queries
export interface TenantCreationWorkflowState {
  step: 'initializing' | 'creating_tenant' | 'creating_admin_user' | 'creating_customer_tracking' | 'setting_up_data' | 'running_onboarding_seeds' | 'sending_welcome_email' | 'completed' | 'failed';
  tenantId?: string;
  adminUserId?: string;
  companyId?: string;
  emailSent?: boolean;
  error?: string;
  progress: number; // 0-100
}

// Signals for workflow control
export interface TenantCreationCancelSignal {
  reason: string;
  cancelledBy: string;
}

export interface TenantCreationUpdateSignal {
  field: string;
  value: any;
}

// Portal User Creation Types
export interface CreatePortalUserActivityInput {
  tenantId: string;
  email: string;
  password?: string; // Optional - will generate if not provided
  contactId: string;
  companyId: string;
  firstName?: string;
  lastName?: string;
  roleId?: string; // Optional specific role ID
  isClientAdmin?: boolean; // Whether the user should be a client admin
}

export interface CreatePortalUserActivityResult {
  userId: string;
  roleId: string;
  temporaryPassword?: string; // Only set if password was generated
}