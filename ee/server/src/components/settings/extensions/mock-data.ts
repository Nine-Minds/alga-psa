import { Extension, ExtensionManifest } from '@/lib/extensions/types';

// Mock extension data for UI development
export const mockExtensionData: Extension[] = [
  {
    id: 'ext-001',
    name: 'Customer Dashboard',
    description: 'Enhanced customer dashboard with additional analytics and insights',
    version: '1.0.0',
    author: 'Nine Minds',
    isEnabled: true,
    createdAt: new Date('2025-05-01T00:00:00Z'),
    updatedAt: new Date('2025-05-10T00:00:00Z'),
    tenantId: 'tenant-001',
    manifest: {
      name: 'customer-dashboard',
      description: 'Enhanced customer dashboard with additional analytics and insights',
      version: '1.0.0',
      author: 'Nine Minds',
      homepage: 'https://nine-minds.com/extensions/customer-dashboard',
      repository: 'https://github.com/nine-minds/customer-dashboard',
      license: 'MIT',
      main: './index.js',
      components: [
        {
          type: 'tab',
          id: 'customer-insights',
          entryPoint: './components/CustomerInsights.js',
          mountPoint: 'company-details',
          properties: {
            label: 'Customer Insights',
            icon: 'ChartBarIcon',
            order: 50
          }
        }
      ],
      permissions: [
        'company:read',
        'invoice:read',
        'ticket:read'
      ],
      settings: [
        {
          key: 'displayMode',
          label: 'Display Mode',
          description: 'Choose how the dashboard data is displayed',
          type: 'select',
          defaultValue: 'charts',
          options: [
            { label: 'Charts & Graphs', value: 'charts' },
            { label: 'Data Tables', value: 'tables' },
            { label: 'Mixed View', value: 'mixed' }
          ],
          required: true,
          category: 'Display'
        },
        {
          key: 'refreshInterval',
          label: 'Data Refresh Interval',
          description: 'How often to refresh the dashboard data (in minutes)',
          type: 'number',
          defaultValue: 5,
          min: 1,
          max: 60,
          required: true,
          category: 'Performance'
        },
        {
          key: 'showBillingTrends',
          label: 'Show Billing Trends',
          description: 'Display billing trends on the dashboard',
          type: 'boolean',
          defaultValue: true,
          category: 'Display'
        },
        {
          key: 'apiKey',
          label: 'External API Key',
          description: 'API key for external data integration (if needed)',
          type: 'string',
          placeholder: 'Enter API key',
          category: 'Integration'
        }
      ],
      assets: [
        './assets/icon.svg',
        './assets/styles.css'
      ]
    }
  },
  {
    id: 'ext-002',
    name: 'Reporting Pack',
    description: 'Additional reporting templates and export options',
    version: '1.2.3',
    author: 'Alga Integrations',
    isEnabled: true,
    createdAt: new Date('2025-04-15T00:00:00Z'),
    updatedAt: new Date('2025-05-05T00:00:00Z'),
    tenantId: 'tenant-001',
    manifest: {
      name: 'reporting-pack',
      description: 'Additional reporting templates and export options',
      version: '1.2.3',
      author: 'Alga Integrations',
      license: 'Commercial',
      main: './index.js',
      components: [
        {
          type: 'page',
          id: 'advanced-reports',
          entryPoint: './pages/AdvancedReports.js',
          properties: {
            label: 'Advanced Reports',
            icon: 'DocumentChartBarIcon',
            navigationPath: '/reports'
          }
        },
        {
          type: 'navigation',
          id: 'reports-nav',
          entryPoint: './components/ReportsNavItem.js',
          properties: {
            label: 'Advanced Reports',
            icon: 'DocumentChartBarIcon',
            order: 80,
            section: 'reporting'
          }
        }
      ],
      permissions: [
        'report:read',
        'report:write',
        'company:read',
        'invoice:read',
        'ticket:read',
        'storage:read'
      ],
      settings: [
        {
          key: 'defaultFormat',
          label: 'Default Export Format',
          description: 'Default format for report exports',
          type: 'select',
          defaultValue: 'pdf',
          options: [
            { label: 'PDF', value: 'pdf' },
            { label: 'Excel', value: 'xlsx' },
            { label: 'CSV', value: 'csv' }
          ],
          required: true
        },
        {
          key: 'companyLogoInReports',
          label: 'Include Company Logo',
          description: 'Include your company logo in report headers',
          type: 'boolean',
          defaultValue: true
        },
        {
          key: 'footerText',
          label: 'Custom Footer Text',
          description: 'Custom text to include in report footers',
          type: 'text',
          placeholder: 'Enter footer text'
        }
      ]
    }
  },
  {
    id: 'ext-003',
    name: 'QuickBooks Pro Sync',
    description: 'Enhanced QuickBooks integration with advanced mapping and reconciliation',
    version: '2.0.1',
    author: 'Accounting Solutions Ltd',
    isEnabled: false,
    createdAt: new Date('2025-03-20T00:00:00Z'),
    updatedAt: new Date('2025-04-20T00:00:00Z'),
    tenantId: 'tenant-001',
    manifest: {
      name: 'quickbooks-pro-sync',
      description: 'Enhanced QuickBooks integration with advanced mapping and reconciliation',
      version: '2.0.1',
      author: 'Accounting Solutions Ltd',
      license: 'Commercial',
      main: './index.js',
      components: [
        {
          type: 'tab',
          id: 'qb-mapping',
          entryPoint: './components/QBMapping.js',
          mountPoint: 'integration-settings',
          properties: {
            label: 'QuickBooks Mapping',
            icon: 'CogIcon',
            order: 20
          }
        },
        {
          type: 'tab',
          id: 'qb-reconciliation',
          entryPoint: './components/QBReconciliation.js',
          mountPoint: 'accounting',
          properties: {
            label: 'QB Reconciliation',
            icon: 'CheckCircleIcon',
            order: 30
          }
        }
      ],
      permissions: [
        'integration:manage',
        'company:read',
        'company:write',
        'invoice:read',
        'invoice:write',
        'storage:read',
        'storage:write'
      ],
      settings: [
        {
          key: 'qbEnvironment',
          label: 'QuickBooks Environment',
          description: 'Select which QuickBooks environment to connect to',
          type: 'select',
          defaultValue: 'production',
          options: [
            { label: 'Production', value: 'production' },
            { label: 'Sandbox', value: 'sandbox' }
          ],
          required: true,
          category: 'Connection'
        },
        {
          key: 'syncFrequency',
          label: 'Sync Frequency',
          description: 'How often to sync data with QuickBooks (in hours)',
          type: 'number',
          defaultValue: 24,
          min: 1,
          max: 168,
          required: true,
          category: 'Sync Settings'
        },
        {
          key: 'autoSync',
          label: 'Automatic Sync',
          description: 'Enable automatic synchronization',
          type: 'boolean',
          defaultValue: true,
          category: 'Sync Settings'
        },
        {
          key: 'companyMappingDefault',
          label: 'Default Company Mapping',
          description: 'Default mapping for new companies',
          type: 'select',
          defaultValue: 'customer',
          options: [
            { label: 'Customer', value: 'customer' },
            { label: 'Vendor', value: 'vendor' },
            { label: 'Both', value: 'both' }
          ],
          category: 'Mapping'
        },
        {
          key: 'webhookUrl',
          label: 'Webhook URL',
          description: 'URL for QuickBooks webhooks (if using)',
          type: 'string',
          placeholder: 'https://...',
          category: 'Advanced'
        },
        {
          key: 'loggingLevel',
          label: 'Logging Level',
          description: 'Detail level for sync logs',
          type: 'select',
          defaultValue: 'info',
          options: [
            { label: 'Error', value: 'error' },
            { label: 'Warning', value: 'warning' },
            { label: 'Info', value: 'info' },
            { label: 'Debug', value: 'debug' }
          ],
          category: 'Advanced'
        }
      ],
      requiredExtensions: []
    }
  }
];