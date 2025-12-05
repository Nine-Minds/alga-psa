# Currency Flow in Contracts

This document describes how currency is inherited and displayed across contract templates, clients, and contracts.

## Overview

Currency in Alga PSA follows a strict inheritance model. Once a contract is created, its currency is locked based on its source (template or client). This ensures billing consistency and prevents accidental currency mismatches.

## Currency Sources

### 1. Contract Templates
- Templates can have a currency set during creation or editing
- Currency is stored in `contract_templates.currency_code`
- Default: `USD`

### 2. Clients
- Each client has a default currency setting
- Currency is stored in `clients.default_currency_code`
- Default: `USD`
- Used when creating contracts without a template

### 3. Contracts
- Contracts inherit currency at creation time
- Currency is stored in `contracts.currency_code`
- **Currency is never editable on a contract** (read-only after creation)

## Currency Inheritance Rules

### Contract Creation Wizard (with Template)
| Step | Behavior |
|------|----------|
| Template Selection | Currency is set from the selected template |
| Client Selection | **Client list is filtered** to only show clients with matching default currency |
| Currency Field | Displayed as **read-only** with message: "Currency is set by the template" |

### Contract Creation Wizard (without Template)
| Step | Behavior |
|------|----------|
| Client Selection | Currency is set from the selected client's default currency |
| Currency Field | Displayed as **read-only** with message: "Currency is based on the client's default currency" |

### Quick Add Contract
| Step | Behavior |
|------|----------|
| Client Selection | Currency is set from the selected client's default currency |
| Currency Field | Displayed as **read-only** |

### Contract Detail View
- Currency is always displayed as read-only
- Shown in the "Contract Snapshot" card
- Cannot be edited regardless of contract status or invoice history

## UI Components

### Contract Wizard (`ContractWizard.tsx`)
- `ContractBasicsStep.tsx`: Handles currency display and client filtering
- Currency dropdown is replaced with a static display when a template or client is selected

### Contract Detail (`ContractDetail.tsx`)
- Currency shown in the Contract Snapshot card alongside other contract metadata
- Read-only display using currency code label (e.g., "US Dollar (USD)")

### Contract Header (`ContractHeader.tsx`)
- Currency shown in stats bar with Coins icon

### Contract Template Detail (`ContractTemplateDetail.tsx`)
- Currency displayed in Template Snapshot card
- Editable in template edit mode

### Quick Add Dialog (`ContractDialog.tsx`)
- Currency displayed based on selected client
- Read-only field

## Client Filtering by Currency

When a template is selected in the contract wizard, the client picker filters companies to only show those whose `default_currency_code` matches the template's `currency_code`.

**Implementation:** `ContractBasicsStep.tsx`
```tsx
const filteredCompanies = selectedTemplateId && selectedTemplate
  ? companies.filter(company =>
      company.default_currency_code === selectedTemplate.currency_code ||
      (!company.default_currency_code && selectedTemplate.currency_code === 'USD')
    )
  : companies;
```

## Rationale

This design ensures:
1. **Billing Consistency**: All line items in a contract use the same currency
2. **Invoice Accuracy**: Invoices inherit contract currency without ambiguity
3. **Client Alignment**: When using templates, only compatible clients can be selected
4. **Audit Trail**: Currency cannot be changed after contract creation, preserving historical accuracy

## Invoice Generation and Currency

### From Contracts (Billing Run)
To generate invoices from contracts:
1. Go to **Billing Dashboard** → **Invoicing** → **Generate** tab
2. Select the billing period and clients
3. Run the billing process

The billing engine:
- Uses the contract's `currency_code` for all charges
- Creates invoices with the contract's currency
- Stores `currency_code` on the invoice record

### Manual Invoices
When creating manual invoices:
- Currency is derived from the client's `default_currency_code`
- All line items display in the client's currency
- The total is formatted with the correct currency symbol

### Invoice Display
Invoice templates use the `currencyCode` field to format all monetary values:
- Standard templates (`standard-default.ts`, `standard-detailed.ts`)
- Use `formatCurrency(amount, currencyCode)` helper
- Currency symbols are mapped: USD→$, EUR→€, GBP→£, JPY→¥, etc.

## Related Documentation

- [Multi-Currency Design](../../ee/docs/plans/multi_currency_design.md) - Database schema and billing engine implementation
- [Multi-Currency Billing Plan](../../ee/docs/plans/2025-11-17-multi-currency-billing-plan.md) - Comprehensive billing enablement plan

## Currency Options

Supported currencies are defined in `ContractBasicsStep.tsx`:
- USD - US Dollar
- EUR - Euro
- GBP - British Pound
- CAD - Canadian Dollar
- AUD - Australian Dollar
- JPY - Japanese Yen
- CHF - Swiss Franc
- NZD - New Zealand Dollar
