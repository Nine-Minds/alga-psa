# Tax System Completion & External Tax Passthrough Plan

## Purpose & Overview

Complete the Alga PSA tax system by exposing existing backend capabilities through UI and implementing an external tax passthrough system that allows accounting packages (Xero, QuickBooks) to handle tax calculations with results imported back into Alga PSA.

Primary outcomes:
- **UI Completion:** Expose composite tax components, progressive tax brackets, tax holidays, and client tax exemption features that exist in the backend but lack UI.
- **External Tax Mode:** Enable invoices to delegate tax calculation to external accounting systems, import calculated taxes back, and store them as authoritative while preserving internal tax calculation capabilities.
- **Reconciliation Dashboard:** Provide visibility into tax source (internal vs external) and any discrepancies between systems.

---

## Discovery Highlights

### Current Backend Capabilities (Implemented but Hidden)

| Feature | Backend Location | Status |
|---------|-----------------|--------|
| **Composite Tax Components** | `taxSettingsActions.ts:77-95`, `tax_components` table | Full CRUD, UI stripped |
| **Progressive Tax Brackets** | `taxSettingsActions.ts:97-115`, `tax_rate_thresholds` table | Full CRUD, UI stripped |
| **Tax Holidays** | `taxSettingsActions.ts:117-135`, `tax_holidays` table | Full CRUD, UI stripped |
| **Client Tax Exempt Flag** | `clients.is_tax_exempt` column | Field exists, no UI toggle |
| **Location-Specific Rates** | `client_tax_rates.location_id` column | Schema ready, not enforced |

### Code Intentionally Disabled

**`server/src/components/TaxSettingsForm.tsx:137`:**
```typescript
// Removed UI sections for Tax Components, Thresholds, and Holidays (Phase 1.2)
```

**`server/src/lib/models/clientTaxSettings.ts:94-129`:**
```typescript
// getCompositeTaxComponents() returns [] (commented out)
// getTaxRateThresholds() returns [] (commented out)
```

### Current Accounting Integration Architecture

```
┌─────────────────┐         ┌──────────────────┐
│   Alga PSA      │ ──────► │  Xero/QuickBooks │
│ (Tax Calculated)│         │ (Receives Tax)   │
└─────────────────┘         └──────────────────┘
       │                            │
       │ Pre-calculated tax         │ Cannot override
       │ amounts sent               │ tax calculations
       └────────────────────────────┘
         ONE-WAY ONLY - NO IMPORT
```

### Key Files Reference

**Tax Service & Actions:**
- `server/src/lib/services/taxService.ts` - Core calculation engine
- `server/src/lib/actions/taxRateActions.ts` - Tax rate CRUD
- `server/src/lib/actions/taxSettingsActions.ts` - Settings, components, thresholds, holidays
- `server/src/lib/actions/clientTaxRateActions.ts` - Client-tax associations
- `server/src/interfaces/tax.interfaces.ts` - Type definitions

**Tax UI Components:**
- `server/src/components/billing-dashboard/TaxRates.tsx` - Tax rate management
- `server/src/components/settings/tax/TaxRegionsManager.tsx` - Region management
- `server/src/components/TaxSettingsForm.tsx` - Client tax settings (stripped)
- `server/src/components/clients/ClientTaxRates.tsx` - Client default tax rate

**Accounting Integration:**
- `server/src/lib/adapters/accounting/accountingExportAdapter.ts` - Adapter interface
- `server/src/lib/adapters/accounting/quickBooksOnlineAdapter.ts` - QBO implementation
- `server/src/lib/adapters/accounting/xeroAdapter.ts` - Xero implementation
- `server/src/lib/services/accountingExportService.ts` - Export orchestration

**Database Tables:**
- `tax_rates` - Master tax rate definitions
- `tax_components` - Composite tax components
- `tax_rate_thresholds` - Progressive tax brackets
- `tax_holidays` - Temporary exemption periods
- `client_tax_settings` - Per-client tax configuration
- `client_tax_rates` - Client-tax rate associations
- `tax_regions` - Geographic tax regions

---

## Scope & Deliverables

### In Scope

1. **Phase A - UI for Existing Features:**
   - Composite tax component editor with sequence and compound controls
   - Progressive tax bracket editor with min/max/rate inputs
   - Tax holiday manager with date-range picker
   - Client tax exempt toggle
   - Tax precedence documentation in UI

2. **Phase B - External Tax Passthrough:**
   - Database schema for tax source tracking
   - Export mode that delegates tax to external system
   - Import service to fetch calculated taxes from Xero/QuickBooks
   - Reconciliation UI showing internal vs external tax

3. **Phase C - Integration & Testing:**
   - End-to-end tests for all new UI
   - Sandbox tests for external tax import
   - Documentation and admin guides

### Out of Scope

- Automatic tax rate updates from government sources
- Real-time tax calculation during quote/estimate creation
- Tax reporting/filing integrations
- Multi-currency tax handling (deferred)

---

## Phase A – UI Implementation for Existing Backend Features

### A.1 Re-enable Tax Component Data Fetching

**Objective:** Restore the data layer that fetches composite tax components from the database.

**Files to Modify:**
- `server/src/lib/models/clientTaxSettings.ts`

**Tasks:**
- [ ] **A.1.1** Uncomment `getCompositeTaxComponents()` method (lines 94-108)
  - Remove the early return of empty array
  - Ensure query joins `tax_components` with `composite_tax_mappings`
  - Return `ITaxComponent[]` with all fields: `tax_component_id`, `name`, `rate`, `sequence`, `is_compound`, `start_date`, `end_date`, `conditions`

- [ ] **A.1.2** Uncomment `getTaxRateThresholds()` method (lines 111-129)
  - Remove the early return of empty array
  - Query `tax_rate_thresholds` table filtered by `tax_rate_id`
  - Return `ITaxRateThreshold[]` with: `tax_rate_threshold_id`, `min_amount`, `max_amount`, `rate`

- [ ] **A.1.3** Verify `getTaxHolidays()` returns actual data
  - Currently not commented but may not be called
  - Query `tax_holidays` filtered by `tax_component_id`
  - Return `ITaxHoliday[]` with: `tax_holiday_id`, `start_date`, `end_date`, `description`

- [ ] **A.1.4** Add integration test for each data fetching method
  - Create test file: `server/src/test/unit/clientTaxSettings.test.ts`
  - Seed test data with composite rates, thresholds, and holidays
  - Verify correct data returned

