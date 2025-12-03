# Multi-Currency Design & Implementation Plan

## 1. Executive Summary

This document details the technical implementation for "Native Currency Contracts" in the Alga PSA billing system.
**Core Principle:** A contract is defined in a specific currency. All rates (fixed, hourly, usage) within that contract are treated as cents/sub-units of that currency. Invoices generated from the contract inherit that currency. We do **not** support real-time FX conversion or mixed-currency invoices in Phase 1.

## 2. Database Schema & Migrations

We will build upon the initial migration strategy to ensure data integrity across billing, clients, and taxation.

### 2.1 Core Tables
*   **`contracts`**: Add `currency_code` (CHAR(3), Not Null, Default 'USD').
    *   *Rationale:* Defines the currency for all lines in this contract.
*   **`contract_templates`**: Add `currency_code` (CHAR(3), Not Null, Default 'USD').
    *   *Rationale:* Templates act as blueprints; cloning a template copies this currency to the new contract.
*   **`clients`**: Add `default_currency_code` (CHAR(3), Not Null, Default 'USD').
    *   *Rationale:* Defaults for manual invoices and new contract creation.
*   **`invoices`**: Add `currency_code` (CHAR(3), Not Null, Default 'USD').
    *   *Rationale:* Persisted at generation time to ensure historical accuracy.

### 2.2 Taxation Safety (New)
*   **`tax_rates`**: Add `currency_code` (CHAR(3), Nullable).
    *   *Rationale:* Critical for threshold-based taxes. If a tax rate has a "max tax amount" or "min threshold" defined in absolute numbers (e.g., 5000), we must ensure it is only applied to invoices in the matching currency.
    *   *Behavior:* If `null`, the rate is considered "currency agnostic" (pure percentage). If set, it only applies if the invoice currency matches.

### 2.3 Migration Script (`20251118134500_add_multi_currency_support.cjs`)
*   Update to include the `tax_rates` column.
*   **Backfill Strategy:** Update all existing rows to 'USD' to maintain current behavior.

## 3. Data Structures (TypeScript Interfaces)

### 3.1 Contract Interfaces (`server/src/interfaces/contract.interfaces.ts`)
```typescript
export interface IContract {
  // ... existing fields
  currency_code: string; // e.g., 'USD', 'EUR', 'GBP'
}

export interface IContractDTO {
   // ... used for creation
   currency_code?: string;
}
```

### 3.2 Client Interfaces (`server/src/interfaces/client.interfaces.ts`)
```typescript
export interface IClient {
  // ... existing fields
  default_currency_code: string;
}
```

### 3.3 Billing Interfaces (`server/src/interfaces/billing.interfaces.ts`)
```typescript
export interface IBillingResult extends TenantEntity {
  // ... existing fields
  currency_code: string; // Propagated from contract(s)
}

export interface IBillingCharge {
  // ... existing fields
  // No currency code needed per-charge as they must align with the parent result
}
```

### 3.4 Invoice Interfaces (`server/src/interfaces/invoice.interfaces.ts`)
```typescript
export interface IInvoice {
  // ... existing fields
  currency_code: string;
}

export interface InvoiceViewModel {
  // ... existing fields
  currencyCode: string; // Passed to Wasm template for formatting
}
```

## 4. Algorithm & Logic Updates

### 4.1 Billing Engine (`server/src/lib/billing/billingEngine.ts`)

The `calculateBilling` method requires a rigorous validation step before summing charges.

**Revised Flow:**
1.  **Fetch Client Config:** Retrieve `client.default_currency_code`.
2.  **Fetch Contracts:** When retrieving `client_contract_lines` and joining `contracts`, select `contracts.currency_code`.
3.  **Validation (Critical Gap):**
    *   Group active contract lines by `currency_code`.
    *   **Rule:** If multiple currencies are detected in the active contracts for the *same* billing cycle, throw a blocking error: *"Billing Error: Client {id} has active contracts in multiple currencies ({currencies}). Mixed currency billing is not supported."*
4.  **Resolution:**
    *   If contracts exist, set `billingResult.currency_code = contracts[0].currency_code`.
    *   If *no* contracts exist (e.g., usage-only billing or manual-only flow), default to `client.default_currency_code`.
5.  **Charge Calculation:** Proceed as normal. The system assumes all `rate` and `total` integers are in the resolved currency.

### 4.2 Invoice Service (`server/src/lib/services/invoiceService.ts`)

**`persistInvoiceCharges` / `createInvoice`:**
*   Accept `currency_code` as a required parameter or extract it from `IBillingResult`.
*   Insert into `invoices` table: `currency_code`.

**`updateInvoiceTotalsAndRecordTransaction`:**
*   No math changes needed (summing integers).
*   Ensure `Transaction` records inherit the currency if the transaction table supports it (or assume ledger matches invoice currency).

