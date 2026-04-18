import type { DateValue, ISO8601String } from '../lib/temporal';
import { TenantEntity } from './index';
import { WasmInvoiceViewModel as RendererInvoiceViewModel, WasmInvoiceViewModel } from '../lib/invoice-renderer/types'; // Import the correct ViewModel
import type { TemplateAst } from '../lib/invoice-template-ast';

// Tax source types for external tax delegation
export type TaxSource = 'internal' | 'external' | 'pending_external';
export type InvoiceRecurringExecutionWindowKind = 'client_cadence_window' | 'contract_cadence_window';
export type InvoiceRecurringCadenceSource = 'client_schedule' | 'contract_anniversary';

// Derived tax import state used for UI + workflow gating (separate from invoice status).
export type TaxImportState = 'not_required' | 'pending' | 'complete';

export function getTaxImportState(taxSource?: TaxSource | null): TaxImportState {
  switch (taxSource) {
    case 'pending_external':
      return 'pending';
    case 'external':
      return 'complete';
    case 'internal':
    default:
      return 'not_required';
  }
}

export interface IInvoice extends TenantEntity {
  invoice_id: string;
  client_id: string;
  /** Snapshot of the purchase order number for this invoice (nullable). */
  po_number?: string | null;
  /** Client contract assignment that generated this invoice (nullable). */
  client_contract_id?: string | null;
  invoice_date: DateValue;
  due_date: DateValue;
  subtotal: number;
  tax: number;
  total_amount: number;
  currency_code: string;
  status: InvoiceStatus;
  invoice_number: string;
  finalized_at?: DateValue;
  credit_applied: number;
  billing_cycle_id?: string;
  is_manual: boolean;
  invoice_charges: IInvoiceCharge[];
  /** @deprecated Use invoice_charges instead. */
  invoice_items?: IInvoiceCharge[];
  /** Source of tax calculation: internal (Alga), external (accounting package), pending_external (awaiting import) */
  tax_source?: TaxSource;
  recurring_execution_window_kind?: InvoiceRecurringExecutionWindowKind | null;
  recurring_cadence_source?: InvoiceRecurringCadenceSource | null;
  recurring_service_period_start?: ISO8601String | null;
  recurring_service_period_end?: ISO8601String | null;
  recurring_invoice_window_start?: ISO8601String | null;
  recurring_invoice_window_end?: ISO8601String | null;
}

export interface NetAmountItem {
  quantity: number;
  rate: number;
  is_discount?: boolean;
  discount_type?: DiscountType;
  discount_percentage?: number;
  applies_to_item_id?: string;
  applies_to_service_id?: string; // Reference a service instead of an item
}

export interface IInvoiceChargeRecurringDetailPeriod {
  service_period_start?: ISO8601String | null;
  service_period_end?: ISO8601String | null;
  billing_timing?: 'arrears' | 'advance' | null;
}

export interface IInvoiceCharge extends TenantEntity, NetAmountItem {
  item_id: string;
  invoice_id: string;
  service_id?: string;
  service_period_start?: ISO8601String | null;
  service_period_end?: ISO8601String | null;
  billing_timing?: 'arrears' | 'advance' | null;
  /**
   * Canonical recurring detail periods linked to this charge.
   * When present, these rows are authoritative and the parent service-period
   * fields are summary values derived from them.
   * Historical flat invoices and non-recurring charges omit this field.
   */
  recurring_detail_periods?: IInvoiceChargeRecurringDetailPeriod[];
  service_item_kind?: 'service' | 'product';
  service_sku?: string | null;
  service_name?: string | null;
  contract_line_id?: string; // Added for consolidated fixed items
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
  applies_to_service_id?: string; // Reference a service instead of an item
  location_id?: string | null;
  client_contract_id?: string; // Reference to the client contract assignment
  contract_name?: string; // Contract name
  is_bundle_header?: boolean; // Whether this item is a contract group header
  parent_item_id?: string; // Reference to the parent contract group header item
  created_by?: string;
  updated_by?: string;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
  // External tax fields (populated when tax is calculated by external accounting system)
  /** Tax amount calculated by external accounting system (in cents) */
  external_tax_amount?: number;
  /** Tax code from external accounting system */
  external_tax_code?: string;
  /** Tax rate from external accounting system */
  external_tax_rate?: number;
}

export type DiscountType = 'percentage' | 'fixed';

/**
 * Interface for adding manual items to an invoice
 */
// export interface IManualInvoiceItem {
//   description: string;
//   quantity: number;
//   item_id: string;
//   rate: number;
//   service_id?: string;
//   discount_type?: DiscountType;
//   discount_percentage?: number;
//   applies_to_item_id?: string;
// }

/**
 * Request interface for adding manual items to an existing invoice
 */
export interface IAddManualItemsRequest {
  invoice_id: string;
  items: IInvoiceCharge[];
}

// Temporary alias to avoid breaking external imports during the rename rollout.
export type IInvoiceItem = IInvoiceCharge;

