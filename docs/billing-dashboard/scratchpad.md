# Billing Dashboard Hierarchical Report System - Progress Tracker

## Current Status: Designing Core Infrastructure

###  Completed Tasks
- [x] Research existing report patterns in codebase
- [x] Analyze current billing dashboard structure  
- [x] Design high-level hierarchical report architecture
- [x] Identify integration points with existing infrastructure

### = In Progress Tasks
- [ ] Define named reports structure for billing dashboard
- [ ] Design core report infrastructure components
- [ ] Create billing dashboard report definitions

### =� Upcoming Tasks
- [ ] Plan migration strategy from existing patterns
- [ ] Update project documentation with reports approach
- [ ] Create implementation roadmap

---

## Hierarchical Report System Design

### Core Architecture

```
server/src/lib/reports/
   core/
      ReportEngine.ts           # Main execution engine
      ReportDefinition.ts       # Report metadata structure  
      ReportCache.ts            # Redis-based caching
      MetricCalculator.ts       # Metric computation utilities
      types.ts                  # Shared TypeScript interfaces
   definitions/
      billing/
         overview.ts           # Billing dashboard overview
         revenue-analysis.ts   # Revenue trends and analysis
         client-performance.ts # Client billing metrics
         service-utilization.ts# Service performance metrics
         index.ts              # Export all billing reports
      operations/
         time-utilization.ts   # Time tracking analytics
         asset-performance.ts  # Asset utilization reports
         index.ts
      financial/
         accounts-receivable.ts# AR aging and analysis
         credit-analysis.ts    # Credit usage and trends
         index.ts
      index.ts                  # Export all report definitions
   builders/
      QueryBuilder.ts           # Dynamic SQL query construction
      FilterBuilder.ts          # Dynamic filtering logic
      AggregationBuilder.ts     # Data aggregation utilities
      DateRangeBuilder.ts       # Date range calculations
   actions/
       executeReport.ts          # Universal report executor
       getReportMetadata.ts      # Report definition retrieval
       validateReportAccess.ts   # Permission checking
       index.ts                  # Export all actions
```

### Key Design Principles

1. **Named Reports**: Each report has a unique identifier (e.g., 'billing.overview')
2. **Declarative Configuration**: Reports defined as configuration objects, not code
3. **Reusable Components**: Metrics can be shared across multiple reports
4. **Performance Optimized**: Built-in caching and query optimization
5. **Security First**: Tenant isolation and permission checking
6. **Type Safe**: Full TypeScript support with strong typing

---

## Core Interface Definitions

### Report Definition Structure

```typescript
export interface ReportDefinition {
  id: string;                     // Unique identifier (e.g., 'billing.overview')
  name: string;                   // Human-readable name
  description: string;            // Report description
  category: ReportCategory;       // Category for organization
  version: string;                // Version for compatibility
  
  metrics: MetricDefinition[];    // List of metrics to calculate
  parameters?: ParameterDefinition[]; // Optional input parameters
  
  permissions: {                  // Access control
    roles: string[];              // Required roles
    resources: string[];          // Required resource permissions
  };
  
  caching?: {                     // Caching configuration
    ttl: number;                  // Time to live in seconds
    key: string;                  // Cache key template
    invalidateOn?: string[];      // Events that invalidate cache
  };
  
  scheduling?: {                  // For scheduled reports
    frequency: string;            // Cron expression
    enabled: boolean;
  };
}

export interface MetricDefinition {
  id: string;                     // Metric identifier
  name: string;                   // Display name
  description?: string;           // Optional description
  type: MetricType;               // Type of metric (count, sum, avg, etc.)
  
  query: QueryDefinition;         // How to calculate the metric
  formatting?: FormattingOptions; // Display formatting
  
  dependencies?: string[];        // Other metrics this depends on
  conditions?: ConditionDefinition[]; // Conditional logic
}

export interface QueryDefinition {
  table: string;                  // Primary table
  joins?: JoinDefinition[];       // Table joins
  fields?: string[];              // Fields to select
  aggregation?: AggregationType;  // Aggregation method
  filters?: FilterDefinition[];   // Where conditions
  groupBy?: string[];             // Group by fields
  orderBy?: OrderDefinition[];    // Sorting
  limit?: number;                 // Result limit
}

export type MetricType = 'count' | 'sum' | 'average' | 'min' | 'max' | 'ratio' | 'trend';
export type AggregationType = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct';
export type ReportCategory = 'billing' | 'operations' | 'financial' | 'analytics' | 'compliance';
```