**Acceptance Criteria:**
- All three methods return real data from database
- Existing tax calculation tests still pass
- New unit tests cover data fetching

---

### A.2 Create Tax Component Editor UI

**Objective:** Build a UI component for managing composite tax components within a tax rate.

**New File:**
- `server/src/components/settings/tax/TaxComponentEditor.tsx`

**Tasks:**
- [ ] **A.2.1** Create `TaxComponentEditor` component structure
  ```typescript
  interface TaxComponentEditorProps {
    taxRateId: string;
    components: ITaxComponent[];
    onComponentsChange: (components: ITaxComponent[]) => void;
    isReadOnly?: boolean;
  }
  ```

- [ ] **A.2.2** Implement component list display
  - DataTable showing: Name, Rate (%), Sequence, Compound (Yes/No), Date Range
  - Sort by `sequence` ascending
  - Visual indicator for compound components (icon or badge)

- [ ] **A.2.3** Implement "Add Component" functionality
  - Button opens modal/drawer with form fields:
    - Name (required, text input, max 100 chars)
    - Rate (required, number input, 0-100%, 2 decimal places)
    - Sequence (required, integer, auto-increments)
    - Is Compound (checkbox, default false)
    - Start Date (optional, date picker)
    - End Date (optional, date picker)
  - Form validation:
    - Name uniqueness within the tax rate
    - End date must be after start date if both provided
  - Call `createTaxComponent()` action on submit

- [ ] **A.2.4** Implement "Edit Component" functionality
  - Row action to open edit modal with pre-filled values
  - Call `updateTaxComponent()` action on submit
  - Prevent editing sequence to value already in use

- [ ] **A.2.5** Implement "Delete Component" functionality
  - Row action with confirmation dialog
  - Warning if component has tax holidays
  - Call `deleteTaxComponent()` action on confirm

- [ ] **A.2.6** Implement drag-and-drop sequence reordering
  - Allow reordering components via drag handle
  - Update all affected component sequences on drop
  - Batch update via `updateTaxComponent()` calls

- [ ] **A.2.7** Add compound tax calculation preview
  - Show example calculation below the list:
    ```
    Example: $100.00 base amount
    Component 1 (VAT 10%): $10.00
    Component 2 (Local 2%, compound): $2.20
    Total Tax: $12.20 (Effective Rate: 12.2%)
    ```
  - Update preview when components change

**Acceptance Criteria:**
- Full CRUD operations work for tax components
- Sequence ordering is maintained correctly
- Compound calculation preview matches `TaxService.calculateCompositeTax()` logic
- Form validation prevents invalid data entry

---

### A.3 Create Tax Threshold/Bracket Editor UI

**Objective:** Build a UI component for managing progressive tax brackets within a tax rate.

**New File:**
- `server/src/components/settings/tax/TaxThresholdEditor.tsx`

**Tasks:**
- [ ] **A.3.1** Create `TaxThresholdEditor` component structure
  ```typescript
  interface TaxThresholdEditorProps {
    taxRateId: string;
    thresholds: ITaxRateThreshold[];
    onThresholdsChange: (thresholds: ITaxRateThreshold[]) => void;
    currency: string; // For formatting
    isReadOnly?: boolean;
  }
  ```

- [ ] **A.3.2** Implement threshold list display
  - DataTable showing: Min Amount, Max Amount, Rate (%)
  - Format amounts with currency symbol
  - Show "No limit" or infinity symbol for null max_amount
  - Sort by `min_amount` ascending

- [ ] **A.3.3** Implement "Add Bracket" functionality
  - Button opens modal with form fields:
    - Min Amount (required, currency input, default to previous max + 0.01)
    - Max Amount (optional, currency input, null = unlimited)
    - Rate (required, number input, 0-100%, 2 decimal places)
  - Form validation:
    - Min must be >= 0
    - Max must be > min if provided
    - No overlapping brackets (check against existing)
    - No gaps between brackets (warn user)
  - Call `createTaxRateThreshold()` action on submit

- [ ] **A.3.4** Implement "Edit Bracket" functionality
  - Row action to open edit modal
  - Validate changes don't create overlaps/gaps
  - Call `updateTaxRateThreshold()` action on submit

- [ ] **A.3.5** Implement "Delete Bracket" functionality
  - Row action with confirmation
  - Warn if deletion creates gap in brackets
  - Call `deleteTaxRateThreshold()` action on confirm

- [ ] **A.3.6** Add progressive tax calculation preview
  - Input field for test amount
  - Show bracket-by-bracket breakdown:
    ```
    Amount: $75,000.00
    $0 - $10,000 @ 10%: $1,000.00
    $10,000 - $50,000 @ 15%: $6,000.00
    $50,000+ @ 20%: $5,000.00
    Total Tax: $12,000.00 (Effective Rate: 16.0%)
    ```
  - Update on amount change

- [ ] **A.3.7** Add bracket visualization
  - Optional: Visual bar chart showing brackets
  - Color-coded by rate
  - Tooltip on hover showing details

**Acceptance Criteria:**
- Full CRUD operations work for thresholds
- Validation prevents overlapping brackets
- Preview calculation matches `TaxService.calculateThresholdBasedTax()` logic
- Currency formatting respects tenant settings

---

### A.4 Create Tax Holiday Manager UI

**Objective:** Build a UI component for managing tax holidays (temporary exemption periods).

**New File:**
- `server/src/components/settings/tax/TaxHolidayManager.tsx`

**Tasks:**
- [ ] **A.4.1** Create `TaxHolidayManager` component structure
  ```typescript
  interface TaxHolidayManagerProps {
    taxComponentId: string;
    componentName: string;
    holidays: ITaxHoliday[];
    onHolidaysChange: (holidays: ITaxHoliday[]) => void;
    isReadOnly?: boolean;
  }
  ```

- [ ] **A.4.2** Implement holiday list display
  - DataTable showing: Start Date, End Date, Description, Status
  - Status column: "Active" (current date in range), "Upcoming", "Expired"
  - Sort by `start_date` descending (most recent first)
  - Visual indicator for currently active holidays

- [ ] **A.4.3** Implement "Add Holiday" functionality
  - Button opens modal with form fields:
    - Start Date (required, date picker)
    - End Date (required, date picker)
    - Description (optional, text input, max 255 chars)
  - Form validation:
    - End date must be after start date
    - Warn if overlaps with existing holiday for same component
  - Call `createTaxHoliday()` action on submit

