import { z } from 'zod';

/**
 * Invoice status types
 */
export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'pending'
  | 'prepayment'
  | 'partially_applied';

/**
 * Discount type for invoice items
 */
export type DiscountType = 'percentage' | 'fixed';

/**
 * Invoice entity representing a customer invoice
 */
export interface Invoice {
  invoice_id: string;
  tenant: string;
  client_id: string;
  invoice_number: string;
  invoice_date: string; // ISO8601 date string
  due_date: string; // ISO8601 date string
  subtotal: number;
  tax: number;
  total_amount: number;
  status: InvoiceStatus;
  finalized_at?: string; // ISO8601 timestamp
  credit_applied: number;
  billing_cycle_id?: string;
  is_manual: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Invoice item/charge representing a line item on an invoice
 */
export interface InvoiceItem {
  item_id: string;
  invoice_id: string;
  tenant: string;
  service_id?: string;
  contract_line_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  tax_amount: number;
  net_amount: number;
  tax_region?: string;
  tax_rate?: number;
  is_manual: boolean;
  is_taxable?: boolean;
  is_discount?: boolean;
  discount_type?: DiscountType;
  discount_percentage?: number;
  applies_to_item_id?: string;
  applies_to_service_id?: string;
  client_contract_id?: string;
  contract_name?: string;
  is_bundle_header?: boolean;
  parent_item_id?: string;
  created_by?: string;
  updated_by?: string;
  created_at?: string; // ISO8601 timestamp
  updated_at?: string; // ISO8601 timestamp
}

/**
 * Input for creating a manual invoice item
 */
export const createInvoiceItemSchema = z.object({
  service_id: z.string().uuid(),
  description: z.string().min(1, 'Description is required').max(500),
  quantity: z.number().min(0).default(1),
  unit_price: z.number().min(0),
  is_discount: z.boolean().optional(),
  discount_type: z.enum(['percentage', 'fixed']).optional(),
  discount_percentage: z.number().min(0).max(100).optional(),
  applies_to_item_id: z.string().uuid().optional(),
  applies_to_service_id: z.string().uuid().optional(),
});

export type CreateInvoiceItemInput = z.infer<typeof createInvoiceItemSchema>;

/**
 * Input schema for creating a manual invoice
 */
export const createManualInvoiceSchema = z.object({
  client_id: z.string().uuid(),
  invoice_date: z.string().optional(), // ISO date string, defaults to today
  due_date: z.string().optional(), // ISO date string
  items: z.array(createInvoiceItemSchema).min(1, 'At least one item is required'),
  is_prepayment: z.boolean().optional(),
  expiration_date: z.string().optional(), // For prepayments
});

export type CreateManualInvoiceInput = z.infer<typeof createManualInvoiceSchema>;

/**
 * Input schema for updating an invoice
 */
export const updateInvoiceSchema = z.object({
  invoice_id: z.string().uuid(),
  invoice_date: z.string().optional(),
  due_date: z.string().optional(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled', 'pending', 'prepayment', 'partially_applied']).optional(),
  notes: z.string().optional(),
});

export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

/**
 * Input schema for generating an invoice from a billing cycle
 */
export const generateInvoiceSchema = z.object({
  client_id: z.string().uuid(),
  billing_cycle_id: z.string().uuid().optional(),
  cycle_start: z.string(), // ISO date string
  cycle_end: z.string(), // ISO date string
  include_time_entries: z.boolean().default(true),
  include_usage: z.boolean().default(true),
  include_fixed: z.boolean().default(true),
});

export type GenerateInvoiceInput = z.infer<typeof generateInvoiceSchema>;

/**
 * Input schema for finalizing an invoice
 */
export const finalizeInvoiceSchema = z.object({
  invoice_id: z.string().uuid(),
  send_to_client: z.boolean().default(false),
});

export type FinalizeInvoiceInput = z.infer<typeof finalizeInvoiceSchema>;

/**
 * Filters for querying invoices
 */
export interface InvoiceFilters {
  search?: string; // Search invoice number or client
  client_id?: string;
  status?: InvoiceStatus | InvoiceStatus[];
  from_date?: string; // ISO date string
  to_date?: string; // ISO date string
  is_manual?: boolean;
  billing_cycle_id?: string;
  limit?: number;
  offset?: number;
  orderBy?: keyof Invoice;
  orderDirection?: 'asc' | 'desc';
}

/**
 * Paginated response for invoice queries
 */
export interface InvoiceListResponse {
  invoices: Invoice[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Invoice with its items for detailed views
 */
export interface InvoiceWithItems extends Invoice {
  items: InvoiceItem[];
}

/**
 * Invoice summary for dashboard/reports
 */
export interface InvoiceSummary {
  total_invoices: number;
  total_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  overdue_amount: number;
  draft_count: number;
  sent_count: number;
  paid_count: number;
  overdue_count: number;
}