---

## Billing Dashboard Report Definitions

### 1. Billing Overview Report

```typescript
// definitions/billing/overview.ts
export const billingOverviewReport: ReportDefinition = {
  id: 'billing.overview',
  name: 'Billing Dashboard Overview',
  description: 'Core metrics for the billing dashboard overview tab',
  category: 'billing',
  version: '1.0.0',
  
  permissions: {
    roles: ['admin', 'billing_manager', 'account_manager'],
    resources: ['billing.read']
  },
  
  metrics: [
    {
      id: 'active_plans_count',
      name: 'Active Billing Plans',
      description: 'Count of currently active billing plans',
      type: 'count',
      query: {
        table: 'billing_plans',
        filters: [
          { field: 'is_active', operator: 'eq', value: true },
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' }
        ]
      },
      formatting: {
        type: 'number',
        decimals: 0
      }
    },
    
    {
      id: 'active_clients_count',
      name: 'Active Billing Clients',
      description: 'Count of companies with active billing plans',
      type: 'count',
      query: {
        table: 'companies',
        joins: [
          {
            type: 'inner',
            table: 'company_billing_plans',
            on: [
              { left: 'companies.company_id', right: 'company_billing_plans.company_id' },
              { left: 'companies.tenant', right: 'company_billing_plans.tenant' }
            ]
          }
        ],
        aggregation: 'count_distinct',
        fields: ['companies.company_id'],
        filters: [
          { field: 'company_billing_plans.is_active', operator: 'eq', value: true },
          { field: 'companies.tenant', operator: 'eq', value: '{{tenant}}' }
        ]
      },
      formatting: {
        type: 'number',
        decimals: 0
      }
    },
    
    {
      id: 'monthly_revenue',
      name: 'Current Month Revenue',
      description: 'Total revenue for the current month',
      type: 'sum',
      query: {
        table: 'invoices',
        fields: ['total_amount'],
        aggregation: 'sum',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'status', operator: 'in', value: ['paid', 'completed'] },
          { field: 'invoice_date', operator: 'gte', value: '{{start_of_month}}' },
          { field: 'invoice_date', operator: 'lt', value: '{{end_of_month}}' }
        ]
      },
      formatting: {
        type: 'currency',
        currency: 'USD',
        divisor: 100 // Convert from cents
      }
    },
    
    {
      id: 'active_services_count',
      name: 'Active Services',
      description: 'Count of services in the service catalog',
      type: 'count',
      query: {
        table: 'service_catalog',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' }
        ]
      },
      formatting: {
        type: 'number',
        decimals: 0
      }
    },
    
    {
      id: 'outstanding_amount',
      name: 'Outstanding Invoices',
      description: 'Total amount of unpaid invoices',
      type: 'sum',
      query: {
        table: 'invoices',
        fields: ['total_amount - COALESCE(credit_applied, 0) as outstanding'],
        aggregation: 'sum',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'status', operator: 'in', value: ['open', 'overdue', 'sent'] }
        ]
      },
      formatting: {
        type: 'currency',
        currency: 'USD',
        divisor: 100
      }
    },
    
    {
      id: 'total_credit_balance',
      name: 'Total Credit Balance',
      description: 'Sum of all company credit balances',
      type: 'sum',
      query: {
        table: 'companies',
        fields: ['credit_balance'],
        aggregation: 'sum',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'credit_balance', operator: 'gt', value: 0 }
        ]
      },
      formatting: {
        type: 'currency',
        currency: 'USD',
        divisor: 100
      }
    },
    
    {
      id: 'pending_time_entries',
      name: 'Pending Time Entries',
      description: 'Count of time entries awaiting approval',
      type: 'count',
      query: {
        table: 'time_entries',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'approval_status', operator: 'eq', value: 'pending' }
        ]
      },
      formatting: {
        type: 'number',
        decimals: 0
      }
    },
    
    {
      id: 'monthly_billable_hours',
      name: 'Current Month Billable Hours',
      description: 'Total billable hours for the current month',
      type: 'sum',
      query: {
        table: 'time_entries',
        fields: ['billable_duration'],
        aggregation: 'sum',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'billable', operator: 'eq', value: true },
          { field: 'start_time', operator: 'gte', value: '{{start_of_month}}' },
          { field: 'start_time', operator: 'lt', value: '{{end_of_month}}' }
        ]
      },
      formatting: {
        type: 'duration',
        unit: 'hours',
        decimals: 1
      }
    }
  ],
  
  caching: {
    ttl: 300, // 5 minutes
    key: 'billing.overview.{{tenant}}',
    invalidateOn: ['invoice.created', 'invoice.updated', 'billing_plan.updated']
  }
};
```