- [ ] **A.4.4** Implement "Edit Holiday" functionality
  - Row action to open edit modal
  - Call `updateTaxHoliday()` action on submit

- [ ] **A.4.5** Implement "Delete Holiday" functionality
  - Row action with confirmation
  - Call `deleteTaxHoliday()` action on confirm

- [ ] **A.4.6** Add calendar view option
  - Toggle between list and calendar view
  - Calendar shows holidays as date ranges
  - Click on holiday to edit

- [ ] **A.4.7** Add bulk import from CSV
  - "Import Holidays" button
  - CSV format: start_date, end_date, description
  - Preview before import
  - Batch create via `createTaxHoliday()` calls

**Acceptance Criteria:**
- Full CRUD operations work for holidays
- Active/upcoming/expired status displays correctly
- Date validation prevents invalid ranges
- Calendar view renders holiday periods

---

### A.5 Integrate Advanced Tax Features into Tax Rate Editor

**Objective:** Add tabs/sections to the existing tax rate editor to expose components, thresholds, and holidays.

**Files to Modify:**
- `server/src/components/billing-dashboard/TaxRates.tsx`
- Create: `server/src/components/billing-dashboard/TaxRateDetailPanel.tsx`

**Tasks:**
- [ ] **A.5.1** Create `TaxRateDetailPanel` wrapper component
  - Receives `taxRateId` and `isComposite` props
  - Shows tabbed interface:
    - "Details" tab: Basic rate info (existing form)
    - "Components" tab: `TaxComponentEditor` (only if `is_composite` = true)
    - "Brackets" tab: `TaxThresholdEditor` (optional progressive taxation)
  - Load data for all tabs on mount

- [ ] **A.5.2** Add "Is Composite" toggle to tax rate creation form
  - Checkbox: "This is a composite tax with multiple components"
  - When checked, after creation redirect to Components tab
  - Set `is_composite: true` on the tax rate

- [ ] **A.5.3** Add "Use Progressive Brackets" toggle
  - Checkbox: "Use progressive tax brackets based on amount"
  - Mutually exclusive with flat percentage rate
  - When checked, hide percentage field and show Brackets tab

- [ ] **A.5.4** Update TaxRates list to show composite/progressive indicators
  - Icon or badge for composite rates
  - Icon or badge for progressive rates
  - Tooltip showing component count or bracket count

- [ ] **A.5.5** Add holiday management access from component editor
  - Each component row has "Manage Holidays" action
  - Opens `TaxHolidayManager` in drawer/modal
  - Shows holiday count badge on action button

- [ ] **A.5.6** Add help text explaining tax calculation precedence
  - Info panel explaining:
    1. Client tax exempt flag checked first
    2. Service-specific tax rate used if assigned
    3. Client default tax rate used as fallback
    4. Tax region lookup determines applicable rate
  - Link to documentation

**Acceptance Criteria:**
- Tax rate editor shows all advanced options
- Composite and progressive modes work correctly
- Users can access holiday management from component list
- Help text explains precedence clearly

---

### A.6 Add Client Tax Exempt Toggle

**Objective:** Expose the `is_tax_exempt` flag on clients in the UI.

**Files to Modify:**
- `server/src/components/clients/ClientBillingSettings.tsx` (or equivalent)
- `server/src/lib/actions/clientActions.ts`

**Tasks:**
- [ ] **A.6.1** Add "Tax Exempt" toggle to client billing settings
  - Checkbox: "This client is tax exempt"
  - Below the checkbox, text field: "Tax Exemption Certificate/Reference" (optional)
  - Save updates `clients.is_tax_exempt` field

- [ ] **A.6.2** Create `updateClientTaxExemptStatus` action
  ```typescript
  async function updateClientTaxExemptStatus(
    clientId: string,
    isTaxExempt: boolean,
    exemptionReference?: string
  ): Promise<void>
  ```
  - Updates `clients` table
  - Requires `billing.update` permission

- [ ] **A.6.3** Add tax exempt indicator to client list
  - Badge or icon on client row when `is_tax_exempt = true`
  - Filter option: "Show only tax exempt clients"

- [ ] **A.6.4** Add tax exempt indicator to invoice preview/generation
  - When generating invoice for tax exempt client:
    - Show notice: "Client is tax exempt - no tax applied"
    - Ensure `TaxService.calculateTax()` respects flag

- [ ] **A.6.5** Add audit trail for tax exempt changes
  - Log when `is_tax_exempt` changes
  - Record who made the change and when

**Acceptance Criteria:**
- Toggle saves correctly to database
- Tax calculation respects exempt flag
- Audit trail captures changes
- UI indicators show exempt status

---

### A.7 Documentation and Help Integration

**Objective:** Update documentation to match implemented features and add in-app help.

**Tasks:**
- [ ] **A.7.1** Update `docs/international_tax_support.md`
  - Remove references to non-existent UI features
  - Add accurate screenshots of new UI
  - Document all tax calculation modes

- [ ] **A.7.2** Create in-app help tooltips
  - "What is a composite tax?" tooltip
  - "What are progressive tax brackets?" tooltip
  - "When should I use tax holidays?" tooltip

- [ ] **A.7.3** Add tax setup wizard/guide
  - Step-by-step guide for common scenarios:
    1. Simple flat tax (e.g., 10% VAT)
    2. Composite tax (e.g., GST + PST)
    3. Progressive tax (e.g., income-based brackets)
  - Link from tax settings page

- [ ] **A.7.4** Document tax precedence rules
  - Clear documentation of:
    - Client exempt > Service rate > Client default > Region lookup
  - Include flowchart diagram

**Acceptance Criteria:**
- Documentation matches actual functionality
- Help tooltips provide useful context
- Setup wizard covers common use cases

---

## Phase B – External Tax Passthrough System

### B.1 Database Schema for External Tax Support

**Objective:** Add fields to track tax source and store externally-calculated tax amounts.

**New Migration File:**
- `server/migrations/YYYYMMDDHHMMSS_add_external_tax_support.cjs`

**Tasks:**
- [ ] **B.1.1** Add `tax_source` column to `invoices` table
  ```sql
  ALTER TABLE invoices
  ADD COLUMN tax_source VARCHAR(20) DEFAULT 'internal'
  CHECK (tax_source IN ('internal', 'external', 'pending_external'));

  COMMENT ON COLUMN invoices.tax_source IS
    'Source of tax calculation: internal (Alga), external (accounting package), pending_external (awaiting import)';
  ```

