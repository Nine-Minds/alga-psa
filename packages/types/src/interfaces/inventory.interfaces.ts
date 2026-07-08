import { TenantEntity } from './index';

/**
 * Inventory module interfaces.
 * See docs/plans/2026-06-26-inventory-module-design.md and ee/docs/plans/2026-06-26-inventory-module/.
 * Monetary fields are integer cents (bigint in the DB, surfaced as number here).
 */

export type StockLocationType = 'warehouse' | 'van' | 'office' | 'other';

export type StockUnitStatus =
  | 'in_stock'
  | 'allocated'
  | 'in_transit'
  | 'on_loan'
  | 'delivered'
  | 'returned'
  | 'in_rma'
  | 'retired';

export type StockMovementType =
  | 'receipt'
  | 'consume'
  | 'adjust'
  | 'transfer_out'
  | 'transfer_in'
  | 'return_restock'
  | 'return_defective'
  | 'rma_out'
  | 'rma_in'
  | 'loan_out'
  | 'loan_in'
  | 'retire';

export type StockMovementSourceDocType =
  | 'purchase_order'
  | 'sales_order'
  | 'ticket_material'
  | 'project_material'
  | 'contract'
  | 'rma'
  | 'transfer'
  | 'loan'
  | 'manual';

export type PurchaseOrderStatus = 'draft' | 'open' | 'partially_received' | 'received' | 'cancelled';

export type SalesOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'invoiced'
  | 'closed'
  | 'cancelled';

export type SalesOrderInvoiceMode = 'on_fulfillment' | 'manual';
export type SalesOrderAllocationMode = 'soft' | 'hard';
export type SalesOrderLineFulfillmentType = 'from_stock' | 'drop_ship';

export type StockTransferStatus = 'dispatched' | 'received' | 'cancelled';

export type RmaType = 'standard' | 'advance_replacement';

export type RmaStatus =
  | 'open'
  | 'awaiting_return'
  | 'returned'
  | 'sent_to_vendor'
  | 'replacement_received'
  | 'replacement_deployed'
  | 'dead_unit_owed'
  | 'dead_unit_returned'
  | 'replaced'
  | 'credited'
  | 'charged'
  | 'closed';

export type KitPricingMode = 'sum' | 'fixed';

export interface IStockLocation extends TenantEntity {
  location_id: string;
  name: string;
  location_type: StockLocationType;
  assigned_user_id?: string | null;
  manager_user_id?: string | null;
  // Optional physical address (warehouse/office have one; a Vehicle location does not).
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
  /**
   * Occupancy, populated only on list reads with includeStock.
   * - item_type_count: distinct products on hand (what the row shows — meaningful across many types).
   * - on_hand_qty: total pieces on hand (coarse; shown in the drill-in header, not the row).
   * - unit_count: present serialized units (gates Deactivate; flags allocated / in-transit).
   */
  item_type_count?: number;
  on_hand_qty?: number;
  unit_count?: number;
}

