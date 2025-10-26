// Contract Expiration Report Definition
// Track upcoming contract expirations and renewal opportunities

import { ReportDefinition } from '../../core/types';

export const contractExpirationReport: ReportDefinition = {
  id: 'contracts.expiration',
  name: 'Contract Expiration Report',
  description: 'Track upcoming contract expirations and renewal opportunities',
  category: 'billing',
  version: '1.0.0',

  permissions: {
    roles: ['admin', 'billing_manager', 'account_manager'],
    resources: ['billing.read', 'contracts.read']
  },

  metrics: [
    {
      id: 'expiring_contracts_count',
      name: 'Contracts Expiring Soon',
      description: 'Count of contracts expiring within 90 days',
      type: 'count',
      query: {
        table: 'client_contracts',
        aggregation: 'count',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'is_active', operator: 'eq', value: true },
          { field: 'end_date', operator: 'is_not_null', value: null },
          { field: 'end_date', operator: 'lte', value: '{{in_90_days}}' }
        ]
      },
      formatting: {
        type: 'number',
        decimals: 0
      }
    },

    {
      id: 'critical_expiration_count',
      name: 'Contracts Expiring in 30 Days',
      description: 'Count of contracts expiring within the next 30 days (critical)',
      type: 'count',
      query: {
        table: 'client_contracts',
        aggregation: 'count',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'is_active', operator: 'eq', value: true },
          { field: 'end_date', operator: 'is_not_null', value: null },
          { field: 'end_date', operator: 'lte', value: '{{in_30_days}}' }
        ]
      },
      formatting: {
        type: 'number',
        decimals: 0
      }
    },

    {
      id: 'expiring_contracts_revenue',
      name: 'Revenue at Risk (Expiring Soon)',
      description: 'Total monthly value of contracts expiring within 90 days',
      type: 'sum',
      query: {
        table: 'client_contracts',
        joins: [
          {
            type: 'inner',
            table: 'contract_lines',
            on: [
              { left: 'client_contracts.contract_id', right: 'contract_lines.contract_id' },
              { left: 'client_contracts.tenant', right: 'contract_lines.tenant' }
            ]
          }
        ],
        fields: ['COALESCE(contract_lines.custom_rate, 0)'],
        aggregation: 'sum',
        filters: [
          { field: 'client_contracts.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'client_contracts.is_active', operator: 'eq', value: true },
          { field: 'client_contracts.end_date', operator: 'is_not_null', value: null },
          { field: 'client_contracts.end_date', operator: 'lte', value: '{{in_90_days}}' }
        ]
      },
      formatting: {
        type: 'currency',
        currency: 'USD',
        divisor: 100
      }
    },

    {
      id: 'expired_contracts_count',
      name: 'Expired Contracts',
      description: 'Count of contracts that have already expired',
      type: 'count',
      query: {
        table: 'client_contracts',
        aggregation: 'count',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'end_date', operator: 'is_not_null', value: null },
          { field: 'end_date', operator: 'lt', value: '{{today}}' }
        ]
      },
      formatting: {
        type: 'number',
        decimals: 0
      }
    }
  ],

  caching: {
    ttl: 300, // 5 minutes
    key: 'contracts.expiration.{{tenant}}',
    invalidateOn: ['client_contracts.created', 'client_contracts.updated', 'client_contracts.deleted']
  }
};