- [ ] **B.1.2** Add external tax fields to `invoice_charges` table
  ```sql
  ALTER TABLE invoice_charges
  ADD COLUMN external_tax_amount INTEGER,
  ADD COLUMN external_tax_code VARCHAR(50),
  ADD COLUMN external_tax_rate DECIMAL(5,2);

  COMMENT ON COLUMN invoice_charges.external_tax_amount IS
    'Tax amount calculated by external accounting system (in cents)';
  ```

- [ ] **B.1.3** Add tax delegation settings to `tenant_settings` table
  ```sql
  ALTER TABLE tenant_settings
  ADD COLUMN default_tax_source VARCHAR(20) DEFAULT 'internal',
  ADD COLUMN allow_external_tax_override BOOLEAN DEFAULT false,
  ADD COLUMN external_tax_adapter VARCHAR(50);

  COMMENT ON COLUMN tenant_settings.default_tax_source IS
    'Default tax calculation source for new invoices';
  ```

- [ ] **B.1.4** Add client-level tax source override
  ```sql
  ALTER TABLE client_tax_settings
  ADD COLUMN tax_source_override VARCHAR(20),
  ADD COLUMN external_tax_adapter_override VARCHAR(50);

  COMMENT ON COLUMN client_tax_settings.tax_source_override IS
    'Per-client override of tenant tax source setting';
  ```

- [ ] **B.1.5** Create `external_tax_imports` tracking table
  ```sql
  CREATE TABLE external_tax_imports (
    import_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant UUID NOT NULL REFERENCES tenants(tenant),
    invoice_id UUID NOT NULL REFERENCES invoices(invoice_id),
    adapter_type VARCHAR(50) NOT NULL,
    external_invoice_ref VARCHAR(255),
    imported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    imported_by UUID REFERENCES users(user_id),
    import_status VARCHAR(20) DEFAULT 'success',
    original_internal_tax INTEGER,
    imported_external_tax INTEGER,
    tax_difference INTEGER,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  CREATE INDEX idx_external_tax_imports_invoice
    ON external_tax_imports(invoice_id);
  CREATE INDEX idx_external_tax_imports_tenant
    ON external_tax_imports(tenant);
  ```

- [ ] **B.1.6** Create rollback migration
  - Remove all added columns and tables
  - Ensure clean rollback path

- [ ] **B.1.7** Update TypeScript interfaces
  - Add new fields to `IInvoice`, `IInvoiceCharge`, `ITenantSettings`, `IClientTaxSettings`
  - Create `IExternalTaxImport` interface

**Acceptance Criteria:**
- Migration runs successfully on fresh and existing databases
- Rollback works cleanly
- TypeScript interfaces match schema
- Default values preserve existing behavior

---

### B.2 Tax Source Selection UI

**Objective:** Allow users to configure tax delegation at tenant, client, and invoice levels.

**New Files:**
- `server/src/components/settings/tax/TaxSourceSettings.tsx`
- `server/src/components/invoices/InvoiceTaxSourceBadge.tsx`

**Tasks:**
- [ ] **B.2.1** Create tenant-level tax source settings UI
  - Radio buttons: "Internal (Alga PSA)", "External (Accounting Package)"
  - When External selected:
    - Dropdown: "Select Accounting System" (QuickBooks Online, Xero, etc.)
    - Warning: "Tax will be calculated by {system} and imported back"
  - Save to `tenant_settings`

- [ ] **B.2.2** Create client-level tax source override UI
  - Add to client billing settings
  - Options: "Use Tenant Default", "Internal", "External"
  - When External selected, show adapter dropdown
  - Save to `client_tax_settings`

- [ ] **B.2.3** Create invoice-level tax source indicator
  - Badge component showing: "Tax: Internal", "Tax: External", "Tax: Pending Import"
  - Tooltip explaining the source
  - Color-coded: Green (internal), Blue (external), Orange (pending)

- [ ] **B.2.4** Add tax source selection to manual invoice creation
  - When creating manual invoice:
    - Show tax source dropdown (inherits from client default)
    - Allow override per invoice
  - Set `invoices.tax_source` on creation

- [ ] **B.2.5** Update invoice detail view to show tax source
  - Add tax source badge to invoice header
  - If external, show "Imported from {system} on {date}"
  - Link to import history

**Acceptance Criteria:**
- Settings save correctly at each level
- Inheritance chain works: Invoice -> Client -> Tenant
- Visual indicators clearly show tax source
- Users understand implications of each setting

---

### B.3 Export Adapter Modifications for Tax Delegation

**Objective:** Modify accounting export adapters to support exporting invoices without tax (pending external calculation).

**Files to Modify:**
- `server/src/lib/adapters/accounting/accountingExportAdapter.ts`
- `server/src/lib/adapters/accounting/quickBooksOnlineAdapter.ts`
- `server/src/lib/adapters/accounting/xeroAdapter.ts`

**Tasks:**
- [ ] **B.3.1** Extend adapter capabilities interface
  ```typescript
  export interface AccountingExportAdapterCapabilities {
    deliveryMode: 'api' | 'file';
    supportsPartialRetry: boolean;
    supportsInvoiceUpdates: boolean;
    supportsTaxDelegation: boolean;        // NEW
    supportsInvoiceFetch: boolean;         // NEW
    supportsTaxComponentImport: boolean;   // NEW
  }
  ```

- [ ] **B.3.2** Add tax delegation mode to transform context
  ```typescript
  export interface AccountingExportAdapterContext {
    batch: AccountingExportBatch;
    lines: AccountingExportLine[];
    taxDelegationMode: 'include_tax' | 'exclude_tax' | 'zero_tax';  // NEW
  }
  ```

- [ ] **B.3.3** Modify QBO adapter transform for tax delegation
  - When `taxDelegationMode === 'exclude_tax'`:
    - Set `TaxCodeRef` to the mapped code (for compliance)
    - Set line amounts WITHOUT tax
    - Add metadata flag: `taxDelegated: true`
  - When `taxDelegationMode === 'zero_tax'`:
    - Use "Tax Exempt" or equivalent tax code
    - External system will apply its own tax