---

## Core Report Infrastructure Implementation

### ReportEngine Implementation

```typescript
// core/ReportEngine.ts
'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { ReportDefinition, ReportResult, ReportParameters } from './types';
import { QueryBuilder } from '../builders/QueryBuilder';
import { ReportCache } from './ReportCache';
import { validateReportAccess } from '../actions/validateReportAccess';

export class ReportEngine {
  
  static async execute(
    definition: ReportDefinition,
    parameters: ReportParameters = {},
    options: { skipCache?: boolean } = {}
  ): Promise<ReportResult> {
    const startTime = Date.now();
    
    // 1. Validate access permissions
    await validateReportAccess(definition.id);
    
    // 2. Check cache first (unless skipped)
    if (!options.skipCache && definition.caching) {
      const cached = await ReportCache.get(definition, parameters);
      if (cached) {
        return cached;
      }
    }
    
    // 3. Get database connection with tenant context
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for report execution');
    }
    
    // 4. Add tenant to parameters
    const enrichedParameters = {
      ...parameters,
      tenant,
      start_of_month: this.getStartOfMonth(),
      end_of_month: this.getEndOfMonth(),
      start_of_year: this.getStartOfYear(),
      end_of_year: this.getEndOfYear()
    };
    
    // 5. Execute report within transaction
    const result = await withTransaction(knex, async (trx) => {
      const metrics: Record<string, any> = {};
      
      // Execute each metric calculation
      for (const metric of definition.metrics) {
        try {
          const value = await this.executeMetric(trx, metric, enrichedParameters);
          metrics[metric.id] = this.formatMetricValue(value, metric.formatting);
        } catch (error) {
          console.error(`Error executing metric ${metric.id}:`, error);
          metrics[metric.id] = null;
        }
      }
      
      return {
        reportId: definition.id,
        reportName: definition.name,
        executedAt: new Date().toISOString(),
        parameters: enrichedParameters,
        metrics,
        metadata: {
          version: definition.version,
          category: definition.category,
          executionTime: Date.now() - startTime
        }
      } as ReportResult;
    });
    
    // 6. Cache the result
    if (definition.caching) {
      await ReportCache.set(definition, parameters, result);
    }
    
    return result;
  }
  
  private static async executeMetric(
    trx: any,
    metric: MetricDefinition,
    parameters: ReportParameters
  ): Promise<any> {
    
    // Build the query using QueryBuilder
    const query = QueryBuilder.build(trx, metric.query, parameters);
    
    // Execute and return result
    const result = await query;
    
    // Handle different aggregation types
    if (metric.query.aggregation) {
      return result[0]?.[metric.query.aggregation] || 0;
    }
    
    return result;
  }
  
  private static formatMetricValue(value: any, formatting?: FormattingOptions): any {
    if (!formatting || value === null || value === undefined) {
      return value;
    }
    
    switch (formatting.type) {
      case 'currency':
        return {
          raw: value,
          formatted: this.formatCurrency(value, formatting),
          type: 'currency'
        };
      
      case 'number':
        return {
          raw: value,
          formatted: this.formatNumber(value, formatting),
          type: 'number'
        };
      
      case 'duration':
        return {
          raw: value,
          formatted: this.formatDuration(value, formatting),
          type: 'duration'
        };
      
      default:
        return value;
    }
  }
  
  private static formatCurrency(value: number, formatting: FormattingOptions): string {
    const amount = formatting.divisor ? value / formatting.divisor : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: formatting.currency || 'USD'
    }).format(amount);
  }
  
  private static formatNumber(value: number, formatting: FormattingOptions): string {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: formatting.decimals || 0,
      maximumFractionDigits: formatting.decimals || 0
    }).format(value);
  }
  
  private static formatDuration(minutes: number, formatting: FormattingOptions): string {
    if (formatting.unit === 'hours') {
      const hours = minutes / 60;
      return `${hours.toFixed(formatting.decimals || 1)} hours`;
    }
    return `${minutes} minutes`;
  }
  
  private static getStartOfMonth(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
  
  private static getEndOfMonth(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  }
  
  private static getStartOfYear(): string {
    const now = new Date();
    return new Date(now.getFullYear(), 0, 1).toISOString();
  }
  
  private static getEndOfYear(): string {
    const now = new Date();
    return new Date(now.getFullYear() + 1, 0, 1).toISOString();
  }
}
```