export type BlockType = 'text' | 'dynamic' | 'image';

export interface LayoutBlock {
  block_id: string;
  type: BlockType;
  content: string;
  grid_column: number;
  grid_row: number;
  grid_column_span: number;
  grid_row_span: number;
  styles: Record<string, string>;
}

export type ParsedTemplate = {
  sections: Section[];
  globals: Calculation[];
};

export type InvoiceTemplateSource = 'standard' | 'custom';

export interface IInvoiceTemplate extends TenantEntity {
  template_id: string;
  name: string;
  version: number;
  templateAst?: TemplateAst | null;
  isStandard?: boolean;
  isClone?: boolean;
  is_default?: boolean; // Legacy flag retained for compatibility
  isTenantDefault?: boolean;
  templateSource?: InvoiceTemplateSource;
  standard_invoice_template_code?: string;
  selectValue?: string;
  created_at?: ISO8601String; // Added timestamp
  updated_at?: ISO8601String; // Added timestamp
}

export interface GlobalCalculation {
  type: 'calculation';
  name: string;
  expression: {
      operation: string;
      field: string;
  };
  isGlobal: boolean;
}

export interface Field extends BaseTemplateElement {
  type: 'field';
  name: string;
}

export interface Group extends BaseTemplateElement {
  type: 'group';
  name: string;
  groupBy: string;
  aggregation?: 'sum' | 'count';
  aggregationField?: string;
  showDetails?: boolean;
}

export interface Calculation extends BaseTemplateElement {
  type: 'calculation';
  name: string;
  expression: {
    operation: 'sum' | 'count' | 'avg';
    field: string;
  };
  isGlobal: boolean;
  listReference?: string;
}

export interface Style extends BaseTemplateElement {
  type: 'style';
  elements: string[];
  props: Record<string, string | number>;
}

export interface StaticText extends BaseTemplateElement {
  type: 'staticText';
  id?: string;
  content: string;
}

export interface Conditional extends BaseTemplateElement {
  type: 'conditional';
  condition: {
    field: string;
    op: '==' | '!=' | '>' | '<' | '>=' | '<=';
    value: string | number | boolean;
  };
  content: TemplateElement[];
}

export type TemplateElement = Field | Group | Calculation | Style | Conditional | List | StaticText;

export interface BaseTemplateElement {
  type: string;
  position?: {
    column: number;
    row: number;
  };
  span?: {
    columnSpan: number;
    rowSpan: number;
  };
}

export interface List extends BaseTemplateElement {
  type: 'list';
  name: string;
  groupBy?: string;
  content: TemplateElement[];
}

export interface Section extends TenantEntity {
  type: 'header' | 'items' | 'summary';
  grid: {
    columns: number;
    minRows: number;
  };
  content: TemplateElement[];
}

export interface LayoutSection {
  id: string;
  name: string;
  layout: LayoutBlock[];
  grid_rows: number;
  grid_columns: number;
  order_number: number;
}

export interface DraggableLayoutBlock extends LayoutBlock {
  section: 'header' | 'lists' | 'footer';
}

export interface ICustomField {
  field_id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'boolean';
  default_value?: any;
}

export interface IInvoiceAnnotation {
  annotation_id: string;
  invoice_id: string;
  user_id: string;
  content: string;
  is_internal: boolean;
  created_at: Date;
}

export interface IInvoiceDesignerState {
  currentTemplate: IInvoiceTemplate;
  availableFields: Array<ICustomField | string>;
  conditionalRules: Array<IConditionalRule>;
}

export interface IConditionalRule {
  rule_id: string;
  condition: string;
  action: 'show' | 'hide' | 'format';
  target: string;
  format?: any;
}

export type PreviewInvoiceResponse = {
  success: true;
  data: WasmInvoiceViewModel; // Use the imported ViewModel alias
} | {
  success: false;
  error: string;
  executionIdentityKey?: string;
};

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'pending' | 'prepayment' | 'partially_applied';

export interface InvoiceStatusMetadata {
  label: string;
  description: string;
  /**
   * Indicates whether this status should be included in the default set of invoices
   * when generating accounting exports or similar downstream processes.
   */
  isDefaultForAccountingExport?: boolean;
}

export const INVOICE_STATUS_VALUES: ReadonlyArray<InvoiceStatus> = [
  'draft',
  'sent',
  'paid',
  'overdue',
  'cancelled',
  'pending',
  'prepayment',
  'partially_applied',
] as const;

export const INVOICE_STATUS_LABEL_DEFAULTS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
  pending: 'Pending',
  prepayment: 'Prepayment',
  partially_applied: 'Partially Applied',
};

export const INVOICE_STATUS_DESCRIPTION_DEFAULTS: Record<InvoiceStatus, string> = {
  draft: 'Work-in-progress invoices that have not been sent to the customer',
  sent: 'Invoices that have been finalized and sent to the customer',
  paid: 'Fully paid invoices ready for reconciliation',
  overdue: 'Finalized invoices that are past their due date',
  cancelled: 'Invoices that have been voided or cancelled',
  pending: 'Invoices awaiting approval or additional processing',
  prepayment: 'Advance payment or deposit invoices',
  partially_applied: 'Invoices with partial payments applied',
};

