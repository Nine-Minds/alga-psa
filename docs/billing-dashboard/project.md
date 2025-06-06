# Billing Dashboard Enhancement Project

## Project Overview

This project aims to enhance the billing dashboard by replacing dummy/static values with actual data calculated from the database. This involves introducing a comprehensive reporting module to gather and present real-time billing metrics.

## Current State Analysis

### Current Billing Dashboard Structure

The billing dashboard is implemented as a tabbed interface (`BillingDashboard.tsx`) with the following components:

- **Overview Tab**: Currently displays static values (15 active plans, 87 clients, $123,456 revenue)
- **Other Tabs**: Generate Invoices, Invoices, Invoice Templates, Tax Rates, Plans, Plan Bundles, Service Catalog, Billing Cycles, Time Periods, Usage Tracking, Credits, Reconciliation

### Current Overview Component Analysis

Located at: `server/src/components/billing-dashboard/Overview.tsx`

**Current Issues:**
- All metric values are hardcoded (static)
- No database integration
- No real-time data fetching
- Missing key billing insights

**Current Dummy Values:**
- Active Billing Plans: 15 (hardcoded)
- Total Clients: 87 (hardcoded)
- Monthly Revenue: $123,456 (hardcoded)
- Active Services: 15 (hardcoded)

## Database Structure Analysis

### Key Billing Tables Available

Based on comprehensive migration analysis, the following tables contain data needed for dashboard metrics:

#### Core Data Sources:
1. **`companies`** - Customer entities with billing settings
2. **`invoices`** - Invoice records with amounts, dates, status
3. **`invoice_items`** - Line items with detailed pricing
4. **`billing_plans`** - Available billing plans and configurations
5. **`company_billing_plans`** - Active plan assignments
6. **`service_catalog`** - Available services and default rates
7. **`time_entries`** - Billable time tracking
8. **`usage_tracking`** - Usage-based billing data
9. **`transactions`** - Financial transaction history

#### Advanced Tables:
- **`plan_bundles`** - Bundle definitions and assignments
- **`bucket_usage`** - Hour bucket consumption tracking
- **`tax_rates`** - Tax calculation data
- **`credit_tracking`** - Credit balances and applications

### Data Storage Patterns:
- **Monetary values**: Stored as integers in cents for precision
- **Multi-tenancy**: All tables include `tenant` UUID for isolation
- **Date handling**: Business dates use `date` type, timestamps use `timestamptz`
- **Indexes**: Optimized for tenant-based queries and billing operations

## Required Dashboard Metrics

### Primary Metrics (High Priority)
1. **Active Billing Plans Count**
   - Source: `billing_plans` WHERE `is_active = true`
   - Filter by tenant

2. **Active Billing Clients Count**
   - Source: `companies` with active `company_billing_plans`
   - Join companies with company_billing_plans WHERE `is_active = true`

3. **Monthly Revenue**
   - Source: `invoices` WHERE status indicates completion
   - Sum `total_amount` for current month
   - Convert from cents to dollars for display

4. **Active Services Count**
   - Source: `service_catalog` WHERE active/available
   - Filter by tenant

### Secondary Metrics (Medium Priority)
5. **Outstanding Invoices Amount**
   - Source: `invoices` WHERE status = 'open' or 'overdue'
   - Sum `total_amount - credit_applied`

6. **Current Month Billable Hours**
   - Source: `time_entries` WHERE `billable = true` AND current month
   - Sum `billable_duration` and convert to hours

7. **Credit Balance Total**
   - Source: `companies.credit_balance` or aggregate from `credit_tracking`

8. **Pending Time Entries**
   - Source: `time_entries` WHERE `approval_status = 'pending'`

### Advanced Metrics (Low Priority)
9. **Revenue Trends** (monthly comparison)
10. **Top Services by Revenue**
11. **Client Payment Status Distribution**
12. **Bucket Usage Summary**

## Proposed Server Actions Structure

### Location
Create new directory: `/server/src/lib/actions/billing-dashboard-actions/`