### QueryBuilder Implementation

```typescript
// builders/QueryBuilder.ts
import { Knex } from 'knex';
import { QueryDefinition, ReportParameters, FilterDefinition } from '../core/types';

export class QueryBuilder {
  
  static build(
    trx: Knex.Transaction,
    queryDef: QueryDefinition,
    parameters: ReportParameters
  ): Knex.QueryBuilder {
    
    let query = trx(queryDef.table);
    
    // Add joins
    if (queryDef.joins) {
      queryDef.joins.forEach(join => {
        query = query.join(join.table, builder => {
          join.on.forEach(condition => {
            builder.on(condition.left, condition.right);
          });
        });
      });
    }
    
    // Add field selection
    if (queryDef.fields) {
      query = query.select(queryDef.fields);
    } else if (queryDef.aggregation) {
      query = query.select(trx.raw(`${queryDef.aggregation}(*) as ${queryDef.aggregation}`));
    }
    
    // Add filters
    if (queryDef.filters) {
      queryDef.filters.forEach(filter => {
        query = this.applyFilter(query, filter, parameters);
      });
    }
    
    // Add group by
    if (queryDef.groupBy) {
      query = query.groupBy(queryDef.groupBy);
    }
    
    // Add order by
    if (queryDef.orderBy) {
      queryDef.orderBy.forEach(order => {
        query = query.orderBy(order.field, order.direction || 'asc');
      });
    }
    
    // Add limit
    if (queryDef.limit) {
      query = query.limit(queryDef.limit);
    }
    
    return query;
  }
  
  private static applyFilter(
    query: Knex.QueryBuilder,
    filter: FilterDefinition,
    parameters: ReportParameters
  ): Knex.QueryBuilder {
    
    const value = this.resolveFilterValue(filter.value, parameters);
    
    switch (filter.operator) {
      case 'eq':
        return query.where(filter.field, value);
      case 'neq':
        return query.whereNot(filter.field, value);
      case 'gt':
        return query.where(filter.field, '>', value);
      case 'gte':
        return query.where(filter.field, '>=', value);
      case 'lt':
        return query.where(filter.field, '<', value);
      case 'lte':
        return query.where(filter.field, '<=', value);
      case 'in':
        return query.whereIn(filter.field, Array.isArray(value) ? value : [value]);
      case 'not_in':
        return query.whereNotIn(filter.field, Array.isArray(value) ? value : [value]);
      case 'like':
        return query.where(filter.field, 'like', value);
      case 'is_null':
        return query.whereNull(filter.field);
      case 'is_not_null':
        return query.whereNotNull(filter.field);
      default:
        throw new Error(`Unsupported filter operator: ${filter.operator}`);
    }
  }
  
  private static resolveFilterValue(value: any, parameters: ReportParameters): any {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      const paramName = value.slice(2, -2);
      return parameters[paramName];
    }
    return value;
  }
}
```

### Universal Report Action

