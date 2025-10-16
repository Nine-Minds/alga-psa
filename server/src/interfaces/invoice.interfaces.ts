import { DateValue, ISO8601String } from '@shared/types/temporal';
import { TenantEntity } from './index';
import { WasmInvoiceViewModel as RendererInvoiceViewModel, WasmInvoiceViewModel } from '../lib/invoice-renderer/types'; // Import the correct ViewModel

export interface IInvoice extends TenantEntity {
  invoice_id: string;
  client_id: string;
  invoice_date: DateValue;
  due_date: DateValue;
  subtotal: number;
  tax: number;
  total_amount: number;
  status: InvoiceStatus;
  invoice_number: string;
  finalized_at?: DateValue;
  credit_applied: number;
  billing_cycle_id?: string;
  is_manual: boolean;
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

export interface IInvoiceItem extends TenantEntity, NetAmountItem {
  item_id: string;
  invoice_id: string;
  service_id?: string;
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
  client_contract_id?: string; // Reference to the client contract assignment
  contract_name?: string; // Contract name
  is_bundle_header?: boolean; // Whether this item is a contract group header
  parent_item_id?: string; // Reference to the parent contract group header item
  created_by?: string;
  updated_by?: string;
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
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
  items: IInvoiceItem[];
}

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
  assemblyScriptSource: string;
  wasmBinary?: Buffer;
  isStandard?: boolean;
  isClone?: boolean;
  is_default?: boolean; // Legacy flag retained for compatibility
  isTenantDefault?: boolean;
  templateSource?: InvoiceTemplateSource;
  standard_invoice_template_code?: string;
  selectValue?: string;
  created_at?: ISO8601String; // Added timestamp
  updated_at?: ISO8601String; // Added timestamp
  parsed?: ParsedTemplate; // Added for backward compatibility with tests
  dsl?: string; // Added for backward compatibility with tests
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
};

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'pending' | 'prepayment' | 'partially_applied';

export interface ICreditAllocation extends TenantEntity {
    allocation_id: string;
    transaction_id: string;
    invoice_id: string;
    amount: number;
    created_at: ISO8601String;
}

export interface InvoiceViewModel {
  invoice_number: string;
  client_id: string;
  client: {
    name: string;
    logo: string;
    address: string;
  };
  contact: {
    name: string;
    address: string;
  }
  invoice_date: DateValue;
  invoice_id: string;
  due_date: DateValue;
  status: InvoiceStatus;
  subtotal: number;
  tax: number;
  total: number;
  total_amount: number;
  invoice_items: IInvoiceItem[];
  custom_fields?: Record<string, any>;
  finalized_at?: DateValue;
  credit_applied: number;
  billing_cycle_id?: string;
  is_manual: boolean;
}
