/**
 * Grafana Dashboard: Alga PSA Service Health Overview
 * 
 * This dashboard provides an overview of service health and performance.
 * Designed for Grafana with Prometheus as the data source.
 */

export const serviceHealthDashboard = {
  uid: 'alga-psa-service-health',
  title: 'Alga PSA - Service Health Overview',
  description: 'High-level service health metrics for Alga PSA application monitoring',
  tags: ['alga-psa', 'service-health', 'overview'],
  timezone: 'browser',
  refresh: '30s',
  time: {
    from: 'now-1h',
    to: 'now',
  },
  timepicker: {
    refresh_intervals: ['5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h', '2h', '1d'],
  },
  templating: {
    list: [
      {
        name: 'deployment_type',
        type: 'query',
        query: 'label_values(http_requests_total, deployment_type)',
        current: {
          selected: false,
          text: 'All',
          value: '$__all',
        },
        options: [],
        includeAll: true,
        multi: true,
        datasource: {
          type: 'prometheus',
          uid: '${DS_PROMETHEUS}',
        },
      },
      {
        name: 'tenant_id',
        type: 'query',
        query: 'label_values(http_requests_total{deployment_type="hosted"}, tenant_id)',
        current: {
          selected: false,
          text: 'All',
          value: '$__all',
        },
        options: [],
        includeAll: true,
        multi: true,
        datasource: {
          type: 'prometheus',
          uid: '${DS_PROMETHEUS}',
        },
        hide: 2, // Hide when deployment_type is not hosted
      },
    ],
  },
  panels: [
    // Service Status Row
    {
      id: 1,
      title: 'Service Status',
      type: 'row',
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 0 },
      panels: [],
    },
    
    // Request Rate (RED Method - Rate)
    {
      id: 2,
      title: 'Request Rate (req/sec)',
      type: 'stat',
      gridPos: { h: 8, w: 6, x: 0, y: 1 },
      targets: [
        {
          expr: 'sum(rate(http_requests_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m]))',
          refId: 'A',
          legendFormat: 'Requests/sec',
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
          unit: 'reqps',
        },
      },
    },

    // Error Rate (RED Method - Errors)
    {
      id: 3,
      title: 'Error Rate (%)',
      type: 'stat',
      gridPos: { h: 8, w: 6, x: 6, y: 1 },
      targets: [
        {
          expr: '(sum(rate(http_errors_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m])) / sum(rate(http_requests_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m]))) * 100',
          refId: 'A',
          legendFormat: 'Error Rate',
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
              { color: 'yellow', value: 1 },
              { color: 'red', value: 5 },
            ],
          },
          unit: 'percent',
          max: 100,
          min: 0,
        },
      },
    },

    // Average Response Time (RED Method - Duration)
    {
      id: 4,
      title: 'Avg Response Time (ms)',
      type: 'stat',
      gridPos: { h: 8, w: 6, x: 12, y: 1 },
      targets: [
        {
          expr: 'sum(rate(http_request_duration_seconds_sum{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m])) / sum(rate(http_request_duration_seconds_count{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m])) * 1000',
          refId: 'A',
          legendFormat: 'Avg Response Time',
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
              { color: 'yellow', value: 500 },
              { color: 'red', value: 1000 },
            ],
          },
          unit: 'ms',
        },
      },
    },

    // Active Sessions
    {
      id: 5,
      title: 'Active User Sessions',
      type: 'stat',
      gridPos: { h: 8, w: 6, x: 18, y: 1 },
      targets: [
        {
          expr: 'sum(user_sessions_active{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"})',
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
        },
      },
    },

    // Performance Trends Row
    {
      id: 6,
      title: 'Performance Trends',
      type: 'row',
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 9 },
      panels: [],
    },

    // Request Rate Over Time
    {
      id: 7,
      title: 'Request Rate Over Time',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 0, y: 10 },
      targets: [
        {
          expr: 'sum by (method) (rate(http_requests_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m]))',
          refId: 'A',
          legendFormat: '{{method}}',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'reqps',
        },
      },
    },

    // Response Time Percentiles
    {
      id: 8,
      title: 'Response Time Percentiles',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 12, y: 10 },
      targets: [
        {
          expr: 'histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m])) by (le)) * 1000',
          refId: 'A',
          legendFormat: 'P50',
        },
        {
          expr: 'histogram_quantile(0.90, sum(rate(http_request_duration_seconds_bucket{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m])) by (le)) * 1000',
          refId: 'B',
          legendFormat: 'P90',
        },
        {
          expr: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m])) by (le)) * 1000',
          refId: 'C',
          legendFormat: 'P95',
        },
        {
          expr: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m])) by (le)) * 1000',
          refId: 'D',
          legendFormat: 'P99',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'ms',
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
      panels: [],
    },

    // Database Connections
    {
      id: 10,
      title: 'Database Connections',
      type: 'timeseries',
      gridPos: { h: 8, w: 8, x: 0, y: 19 },
      targets: [
        {
          expr: 'sum(db_connections_active{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"})',
          refId: 'A',
          legendFormat: 'Active Connections',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'short',
        },
      },
    },

    // Memory Usage
    {
      id: 11,
      title: 'Memory Usage',
      type: 'timeseries',
      gridPos: { h: 8, w: 8, x: 8, y: 19 },
      targets: [
        {
          expr: 'sum(system_memory_usage_bytes{deployment_type=~"$deployment_type"})',
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
        },
      },
    },

    // Database Query Performance
    {
      id: 12,
      title: 'Database Query Performance',
      type: 'timeseries',
      gridPos: { h: 8, w: 8, x: 16, y: 19 },
      targets: [
        {
          expr: 'sum(rate(db_query_duration_seconds_sum{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m])) / sum(rate(db_query_duration_seconds_count{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}[5m])) * 1000',
          refId: 'A',
          legendFormat: 'Avg Query Time',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'ms',
        },
      },
    },
  ],
};

export default serviceHealthDashboard;