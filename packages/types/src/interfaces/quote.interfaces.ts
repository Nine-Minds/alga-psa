import { TenantEntity } from './index';
import type { ISO8601String } from '../lib/temporal';
import type { DiscountType, TaxSource } from './invoice.interfaces';
import type { TemplateAst } from '../lib/invoice-template-ast';

export type QuoteStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'converted'
  | 'cancelled'
  | 'superseded'
  | 'archived';

export interface IQuoteItem extends TenantEntity {
  quote_item_id: string;
  quote_id: string;
  service_id?: string | null;
  service_item_kind?: 'service' | 'product' | null;
  service_name?: string | null;
  service_sku?: string | null;
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit' | null;
  description: string;
  quantity: number;
  unit_price: number;
  cost?: number | null;
  cost_currency?: string | null;
  total_price: number;
  tax_amount: number;
  net_amount: number;
  unit_of_measure?: string | null;
  display_order: number;
  phase?: string | null;
  is_optional: boolean;
  is_selected: boolean;
  is_recurring: boolean;
  billing_frequency?: string | null;
  is_discount?: boolean;
  discount_type?: DiscountType | null;
  discount_percentage?: number | null;
  applies_to_item_id?: string | null;
  applies_to_service_id?: string | null;
  is_taxable?: boolean;
  tax_region?: string | null;
  tax_rate?: number | null;
  location_id?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

export interface IQuoteActivity extends TenantEntity {
  activity_id: string;
  quote_id: string;
  activity_type: string;
  description: string;
  performed_by?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: ISO8601String;
}

export interface IQuote extends TenantEntity {
  quote_id: string;
  quote_number?: string | null;
  client_id?: string | null;
  contact_id?: string | null;
  title: string;
  description?: string | null;
  quote_date?: ISO8601String | null;
  valid_until?: ISO8601String | null;
  status?: QuoteStatus | null;
  version: number;
  parent_quote_id?: string | null;
  po_number?: string | null;
  subtotal: number;
  discount_total: number;
  tax: number;
  total_amount: number;
  currency_code: string;
  tax_source?: TaxSource | null;
  internal_notes?: string | null;
  client_notes?: string | null;
  terms_and_conditions?: string | null;
  is_template: boolean;
  template_id?: string | null;
  converted_contract_id?: string | null;
  converted_invoice_id?: string | null;
  sent_at?: ISO8601String | null;
  viewed_at?: ISO8601String | null;
  accepted_at?: ISO8601String | null;
  accepted_by?: string | null;
  accepted_by_name?: string | null;
  rejected_at?: ISO8601String | null;
  rejection_reason?: string | null;
  cancelled_at?: ISO8601String | null;
  expired_at?: ISO8601String | null;
  converted_at?: ISO8601String | null;
  archived_at?: ISO8601String | null;
  opportunity_id?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
  quote_items?: IQuoteItem[];
  quote_activities?: IQuoteActivity[];
}

export interface IQuoteWithClient extends IQuote {
  client_name?: string | null;
  contact_name?: string | null;
}

export interface IQuoteListItem extends IQuote {
  client_name?: string | null;
  display_quote_number: string;
}

export type QuoteConversionTarget = 'contract' | 'invoice' | 'excluded';

export interface QuoteConversionPreviewItem {
  quote_item_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  is_optional: boolean;
  is_selected: boolean;
  is_recurring: boolean;
  is_discount?: boolean;
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit' | null;
  target: QuoteConversionTarget;
  reason?: string | null;
  location_id?: string | null;
  location_name?: string | null;
}

export interface QuoteConversionPreview {
  quote_id: string;
  available_actions: Array<'contract' | 'invoice' | 'both'>;
  contract_items: QuoteConversionPreviewItem[];
  invoice_items: QuoteConversionPreviewItem[];
  excluded_items: QuoteConversionPreviewItem[];
}

export interface QuoteViewModelParty {
  name: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  logo_url?: string | null;
}

export interface QuoteViewModelLocation {
  id: string;
  location_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  address_line3?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  country_name?: string | null;
  region_code?: string | null;
  /** Pre-joined full address, handy for single-line template fields. */
  full_address?: string | null;
}

export interface QuoteViewModelLineItem {
  quote_item_id: string;
  service_id?: string | null;
  service_item_kind?: 'service' | 'product' | null;
  service_name?: string | null;
  service_sku?: string | null;
  billing_method?: 'fixed' | 'hourly' | 'usage' | 'per_unit' | null;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  tax_amount: number;
  net_amount: number;
  unit_of_measure?: string | null;
  phase?: string | null;
  is_optional: boolean;
  is_selected: boolean;
  is_recurring: boolean;
  billing_frequency?: string | null;
  is_discount?: boolean;
  discount_type?: DiscountType | null;
  discount_percentage?: number | null;
  applies_to_item_id?: string | null;
  applies_to_service_id?: string | null;
  tax_region?: string | null;
  tax_rate?: number | null;
  location_id?: string | null;
  /** Resolved location object, when available. */
  location?: QuoteViewModelLocation | null;
}

export interface QuoteViewModelPhase {
  name: string;
  items: QuoteViewModelLineItem[];
}

export interface QuoteViewModelLocationGroup {
  location_id: string | null;
  location?: QuoteViewModelLocation | null;
  /** Convenience fields duplicated for simpler template binding expressions. */
  name?: string | null;
  address?: string | null;
  items: QuoteViewModelLineItem[];
  subtotal: number;
  tax: number;
  total: number;
}

export interface QuoteViewModel {
  quote_id: string;
  quote_number: string;
  title: string;
  description?: string | null;
  scope_of_work?: string | null;
  quote_date?: ISO8601String | null;
  valid_until?: ISO8601String | null;
  status?: QuoteStatus | null;
  version: number;
  po_number?: string | null;
  currency_code: string;
  subtotal: number;
  discount_total: number;
  tax: number;
  total_amount: number;
  terms_and_conditions?: string | null;
  client_notes?: string | null;
  client_id?: string | null;
  contact_id?: string | null;
  client?: QuoteViewModelParty | null;
  contact?: QuoteViewModelParty | null;
  tenant?: QuoteViewModelParty | null;
  line_items: QuoteViewModelLineItem[];
  recurring_items?: QuoteViewModelLineItem[];
  onetime_items?: QuoteViewModelLineItem[];
  service_items?: QuoteViewModelLineItem[];
  product_items?: QuoteViewModelLineItem[];
  recurring_subtotal?: number;
  recurring_tax?: number;
  recurring_total?: number;
  onetime_subtotal?: number;
  onetime_tax?: number;
  onetime_total?: number;
  service_subtotal?: number;
  service_tax?: number;
  service_total?: number;
  product_subtotal?: number;
  product_tax?: number;
  product_total?: number;
  phases?: QuoteViewModelPhase[];
  /**
   * Pre-computed location groupings for templates that want per-location
   * bands. When items span only one location (or none), this may be empty.
   */
  groups_by_location?: QuoteViewModelLocationGroup[];
  /**
   * True when items span ≥2 distinct locations — a convenience flag for
   * templates that auto-branch between flat and grouped layouts.
   */
  has_multiple_locations?: boolean;
  accepted_by_name?: string | null;
  accepted_at?: ISO8601String | null;
}

export type QuoteDocumentTemplateSource = 'standard' | 'custom';

export interface IQuoteDocumentTemplate extends TenantEntity {
  template_id: string;
  name: string;
  version: number;
  templateAst?: TemplateAst | null;
  isStandard?: boolean;
  is_default?: boolean;
  isTenantDefault?: boolean;
  templateSource?: QuoteDocumentTemplateSource;
  standard_quote_document_template_code?: string;
  selectValue?: string;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

export const QUOTE_STATUS_METADATA: Record<QuoteStatus, { label: string; description: string }> = {
  draft: { label: 'Draft', description: 'Quote is being prepared' },
  pending_approval: { label: 'Pending Approval', description: 'Quote is waiting for internal approval' },
  approved: { label: 'Approved', description: 'Quote is approved and ready to send' },
  sent: { label: 'Sent', description: 'Quote has been sent to the client' },
  accepted: { label: 'Accepted', description: 'Client accepted the quote' },
  rejected: { label: 'Rejected', description: 'Client rejected the quote' },
  expired: { label: 'Expired', description: 'Quote passed its validity date' },
  converted: { label: 'Converted', description: 'Quote has been converted to billing records' },
  cancelled: { label: 'Cancelled', description: 'Quote was cancelled before conversion' },
  superseded: { label: 'Superseded', description: 'Quote was replaced by a revision' },
  archived: { label: 'Archived', description: 'Quote is archived and read-only' }
};