### Action Files Structure
```
billing-dashboard-actions/
   index.ts                      # Export all actions and types
   getBillingOverview.ts          # Primary dashboard metrics
   getRevenueMetrics.ts           # Revenue calculations
   getClientMetrics.ts            # Client-related statistics
   getServiceMetrics.ts           # Service usage and performance
   getTimeTrackingMetrics.ts      # Time entry statistics
   types.ts                       # TypeScript interfaces
```

### Implementation Pattern

Each action follows the established codebase patterns:

```typescript
'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { z } from 'zod';

// Input validation schema
const GetBillingOverviewSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export interface IBillingOverview {
  activePlansCount: number;
  activeClientsCount: number;
  monthlyRevenue: number;
  activeServicesCount: number;
  outstandingAmount: number;
  creditBalance: number;
  pendingTimeEntries: number;
  billableHoursThisMonth: number;
}

export async function getBillingOverview(
  input: z.infer<typeof GetBillingOverviewSchema> = {}
): Promise<IBillingOverview> {
  // Validation
  const validationResult = GetBillingOverviewSchema.safeParse(input);
  if (!validationResult.success) {
    throw new Error(`Validation Error: ${validationResult.error.message}`);
  }

  // Database connection
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context is required.');
  }

  try {
    const result = await withTransaction(knex, async (trx) => {
      // Execute multiple queries for dashboard metrics
      const [
        activePlansResult,
        activeClientsResult,
        monthlyRevenueResult,
        activeServicesResult,
        outstandingResult,
        creditBalanceResult,
        pendingTimeResult,
        billableHoursResult
      ] = await Promise.all([
        // Query implementations here
      ]);

      return {
        activePlansCount: activePlansResult[0]?.count || 0,
        activeClientsCount: activeClientsResult[0]?.count || 0,
        monthlyRevenue: monthlyRevenueResult[0]?.total || 0,
        activeServicesCount: activeServicesResult[0]?.count || 0,
        outstandingAmount: outstandingResult[0]?.total || 0,
        creditBalance: creditBalanceResult[0]?.total || 0,
        pendingTimeEntries: pendingTimeResult[0]?.count || 0,
        billableHoursThisMonth: billableHoursResult[0]?.hours || 0,
      };
    });

    return result;
  } catch (error) {
    console.error('Error fetching billing overview:', error);
    throw new Error(`Failed to fetch billing overview: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
```

## Query Implementation Details

### 1. Active Billing Plans Count
```sql
SELECT COUNT(*) as count
FROM billing_plans 
WHERE tenant = ? AND is_active = true
```

### 2. Active Billing Clients Count
```sql
SELECT COUNT(DISTINCT c.company_id) as count
FROM companies c
INNER JOIN company_billing_plans cbp ON c.company_id = cbp.company_id AND c.tenant = cbp.tenant
WHERE c.tenant = ? AND cbp.is_active = true
```

### 3. Monthly Revenue
```sql
SELECT SUM(total_amount) as total
FROM invoices 
WHERE tenant = ? 
  AND invoice_date >= date_trunc('month', CURRENT_DATE)
  AND invoice_date < date_trunc('month', CURRENT_DATE) + interval '1 month'
  AND status IN ('paid', 'completed')
```

### 4. Active Services Count
```sql
SELECT COUNT(*) as count
FROM service_catalog 
WHERE tenant = ?
```

### 5. Outstanding Invoices Amount
```sql
SELECT SUM(total_amount - COALESCE(credit_applied, 0)) as total
FROM invoices 
WHERE tenant = ? 
  AND status IN ('open', 'overdue', 'sent')
```

## Component Integration Plan

### Updated Overview Component

The `Overview.tsx` component needs to be enhanced to:

1. **Import server action**: Import `getBillingOverview` from actions
2. **Add state management**: Use React state for data and loading states
3. **Implement data fetching**: Call server action on component mount
4. **Add loading states**: Show loading indicators while fetching
5. **Error handling**: Display error states gracefully
6. **Real-time updates**: Optionally implement periodic refresh

### Component Structure Changes

```typescript
'use client'
import React, { useState, useEffect } from 'react';
import { getBillingOverview, type IBillingOverview } from 'server/src/lib/actions/billing-dashboard-actions';

