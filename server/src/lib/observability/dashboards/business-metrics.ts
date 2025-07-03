/**
 * Grafana Dashboard: Alga PSA Business & System Metrics
 * 
 * Operational business metrics and system resource monitoring.
 * NOTE: This is for operational monitoring, not user behavior analytics.
 */

export const businessMetricsDashboard = {
  uid: 'alga-psa-business-metrics',
  title: 'Alga PSA - Business & System Metrics',
  description: 'Operational business metrics and system resource monitoring for capacity planning and system health',
  tags: ['alga-psa', 'business', 'system', 'operations'],
  timezone: 'browser',
  refresh: '1m',
  time: {
    from: 'now-6h',
    to: 'now',
  },
  templating: {
    list: [
      {
        name: 'environment',
        type: 'query',
        query: 'label_values(ticket_operations_total, environment)',
        current: {
          selected: false,
          text: 'All',
          value: '$__all',
        },
        includeAll: true,
        multi: true,
      },
      {
        name: 'tenant_id',
        type: 'query',
        query: 'label_values(ticket_operations_total{environment="hosted"}, tenant_id)',
        current: {
          selected: false,
          text: 'All',
          value: '$__all',
        },
        includeAll: true,
        multi: true,
        hide: 2,
      },
    ],
  },
  panels: [
    // Business Operations Overview Row
    {
      id: 1,
      title: 'Business Operations Overview',
      type: 'row',
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 0 },
    },

    // Ticket Operations Rate
    {
      id: 2,
      title: 'Ticket Operations Rate',
      type: 'stat',
      gridPos: { h: 8, w: 6, x: 0, y: 1 },
      targets: [
        {
          expr: 'sum(rate(ticket_operations_total{environment=~"$environment",tenant_id=~"$tenant_id"}[5m]))',
          refId: 'A',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'thresholds',
          },
          thresholds: {
            steps: [
              { color: 'green', value: null },
              { color: 'yellow', value: 10 },
              { color: 'red', value: 50 },
            ],
          },
          unit: 'ops',
          decimals: 2,
        },
      },
    },

    // Billing Operations Rate
    {
      id: 3,
      title: 'Billing Operations Rate',
      type: 'stat',
      gridPos: { h: 8, w: 6, x: 6, y: 1 },
      targets: [
        {
          expr: 'sum(rate(billing_operations_total{environment=~"$environment",tenant_id=~"$tenant_id"}[5m]))',
          refId: 'A',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'thresholds',
          },
          thresholds: {
            steps: [
              { color: 'green', value: null },
              { color: 'yellow', value: 5 },
              { color: 'red', value: 20 },
            ],
          },
          unit: 'ops',
          decimals: 2,
        },
      },
    },

    // Active User Sessions
    {
      id: 4,
      title: 'Active User Sessions',
      type: 'stat',
      gridPos: { h: 8, w: 6, x: 12, y: 1 },
      targets: [
        {
          expr: 'sum(user_sessions_active{environment=~"$environment",tenant_id=~"$tenant_id"})',
          refId: 'A',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'thresholds',
          },
          thresholds: {
            steps: [
              { color: 'green', value: null },
              { color: 'yellow', value: 100 },
              { color: 'red', value: 500 },
            ],
          },
          unit: 'short',
        },
      },
    },

    // Database Connections
    {
      id: 5,
      title: 'Database Connections',
      type: 'stat',
      gridPos: { h: 8, w: 6, x: 18, y: 1 },
      targets: [
        {
          expr: 'sum(db_connections_active{environment=~"$environment",tenant_id=~"$tenant_id"})',
          refId: 'A',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'thresholds',
          },
          thresholds: {
            steps: [
              { color: 'green', value: null },
              { color: 'yellow', value: 50 },
              { color: 'red', value: 100 },
            ],
          },
          unit: 'short',
        },
      },
    },

    // Business Activity Trends Row
    {
      id: 6,
      title: 'Business Activity Trends',
      type: 'row',
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 9 },
    },

    // Ticket Operations by Action
    {
      id: 7,
      title: 'Ticket Operations by Action',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 0, y: 10 },
      targets: [
        {
          expr: 'sum by (action) (rate(ticket_operations_total{environment=~"$environment",tenant_id=~"$tenant_id"}[5m]))',
          refId: 'A',
          legendFormat: '{{action}}',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'ops',
          custom: {
            drawStyle: 'line',
            lineInterpolation: 'linear',
            stacking: {
              mode: 'normal',
              group: 'A',
            },
          },
        },
      },
    },

    // Billing Operations by Action
    {
      id: 8,
      title: 'Billing Operations by Action',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 12, y: 10 },
      targets: [
        {
          expr: 'sum by (action) (rate(billing_operations_total{environment=~"$environment",tenant_id=~"$tenant_id"}[5m]))',
          refId: 'A',
          legendFormat: '{{action}}',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'ops',
          custom: {
            drawStyle: 'line',
            lineInterpolation: 'linear',
            stacking: {
              mode: 'normal',
              group: 'A',
            },
          },
        },
      },
    },

    // System Resources Row
    {
      id: 9,
      title: 'System Resources',
      type: 'row',
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 18 },
    },

    // Memory Usage
    {
      id: 10,
      title: 'Memory Usage',
      type: 'timeseries',
      gridPos: { h: 8, w: 8, x: 0, y: 19 },
      targets: [
        {
          expr: 'sum(system_memory_usage_bytes{environment=~"$environment"})',
          refId: 'A',
          legendFormat: 'Memory Usage',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'bytes',
          custom: {
            drawStyle: 'line',
            lineInterpolation: 'linear',
            fillOpacity: 20,
          },
        },
      },
    },

    // Database Query Performance
    {
      id: 11,
      title: 'Database Query Performance',
      type: 'timeseries',
      gridPos: { h: 8, w: 8, x: 8, y: 19 },
      targets: [
        {
          expr: 'histogram_quantile(0.95, sum(rate(db_query_duration_seconds_bucket{environment=~"$environment",tenant_id=~"$tenant_id"}[5m])) by (le)) * 1000',
          refId: 'A',
          legendFormat: 'P95 Query Time',
        },
        {
          expr: 'sum(rate(db_query_duration_seconds_sum{environment=~"$environment",tenant_id=~"$tenant_id"}[5m])) / sum(rate(db_query_duration_seconds_count{environment=~"$environment",tenant_id=~"$tenant_id"}[5m])) * 1000',
          refId: 'B',
          legendFormat: 'Avg Query Time',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'ms',
          custom: {
            drawStyle: 'line',
            lineInterpolation: 'linear',
          },
        },
      },
    },

    // System Connections
    {
      id: 12,
      title: 'System Connections',
      type: 'timeseries',
      gridPos: { h: 8, w: 8, x: 16, y: 19 },
      targets: [
        {
          expr: 'sum(system_connections_active{environment=~"$environment"})',
          refId: 'A',
          legendFormat: 'Active Connections',
        },
        {
          expr: 'sum(db_connections_active{environment=~"$environment",tenant_id=~"$tenant_id"})',
          refId: 'B',
          legendFormat: 'DB Connections',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'short',
          custom: {
            drawStyle: 'line',
            lineInterpolation: 'linear',
          },
        },
      },
    },

    // Capacity Planning Row
    {
      id: 13,
      title: 'Capacity Planning',
      type: 'row',
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 27 },
    },

    // User Session Trends
    {
      id: 14,
      title: 'User Session Trends',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 0, y: 28 },
      targets: [
        {
          expr: 'sum(user_sessions_active{environment=~"$environment",tenant_id=~"$tenant_id"})',
          refId: 'A',
          legendFormat: 'Active Sessions',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'short',
          custom: {
            drawStyle: 'line',
            lineInterpolation: 'linear',
            fillOpacity: 20,
          },
        },
      },
    },

    // Database Activity Summary
    {
      id: 15,
      title: 'Database Activity Summary',
      type: 'table',
      gridPos: { h: 8, w: 12, x: 12, y: 28 },
      targets: [
        {
          expr: 'sum by (operation, table) (rate(db_queries_total{environment=~"$environment",tenant_id=~"$tenant_id"}[5m]))',
          refId: 'A',
          format: 'table',
          instant: true,
        },
      ],
      transformations: [
        {
          id: 'organize',
          options: {
            excludeByName: {
              Time: true,
            },
            indexByName: {
              table: 0,
              operation: 1,
              Value: 2,
            },
            renameByName: {
              table: 'Table',
              operation: 'Operation',
              Value: 'Queries/sec',
            },
          },
        },
      ],
      fieldConfig: {
        defaults: {
          custom: {
            align: 'auto',
            displayMode: 'auto',
          },
        },
        overrides: [
          {
            matcher: { id: 'byName', options: 'Queries/sec' },
            properties: [
              {
                id: 'unit',
                value: 'ops',
              },
              {
                id: 'custom.displayMode',
                value: 'gradient-gauge',
              },
            ],
          },
        ],
      },
    },
  ],
};

export default businessMetricsDashboard;