- [ ] **B.3.4** Modify Xero adapter transform for tax delegation
  - When `taxDelegationMode === 'exclude_tax'`:
    - Set `LineAmountType: 'Exclusive'`
    - Map to appropriate Xero tax code
    - Let Xero calculate tax
  - Store Xero invoice ID for later fetch

- [ ] **B.3.5** Add post-export callback for pending imports
  - After successful export with tax delegation:
    - Update invoice: `tax_source = 'pending_external'`
    - Store external document reference
    - Queue import job (or manual trigger)

- [ ] **B.3.6** Add adapter method for invoice fetch
  ```typescript
  interface AccountingExportAdapter {
    // ... existing methods
    fetchInvoice?(externalRef: string): Promise<ExternalInvoiceData | null>;
  }
  ```

**Acceptance Criteria:**
- Adapters correctly handle tax delegation mode
- Invoices export without tax when configured
- External references stored for import
- Invoice status updated to pending_external

---

### B.4 External Tax Import Service

**Objective:** Create service to fetch invoices from external systems and import calculated tax amounts.

**New Files:**
- `server/src/lib/services/externalTaxImportService.ts`
- `server/src/lib/adapters/accounting/taxImportAdapter.ts`

**Tasks:**
- [ ] **B.4.1** Create `ExternalTaxImportService` class
  ```typescript
  export class ExternalTaxImportService {
    async importTaxForInvoice(invoiceId: string): Promise<ExternalTaxImportResult>;
    async batchImportPendingTaxes(): Promise<BatchImportResult>;
    async getImportHistory(invoiceId: string): Promise<IExternalTaxImport[]>;
    async reconcileTaxDifferences(invoiceId: string): Promise<ReconciliationResult>;
  }
  ```

- [ ] **B.4.2** Implement QBO invoice fetch
  - Use `QboClientService` to fetch invoice by external ref
  - Extract per-line tax amounts from response:
    ```typescript
    interface QboInvoiceTaxData {
      invoiceId: string;
      totalTax: number;
      lines: Array<{
        lineId: string;
        description: string;
        amount: number;
        taxAmount: number;
        taxCode: string;
        taxRate: number;
      }>;
    }
    ```
  - Match QBO lines to Alga invoice charges

- [ ] **B.4.3** Implement Xero invoice fetch
  - Use `XeroClientService` to fetch invoice
  - Extract tax data from Xero response format
  - Handle multi-component taxes (GST + PST etc.)

- [ ] **B.4.4** Implement tax amount import logic
  ```typescript
  async importTaxForInvoice(invoiceId: string): Promise<ExternalTaxImportResult> {
    // 1. Get invoice and verify tax_source = 'pending_external'
    // 2. Get adapter based on invoice's export batch
    // 3. Fetch invoice from external system
    // 4. Match external lines to invoice_charges
    // 5. Update invoice_charges.external_tax_amount
    // 6. Update invoice.tax_source = 'external'
    // 7. Recalculate invoice.tax total
    // 8. Record import in external_tax_imports table
    // 9. Return result with any discrepancies
  }
  ```

- [ ] **B.4.5** Implement line matching algorithm
  - Primary match: Use stored external line reference
  - Fallback match: Match by description + amount
  - Handle partial matches with warning
  - Report unmatched lines as errors

- [ ] **B.4.6** Implement batch import for pending invoices
  ```typescript
  async batchImportPendingTaxes(): Promise<BatchImportResult> {
    // 1. Query invoices with tax_source = 'pending_external'
    // 2. Group by adapter type
    // 3. Import each group (with rate limiting)
    // 4. Return summary: success count, failure count, errors
  }
  ```

- [ ] **B.4.7** Create reconciliation logic
  - Compare internal tax calculation with imported external tax
  - Flag invoices with >1% difference
  - Store both values for audit

- [ ] **B.4.8** Add API endpoints
  ```
  POST /api/invoices/{id}/import-external-tax
  POST /api/invoices/batch-import-external-tax
  GET /api/invoices/{id}/external-tax-history
  ```

**Acceptance Criteria:**
- Tax import works for QBO and Xero
- Line matching handles edge cases
- Discrepancies are tracked and flagged
- Batch import handles large volumes

---

### B.5 External Tax Import UI

**Objective:** Build UI for managing external tax imports and viewing import history.

**New Files:**
- `server/src/components/invoices/ExternalTaxImportPanel.tsx`
- `server/src/components/invoices/TaxReconciliationView.tsx`

**Tasks:**
- [ ] **B.5.1** Create "Import External Tax" button on invoice detail
  - Only visible when `tax_source = 'pending_external'`
  - Button: "Import Tax from {System}"
  - Shows loading state during import
  - Displays success/error toast on completion

- [ ] **B.5.2** Create import history panel
  - Shows list of imports for invoice
  - Columns: Date, System, Status, Internal Tax, External Tax, Difference
  - Click to expand shows line-by-line comparison

- [ ] **B.5.3** Create batch import dashboard
  - Card showing: "X invoices pending external tax import"
  - "Import All" button triggers batch import
  - Progress indicator during batch import
  - Results summary when complete

- [ ] **B.5.4** Create tax reconciliation view
  - Side-by-side comparison:
    - Left: Alga internal calculation
    - Right: External system calculation
  - Per-line breakdown
  - Highlight differences
  - Action: "Accept External Tax" or "Keep Internal Tax"

- [ ] **B.5.5** Add reconciliation alerts
  - Dashboard widget: "X invoices have tax discrepancies"
  - Link to reconciliation queue
  - Filter by discrepancy amount

- [ ] **B.5.6** Create tax source history timeline
  - Visual timeline showing:
    - Invoice created (internal tax)
    - Exported to {system}
    - Tax imported from {system}
    - Any reconciliation actions

**Acceptance Criteria:**
- Users can import external tax with one click
- Import history provides full audit trail
- Reconciliation view clearly shows differences
- Batch operations handle large volumes

---

### B.6 Invoice Flow Updates

**Objective:** Update invoice generation and finalization flows to support external tax mode.

**Files to Modify:**
- `server/src/lib/services/invoiceService.ts`
- `server/src/lib/billing/billingEngine.ts`

**Tasks:**
- [ ] **B.6.1** Update invoice generation to check tax source setting
  ```typescript
  // In invoice generation:
  const taxSource = await getTaxSourceForClient(clientId);
  if (taxSource === 'external') {
    // Generate invoice with tax_source = 'pending_external'
    // Set tax amounts to 0 (or skip calculation)
    // Flag for export
  } else {
    // Existing internal tax calculation
  }
  ```

