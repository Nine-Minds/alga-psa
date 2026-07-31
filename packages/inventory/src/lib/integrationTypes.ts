/**
 * Locked contract types for the PSA-integration slices
 * (plan: ee/docs/plans/2026-07-02-inventory-psa-integration).
 *
 * Pure types only — no imports, safe for client components.
 */

// ---- Availability (S1 quote chips, S2 material pickers) ----

export interface ProductLocationAvailability {
  location_id: string;
  location_name: string;
  on_hand: number;
}

export interface ProductAvailability {
  service_id: string;
  track_stock: boolean;
  is_serialized: boolean;
  on_hand_total: number;
  /** on_hand_total minus open (soft) allocations */
  available_total: number;
  reorder_point: number | null;
  locations: ProductLocationAvailability[];
}

/** Optional stock fields appended to catalog picker rows for tracked products. */
export interface PickerStockFields {
  track_stock?: boolean;
  on_hand_total?: number | null;
  reorder_point?: number | null;
}

// ---- Client 360 (S3) ----

export interface ClientSalesOrderSummary {
  so_id: string;
  so_number: string;
  status: string;
  order_date: string | null; // ISO
  currency_code: string;
  /** sum of quantity_ordered * unit_price across lines, cents */
  total_amount: number;
  line_count: number;
}

export interface ClientEquipmentRow {
  unit_id: string;
  service_id: string;
  service_name: string;
  sku: string | null;
  serial_number: string | null;
  mac_address: string | null;
  status: string;
  delivered_at: string | null; // ISO
  asset_id: string | null;
}

export interface ClientRmaRow {
  rma_id: string;
  rma_number: string | null;
  status: string;
  created_at: string; // ISO
  service_name: string | null;
  serial_number: string | null;
}

// ---- Asset provenance (S3) ----

export interface AssetRmaHistoryRow {
  rma_id: string;
  rma_number: string | null;
  status: string;
  created_at: string; // ISO
  resolution: string | null;
}

export interface AssetInventoryProvenance {
  /** null when the asset has no inventory links */
  service_id: string | null;
  service_name: string | null;
  sku: string | null;
  unit_id: string | null;
  serial_number: string | null;
  mac_address: string | null;
  /** origin sales order, via unit → fulfillment → SO; null for e.g. ticket-material installs */
  origin_so_id: string | null;
  origin_so_number: string | null;
  delivered_at: string | null; // ISO
  rma_history: AssetRmaHistoryRow[];
}

// ---- Invoice COGS (S5) ----

export interface InvoiceLineCogsRow {
  item_id: string;
  so_id: string | null;
  so_number: string | null;
  so_line_id: string | null;
  /** cents; null when no COGS data exists for the line */
  cogs_total: number | null;
  /** line net amount in cents (denominator used for margin) */
  line_amount: number;
  /** 0..1, null when cogs_total is null or line_amount is 0 */
  margin_ratio: number | null;
}

// ---- Vendor bill export (S5) ----

export type VendorBillExportState = 'not_exported' | 'pending' | 'exported' | 'error';

export interface VendorBillExportStatus {
  bill_id: string;
  state: VendorBillExportState;
  exported_at: string | null; // ISO
  external_ref: string | null; // e.g. QBO bill id
  error_message: string | null;
}
