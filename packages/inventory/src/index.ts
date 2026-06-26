/**
 * @alga-psa/inventory
 *
 * Stock-and-hold inventory module for Alga PSA: per-location stock ledger,
 * serialized units (serial + MAC + warranty), vendors, purchase & sales orders,
 * kitting, transfers, loaners, and RMA. References the product catalog
 * (service_catalog) via product_inventory_settings; the catalog stays the master.
 */
export * from './lib';
export * from './actions';