- [ ] **B.6.2** Add validation for invoice finalization with pending tax
  - Block finalization if `tax_source = 'pending_external'`
  - Show error: "Import external tax before finalizing"
  - Allow override with confirmation

- [ ] **B.6.3** Update invoice total calculation
  ```typescript
  // When tax_source = 'external':
  invoice.tax = sumOfExternalTaxAmounts();
  // When tax_source = 'internal':
  invoice.tax = sumOfInternalTaxAmounts();
  ```

- [ ] **B.6.4** Add tax source to invoice preview
  - Show which tax calculation mode will be used
  - If external, show: "Tax will be calculated by {system}"

- [ ] **B.6.5** Handle tax source changes after creation
  - Allow changing tax source on draft invoices
  - Recalculate tax based on new source
  - Warn if changing from external (loses imported data)

- [ ] **B.6.6** Update invoice PDF/email to show tax source
  - Add note on invoice: "Tax calculated by {system}" when external
  - Include in audit section

**Acceptance Criteria:**
- Invoice generation respects tax source settings
- Finalization blocks on pending external tax
- Totals calculate correctly for both modes
- Preview clearly shows tax calculation mode

---

### B.7 Accounting Export Service Updates

**Objective:** Integrate external tax mode into the existing accounting export workflow.

**Files to Modify:**
- `server/src/lib/services/accountingExportService.ts`
- `server/src/lib/validation/accountingExportValidation.ts`

**Tasks:**
- [ ] **B.7.1** Add tax delegation mode to batch creation
  ```typescript
  interface CreateExportBatchOptions {
    // ... existing fields
    taxDelegationMode?: 'include_tax' | 'delegate_tax';
  }
  ```

- [ ] **B.7.2** Update validation for tax delegation exports
  - When `delegate_tax`:
    - Validate adapter supports tax delegation
    - Validate all lines have valid tax code mappings
    - Skip internal tax amount validation

- [ ] **B.7.3** Add post-delivery tax import scheduling
  - After successful delivery with tax delegation:
    - Option 1: Queue automatic import after delay (configurable)
    - Option 2: Send notification to import manually
  - Record scheduled import in batch metadata

- [ ] **B.7.4** Add export status for tax-delegated batches
  - New status: `awaiting_tax_import`
  - Transitions: `delivered` -> `awaiting_tax_import` -> `tax_imported` -> `posted`

- [ ] **B.7.5** Create export batch tax import action
  - "Import Taxes for Batch" action on export batch
  - Triggers `ExternalTaxImportService.batchImportPendingTaxes()` for batch invoices

- [ ] **B.7.6** Update batch summary to show tax import status
  - Column: "Tax Status" (N/A, Pending Import, Imported, Discrepancy)
  - Count of invoices in each status

**Acceptance Criteria:**
- Tax delegation integrates with existing export flow
- Post-delivery import can be automatic or manual
- Batch status reflects tax import state
- Summary provides clear visibility

---

## Phase C – Testing and Documentation

### C.1 Unit Tests for Tax UI Components

**New Test Files:**
- `server/src/test/components/TaxComponentEditor.test.tsx`
- `server/src/test/components/TaxThresholdEditor.test.tsx`
- `server/src/test/components/TaxHolidayManager.test.tsx`

**Tasks:**
- [ ] **C.1.1** Test TaxComponentEditor
  - Renders component list correctly
  - Add component form validation
  - Edit component updates list
  - Delete component with confirmation
  - Sequence reordering works
  - Compound calculation preview accurate

- [ ] **C.1.2** Test TaxThresholdEditor
  - Renders threshold list correctly
  - Add bracket validation (no overlaps)
  - Edit bracket updates list
  - Delete bracket with confirmation
  - Progressive calculation preview accurate

- [ ] **C.1.3** Test TaxHolidayManager
  - Renders holiday list correctly
  - Add holiday date validation
  - Status calculation (active/upcoming/expired)
  - Calendar view renders

- [ ] **C.1.4** Test TaxSourceSettings
  - Tenant setting saves correctly
  - Client override saves correctly
  - Inheritance chain works

**Acceptance Criteria:**
- All UI components have >80% coverage
- Validation edge cases covered
- Accessibility tests pass

---

### C.2 Integration Tests for External Tax Import

**New Test Files:**
- `server/src/test/integration/externalTaxImport.test.ts`
- `server/src/test/integration/taxDelegationExport.test.ts`

**Tasks:**
- [ ] **C.2.1** Test tax delegation export flow
  - Create invoice with external tax source
  - Export with tax delegation mode
  - Verify external system receives correct data
  - Verify invoice status updated to pending_external

- [ ] **C.2.2** Test external tax import flow
  - Mock external system invoice response
  - Import tax for invoice
  - Verify invoice_charges updated
  - Verify invoice.tax recalculated
  - Verify import history recorded

- [ ] **C.2.3** Test line matching scenarios
  - Exact match by reference
  - Fallback match by description
  - Partial match handling
  - Unmatched line handling

- [ ] **C.2.4** Test reconciliation scenarios
  - Matching tax amounts
  - Small discrepancy (<1%)
  - Large discrepancy (>1%)
  - Accept/reject actions

- [ ] **C.2.5** Test batch import
  - Multiple invoices pending
  - Mixed success/failure
  - Rate limiting
  - Error recovery

**Acceptance Criteria:**
- All integration paths tested
- Edge cases covered
- Error scenarios handled

---

### C.3 Sandbox Testing with External Systems

**Tasks:**
- [ ] **C.3.1** QBO Sandbox testing
  - Set up QBO sandbox company
  - Test tax delegation export
  - Test invoice fetch
  - Test tax import
  - Document sandbox credentials handling

- [ ] **C.3.2** Xero Demo Company testing
  - Set up Xero demo company
  - Test tax delegation export
  - Test invoice fetch
  - Test multi-component tax import
  - Document sandbox credentials handling

- [ ] **C.3.3** Create test fixtures
  - Sample invoices for export
  - Mock external system responses
  - Expected import results

- [ ] **C.3.4** Performance testing
  - Batch import with 100+ invoices
  - Concurrent import handling
  - Memory usage monitoring

**Acceptance Criteria:**
- Both QBO and Xero sandbox tests pass
- Test fixtures created for CI
- Performance acceptable for large batches

---

### C.4 Documentation