### 4.3 Manual Invoices (`server/src/lib/actions/manualInvoiceActions.ts`)

**`generateManualInvoice`:**
1.  Accept optional `currency_code` in input DTO.
2.  If provided, use it.
3.  If not provided, fetch `client.default_currency_code` and use it.
4.  Persist to `invoices` table.

### 4.4 Tax Service (`server/src/lib/services/taxService.ts`)

**`calculateTax`:**
*   Add `currencyCode` parameter.
*   **Threshold Check:** When loading `tax_rates` or `tax_rate_thresholds`:
    *   If `tax_rates.currency_code` is NOT NULL and does NOT match input `currencyCode`, skip this rate or throw configuration error.
    *   This prevents a "1000 JPY" threshold from acting like "1000 USD".

### 4.5 Formatting & Display (Frontend/Templates)

*   **`server/src/lib/i18n/client/index.ts`**: Ensure `formatCurrency(amount, currencyCode)` is used everywhere instead of hardcoded '$'.
*   **Wasm Templates**: Pass `currencyCode` to the template context. Update AssemblyScript logic to use `Intl` (if supported) or a map of symbols (`USD` -> `$`, `EUR` -> `€`) based on the code.

## 5. Implementation Roadmap

### Phase 1: Database & Models
1.  **Modify Migration**: Add `currency_code` to `tax_rates` in `20251118134500...`.
2.  **Run Migration**: Apply changes locally.
3.  **Update Models/Types**: Update `IContract`, `IClient`, `IInvoice` definitions.

### Phase 2: Logic Core
4.  **Refactor BillingEngine**: Implement the mixed-currency check and currency resolution logic.
5.  **Update InvoiceService**: Ensure currency is persisted.
6.  **Update Contract Actions**: Allow setting currency during creation/update.
7.  **Update Manual Invoices**: Add default currency lookup.

### Phase 3: Safety & UI
8.  **Tax Service Update**: Implement currency-aware rate filtering.
9.  **UI Updates**: Add currency dropdowns to Contract forms and Client settings.
10. **Invoice Template**: Pass currency to renderer.

## 6. Verification Scenarios

| Scenario | Setup | Expected Outcome |
| :--- | :--- | :--- |
| **Standard USD** | Client (USD), Contract (USD) | Invoice created in USD. |
| **Euro Contract** | Client (USD), Contract (EUR) | Invoice created in EUR. Rates treated as Euro-cents. |
| **Mixed Error** | Client (USD), Contract A (USD), Contract B (EUR) active same cycle | **Billing Fails** with explicit error message. |
| **Manual Invoice** | Client (GBP), No Contract | Invoice created in GBP (client default). |
| **Tax Mismatch** | Invoice (EUR), Tax Rate (Defined as USD-only) | Tax Service ignores USD rate or throws config error (depending on strictness setting). |

## 7. Phased Todo List

### Phase 1: Schema & Types
- [ ] Update migration '20251118134500_add_multi_currency_support.cjs' to include 'tax_rates.currency_code' for tax safety (See Plan 2.2).
- [ ] Apply EE migrations to update the database.
- [ ] Update 'contract.interfaces.ts' and 'contractTemplate.interfaces.ts' with 'currency_code'.
- [ ] Update 'client.interfaces.ts' (default_currency) and 'invoice.interfaces.ts' (currency_code).
- [ ] Update 'billing.interfaces.ts' to include 'currency_code' in IBillingResult.

### Phase 2: Logic Implementation
- [ ] Update 'contractActions.ts' and 'contractTemplate' model to support saving/updating 'currency_code'.
- [ ] Update 'BillingEngine.ts' to fetch contract currencies and validate consistency (throw error on mixed currencies) (See Plan 4.1).
- [ ] Update 'BillingEngine.ts' to propagate the resolved 'currency_code' in IBillingResult.
- [ ] Update 'invoiceService.ts' ('persistInvoiceCharges') to save 'currency_code' to the invoices table.
- [ ] Update 'manualInvoiceActions.ts' to use input currency or default to client's 'default_currency_code'.
- [ ] Update 'TaxService.ts' to accept 'currencyCode' and filter tax rates/thresholds to match the invoice currency (See Plan 4.4).

### Phase 3: UI & Templates
- [ ] Update Contract and Template forms to include a currency selector.
- [ ] Update Client settings form to include 'Default Currency' selector.
- [ ] Update 'wasm-executor.ts' to inject 'currencyCode' into the invoice template context.
- [ ] Update Standard Templates (AssemblyScript) to use 'currencyCode' for formatting monetary values.

### Phase 4: Verification
- [ ] Perform manual test: Create EUR Contract -> Bill -> Verify Invoice Currency.
- [ ] Perform manual test: Attempt mixed currency billing and verify blocking error.
