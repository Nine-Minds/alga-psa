# Service Catalog Multi-Currency Pricing Plan

**Date:** 2025-12-05 (Revised: 2025-12-06)
**Author:** Claude (billing pod)
**Status:** In Progress
**Related:** [2025-11-17-multi-currency-billing-plan.md](./2025-11-17-multi-currency-billing-plan.md)

## Problem Statement

The current multi-currency implementation has a design conflict:

1. **Contract Templates** have `currency_code` - intended to be inherited by contracts
2. **Clients** have `default_currency_code` - the client's preferred billing currency
3. **Services** in the service catalog have `default_rate` but **no currency context**
4. **Services are added to Contract Templates** - but rates are currency-ambiguous

## Solution: Multi-Currency Pricing Per Service

### Design Principles

1. **Services support multiple currency/price pairs** - One service can have prices in USD, EUR, GBP, etc.
2. **Templates are currency-neutral** - Templates define structure (services, billing frequency) but not currency
3. **Contracts inherit currency from Client** - The contract's currency comes from `clients.default_currency_code`
4. **Validation at contract creation** - If a service doesn't have a price in the required currency, show which services need updating
5. **Simple default case** - Single-currency usage should be effortless (just add one price)

### Mental Model

```
SERVICE: "Managed Workstation"
  └── Prices:
      ├── USD: $150.00
      ├── EUR: €140.00
      └── GBP: £120.00

When creating a contract for a EUR client:
  → System looks up EUR price for each service
  → If any service lacks EUR price → Error listing services that need EUR pricing
```

### Currency Flow

```
SERVICE CATALOG
  └── service_name: "Managed Workstation"
  └── service_prices (1:many)
      ├── { currency_code: "USD", rate: 15000 }
      ├── { currency_code: "EUR", rate: 14000 }
      └── { currency_code: "GBP", rate: 12000 }

CONTRACT TEMPLATE (currency-neutral)
  └── template_lines
      └── services (references service catalog)
  └── NO currency_code

CLIENT
  └── default_currency_code: "EUR"

CONTRACT (created from template for client)
  └── currency_code: "EUR" (inherited from client)
  └── VALIDATION: All referenced services must have a EUR price
      └── If missing → Error: "The following services need EUR pricing: [list]"
```

## Implementation Plan

### Phase 1: Database Schema Changes

#### 1.1 Create `service_prices` table

```sql
CREATE TABLE service_prices (
  price_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant UUID NOT NULL REFERENCES tenants(tenant),
  service_id UUID NOT NULL REFERENCES service_catalog(service_id),
  currency_code CHAR(3) NOT NULL,
  rate INTEGER NOT NULL,  -- Amount in minor units (cents)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Each service can only have one price per currency
  UNIQUE(tenant, service_id, currency_code)
);

-- Index for lookups
CREATE INDEX idx_service_prices_service ON service_prices(service_id);
CREATE INDEX idx_service_prices_currency ON service_prices(currency_code);
```

#### 1.2 Migrate existing `default_rate` data

```sql
-- Move existing rates to service_prices table (assume USD)
INSERT INTO service_prices (tenant, service_id, currency_code, rate)
SELECT tenant, service_id, 'USD', default_rate
FROM service_catalog
WHERE default_rate IS NOT NULL AND default_rate > 0;
```

#### 1.3 Keep `default_rate` as convenience field (optional)

For backward compatibility and simple queries, we can keep `default_rate` on `service_catalog` as a denormalized "primary" rate. Alternatively, remove it entirely and always join to `service_prices`.

**Decision:** Keep `default_rate` for now as a convenience, but treat `service_prices` as the source of truth for multi-currency scenarios.

#### 1.4 Remove `currency_code` from `contract_templates`

```sql
ALTER TABLE contract_templates DROP COLUMN IF EXISTS currency_code;
```

### Phase 2: Type/Interface Updates

#### 2.1 Create `IServicePrice` interface

```typescript
interface IServicePrice {
  price_id: string;
  tenant: string;
  service_id: string;
  currency_code: string;
  rate: number;
  created_at: Date;
  updated_at: Date;
}
```

#### 2.2 Update `IService` interface

```typescript
interface IService {
  service_id: string;
  service_name: string;
  // ... existing fields
  default_rate: number;      // Convenience field (primary rate)
  prices?: IServicePrice[];  // All currency/rate pairs
}
```

#### 2.3 Remove `currency_code` from `IContractTemplate`

### Phase 3: Service Model Updates

#### 3.1 Update service queries to include prices

```typescript
// When fetching a service, optionally include all prices
async function getServiceWithPrices(serviceId: string): Promise<IService> {
  const service = await getService(serviceId);
  const prices = await knex('service_prices')
    .where({ service_id: serviceId });
  return { ...service, prices };
}

// Get price for specific currency
async function getServicePrice(serviceId: string, currencyCode: string): Promise<number | null> {
  const price = await knex('service_prices')
    .where({ service_id: serviceId, currency_code: currencyCode })
    .first();
  return price?.rate ?? null;
}
```

#### 3.2 Create service price CRUD operations

