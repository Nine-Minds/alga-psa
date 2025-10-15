// Contract Bucket Usage Report Definition
// Monitor bucket hours usage and identify overage situations

import { ReportDefinition } from '../../core/types';

export const contractBucketUsageReport: ReportDefinition = {
  id: 'contracts.bucket_usage',
  name: 'Contract Bucket Hours Utilization Report',
  description: 'Monitor bucket hours usage and identify overage situations',
  category: 'billing',
  version: '1.0.0',

  permissions: {
    roles: ['admin', 'billing_manager', 'account_manager'],
    resources: ['billing.read', 'contracts.read']
  },

  metrics: [
    {
      id: 'bucket_contracts_count',
      name: 'Bucket-Type Contracts',
      description: 'Count of active bucket/time-based contracts',
      type: 'count',
      query: {
        table: 'contract_lines',
        aggregation: 'count',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'is_active', operator: 'eq', value: true },
          { field: 'contract_line_type', operator: 'eq', value: 'Bucket' }
        ]
      },
      formatting: {
        type: 'number',
        decimals: 0
      }
    },

    {
      id: 'total_allocated_minutes',
      name: 'Total Allocated Minutes',
      description: 'Sum of all allocated bucket minutes across active contracts',
      type: 'sum',
      query: {
        table: 'contract_line_service_bucket_config',
        joins: [
          {
            type: 'inner',
            table: 'contract_lines',
            on: [
              { left: 'contract_line_service_bucket_config.contract_line_id', right: 'contract_lines.contract_line_id' },
              { left: 'contract_line_service_bucket_config.tenant', right: 'contract_lines.tenant' }
            ]
          }
        ],
        fields: ['contract_line_service_bucket_config.total_minutes'],
        aggregation: 'sum',
        filters: [
          { field: 'contract_line_service_bucket_config.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'contract_lines.is_active', operator: 'eq', value: true },
          { field: 'contract_lines.contract_line_type', operator: 'eq', value: 'Bucket' }
        ]
      },
      formatting: {
        type: 'duration',
        unit: 'hours',
        decimals: 1
      }
    },

    {
      id: 'total_used_minutes',
      name: 'Total Used Minutes',
      description: 'Sum of billable time entries against bucket contracts',
      type: 'sum',
      query: {
        table: 'time_entries',
        joins: [
          {
            type: 'inner',
            table: 'contract_lines',
            on: [
              { left: 'time_entries.contract_line_id', right: 'contract_lines.contract_line_id' },
              { left: 'time_entries.tenant', right: 'contract_lines.tenant' }
            ]
          }
        ],
        fields: ['time_entries.billable_duration'],
        aggregation: 'sum',
        filters: [
          { field: 'time_entries.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'contract_lines.contract_line_type', operator: 'eq', value: 'Bucket' }
        ]
      },
      formatting: {
        type: 'duration',
        unit: 'hours',
        decimals: 1
      }
    },

    {
      id: 'overage_minutes',
      name: 'Total Overage Minutes',
      description: 'Sum of billable minutes exceeding allocated buckets',
      type: 'sum',
      query: {
        table: 'contract_line_service_bucket_config',
        joins: [
          {
            type: 'inner',
            table: 'contract_lines',
            on: [
              { left: 'contract_line_service_bucket_config.contract_line_id', right: 'contract_lines.contract_line_id' },
              { left: 'contract_line_service_bucket_config.tenant', right: 'contract_lines.tenant' }
            ]
          },
          {
            type: 'left',
            table: 'time_entries',
            on: [
              { left: 'contract_lines.contract_line_id', right: 'time_entries.contract_line_id' },
              { left: 'contract_lines.tenant', right: 'time_entries.tenant' }
            ]
          }
        ],
        fields: ['GREATEST(0, COALESCE(SUM(time_entries.billable_duration), 0) - contract_line_service_bucket_config.total_minutes)'],
        aggregation: 'sum',
        filters: [
          { field: 'contract_line_service_bucket_config.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'contract_lines.is_active', operator: 'eq', value: true }
        ]
      },
      formatting: {
        type: 'duration',
        unit: 'hours',
        decimals: 1
      }
    },

    {
      id: 'contracts_in_overage',
      name: 'Contracts in Overage',
      description: 'Count of bucket contracts currently in overage status',
      type: 'count',
      query: {
        table: 'contract_line_service_bucket_config',
        joins: [
          {
            type: 'inner',
            table: 'contract_lines',
            on: [
              { left: 'contract_line_service_bucket_config.contract_line_id', right: 'contract_lines.contract_line_id' },
              { left: 'contract_line_service_bucket_config.tenant', right: 'contract_lines.tenant' }
            ]
          },
          {
            type: 'left',
            table: 'time_entries',
            on: [
              { left: 'contract_lines.contract_line_id', right: 'time_entries.contract_line_id' },
              { left: 'contract_lines.tenant', right: 'time_entries.tenant' }
            ]
          }
        ],
        aggregation: 'count',
        filters: [
          { field: 'contract_line_service_bucket_config.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'contract_lines.is_active', operator: 'eq', value: true }
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
    key: 'contracts.bucket_usage.{{tenant}}',
    invalidateOn: ['contract_lines.updated', 'time_entries.created', 'time_entries.updated']
  }
};
