# Service Catalog Currency & Contract Currency Inheritance Plan

**Date:** 2025-12-05
**Author:** Claude (billing pod)
**Status:** Complete
**Related:** [2025-11-17-multi-currency-billing-plan.md](./2025-11-17-multi-currency-billing-plan.md)

## Problem Statement

The current multi-currency implementation has a design conflict:

1. **Contract Templates** have `currency_code` - intended to be inherited by contracts
2. **Clients** have `default_currency_code` - the client's preferred billing currency
3. **Services** in the service catalog have `default_rate` but **no currency context** - stored as plain integers without knowing the currency
4. **Services are added to Contract Templates** - but when templates reference services with currency-agnostic rates, the currency of those rates is ambiguous

When creating a contract, you must select a client. The client has a currency. If the template also has a currency, and services have no currency, there's ambiguity about which currency governs pricing.

## Solution: Services Define Currency, Templates Become Currency-Neutral

### Design Principles

1. **Services have explicit currency** - Each service's `default_rate` is tagged with a `currency_code`
2. **Templates are currency-neutral** - Templates define structure (services, billing frequency) but not currency
3. **Contracts inherit currency from Client** - The contract's currency comes from `clients.default_currency_code`
4. **Strict validation** - Block saving contracts if service currencies don't match the contract/client currency

### Currency Flow

```
SERVICE CATALOG
  └── service_name: "Consulting"
  └── default_rate: 15000 (150.00)
  └── currency_code: "USD"  ← Explicit currency for this rate

CONTRACT TEMPLATE (currency-neutral)
  └── template_lines
      └── services (references service catalog)
  └── NO currency_code (removed/deprecated)

CLIENT
  └── default_currency_code: "EUR"

CONTRACT (created from template for client)
  └── currency_code: "EUR" (inherited from client)
  └── VALIDATION: All referenced services must have currency_code = "EUR"
      └── If mismatch → Block save with error
```

## Implementation Plan

### Phase 1: Database Schema Changes

#### 1.1 Add `currency_code` to `service_catalog`

```sql
ALTER TABLE service_catalog
ADD COLUMN currency_code CHAR(3) NOT NULL DEFAULT 'USD';

-- Backfill: All existing services are assumed to be USD
UPDATE service_catalog SET currency_code = 'USD' WHERE currency_code IS NULL;
```

#### 1.2 Remove/Deprecate `currency_code` from `contract_templates`

Two options:
- **Option A (Clean):** Remove the column entirely via migration
- **Option B (Safe):** Keep column but stop using it, mark as deprecated

Recommendation: **Option A** - Remove the column since it creates confusion and isn't needed.

```sql
ALTER TABLE contract_templates DROP COLUMN currency_code;
```

### Phase 2: Type/Interface Updates

#### 2.1 Update `IService` interface

File: `server/src/lib/models/service.ts`

```typescript
interface IService {
  service_id: string;
  service_name: string;
  // ... existing fields
  default_rate: number;
  currency_code: string;  // NEW: Currency of default_rate
}
```

#### 2.2 Update `IContractTemplate` interface

File: `server/src/lib/models/contractTemplate.ts`

Remove `currency_code` from the interface.

### Phase 3: Service Catalog Updates

#### 3.1 Update service CRUD operations

Files:
- `server/src/lib/actions/serviceActions.ts`
- `server/src/lib/services/serviceService.ts`

- Add `currency_code` to create/update operations
- Default to tenant's base currency if not specified

#### 3.2 Update Service Catalog UI

Files:
- `server/src/components/services/ServiceForm.tsx` (or similar)
- `server/src/components/services/ServiceCatalog.tsx` (or similar)

- Add currency selector to service form
- Display currency badge next to rates in service list

### Phase 4: Contract Template Updates

#### 4.1 Remove currency from template forms

Files:
- `server/src/components/contracts/ContractTemplateForm.tsx` (or similar)
- `server/src/lib/actions/contractTemplateActions.ts`

- Remove currency selector from template creation/editing
- Update any queries that reference `contract_templates.currency_code`

### Phase 5: Contract Creation Validation

#### 5.1 Add currency validation when creating contracts

Files:
- `server/src/lib/actions/contractActions.ts`
- `server/src/lib/billing/utils/templateClone.ts`

Logic:
1. Get client's `default_currency_code`
2. Set contract's `currency_code` = client's currency
3. For each service in the contract/template:
   - Check if `service.currency_code` === `contract.currency_code`
   - If ANY mismatch: **Block save with descriptive error**

```typescript
function validateContractServiceCurrencies(
  contractCurrency: string,
  services: IService[]
): { valid: boolean; errors: string[] } {
  const mismatched = services.filter(s => s.currency_code !== contractCurrency);
  if (mismatched.length > 0) {
    return {
      valid: false,
      errors: mismatched.map(s =>
        `Service "${s.service_name}" is priced in ${s.currency_code}, but contract is in ${contractCurrency}`
      )
    };
  }
  return { valid: true, errors: [] };
}
```

#### 5.2 Update UI to show validation errors

- When user tries to save contract with mismatched currencies, show clear error message
- Optionally: Show warning in template view if template contains services in multiple currencies

### Phase 6: Testing

#### 6.1 Unit Tests

- Test currency validation function
- Test service CRUD with currency

#### 6.2 Integration Tests

- Test contract creation blocks when service currency mismatches
- Test contract creation succeeds when currencies match
- Test backfill migration

## Files Modified

### Database/Migrations
- [x] `20251205130000_add_currency_to_service_catalog.cjs` - Adds currency_code to service_catalog
- [x] `20251205130001_remove_currency_from_contract_templates.cjs` - Removes currency_code from contract_templates

### Types/Interfaces
- [x] `server/src/interfaces/billing.interfaces.ts` - Added currency_code to IService
- [x] `server/src/interfaces/contractTemplate.interfaces.ts` - Removed currency_code from IContractTemplate
- [x] `server/src/lib/models/service.ts` - Updated schema and queries to include currency_code
- [x] `server/src/lib/models/contractTemplate.ts` - Removed currency_code from insert

### Server Actions/Services
- [x] `server/src/lib/actions/serviceActions.ts` - Handle currency in service CRUD
- [x] `server/src/lib/actions/contractWizardActions.ts` - Added currency validation for services matching contract currency

### UI Components
- [x] `server/src/components/settings/billing/QuickAddService.tsx` - Added currency selector with dynamic currency symbol
- [x] `server/src/components/settings/billing/ServiceCatalogManager.tsx` - Added currency column and edit currency selector
- [x] `server/src/components/billing-dashboard/contracts/template-wizard/TemplateWizard.tsx` - Removed currency_code from wizard data
- [x] `server/src/components/billing-dashboard/contracts/template-wizard/steps/TemplateContractBasicsStep.tsx` - Removed currency selector

## Rollback Plan

If issues arise:
1. Revert migrations (add currency back to templates, remove from services)
2. Revert code changes
3. Services without currency will fall back to USD assumption

## Success Criteria

- [x] All services have explicit `currency_code`
- [x] Contract templates no longer have `currency_code`
- [x] Contract creation fails with clear error if service currencies don't match client currency
- [x] Existing contracts continue to work (backward compatible)
- [x] UI shows currency information clearly on services

## Open Questions

1. Should we allow tenant admins to bulk-update service currencies?
2. Should we show a "compatible services" filter when adding services to contracts?
3. Future: Multi-currency service pricing (same service, different rates per currency)?
