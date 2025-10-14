// Billing Overview Report Definition
// Provides core metrics for the billing dashboard overview tab

import { ReportDefinition } from '../../core/types';

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
      name: 'Active Contract Lines',
      description: 'Count of currently active contract lines',
      type: 'count',
      query: {
        table: 'contract_lines',
        aggregation: 'count',
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
      description: 'Count of clients with active contract lines',
      type: 'count',
      query: {
        table: 'clients',
        joins: [
          {
            type: 'inner',
            table: 'client_contract_lines',
            on: [
              { left: 'clients.client_id', right: 'client_contract_lines.client_id' },
              { left: 'clients.tenant', right: 'client_contract_lines.tenant' }
            ]
          }
        ],
        aggregation: 'count_distinct',
        fields: ['clients.client_id'],
        filters: [
          { field: 'client_contract_lines.is_active', operator: 'eq', value: true },
          { field: 'clients.tenant', operator: 'eq', value: '{{tenant}}' }
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
        aggregation: 'count',
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
        fields: ['total_amount - COALESCE(credit_applied, 0)'],
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
      description: 'Sum of all client credit balances',
      type: 'sum',
      query: {
        table: 'clients',
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
        aggregation: 'count',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'approval_status', operator: 'eq', value: 'SUBMITTED' }
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
    invalidateOn: ['invoice.created', 'invoice.updated', 'contract_line.updated']
  }
};