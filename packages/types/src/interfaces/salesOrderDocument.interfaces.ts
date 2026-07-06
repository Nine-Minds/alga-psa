import type { ISO8601String } from '../lib/temporal';

/**
 * A named party (the customer, or the tenant's own company) as shown on a Sales Order
 * document. Structurally identical to QuoteViewModelParty.
 */
// LEVERAGE: pattern document-party — same shape as QuoteViewModelParty; converge into a shared
// DocumentParty type when the generic document spine (Phase 2, Approach C) lands.
export interface SalesOrderDocumentParty {
  name: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  logo_url?: string | null;
}

/** One Sales Order line as rendered on a document (amounts in integer cents). */
export interface SalesOrderViewModelLineItem {
  so_line_id: string;
  service_id?: string | null;
  service_name?: string | null;
  service_sku?: string | null;
  description?: string | null;
  quantity_ordered: number;
  quantity_fulfilled: number;
  /** Unit price in integer cents. */
  unit_price: number;
  /** quantity_ordered × unit_price, in integer cents. */
  amount: number;
  /** 'from_stock' | 'drop_ship' — how the line is fulfilled. */
  fulfillment_type?: string | null;
  /** Convenience flag for templates: true when fulfillment_type === 'drop_ship'. */
  is_drop_ship: boolean;
}

/**
 * The render model a Sales Order document template binds against — the SO analog of
 * QuoteViewModel. Built by mapDbSalesOrderToViewModel. Money fields are integer cents.
 */
export interface SalesOrderViewModel {
  so_id: string;
  so_number: string;
  status?: string | null;
  order_date?: ISO8601String | null;
  expected_ship_date?: ISO8601String | null;
  client_po_number?: string | null;
  currency_code: string;
  notes?: string | null;
  client_id?: string | null;
  customer?: SalesOrderDocumentParty | null;
  /** The tenant's own company (issuer). Named to match the canonical invoice/quote data key
   *  so template binding paths (customer.*, tenantClient.*) resolve uniformly. */
  tenantClient?: SalesOrderDocumentParty | null;
  line_items: SalesOrderViewModelLineItem[];
  /** Σ line amounts, integer cents. */
  subtotal: number;
  /**
   * Tax in integer cents. Phase 1: 0 — SO lines carry tax_rate_id, not a stored tax amount;
   * the binding final tax is computed on the generated invoice, not the order document.
   */
  tax: number;
  /** subtotal + tax, integer cents. */
  total: number;
}