const Overview = () => {
  const [data, setData] = useState<IBillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        setLoading(true);
        const overview = await getBillingOverview();
        setData(overview);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  // Component rendering logic with real data
};
```

## Performance Considerations

### Database Optimization
1. **Proper indexing**: Ensure key columns used in filters have indexes
2. **Query optimization**: Use appropriate JOINs and aggregations
3. **Caching strategy**: Consider implementing Redis caching for frequently accessed metrics
4. **Pagination**: For large datasets, implement proper pagination

### Frontend Optimization
1. **Loading states**: Implement skeleton loaders during data fetch
2. **Error boundaries**: Add proper error handling and retry mechanisms
3. **Memoization**: Use React.memo and useMemo for expensive calculations
4. **Progressive loading**: Load critical metrics first, secondary metrics after

## Security Considerations

### Data Access Control
1. **Tenant isolation**: All queries must filter by tenant
2. **Permission checking**: Verify user has billing access permissions
3. **Input validation**: Validate all inputs using Zod schemas
4. **SQL injection prevention**: Use parameterized queries only

### Authentication Pattern
```typescript
// Check user permissions before data access
const session = await getServerSession(options);
if (!session?.user?.id) {
  throw new Error('Unauthorized');
}

const userRoles = await getUserRolesWithPermissions(session.user.id);
const hasBillingAccess = userRoles.some(role =>
  role.permissions.some(p => p.resource === 'billing' && p.action === 'read')
);

if (!hasBillingAccess) {
  throw new Error('Insufficient permissions');
}
```

## Implementation Phases

### Phase 1: Core Metrics (Week 1)
- Implement `getBillingOverview` action
- Update Overview component with real data
- Add loading and error states
- Basic testing and validation

### Phase 2: Enhanced Metrics (Week 2)
- Add `getRevenueMetrics` for trend analysis
- Implement `getClientMetrics` for client insights
- Add `getServiceMetrics` for service performance
- Enhanced error handling and logging

### Phase 3: Advanced Features (Week 3)
- Add real-time updates with periodic refresh
- Implement caching strategy
- Add metric drilling (click to see details)
- Performance optimization and monitoring

### Phase 4: Polish and Testing (Week 4)
- Comprehensive testing across different tenant scenarios
- Performance benchmarking
- UI/UX refinements
- Documentation updates

## Testing Strategy

### Unit Tests
- Test each server action independently
- Mock database responses
- Validate error handling scenarios
- Test input validation with various inputs

### Integration Tests
- Test component-action integration
- Verify tenant isolation
- Test with realistic data volumes
- Performance testing under load

### Manual Testing
- Test with different user roles
- Verify data accuracy against database
- Test loading states and error conditions
- Cross-browser compatibility

## Monitoring and Maintenance

### Performance Monitoring
- Monitor query execution times
- Track component render performance
- Monitor error rates and types
- Set up alerts for slow queries

### Data Quality Monitoring
- Verify metric accuracy periodically
- Monitor for data inconsistencies
- Track unusual metric variations
- Implement data validation checks

## Risk Assessment

### High Risk
- **Data accuracy**: Incorrect calculations could impact business decisions
- **Performance**: Slow queries could degrade user experience
- **Security**: Improper tenant isolation could expose sensitive data

### Medium Risk
- **Scalability**: Queries may not scale with large data volumes
- **Maintenance**: Complex queries may be difficult to maintain

### Low Risk
- **UI changes**: Minimal impact on existing functionality
- **Backwards compatibility**: New features are additive

## Success Metrics

### Technical Success
- Query response times < 500ms for dashboard load
- Zero data accuracy issues after validation
- 100% test coverage for critical paths
- Zero security vulnerabilities

### Business Success
- Real-time visibility into billing performance
- Improved decision-making with accurate data
- Reduced manual reporting overhead
- Enhanced user satisfaction with dashboard

## Conclusion

This comprehensive plan provides a roadmap for transforming the billing dashboard from static dummy data to a dynamic, real-time reporting system. The proposed solution leverages the existing robust database schema and follows established codebase patterns for consistency and maintainability.

The phased implementation approach ensures minimal risk while delivering incremental value. The emphasis on performance, security, and data accuracy aligns with the critical nature of billing data in business operations.

The modular action structure allows for future enhancements and provides a foundation for additional reporting features as business requirements evolve.