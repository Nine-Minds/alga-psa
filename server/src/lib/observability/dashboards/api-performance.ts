/**
 * Grafana Dashboard: Alga PSA API Performance
 * 
 * Detailed API performance metrics and endpoint analysis.
 * Focuses on individual route performance and patterns.
 */

export const apiPerformanceDashboard = {
  uid: 'alga-psa-api-performance',
  title: 'Alga PSA - API Performance',
  description: 'Detailed API performance metrics and endpoint analysis for operational monitoring',
  tags: ['alga-psa', 'api', 'performance', 'endpoints'],
  timezone: 'browser',
  refresh: '30s',
  time: {
    from: 'now-1h',
    to: 'now',
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
        includeAll: true,
        multi: true,
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
        includeAll: true,
        multi: true,
        hide: 2,
      },
      {
        name: 'route',
        type: 'query',
        query: 'label_values(http_requests_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}, route)',
        current: {
          selected: false,
          text: 'All',
          value: '$__all',
        },
        includeAll: true,
        multi: true,
      },
      {
        name: 'method',
        type: 'query',
        query: 'label_values(http_requests_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id"}, method)',
        current: {
          selected: false,
          text: 'All',
          value: '$__all',
        },
        includeAll: true,
        multi: true,
      },
    ],
  },
  panels: [
    // API Overview Row
    {
      id: 1,
      title: 'API Overview',
      type: 'row',
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 0 },
    },

    // Top Endpoints by Request Volume
    {
      id: 2,
      title: 'Top Endpoints by Request Volume',
      type: 'table',
      gridPos: { h: 8, w: 12, x: 0, y: 1 },
      targets: [
        {
          expr: 'topk(10, sum by (route, method) (rate(http_requests_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id",route=~"$route",method=~"$method"}[5m])))',
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
              route: 0,
              method: 1,
              Value: 2,
            },
            renameByName: {
              route: 'Route',
              method: 'Method',
              Value: 'Requests/sec',
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
            matcher: { id: 'byName', options: 'Requests/sec' },
            properties: [
              {
                id: 'unit',
                value: 'reqps',
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

    // Slowest Endpoints
    {
      id: 3,
      title: 'Slowest Endpoints (P95 Response Time)',
      type: 'table',
      gridPos: { h: 8, w: 12, x: 12, y: 1 },
      targets: [
        {
          expr: 'topk(10, histogram_quantile(0.95, sum by (route, method, le) (rate(http_request_duration_seconds_bucket{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id",route=~"$route",method=~"$method"}[5m])))) * 1000',
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
              le: true,
            },
            indexByName: {
              route: 0,
              method: 1,
              Value: 2,
            },
            renameByName: {
              route: 'Route',
              method: 'Method',
              Value: 'P95 Response Time (ms)',
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
            matcher: { id: 'byName', options: 'P95 Response Time (ms)' },
            properties: [
              {
                id: 'unit',
                value: 'ms',
              },
              {
                id: 'custom.displayMode',
                value: 'gradient-gauge',
              },
              {
                id: 'thresholds',
                value: {
                  steps: [
                    { color: 'green', value: null },
                    { color: 'yellow', value: 500 },
                    { color: 'red', value: 1000 },
                  ],
                },
              },
            ],
          },
        ],
      },
    },

    // Request Rate by Endpoint Row
    {
      id: 4,
      title: 'Request Patterns',
      type: 'row',
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 9 },
    },

    // Request Rate by Route
    {
      id: 5,
      title: 'Request Rate by Route',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 0, y: 10 },
      targets: [
        {
          expr: 'sum by (route) (rate(http_requests_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id",route=~"$route",method=~"$method"}[5m]))',
          refId: 'A',
          legendFormat: '{{route}}',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'reqps',
          custom: {
            drawStyle: 'line',
            lineInterpolation: 'linear',
            barAlignment: 0,
            lineWidth: 1,
            fillOpacity: 10,
            gradientMode: 'none',
            spanNulls: false,
            insertNulls: false,
            showPoints: 'never',
            pointSize: 5,
            stacking: {
              mode: 'none',
              group: 'A',
            },
          },
        },
      },
    },

    // HTTP Status Codes Distribution
    {
      id: 6,
      title: 'HTTP Status Codes Distribution',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 12, y: 10 },
      targets: [
        {
          expr: 'sum by (status_code) (rate(http_requests_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id",route=~"$route",method=~"$method"}[5m]))',
          refId: 'A',
          legendFormat: '{{status_code}}',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'reqps',
          custom: {
            drawStyle: 'line',
            lineInterpolation: 'linear',
            stacking: {
              mode: 'normal',
              group: 'A',
            },
          },
        },
        overrides: [
          {
            matcher: { id: 'byRegex', options: '/^[45].*/' },
            properties: [
              {
                id: 'color',
                value: {
                  mode: 'fixed',
                  fixedColor: 'red',
                },
              },
            ],
          },
          {
            matcher: { id: 'byRegex', options: '/^[23].*/' },
            properties: [
              {
                id: 'color',
                value: {
                  mode: 'fixed',
                  fixedColor: 'green',
                },
              },
            ],
          },
        ],
      },
    },

    // Response Time Analysis Row
    {
      id: 7,
      title: 'Response Time Analysis',
      type: 'row',
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 18 },
    },

    // Response Time Heatmap
    {
      id: 8,
      title: 'Response Time Distribution (Heatmap)',
      type: 'heatmap',
      gridPos: { h: 8, w: 24, x: 0, y: 19 },
      targets: [
        {
          expr: 'sum(rate(http_request_duration_seconds_bucket{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id",route=~"$route",method=~"$method"}[5m])) by (le)',
          refId: 'A',
          format: 'heatmap',
          legendFormat: '{{le}}',
        },
      ],
      fieldConfig: {
        defaults: {
          custom: {
            hideFrom: {
              legend: false,
              tooltip: false,
              vis: false,
            },
            scaleDistribution: {
              type: 'linear',
            },
          },
        },
      },
    },

    // Error Analysis Row
    {
      id: 9,
      title: 'Error Analysis',
      type: 'row',
      collapsed: false,
      gridPos: { h: 1, w: 24, x: 0, y: 27 },
    },

    // Error Rate by Endpoint
    {
      id: 10,
      title: 'Error Rate by Endpoint',
      type: 'timeseries',
      gridPos: { h: 8, w: 12, x: 0, y: 28 },
      targets: [
        {
          expr: '(sum by (route) (rate(http_errors_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id",route=~"$route",method=~"$method"}[5m])) / sum by (route) (rate(http_requests_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id",route=~"$route",method=~"$method"}[5m]))) * 100',
          refId: 'A',
          legendFormat: '{{route}}',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          unit: 'percent',
          min: 0,
          max: 100,
          thresholds: {
            steps: [
              { color: 'green', value: null },
              { color: 'yellow', value: 1 },
              { color: 'red', value: 5 },
            ],
          },
        },
      },
    },

    // Most Common Errors
    {
      id: 11,
      title: 'Most Common Errors (Last Hour)',
      type: 'table',
      gridPos: { h: 8, w: 12, x: 12, y: 28 },
      targets: [
        {
          expr: 'topk(10, sum by (route, method, status_code) (increase(http_requests_total{deployment_type=~"$deployment_type",tenant_id=~"$tenant_id",status_code=~"[45].*",route=~"$route",method=~"$method"}[1h])))',
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
              route: 0,
              method: 1,
              status_code: 2,
              Value: 3,
            },
            renameByName: {
              route: 'Route',
              method: 'Method',
              status_code: 'Status Code',
              Value: 'Error Count',
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
            matcher: { id: 'byName', options: 'Error Count' },
            properties: [
              {
                id: 'custom.displayMode',
                value: 'gradient-gauge',
              },
              {
                id: 'color',
                value: {
                  mode: 'continuous-GrYlRd',
                },
              },
            ],
          },
        ],
      },
    },
  ],
};

export default apiPerformanceDashboard;