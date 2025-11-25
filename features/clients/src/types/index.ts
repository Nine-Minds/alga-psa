import { z } from 'zod';

/**
 * Client/Company entity representing a client organization or individual
 */
export interface Company {
  client_id: string;
  tenant: string;
  client_name: string;
  client_type: 'company' | 'individual' | null;
  url: string;
  is_inactive: boolean;
  is_tax_exempt: boolean;
  created_at: Date;
  updated_at: Date;

  // Contact information (via default location)
  email?: string | null;
  phone_no?: string | null;
  address?: string | null;
  address_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;

  // Business details
  notes?: string | null;
  properties?: Record<string, any> | null;
  parent_client_id?: string | null;

  // Financial settings
  credit_balance: number;
  credit_limit?: number;
  payment_terms?: string;
  billing_cycle: 'monthly' | 'quarterly' | 'annually' | 'custom';
  preferred_payment_method?: string;
  auto_invoice?: boolean;
  invoice_delivery_method?: string;

  // Tax information
  tax_id_number?: string;
  tax_exemption_certificate?: string;
  tax_region?: string;
  region_code?: string | null;

  // Account management
  account_manager_id?: string | null;
  account_manager_full_name?: string;
  billing_contact_id?: string;
  billing_email?: string;

  // Customization
  timezone?: string;
  invoice_template_id?: string;
  notes_document_id?: string | null;

  // UI-only fields
  logoUrl?: string | null;
  tags?: string[];
}

/**
 * Input schema for creating a new client
 */
export const createCompanySchema = z.object({
  client_name: z.string().min(1, 'Client name is required').max(255),
  client_type: z.enum(['company', 'individual']).default('company'),
  url: z.string().url().or(z.literal('')).optional(),
  email: z.string().email().nullable().optional(),
  phone_no: z.string().max(50).nullable().optional(),
  address: z.string().nullable().optional(),
  address_2: z.string().nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  zip: z.string().max(20).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
  properties: z.record(z.any()).nullable().optional(),
  parent_client_id: z.string().uuid().nullable().optional(),

  // Financial settings
  payment_terms: z.string().optional(),
  billing_cycle: z.enum(['monthly', 'quarterly', 'annually', 'custom']).default('monthly'),
  credit_limit: z.number().min(0).optional(),
  preferred_payment_method: z.string().optional(),
  auto_invoice: z.boolean().optional(),
  invoice_delivery_method: z.string().optional(),

  // Tax information
  is_tax_exempt: z.boolean().default(false),
  tax_id_number: z.string().optional(),
  tax_exemption_certificate: z.string().optional(),
  region_code: z.string().nullable().optional(),

  // Account management
  account_manager_id: z.string().uuid().nullable().optional(),
  billing_contact_id: z.string().uuid().nullable().optional(),
  billing_email: z.string().email().nullable().optional(),

  // Customization
  timezone: z.string().optional(),
  invoice_template_id: z.string().uuid().nullable().optional(),

  tags: z.array(z.string().uuid()).optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/**
 * Input schema for updating an existing client
 */
export const updateCompanySchema = createCompanySchema.partial().extend({
  client_id: z.string().uuid(),
  is_inactive: z.boolean().optional(),
});

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

/**
 * Filters for querying clients
 */
export interface CompanyFilters {
  search?: string;
  client_type?: 'company' | 'individual' | 'all';
  is_inactive?: boolean;
  status?: 'active' | 'inactive' | 'all';
  tags?: string[];
  account_manager_id?: string;
  limit?: number;
  offset?: number;
  page?: number;
  pageSize?: number;
  orderBy?: keyof Company;
  sortBy?: string;
  orderDirection?: 'asc' | 'desc';
  sortDirection?: 'asc' | 'desc';
  loadLogos?: boolean;
}

/**
 * Paginated response for client queries
 */
export interface CompanyListResponse {
  clients: Company[];
  total: number;
  totalCount: number;
  limit: number;
  offset: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Client with location data joined
 */
export interface CompanyWithLocation extends Company {
  location_email?: string;
  location_phone?: string;
  location_address?: string;
  address_line1?: string;
  address_line2?: string;
  state_province?: string;
  postal_code?: string;
  country_name?: string;
}