```typescript
// actions/executeReport.ts
'use server';

import { z } from 'zod';
import { ReportEngine } from '../core/ReportEngine';
import { getReportDefinition } from './getReportDefinition';
import { ReportResult } from '../core/types';

const ExecuteReportSchema = z.object({
  reportId: z.string(),
  parameters: z.record(z.any()).optional().default({}),
  options: z.object({
    skipCache: z.boolean().optional(),
    forceRefresh: z.boolean().optional()
  }).optional().default({})
});

export async function executeReport(
  input: z.infer<typeof ExecuteReportSchema>
): Promise<ReportResult> {
  
  // Validate input
  const validationResult = ExecuteReportSchema.safeParse(input);
  if (!validationResult.success) {
    const errorMessages = validationResult.error.errors.map(e => 
      `${e.path.join('.')}: ${e.message}`
    ).join(', ');
    throw new Error(`Validation Error: ${errorMessages}`);
  }
  
  const { reportId, parameters, options } = validationResult.data;
  
  try {
    // Get report definition
    const definition = await getReportDefinition(reportId);
    if (!definition) {
      throw new Error(`Report definition not found: ${reportId}`);
    }
    
    // Execute the report
    const result = await ReportEngine.execute(definition, parameters, options);
    
    return result;
    
  } catch (error) {
    console.error(`Error executing report ${reportId}:`, error);
    throw new Error(`Failed to execute report: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Convenience function for billing overview
export async function getBillingOverview(): Promise<ReportResult> {
  return executeReport({ reportId: 'billing.overview' });
}
```

### Overview Component Integration Plan

```typescript
// Updated Overview.tsx structure
'use client'
import React, { useState, useEffect } from 'react';
import { getBillingOverview } from 'server/src/lib/reports/actions';
import { ReportResult } from 'server/src/lib/reports/core/types';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';

