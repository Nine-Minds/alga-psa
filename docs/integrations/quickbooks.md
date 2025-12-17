# QuickBooks Integration (Admin Guide)

Alga PSA currently supports **QuickBooks CSV** exports for manual import into QuickBooks. **QuickBooks Online (OAuth)** is displayed as **Coming soon** in the UI.

## QuickBooks CSV (Available Now)
### Where to configure
Go to **Settings → Integrations → Accounting** and select **QuickBooks CSV**.

### Configure mappings (required)
Before exporting invoices, configure mappings in the **QuickBooks CSV Mappings** section:
- **Clients** (Alga clients → QuickBooks “Customers”)
- **Items / Services** (Alga services → QuickBooks “Items”)
- **Tax Codes** (Alga tax codes → QuickBooks “TaxCode”)
- **Payment Terms** (Alga payment terms → QuickBooks “Term”)

These mappings are stored in `tenant_external_entity_mappings` under `integration_type = 'quickbooks_csv'`.

### Export invoices
Use **CSV Export for QuickBooks** to export invoices by date range and status. If required mappings are missing, the export will fail with a list of what to map.

**Immutability:** once an invoice is successfully exported, Alga records an invoice mapping and will exclude that invoice from future exports for `quickbooks_csv`.

### Import tax (optional)
If a tenant is configured to delegate tax calculation externally, Alga can import tax values back from QuickBooks report CSVs using the **Import Tax from QuickBooks CSV** panel.

## QuickBooks Online (OAuth) – Coming Soon
QuickBooks Online OAuth is visible on the Accounting Integrations setup screen but disabled until OAuth rollout is complete. When enabled, it will support direct API delivery and catalog-backed mapping selection.

