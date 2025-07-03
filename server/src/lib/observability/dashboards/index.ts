/**
 * Grafana Dashboards for Alga PSA Observability
 * 
 * Pre-built dashboards for operational monitoring using Prometheus metrics.
 * These can be imported into Grafana or provisioned automatically.
 * 
 * IMPORTANT: These dashboards are for operational observability only.
 * They display system health, performance, and capacity metrics.
 * User behavior analytics are handled separately by PostHog.
 */

import serviceHealthDashboard from './service-health';
import apiPerformanceDashboard from './api-performance';
import businessMetricsDashboard from './business-metrics';

export {
  serviceHealthDashboard,
  apiPerformanceDashboard,
  businessMetricsDashboard,
};

/**
 * All available dashboards
 */
export const allDashboards = {
  'service-health': serviceHealthDashboard,
  'api-performance': apiPerformanceDashboard,
  'business-metrics': businessMetricsDashboard,
};

/**
 * Dashboard metadata for easier management
 */
export const dashboardMetadata = [
  {
    id: 'service-health',
    name: 'Service Health Overview',
    description: 'High-level service health metrics and RED method monitoring',
    category: 'overview',
    priority: 1,
    dashboard: serviceHealthDashboard,
  },
  {
    id: 'api-performance',
    name: 'API Performance',
    description: 'Detailed API endpoint performance and error analysis',
    category: 'performance',
    priority: 2,
    dashboard: apiPerformanceDashboard,
  },
  {
    id: 'business-metrics',
    name: 'Business & System Metrics',
    description: 'Operational business metrics and system resource monitoring',
    category: 'operations',
    priority: 3,
    dashboard: businessMetricsDashboard,
  },
];

/**
 * Generate Grafana provisioning configuration
 * This can be used to automatically provision dashboards in Grafana
 */
export function generateGrafanaProvisioningConfig(): {
  dashboards: any[];
  datasources: any[];
} {
  const dashboards = dashboardMetadata.map((meta) => ({
    name: meta.name,
    type: 'file',
    disableDeletion: false,
    updateIntervalSeconds: 30,
    allowUiUpdates: true,
    options: {
      path: `/etc/grafana/provisioning/dashboards/${meta.id}.json`,
    },
  }));

  const datasources = [
    {
      name: 'Prometheus',
      type: 'prometheus',
      access: 'proxy',
      url: process.env.PROMETHEUS_ENDPOINT || 'http://prometheus:9090',
      isDefault: true,
      editable: true,
    },
    {
      name: 'Loki',
      type: 'loki',
      access: 'proxy',
      url: process.env.LOKI_ENDPOINT || 'http://loki:3100',
      editable: true,
    },
    {
      name: 'Tempo',
      type: 'tempo',
      access: 'proxy',
      url: process.env.TEMPO_ENDPOINT || 'http://tempo:3200',
      editable: true,
    },
  ];

  return {
    dashboards,
    datasources,
  };
}

/**
 * Export dashboards as JSON files for manual import
 */
export function exportDashboardsAsJson(): Record<string, string> {
  const exported: Record<string, string> = {};
  
  for (const [key, dashboard] of Object.entries(allDashboards)) {
    exported[`${key}.json`] = JSON.stringify(dashboard, null, 2);
  }
  
  return exported;
}

/**
 * Get dashboard by ID
 */
export function getDashboard(id: string): any | null {
  return allDashboards[id as keyof typeof allDashboards] || null;
}

/**
 * Get all dashboard IDs
 */
export function getDashboardIds(): string[] {
  return Object.keys(allDashboards);
}

/**
 * Validate dashboard configuration
 */
export function validateDashboard(dashboard: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!dashboard.uid) {
    errors.push('Dashboard must have a uid');
  }
  
  if (!dashboard.title) {
    errors.push('Dashboard must have a title');
  }
  
  if (!dashboard.panels || !Array.isArray(dashboard.panels)) {
    errors.push('Dashboard must have panels array');
  }
  
  if (!dashboard.tags || !Array.isArray(dashboard.tags)) {
    errors.push('Dashboard should have tags array');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get dashboard summary for API responses
 */
export function getDashboardSummary(): Array<{
  id: string;
  title: string;
  description: string;
  category: string;
  uid: string;
  tags: string[];
}> {
  return dashboardMetadata.map((meta) => ({
    id: meta.id,
    title: meta.dashboard.title,
    description: meta.dashboard.description,
    category: meta.category,
    uid: meta.dashboard.uid,
    tags: meta.dashboard.tags || [],
  }));
}

/**
 * Grafana provisioning files for docker-compose or Kubernetes
 */
export const provisioningFiles = {
  /**
   * Grafana dashboard provisioning configuration
   */
  dashboardProvisioning: `
apiVersion: 1

providers:
  - name: 'alga-psa-dashboards'
    orgId: 1
    folder: 'Alga PSA'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    allowUiUpdates: true
    options:
      path: /etc/grafana/provisioning/dashboards/alga-psa
  `,

  /**
   * Grafana datasource provisioning configuration
   */
  datasourceProvisioning: `
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: \${PROMETHEUS_ENDPOINT:-http://prometheus:9090}
    isDefault: true
    editable: true
    
  - name: Loki
    type: loki
    access: proxy
    url: \${LOKI_ENDPOINT:-http://loki:3100}
    editable: true
    
  - name: Tempo
    type: tempo
    access: proxy
    url: \${TEMPO_ENDPOINT:-http://tempo:3200}
    editable: true
    jsonData:
      httpMethod: GET
      tracesToLogs:
        datasourceUid: 'loki'
        filterByTraceID: true
        mapTagNamesEnabled: true
  `,
};

export default {
  allDashboards,
  dashboardMetadata,
  generateGrafanaProvisioningConfig,
  exportDashboardsAsJson,
  getDashboard,
  getDashboardIds,
  validateDashboard,
  getDashboardSummary,
  provisioningFiles,
};