const INVOICE_STATUS_ACCOUNTING_DEFAULTS: Record<InvoiceStatus, boolean> = {
  draft: false,
  sent: true,
  paid: true,
  overdue: true,
  cancelled: false,
  pending: false,
  prepayment: true,
  partially_applied: true,
};

/**
 * @deprecated For UI rendering, use the `useInvoiceStatusOptions`, `useFormatInvoiceStatus`,
 * or `useFormatInvoiceStatusDescription` hooks from `@alga-psa/ui/hooks/useInvoiceEnumOptions`.
 * This map remains for non-UI callers that need the structural `isDefaultForAccountingExport`
 * flag and English fallback strings; do not add new UI consumers.
 */
export const INVOICE_STATUS_METADATA: Record<InvoiceStatus, InvoiceStatusMetadata> =
  INVOICE_STATUS_VALUES.reduce((acc, value) => {
    acc[value] = {
      label: INVOICE_STATUS_LABEL_DEFAULTS[value],
      description: INVOICE_STATUS_DESCRIPTION_DEFAULTS[value],
      ...(INVOICE_STATUS_ACCOUNTING_DEFAULTS[value]
        ? { isDefaultForAccountingExport: true }
        : {}),
    };
    return acc;
  }, {} as Record<InvoiceStatus, InvoiceStatusMetadata>);

export const INVOICE_STATUS_DISPLAY_ORDER: InvoiceStatus[] = [
  'sent',
  'paid',
  'partially_applied',
  'overdue',
  'prepayment',
  'pending',
  'draft',
  'cancelled'
];

export const DEFAULT_ACCOUNTING_EXPORT_STATUSES: InvoiceStatus[] = INVOICE_STATUS_DISPLAY_ORDER.filter(
  (status) => INVOICE_STATUS_METADATA[status]?.isDefaultForAccountingExport
);

export interface ICreditAllocation extends TenantEntity {
    allocation_id: string;
    transaction_id: string;
    invoice_id: string;
    amount: number;
    created_at: ISO8601String;
}

/**
 * Shape of a single `client_locations` row as referenced by invoice line
 * items on the rendered invoice view model. Mirrors `QuoteViewModelLocation`
 * from `quote.interfaces.ts` exactly; the parallel type alias is retained
 * so downstream code can refer to it as an invoice-specific concept without
 * reaching into the quote namespace.
 */
export interface InvoiceViewModelLocation {
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

/**
 * Pre-computed per-location line-item grouping for invoice templates that
 * want location "bands" (one location + address header + rows + per-location
 * subtotal). Mirrors `QuoteViewModelLocationGroup`.
 */
export interface InvoiceViewModelLocationGroup {
  location_id: string | null;
  location?: InvoiceViewModelLocation | null;
  /** Convenience fields duplicated for simpler template binding expressions. */
  name?: string | null;
  address?: string | null;
  items: IInvoiceCharge[];
  subtotal: number;
  tax: number;
  total: number;
}

export interface InvoiceViewModel {
  invoice_number: string;
  client_id: string;
  po_number?: string | null;
  client_contract_id?: string | null;
  client: {
    name: string;
    logo: string;
    address: string;
  };
  contact: {
    name: string;
    address: string;
  };
  tenantClient?: {
    name: string | null;
    address: string | null;
    logoUrl: string | null;
  } | null;
  invoice_date: DateValue;
  invoice_id: string;
  due_date: DateValue;
  status: InvoiceStatus;
  currencyCode: string;
  subtotal: number;
  tax: number;
  total: number;
  total_amount: number;
  invoice_charges: IInvoiceCharge[];
  service_period_start?: DateValue | null;
  service_period_end?: DateValue | null;
  custom_fields?: Record<string, any>;
  finalized_at?: DateValue;
  credit_applied: number;
  billing_cycle_id?: string;
  is_manual: boolean;
  tax_source?: 'internal' | 'external' | 'pending_external';
  recurring_execution_window_kind?: InvoiceRecurringExecutionWindowKind | null;
  recurring_cadence_source?: InvoiceRecurringCadenceSource | null;
  recurring_service_period_start?: ISO8601String | null;
  recurring_service_period_end?: ISO8601String | null;
  recurring_invoice_window_start?: ISO8601String | null;
  recurring_invoice_window_end?: ISO8601String | null;
  /**
   * Pre-computed location groupings for invoice templates and UI surfaces
   * that want per-location bands. When charges span only one location
   * (or none), this may be empty.
   */
  groups_by_location?: InvoiceViewModelLocationGroup[];
  /**
   * True when invoice_charges span ≥2 distinct locations — a convenience
   * flag for auto-branching between flat and grouped layouts.
   */
  has_multiple_locations?: boolean;
}