```typescript
async function setServicePrice(
  serviceId: string,
  currencyCode: string,
  rate: number
): Promise<IServicePrice> {
  // Upsert: insert or update if exists
}

async function removeServicePrice(
  serviceId: string,
  currencyCode: string
): Promise<void> {
  // Delete specific currency price
}
```

### Phase 4: Service Catalog UI Updates

#### 4.1 Design Goals

- **Simple case is simple**: Adding a single price should be as easy as before
- **Multi-currency is accessible**: Easy to add additional currency prices
- **Clear display**: Show all prices for a service at a glance

#### 4.2 Service Form Updates

**Option A: Inline Price List**
```
Service Name: [Managed Workstation]
Service Type: [Recurring      v]

Pricing:
┌─────────────┬────────────────┬─────────┐
│ Currency    │ Rate           │         │
├─────────────┼────────────────┼─────────┤
│ USD      v  │ $150.00        │ [Remove]│
│ EUR      v  │ €140.00        │ [Remove]│
├─────────────┴────────────────┴─────────┤
│ [+ Add Currency]                       │
└────────────────────────────────────────┘
```

**Option B: Primary + Additional**
```
Service Name: [Managed Workstation]
Default Rate: [150.00] Currency: [USD v]

Additional Pricing (optional):
  EUR: [140.00]  [x]
  GBP: [120.00]  [x]
  [+ Add Currency]
```

**Recommendation:** Option A - Treats all currencies equally, cleaner mental model.

#### 4.3 Service Catalog List View

Show primary currency with indicator if multiple currencies exist:

```
┌──────────────────────┬──────────┬───────────┬──────────┐
│ Service              │ Type     │ Rate      │ Actions  │
├──────────────────────┼──────────┼───────────┼──────────┤
│ Managed Workstation  │ Recurring│ $150 +2   │ Edit     │
│ Server Monitoring    │ Recurring│ $200      │ Edit     │
│ Consulting           │ Hourly   │ €175 +1   │ Edit     │
└──────────────────────┴──────────┴───────────┴──────────┘

"+2" indicates 2 additional currencies beyond the displayed one
```

### Phase 5: Contract Creation Validation

#### 5.1 Validation Logic

```typescript
interface CurrencyValidationResult {
  valid: boolean;
  missingPrices: Array<{
    service_id: string;
    service_name: string;
    required_currency: string;
  }>;
}

function validateServicesHaveCurrency(
  services: IService[],
  requiredCurrency: string
): CurrencyValidationResult {
  const missing = services.filter(service => {
    const hasPrice = service.prices?.some(p => p.currency_code === requiredCurrency);
    return !hasPrice;
  });

  return {
    valid: missing.length === 0,
    missingPrices: missing.map(s => ({
      service_id: s.service_id,
      service_name: s.service_name,
      required_currency: requiredCurrency
    }))
  };
}
```

#### 5.2 Error Message

When validation fails:

```
Cannot create contract in EUR. The following services do not have EUR pricing:

• Managed Workstation
• Server Monitoring
• Help Desk Support

Please add EUR prices to these services in the Service Catalog before creating this contract.
```

### Phase 6: Testing

#### 6.1 Unit Tests

- Test service price CRUD operations
- Test currency validation function
- Test getServicePrice returns correct currency

#### 6.2 Integration Tests

- Test contract creation succeeds when all services have required currency
- Test contract creation fails with clear error when prices missing
- Test migration correctly moves existing rates to service_prices

## Files to Modify

### Database/Migrations
- [ ] `20251205130000_add_service_prices_table.cjs` - Create service_prices, migrate data
- [ ] `20251205130001_remove_currency_from_contract_templates.cjs` - Remove currency_code (keep as-is)

### Types/Interfaces
- [ ] `server/src/interfaces/billing.interfaces.ts` - Add IServicePrice, update IService
- [ ] `server/src/interfaces/contractTemplate.interfaces.ts` - Remove currency_code (already done)

### Server Models/Actions
- [ ] `server/src/lib/models/service.ts` - Add price queries
- [ ] `server/src/lib/models/servicePrice.ts` - New model for service_prices
- [ ] `server/src/lib/actions/serviceActions.ts` - Handle price CRUD
- [ ] `server/src/lib/actions/contractWizardActions.ts` - Update validation

### UI Components
- [ ] `server/src/components/settings/billing/ServiceCatalogManager.tsx` - Multi-currency UI
- [ ] `server/src/components/settings/billing/QuickAddService.tsx` - Multi-currency support
- [ ] Service form component - Price list editor

## Migration Strategy

Since this hasn't been deployed yet, we will:

1. Replace the existing migration `20251205130000_add_currency_to_service_catalog.cjs` with new schema
2. Keep `20251205130001_remove_currency_from_contract_templates.cjs` as-is
3. Update all code to use new `service_prices` model

## Success Criteria

- [ ] Services can have multiple currency/price pairs
- [ ] Single-currency usage is simple (just add one price)
- [ ] Contract templates no longer have `currency_code`
- [ ] Contract creation validates services have required currency
- [ ] Clear error messages list services needing price updates
- [ ] UI displays all prices, easy to add/edit currencies
- [ ] Existing contracts continue to work (backward compatible)

## Open Questions

1. Should we show available currencies in contract creation UI (filter services)?
2. Should we support "copy price from another currency" with exchange rate?
3. Should we track price history for auditing?