**Tasks:**
- [ ] **C.4.1** Update `docs/international_tax_support.md`
  - Add sections for:
    - Composite tax components
    - Progressive tax brackets
    - Tax holidays
    - External tax passthrough
  - Remove references to non-existent features
  - Add accurate screenshots

- [ ] **C.4.2** Create `docs/external_tax_integration.md`
  - Overview of external tax mode
  - Setup guide for each accounting system
  - Tax delegation export process
  - Tax import process
  - Reconciliation workflow
  - Troubleshooting guide

- [ ] **C.4.3** Create admin guide
  - How to configure tax source settings
  - How to manage composite taxes
  - How to set up progressive brackets
  - How to handle tax discrepancies
  - Best practices

- [ ] **C.4.4** Update API documentation
  - New endpoints for external tax
  - Request/response examples
  - Error codes

- [ ] **C.4.5** Create release notes template
  - Summary of new features
  - Migration steps for existing tenants
  - Breaking changes (if any)
  - Known limitations

**Acceptance Criteria:**
- Documentation complete and accurate
- Screenshots match current UI
- API docs include all new endpoints
- Release notes ready for publication

---

## Appendix A: Database Schema Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           TAX SYSTEM SCHEMA                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐         ┌─────────────────────┐                    │
│  │   tax_regions   │         │     tax_rates       │                    │
│  │─────────────────│         │─────────────────────│                    │
│  │ region_code (PK)│◄────────│ region_code (FK)    │                    │
│  │ region_name     │         │ tax_rate_id (PK)    │                    │
│  │ is_active       │         │ tax_type            │                    │
│  │ tenant          │         │ tax_percentage      │                    │
│  └─────────────────┘         │ is_composite        │                    │
│                              │ start_date          │                    │
│                              │ end_date            │                    │
│                              │ tenant              │                    │
│                              └──────────┬──────────┘                    │
│                                         │                                │
│                    ┌────────────────────┼────────────────────┐          │
│                    │                    │                    │          │
│                    ▼                    ▼                    ▼          │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐ │
│  │   tax_components    │  │tax_rate_thresholds  │  │client_tax_rates │ │
│  │─────────────────────│  │─────────────────────│  │─────────────────│ │
│  │ tax_component_id(PK)│  │ threshold_id (PK)   │  │ client_id (FK)  │ │
│  │ tax_rate_id (FK)    │  │ tax_rate_id (FK)    │  │ tax_rate_id(FK) │ │
│  │ name                │  │ min_amount          │  │ is_default      │ │
│  │ rate                │  │ max_amount          │  │ location_id     │ │
│  │ sequence            │  │ rate                │  │ tenant          │ │
│  │ is_compound         │  │ tenant              │  └─────────────────┘ │
│  │ start_date          │  └─────────────────────┘                      │
│  │ end_date            │                                                │
│  │ tenant              │                                                │
│  └──────────┬──────────┘                                                │
│             │                                                            │
│             ▼                                                            │
│  ┌─────────────────────┐                                                │
│  │    tax_holidays     │                                                │
│  │─────────────────────│                                                │
│  │ tax_holiday_id (PK) │                                                │
│  │ tax_component_id(FK)│                                                │
│  │ start_date          │                                                │
│  │ end_date            │                                                │
│  │ description         │                                                │
│  └─────────────────────┘                                                │
│                                                                          │
│  ┌─────────────────────┐         ┌─────────────────────────────────┐   │
│  │client_tax_settings  │         │    external_tax_imports         │   │
│  │─────────────────────│         │─────────────────────────────────│   │
│  │ client_id (FK)      │         │ import_id (PK)                  │   │
│  │ is_reverse_charge   │         │ invoice_id (FK)                 │   │
│  │ tax_source_override │ [NEW]   │ adapter_type                    │   │
│  │ external_adapter    │ [NEW]   │ external_invoice_ref            │   │
│  │ tenant              │         │ imported_at                     │   │
│  └─────────────────────┘         │ original_internal_tax           │   │
│                                  │ imported_external_tax           │   │
│  ┌─────────────────────┐         │ tax_difference                  │   │
│  │      invoices       │         │ tenant                          │   │
│  │─────────────────────│         └─────────────────────────────────┘   │
│  │ invoice_id (PK)     │                                                │
│  │ tax_source          │ [NEW: internal/external/pending_external]     │
│  │ tax                 │                                                │
│  │ ...                 │                                                │
│  └─────────────────────┘                                                │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      invoice_charges                             │   │
│  │─────────────────────────────────────────────────────────────────│   │
│  │ item_id (PK)                                                     │   │
│  │ invoice_id (FK)                                                  │   │
│  │ tax_amount              (internal calculation)                   │   │
│  │ tax_region                                                       │   │
│  │ tax_rate                                                         │   │
│  │ external_tax_amount     [NEW] (external calculation)             │   │
│  │ external_tax_code       [NEW]                                    │   │
│  │ external_tax_rate       [NEW]                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix B: External Tax Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     EXTERNAL TAX PASSTHROUGH FLOW                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. INVOICE CREATION                                                     │
│  ┌──────────────────┐                                                   │
│  │ Check tax_source │                                                   │
│  │ setting          │                                                   │
│  └────────┬─────────┘                                                   │
│           │                                                              │
│     ┌─────┴─────┐                                                       │
│     │           │                                                       │
│     ▼           ▼                                                       │
│  ┌──────┐   ┌──────────┐                                               │
│  │INTERNAL│  │ EXTERNAL │                                               │
│  └───┬───┘   └────┬─────┘                                               │
│      │            │                                                      │
│      ▼            ▼                                                      │
│  ┌─────────┐  ┌─────────────────┐                                       │
│  │Calculate │  │Set tax_source = │                                       │
│  │tax via   │  │pending_external │                                       │
│  │TaxService│  │tax_amount = 0   │                                       │
│  └─────────┘  └────────┬────────┘                                       │
│                        │                                                 │
│  2. EXPORT TO ACCOUNTING SYSTEM                                         │
│                        │                                                 │
│                        ▼                                                 │
│  ┌─────────────────────────────────────┐                                │
│  │ Export with taxDelegationMode =     │                                │
│  │ 'delegate_tax'                      │                                │
│  │                                      │                                │
│  │ Adapter sends invoice WITHOUT tax    │                                │
│  │ External system calculates tax       │                                │
│  └─────────────────────┬───────────────┘                                │
│                        │                                                 │
│  3. TAX IMPORT                                                          │
│                        │                                                 │
│                        ▼                                                 │
│  ┌─────────────────────────────────────┐                                │
│  │ ExternalTaxImportService            │                                │
│  │                                      │                                │
│  │ 1. Fetch invoice from ext system    │                                │
│  │ 2. Extract tax amounts per line     │                                │
│  │ 3. Match to invoice_charges         │                                │
│  │ 4. Update external_tax_amount       │                                │
│  │ 5. Set tax_source = 'external'      │                                │
│  │ 6. Recalculate invoice total        │                                │
│  │ 7. Record in external_tax_imports   │                                │
│  └─────────────────────┬───────────────┘                                │
│                        │                                                 │
│  4. RECONCILIATION (if needed)                                          │
│                        │                                                 │
│                        ▼                                                 │
│  ┌─────────────────────────────────────┐                                │
│  │ Compare internal vs external tax    │                                │
│  │                                      │                                │
│  │ If difference > threshold:          │                                │
│  │   - Flag for review                 │                                │
│  │   - Show reconciliation UI          │                                │
│  │   - Allow accept/reject             │                                │
│  └─────────────────────────────────────┘                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix C: Tax Calculation Precedence

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     TAX CALCULATION PRECEDENCE                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  START: Calculate tax for invoice line                                   │
│                        │                                                 │
│                        ▼                                                 │
│  ┌─────────────────────────────────────┐                                │
│  │ 1. Check invoice.tax_source         │                                │
│  │    If 'external' -> use external_tax│                                │
│  │    If 'pending' -> tax = 0          │                                │
│  │    If 'internal' -> continue        │                                │
│  └─────────────────────┬───────────────┘                                │
│                        │                                                 │
│                        ▼                                                 │
│  ┌─────────────────────────────────────┐                                │
│  │ 2. Check client.is_tax_exempt       │                                │
│  │    If TRUE -> tax = 0               │                                │
│  │    If FALSE -> continue             │                                │
│  └─────────────────────┬───────────────┘                                │
│                        │                                                 │
│                        ▼                                                 │
│  ┌─────────────────────────────────────┐                                │
│  │ 3. Check invoice_charge.is_taxable  │                                │
│  │    If FALSE -> tax = 0              │                                │
│  │    If TRUE -> continue              │                                │
│  └─────────────────────┬───────────────┘                                │
│                        │                                                 │
│                        ▼                                                 │
│  ┌─────────────────────────────────────┐                                │
│  │ 4. Check service.tax_rate_id        │                                │
│  │    If SET -> use service tax rate   │                                │
│  │    If NULL -> continue              │                                │
│  └─────────────────────┬───────────────┘                                │
│                        │                                                 │
│                        ▼                                                 │
│  ┌─────────────────────────────────────┐                                │
│  │ 5. Check client default tax rate    │                                │
│  │    (from client_tax_rates)          │                                │
│  │    If SET -> use client tax rate    │                                │
│  │    If NULL -> continue              │                                │
│  └─────────────────────┬───────────────┘                                │
│                        │                                                 │
│                        ▼                                                 │
│  ┌─────────────────────────────────────┐                                │
│  │ 6. Look up by tax_region            │                                │
│  │    (from invoice_charge.tax_region) │                                │
│  │    Query tax_rates for region       │                                │
│  │    Apply date-based filtering       │                                │
│  └─────────────────────┬───────────────┘                                │
│                        │                                                 │
│                        ▼                                                 │
│  ┌─────────────────────────────────────┐                                │
│  │ 7. Calculate tax                    │                                │
│  │    - Simple: amount * rate          │                                │
│  │    - Composite: sum components      │                                │
│  │    - Progressive: bracket calc      │                                │
│  │    - Check tax holidays             │                                │
│  └─────────────────────────────────────┘                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Appendix D: File Reference Index