interface MetricCardProps {
  title: string;
  value: any;
  icon: React.ComponentType;
  loading?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, icon: Icon, loading }) => {
  const displayValue = loading ? '...' : (value?.formatted || value);
  
  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">{title}</h3>
      </CardHeader>
      <CardContent>
        <div className="flex items-center space-x-4">
          <div className="p-3 rounded-full bg-primary-50">
            <Icon className="h-6 w-6 text-primary-500" />
          </div>
          <div>
            <p className="text-2xl font-bold">{displayValue}</p>
            <p className="text-sm text-gray-500">{title}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const Overview = () => {
  const [reportData, setReportData] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBillingOverview() {
      try {
        setLoading(true);
        const data = await getBillingOverview();
        setReportData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load billing data');
      } finally {
        setLoading(false);
      }
    }

    fetchBillingOverview();
  }, []);

  if (error) {
    return <div className="text-red-600">Error: {error}</div>;
  }

  const metrics = reportData?.metrics || {};

  return (
    <div className="space-y-6">
      {/* Billing Summary Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Active Billing Plans"
          value={metrics.active_plans_count}
          icon={FileSpreadsheet}
          loading={loading}
        />
        <MetricCard
          title="Billing Clients"
          value={metrics.active_clients_count}
          icon={Building2}
          loading={loading}
        />
        <MetricCard
          title="Monthly Revenue"
          value={metrics.monthly_revenue}
          icon={DollarSign}
          loading={loading}
        />
      </div>

      {/* Additional metrics... */}
      
      {/* Execution metadata for debugging */}
      {reportData && process.env.NODE_ENV === 'development' && (
        <div className="text-xs text-gray-400">
          Report executed at: {reportData.executedAt} 
          (took {reportData.metadata.executionTime}ms)
        </div>
      )}
    </div>
  );
};
```

---

## Next Steps

### Immediate Tasks (This Session)
1.  Define billing overview report structure
2. = Design core ReportEngine implementation
3. = Create executeReport server action
4. = Plan integration with existing Overview component

### Short Term (Next 1-2 Days)
1. Implement core report infrastructure
2. Create additional billing report definitions
3. Build query execution engine
4. Add caching layer

### Medium Term (Next Week)
1. Migrate existing report actions to new system
2. Update billing dashboard to use reports
3. Add advanced filtering and parameters
4. Implement permission checking

### Long Term (Next Month)
1. Extend to other dashboards
2. Add scheduled reporting
3. Create report builder UI
4. Add export capabilities

---

## Technical Decisions Made

1. **Report IDs**: Use dot notation (e.g., 'billing.overview') for hierarchical organization
2. **Caching**: Redis-based with configurable TTL and smart invalidation
3. **Security**: Role and resource-based permissions with tenant isolation
4. **Flexibility**: Declarative configuration allows easy modification without code changes
5. **Performance**: Query optimization and built-in aggregation support
6. **Integration**: Designed to work with existing server action patterns

---

## Questions/Considerations

1. Should we support real-time updates via WebSocket/SSE for critical metrics?
2. How do we handle report versioning for backwards compatibility?
3. Should we implement a report builder UI for non-technical users?
4. What's the strategy for handling very large datasets (pagination, streaming)?
5. How do we handle cross-tenant reporting for enterprise features?

---

---

## Migration Strategy & Implementation Status

### Phase 1: Core Infrastructure (Week 1)
**Steps**:
1. Create report structure - Set up `/server/src/lib/reports/` directory
2. Implement core classes - ReportEngine, QueryBuilder, basic types
3. Add basic actions - executeReport with simple validation
4. Create billing overview report - Define 'billing.overview' report
5. Test infrastructure - Unit tests for core components

### Phase 2: Billing Dashboard Integration (Week 2)
**Steps**:
1. Update Overview component - Integrate getBillingOverview()
2. Add loading states - Skeleton loading and error handling
3. Implement caching - Redis-based caching for performance
4. Add permission checking - Ensure proper access control
5. Performance optimization - Query optimization and indexing

### Phase 3: Extend to Other Dashboards (Week 3)
**Existing Actions to Migrate**:
- `getHoursByServiceType` → 'operations.hours-by-service'
- `getRecentCompanyInvoices` → 'billing.recent-invoices'
- `getRemainingBucketUnits` → 'billing.bucket-usage'
- `getUsageDataMetrics` → 'operations.usage-metrics'

### Phase 4: Advanced Features (Week 4)
**Steps**:
1. Scheduled reports - Background report generation
2. Export capabilities - PDF/Excel export functionality
3. Report builder UI - Non-technical user report creation
4. Advanced caching - Smart cache invalidation
5. Real-time updates - WebSocket integration for live metrics

---

## ✅ Session Completion Summary

### Design Work Completed
- ✅ Report system architecture design
- ✅ Core interface definitions  
- ✅ Billing overview report specification
- ✅ ReportEngine implementation design
- ✅ QueryBuilder implementation design
- ✅ Universal report action design
- ✅ Overview component integration plan
- ✅ Migration strategy planning

### ✅ Implementation Completed (Phase 1)

The core hierarchical report system has been successfully implemented! Here's what's been delivered:

**Core Infrastructure ✅**
- ✅ Complete directory structure (`/server/src/lib/reports/`)
- ✅ Comprehensive TypeScript interfaces and types
- ✅ ReportEngine class with full execution logic
- ✅ QueryBuilder utility for dynamic query construction
- ✅ ReportRegistry for managing report definitions
- ✅ Universal executeReport server action
- ✅ Billing overview report definition with 8 metrics
- ✅ Updated Overview component using real data
- ✅ Error handling and loading states
- ✅ TypeScript compilation fixes

**Files Created:**
```
server/src/lib/reports/
├── core/
│   ├── types.ts              # Complete type definitions
│   ├── ReportEngine.ts       # Core execution engine
│   ├── ReportRegistry.ts     # Report management
│   └── index.ts              # Exports
├── definitions/
│   └── billing/
│       ├── overview.ts       # Billing overview report
│       └── index.ts          # Exports
├── builders/
│   ├── QueryBuilder.ts       # Query construction
│   └── index.ts              # Exports
├── actions/
│   ├── executeReport.ts      # Server actions
│   └── index.ts              # Exports
├── index.ts                  # Main exports
└── test-reports.ts           # Testing utilities
```

**Component Updates:**
- ✅ `Overview.tsx` - Now uses `getBillingOverview()` instead of dummy data
- ✅ Real-time loading states with spinner animations
- ✅ Error handling with user-friendly messages
- ✅ Formatted metric display (currency, numbers, duration)
- ✅ Development debug information

**Key Features Implemented:**
1. **Named Reports**: `'billing.overview'` report with 8 metrics
2. **Dynamic Queries**: Tenant filtering, date ranges, aggregations
3. **Type Safety**: Full TypeScript support throughout
4. **Error Handling**: Comprehensive error types and handling
5. **Formatting**: Currency, number, duration formatting
6. **Extensibility**: Easy to add new reports and metrics

**Ready for Next Phase:**
- [ ] Add Redis-based caching system
- [ ] Implement permission validation
- [ ] Add more billing reports (revenue trends, client analysis)
- [ ] Migrate existing report-actions to new system
- [ ] Performance optimization and monitoring

*Last Updated: Implementation Phase 1 Complete*
*Next Update: After Phase 2 (caching & permissions)*