export interface IProductInventorySettings extends TenantEntity {
  service_id: string;
  track_stock: boolean;
  is_serialized: boolean;
  is_kit: boolean;
  creates_asset_on_delivery: boolean;
  reorder_point?: number | null;
  reorder_quantity?: number | null;
  average_cost?: number | null;
  cost_currency: string;
  kit_pricing_mode: KitPricingMode;
  kit_fixed_price?: number | null;
  default_location_id?: string | null;
  preferred_vendor_id?: string | null;
  /** asset_type applied when a delivered serialized unit becomes a managed asset (F026); fallback 'unknown'. */
  default_asset_type?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface IStockLevel extends TenantEntity {
  service_id: string;
  location_id: string;
  quantity_on_hand: number;
  reserved_quantity: number;
  held_quantity: number;
  reorder_point?: number | null;
  /** Derived: quantity_on_hand - reserved_quantity - held_quantity */
  available?: number;
  updated_at?: string | Date;
}

export interface IStockUnit extends TenantEntity {
  unit_id: string;
  service_id: string;
  serial_number: string;
  mac_address?: string | null;
  status: StockUnitStatus;
  location_id?: string | null;
  client_id?: string | null;
  asset_id?: string | null;
  allocated_so_line_id?: string | null;
  warranty_expires_at?: string | Date | null;
  warranty_term?: string | null;
  loan_due_at?: string | Date | null;
  unit_cost?: number | null;
  cost_currency: string;
  received_at?: string | Date | null;
  delivered_at?: string | Date | null;
  source_po_id?: string | null;
  notes?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
  // Denormalized display fields resolved by the list/search readers (LEFT JOINs).
  // Read-only; present on rows fetched for UI listings, absent on bare inserts/updates.
  location_name?: string | null;
  client_name?: string | null;
}

export interface IStockMovement extends TenantEntity {
  movement_id: string;
  movement_type: StockMovementType;
  service_id: string;
  unit_id?: string | null;
  from_location_id?: string | null;
  to_location_id?: string | null;
  quantity: number;
  unit_cost?: number | null;
  cost_currency?: string | null;
  cogs_cost?: number | null;
  reason?: string | null;
  source_doc_type?: StockMovementSourceDocType | null;
  source_doc_id?: string | null;
  performed_by?: string | null;
  created_at?: string | Date;
}

export interface IVendor extends TenantEntity {
  vendor_id: string;
  vendor_name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  payment_terms?: string | null;
  account_number?: string | null;
  notes?: string | null;
  is_active: boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface IPurchaseOrder extends TenantEntity {
  po_id: string;
  po_number: string;
  vendor_id: string;
  status: PurchaseOrderStatus;
  order_date?: string | Date | null;
  expected_date?: string | Date | null;
  ship_to_location_id?: string | null;
  is_drop_ship: boolean;
  drop_ship_client_id?: string | null;
  drop_ship_address?: Record<string, unknown> | null;
  currency_code: string;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
  lines?: IPurchaseOrderLine[];
}

export interface IPurchaseOrderLine extends TenantEntity {
  po_line_id: string;
  po_id: string;
  service_id: string;
  quantity_ordered: number;
  quantity_received: number;
  unit_cost: number;
  cost_currency: string;
  /** The distributor's part number, snapshotted from the vendor's price list (F057). */
  vendor_sku?: string | null;
  source_so_line_id?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface ISalesOrder extends TenantEntity {
  so_id: string;
  so_number: string;
  quote_id?: string | null;
  client_id: string;
  /** Denormalized client display name (joined in list reads); absent on bare row reads. */
  client_name?: string | null;
  status: SalesOrderStatus;
  order_date?: string | Date | null;
  expected_ship_date?: string | Date | null;
  ship_to?: Record<string, unknown> | null;
  currency_code: string;
  client_po_number?: string | null;
  invoice_mode: SalesOrderInvoiceMode;
  allocation_mode: SalesOrderAllocationMode;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
  lines?: ISalesOrderLine[];
}

export interface ISalesOrderLine extends TenantEntity {
  so_line_id: string;
  so_id: string;
  service_id: string;
  quantity_ordered: number;
  quantity_fulfilled: number;
  quantity_invoiced: number;
  /** Non-serialized reservation this line holds (capped at availability on confirm). Serialized lines stay 0 — their claim lives on stock_units.allocated_so_line_id. */
  quantity_reserved?: number;
  /** Location the reservation was placed at (drained exactly on release/fulfill). */
  reserved_location_id?: string | null;
  unit_price: number;
  cost_snapshot?: number | null;
  tax_rate_id?: string | null;
  fulfillment_type: SalesOrderLineFulfillmentType;
  parent_so_line_id?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export type VendorBillStatus = 'draft' | 'open' | 'paid' | 'void';

/** Light AP: what the vendor invoiced, optionally against a PO (F075, D9 — no GL). */
export interface IVendorBill extends TenantEntity {
  bill_id: string;
  vendor_id: string;
  po_id?: string | null;
  bill_number: string;
  bill_date?: string | Date;
  due_date?: string | Date | null;
  currency_code: string;
  status: VendorBillStatus;
  /** Cents. */
  total_amount: number;
  paid_at?: string | Date | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface IVendorBillLine extends TenantEntity {
  bill_line_id: string;
  bill_id: string;
  service_id?: string | null;
  description?: string | null;
  quantity: number;
  unit_cost: number;
  amount: number;
  created_at?: string | Date;
  updated_at?: string | Date;
}

/** Freight/duty/other attached to a PO, applied across received quantities (F069). */
export interface IPoLandedCost extends TenantEntity {
  landed_cost_id: string;
  po_id: string;
  cost_type: 'freight' | 'duty' | 'other';
  /** Cents, in the PO's currency. */
  amount: number;
  currency_code: string;
  allocation_method: 'value' | 'quantity';
  description?: string | null;
  applied: boolean;
  applied_at?: string | Date | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export type CountSessionStatus = 'draft' | 'in_progress' | 'review' | 'approved' | 'cancelled';

/** A per-location stock-take session (F059). Counts are blind; approval applies variances via 'adjust' movements with reason 'cycle_count'. */
export interface ICountSession extends TenantEntity {
  session_id: string;
  location_id: string;
  status: CountSessionStatus;
  created_by?: string | null;
  approved_by?: string | null;
  started_at?: string | Date | null;
  submitted_at?: string | Date | null;
  approved_at?: string | Date | null;
  notes?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface ICountLine extends TenantEntity {
  count_line_id: string;
  session_id: string;
  service_id: string;
  /** On-hand snapshot at session start (withheld from counters — blind count). */
  expected_qty: number;
  expected_serials?: string[] | null;
  counted_qty?: number | null;
  counted_serials?: string[] | null;
  counted_at?: string | Date | null;
  counted_by?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

/** A vendor's offer for a product: the distributor's SKU + contract cost (F052). */
export interface IVendorProduct extends TenantEntity {
  vendor_id: string;
  service_id: string;
  vendor_sku?: string | null;
  /** Contract cost in cents. */
  unit_cost?: number | null;
  cost_currency: string;
  lead_time_days?: number | null;
  /** At most one preferred offer per (tenant, product) — DB-enforced. */
  is_preferred: boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface IKitComponent extends TenantEntity {
  kit_service_id: string;
  component_service_id: string;
  quantity: number;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export interface IStockTransfer extends TenantEntity {
  transfer_id: string;
  from_location_id: string;
  to_location_id: string;
  status: StockTransferStatus;
  dispatched_by?: string | null;
  dispatched_at?: string | Date | null;
  received_by?: string | null;
  received_at?: string | Date | null;
  notes?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
  lines?: IStockTransferLine[];
}

export interface IStockTransferLine extends TenantEntity {
  transfer_line_id: string;
  transfer_id: string;
  service_id: string;
  quantity: number;
  unit_id?: string | null;
  created_at?: string | Date;
}

export interface IRmaCase extends TenantEntity {
  rma_id: string;
  rma_type: RmaType;
  returned_unit_id?: string | null;
  service_id?: string | null;
  client_id?: string | null;
  asset_id?: string | null;
  vendor_id?: string | null;
  rma_reference?: string | null;
  reason?: string | null;
  status: RmaStatus;
  replacement_unit_id?: string | null;
  dead_unit_due_date?: string | Date | null;
  dead_unit_returned_at?: string | Date | null;
  /** Draft invoice created when the client was charged for an unreturned dead unit (F040). */
  charge_invoice_id?: string | null;
  opened_at?: string | Date | null;
  closed_at?: string | Date | null;
  created_by?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}