### Tax Backend Files
| File | Purpose |
|------|---------|
| `server/src/lib/services/taxService.ts` | Core tax calculation engine |
| `server/src/lib/actions/taxRateActions.ts` | Tax rate CRUD operations |
| `server/src/lib/actions/taxSettingsActions.ts` | Settings, components, thresholds, holidays CRUD |
| `server/src/lib/actions/clientTaxRateActions.ts` | Client-tax rate associations |
| `server/src/lib/models/clientTaxSettings.ts` | Data fetching (needs uncommenting) |
| `server/src/interfaces/tax.interfaces.ts` | Type definitions |

### Tax UI Files
| File | Purpose |
|------|---------|
| `server/src/components/billing-dashboard/TaxRates.tsx` | Tax rate list/editor |
| `server/src/components/settings/tax/TaxRegionsManager.tsx` | Region management |
| `server/src/components/TaxSettingsForm.tsx` | Client tax settings (stripped) |
| `server/src/components/clients/ClientTaxRates.tsx` | Client default tax rate |
| `server/src/components/clients/TaxRateCreateForm.tsx` | Inline tax rate creation |

### Accounting Integration Files
| File | Purpose |
|------|---------|
| `server/src/lib/adapters/accounting/accountingExportAdapter.ts` | Adapter interface |
| `server/src/lib/adapters/accounting/quickBooksOnlineAdapter.ts` | QBO implementation |
| `server/src/lib/adapters/accounting/xeroAdapter.ts` | Xero implementation |
| `server/src/lib/services/accountingExportService.ts` | Export orchestration |
| `server/src/lib/services/accountingMappingResolver.ts` | Entity mapping resolution |

### New Files to Create
| File | Purpose |
|------|---------|
| `server/src/components/settings/tax/TaxComponentEditor.tsx` | Composite tax component editor |
| `server/src/components/settings/tax/TaxThresholdEditor.tsx` | Progressive bracket editor |
| `server/src/components/settings/tax/TaxHolidayManager.tsx` | Tax holiday manager |
| `server/src/components/settings/tax/TaxSourceSettings.tsx` | Tax source configuration |
| `server/src/components/invoices/ExternalTaxImportPanel.tsx` | External tax import UI |
| `server/src/components/invoices/TaxReconciliationView.tsx` | Reconciliation comparison |
| `server/src/lib/services/externalTaxImportService.ts` | External tax import service |
| `server/migrations/XXXXXX_add_external_tax_support.cjs` | Schema migration |

---

## Revision History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2025-11-24 | 1.0 | Claude | Initial plan creation |
