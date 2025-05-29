# Sample Extension Template

This document provides a template for creating a new Alga PSA extension. It includes the basic file structure and code examples for a simple dashboard widget extension.

## File Structure

```
sample-dashboard-extension/
├── dist/                      # Compiled output (generated)
├── src/
│   ├── components/
│   │   ├── DashboardWidget.tsx
│   │   ├── SettingsPage.tsx
│   │   └── styles.css
│   ├── handlers/
│   │   └── ticketStats.ts
│   ├── utils/
│   │   └── dataTransformer.ts
│   ├── index.ts               # Extension entry point
│   └── types.ts               # TypeScript type definitions
├── alga-extension.json        # Extension manifest
├── package.json               # Node.js package file
├── tsconfig.json              # TypeScript configuration
└── README.md                  # Extension documentation
```

## Extension Manifest

```json
// alga-extension.json
{
  "id": "com.example.ticket-stats-widget",
  "name": "Ticket Statistics Widget",
  "version": "1.0.0",
  "description": "Dashboard widget that displays comprehensive ticket statistics",
  "author": {
    "name": "Example, Inc.",
    "email": "extensions@example.com",
    "url": "https://example.com"
  },
  "minAppVersion": "1.5.0",
  "editions": ["community", "enterprise"],
  "tenantMode": "specific",
  "main": "dist/index.js",
  "permissions": {
    "api": ["tickets:read", "companies:read"],
    "ui": {
      "dashboards": ["main", "company"]
    }
  },
  "extensionPoints": {
    "ui": {
      "dashboardWidgets": [
        {
          "id": "ticket-stats-widget",
          "displayName": "Ticket Statistics",
          "description": "Displays ticket statistics with interactive charts",
          "defaultWidth": "medium",
          "defaultHeight": "medium",
          "component": "dist/components/DashboardWidget.js",
          "supportedDashboards": ["main", "company"],
          "permissions": ["view_tickets"]
        }
      ]
    },
    "api": {
      "endpoints": [
        {
          "id": "ticket-stats",
          "path": "/ticket-stats",
          "method": "GET",
          "handler": "dist/handlers/ticketStats.js"
        }
      ]
    }
  },
  "configurationSchema": {
    "type": "object",
    "properties": {
      "refreshInterval": {
        "type": "number",
        "title": "Data refresh interval (minutes)",
        "default": 5,
        "minimum": 1,
        "maximum": 60
      },
      "chartType": {
        "type": "string",
        "title": "Default chart type",
        "enum": ["bar", "line", "pie"],
        "default": "bar"
      },
      "showLegend": {
        "type": "boolean",
        "title": "Show chart legend",
        "default": true
      }
    }
  },
  "defaultConfiguration": {
    "refreshInterval": 5,
    "chartType": "bar",
    "showLegend": true
  }
}
```

## Package JSON

```json
// package.json
{
  "name": "ticket-stats-widget",
  "version": "1.0.0",
  "description": "Dashboard widget that displays comprehensive ticket statistics",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "eslint src/**/*.{ts,tsx}",
    "package": "alga-extension package"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "chart.js": "^4.3.0",
    "react-chartjs-2": "^5.2.0",
    "date-fns": "^2.30.0"
  },
  "devDependencies": {
    "@algapsa/extension-sdk": "^1.0.0",
    "@algapsa/extension-cli": "^1.0.0",
    "@types/react": "^18.2.0",
    "@types/node": "^18.0.0",
    "typescript": "^5.0.0",
    "eslint": "^8.0.0",
    "eslint-plugin-react": "^7.0.0",
    "eslint-plugin-react-hooks": "^4.0.0"
  }
}
```

## TypeScript Configuration

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "es2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": false,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react",
    "incremental": true,
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

## Extension Entry Point

```typescript
// src/index.ts
import { ExtensionContext } from '@algapsa/extension-sdk';
import type { Configuration } from './types';

/**
 * Initialize the extension
 * 
 * This function is called when the extension is loaded
 */
export async function initialize(context: ExtensionContext) {
  // Access the extension's configuration
  const config = await context.storage.get('config') as Configuration || {
    refreshInterval: 5,
    chartType: 'bar',
    showLegend: true
  };
  
  // Log initialization
  context.logger.info('Ticket Statistics Widget initialized', { config });
  
  // Set up event listeners
  const unsubscribe = context.events.subscribe('ticket:created', async (data) => {
    context.logger.info('New ticket created, refreshing stats', { ticketId: data.id });
    // Could trigger a refresh or update cached data
  });
  
  // Return public API
  return {
    // Method to get current configuration
    getConfiguration: async () => {
      return await context.storage.get('config') as Configuration;
    },
    
    // Method to update configuration
    updateConfiguration: async (newConfig: Partial<Configuration>) => {
      const currentConfig = await context.storage.get('config') as Configuration || {
        refreshInterval: 5,
        chartType: 'bar',
        showLegend: true
      };
      
      const updatedConfig = {
        ...currentConfig,
        ...newConfig
      };
      
      await context.storage.set('config', updatedConfig);
      return updatedConfig;
    },
    
    // Version info
    version: '1.0.0'
  };
}

/**
 * Clean up resources when the extension is disabled or uninstalled
 */
export async function deactivate() {
  // Any cleanup code goes here
  console.log('Ticket Statistics Widget deactivated');
}
```

## Types Definition

```typescript
// src/types.ts

// Extension configuration
export interface Configuration {
  refreshInterval: number;
  chartType: 'bar' | 'line' | 'pie';
  showLegend: boolean;
}

// Ticket statistics data structure
export interface TicketStats {
  totalCount: number;
  openCount: number;
  closedCount: number;
  byPriority: {
    [priority: string]: number;
  };
  byCategory: {
    [category: string]: number;
  };
  byStatus: {
    [status: string]: number;
  };
  resolutionTimes: {
    average: number;
    median: number;
    min: number;
    max: number;
  };
  trendsData: {
    dates: string[];
    created: number[];
    closed: number[];
  };
}

// Company context for company-specific dashboard
export interface CompanyContext {
  companyId: string;
  companyName: string;
}
```

## Dashboard Widget Component

```tsx
// src/components/DashboardWidget.tsx
import React, { useState, useEffect } from 'react';
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  BarElement, 
  Title, 
  Tooltip, 
  Legend,
  ArcElement,
  PointElement,
  LineElement
} from 'chart.js';
import { Bar, Pie, Line } from 'react-chartjs-2';
import { ExtensionComponentProps } from '@algapsa/extension-sdk';
import { Configuration, TicketStats, CompanyContext } from '../types';
import './styles.css';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement
);

const DashboardWidget: React.FC<ExtensionComponentProps> = ({ context }) => {
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Configuration>({
    refreshInterval: 5,
    chartType: 'bar',
    showLegend: true
  });
  
  // Get company ID from context if this is on a company dashboard
  const companyContext = context.data as CompanyContext | undefined;
  const companyId = companyContext?.companyId;
  
  // Load configuration and initial data
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const extensionApi = await context.getExtensionApi();
        const currentConfig = await extensionApi.getConfiguration();
        setConfig(currentConfig);
      } catch (err) {
        context.logger.error('Failed to load configuration', err);
        // Fall back to default config
      }
    };
    
    loadConfig();
  }, []);
  
  // Load ticket stats
  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const query = companyId ? `?companyId=${companyId}` : '';
        const response = await context.apiClient.get(`/api/extensions/com.example.ticket-stats-widget/ticket-stats${query}`);
        setStats(response.data);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to load ticket statistics');
        context.logger.error('Failed to load ticket statistics', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchStats();
    
    // Set up refresh interval
    const intervalId = setInterval(fetchStats, config.refreshInterval * 60 * 1000);
    
    return () => clearInterval(intervalId);
  }, [config.refreshInterval, companyId]);
  
  // Render loading state
  if (loading && !stats) {
    return (
      <div className="ticket-stats-widget loading">
        <div className="loading-spinner"></div>
        <p>Loading ticket statistics...</p>
      </div>
    );
  }
  
  // Render error state
  if (error) {
    return (
      <div className="ticket-stats-widget error">
        <p>Error: {error}</p>
        <button onClick={() => setLoading(true)}>Retry</button>
      </div>
    );
  }
  
  // No data available
  if (!stats) {
    return (
      <div className="ticket-stats-widget empty">
        <p>No ticket data available</p>
      </div>
    );
  }
  
  // Prepare chart data based on selected chart type
  let chartComponent;
  
  switch (config.chartType) {
    case 'pie':
      const pieData = {
        labels: Object.keys(stats.byStatus),
        datasets: [
          {
            data: Object.values(stats.byStatus),
            backgroundColor: [
              '#FF6384',
              '#36A2EB',
              '#FFCE56',
              '#4BC0C0',
              '#9966FF',
              '#FF9F40'
            ]
          }
        ]
      };
      
      chartComponent = (
        <Pie 
          data={pieData} 
          options={{
            plugins: {
              legend: {
                display: config.showLegend
              },
              title: {
                display: true,
                text: 'Tickets by Status'
              }
            }
          }}
        />
      );
      break;
      
    case 'line':
      const lineData = {
        labels: stats.trendsData.dates,
        datasets: [
          {
            label: 'Created',
            data: stats.trendsData.created,
            borderColor: '#36A2EB',
            backgroundColor: 'rgba(54, 162, 235, 0.2)'
          },
          {
            label: 'Closed',
            data: stats.trendsData.closed,
            borderColor: '#FF6384',
            backgroundColor: 'rgba(255, 99, 132, 0.2)'
          }
        ]
      };
      
      chartComponent = (
        <Line 
          data={lineData} 
          options={{
            plugins: {
              legend: {
                display: config.showLegend
              },
              title: {
                display: true,
                text: 'Ticket Trends'
              }
            }
          }}
        />
      );
      break;
      
    case 'bar':
    default:
      const barData = {
        labels: Object.keys(stats.byPriority),
        datasets: [
          {
            label: 'Ticket Count',
            data: Object.values(stats.byPriority),
            backgroundColor: 'rgba(54, 162, 235, 0.5)'
          }
        ]
      };
      
      chartComponent = (
        <Bar 
          data={barData} 
          options={{
            plugins: {
              legend: {
                display: config.showLegend
              },
              title: {
                display: true,
                text: 'Tickets by Priority'
              }
            }
          }}
        />
      );
      break;
  }
  
  return (
    <div className="ticket-stats-widget">
      <div className="widget-header">
        <h3>Ticket Statistics {companyContext ? `- ${companyContext.companyName}` : ''}</h3>
        <div className="widget-controls">
          <select 
            value={config.chartType}
            onChange={async (e) => {
              const newConfig = { ...config, chartType: e.target.value as 'bar' | 'line' | 'pie' };
              setConfig(newConfig);
              
              try {
                const extensionApi = await context.getExtensionApi();
                await extensionApi.updateConfiguration(newConfig);
              } catch (err) {
                context.logger.error('Failed to update configuration', err);
              }
            }}
          >
            <option value="bar">Bar Chart</option>
            <option value="line">Line Chart</option>
            <option value="pie">Pie Chart</option>
          </select>
        </div>
      </div>
      
      <div className="widget-summary">
        <div className="stat-box">
          <span className="stat-value">{stats.totalCount}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat-box">
          <span className="stat-value">{stats.openCount}</span>
          <span className="stat-label">Open</span>
        </div>
        <div className="stat-box">
          <span className="stat-value">{stats.closedCount}</span>
          <span className="stat-label">Closed</span>
        </div>
        <div className="stat-box">
          <span className="stat-value">{stats.resolutionTimes.average.toFixed(1)}h</span>
          <span className="stat-label">Avg. Time</span>
        </div>
      </div>
      
      <div className="widget-chart">
        {chartComponent}
      </div>
    </div>
  );
};

export default DashboardWidget;
```

## API Handler

```typescript
// src/handlers/ticketStats.ts
import { APIHandlerContext } from '@algapsa/extension-sdk';
import { TicketStats } from '../types';
import { formatTicketData } from '../utils/dataTransformer';

/**
 * Handler for the ticket-stats API endpoint
 * 
 * This endpoint returns ticket statistics, optionally filtered by company ID
 */
export async function handler(req: any, res: any, context: APIHandlerContext) {
  try {
    // Get query parameters
    const { companyId } = req.query;
    
    // Build API request parameters
    let params = new URLSearchParams();
    if (companyId) {
      params.append('companyId', companyId);
    }
    
    // Get all tickets (or filtered by company)
    const ticketsResponse = await context.apiClient.get(`/api/tickets?${params.toString()}`);
    const tickets = ticketsResponse.data;
    
    // Process tickets data to generate statistics
    const stats: TicketStats = formatTicketData(tickets);
    
    // Return the processed stats
    return res.json(stats);
  } catch (error: any) {
    context.logger.error('Error fetching ticket statistics', error);
    
    return res.status(500).json({
      error: 'Failed to fetch ticket statistics',
      message: error.message || 'An unexpected error occurred',
    });
  }
}
```

## Data Transformer Utility

```typescript
// src/utils/dataTransformer.ts
import { format, parseISO, differenceInHours } from 'date-fns';
import { TicketStats } from '../types';

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  created_at: string;
  closed_at: string | null;
  company_id: string;
  // Other ticket properties
}

/**
 * Transforms raw ticket data into statistics
 */
export function formatTicketData(tickets: Ticket[]): TicketStats {
  // Calculate basic counts
  const totalCount = tickets.length;
  const openCount = tickets.filter(t => !t.closed_at).length;
  const closedCount = tickets.filter(t => t.closed_at).length;
  
  // Group by priority
  const byPriority: Record<string, number> = {};
  tickets.forEach(ticket => {
    byPriority[ticket.priority] = (byPriority[ticket.priority] || 0) + 1;
  });
  
  // Group by category
  const byCategory: Record<string, number> = {};
  tickets.forEach(ticket => {
    byCategory[ticket.category] = (byCategory[ticket.category] || 0) + 1;
  });
  
  // Group by status
  const byStatus: Record<string, number> = {};
  tickets.forEach(ticket => {
    byStatus[ticket.status] = (byStatus[ticket.status] || 0) + 1;
  });
  
  // Calculate resolution times
  const resolutionTimes: number[] = tickets
    .filter(t => t.closed_at)
    .map(ticket => {
      const created = parseISO(ticket.created_at);
      const closed = parseISO(ticket.closed_at!);
      return differenceInHours(closed, created);
    });
  
  // Calculate resolution time statistics
  const average = resolutionTimes.length 
    ? resolutionTimes.reduce((sum, time) => sum + time, 0) / resolutionTimes.length 
    : 0;
  
  const sortedTimes = [...resolutionTimes].sort((a, b) => a - b);
  const median = sortedTimes.length 
    ? sortedTimes[Math.floor(sortedTimes.length / 2)] 
    : 0;
  
  const min = sortedTimes.length ? sortedTimes[0] : 0;
  const max = sortedTimes.length ? sortedTimes[sortedTimes.length - 1] : 0;
  
  // Generate trend data for the last 7 days
  const now = new Date();
  const dates: string[] = [];
  const createdCounts: number[] = [];
  const closedCounts: number[] = [];
  
  // Generate the last 7 days
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(now.getDate() - i);
    const formattedDate = format(date, 'MM/dd');
    
    // Format date to YYYY-MM-DD for comparison
    const dateString = format(date, 'yyyy-MM-dd');
    
    // Count tickets created on this date
    const createdOnDate = tickets.filter(ticket => {
      const createdDate = format(parseISO(ticket.created_at), 'yyyy-MM-dd');
      return createdDate === dateString;
    }).length;
    
    // Count tickets closed on this date
    const closedOnDate = tickets.filter(ticket => {
      if (!ticket.closed_at) return false;
      const closedDate = format(parseISO(ticket.closed_at), 'yyyy-MM-dd');
      return closedDate === dateString;
    }).length;
    
    dates.push(formattedDate);
    createdCounts.push(createdOnDate);
    closedCounts.push(closedOnDate);
  }
  
  return {
    totalCount,
    openCount,
    closedCount,
    byPriority,
    byCategory,
    byStatus,
    resolutionTimes: {
      average,
      median,
      min,
      max
    },
    trendsData: {
      dates,
      created: createdCounts,
      closed: closedCounts
    }
  };
}
```

## Settings Page Component

```tsx
// src/components/SettingsPage.tsx
import React, { useState, useEffect } from 'react';
import { SettingsPageProps } from '@algapsa/extension-sdk';
import { Configuration } from '../types';

const SettingsPage: React.FC<SettingsPageProps> = ({
  context,
  onSave
}) => {
  const [config, setConfig] = useState<Configuration>({
    refreshInterval: 5,
    chartType: 'bar',
    showLegend: true
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  
  // Load current configuration
  useEffect(() => {
    const loadConfig = async () => {
      try {
        setLoading(true);
        const extensionApi = await context.getExtensionApi();
        const currentConfig = await extensionApi.getConfiguration();
        setConfig(currentConfig);
      } catch (error) {
        context.logger.error('Failed to load configuration', error);
        context.uiComponents.Toast.error('Failed to load settings');
      } finally {
        setLoading(false);
      }
    };
    
    loadConfig();
  }, []);
  
  // Handle save
  const handleSave = async () => {
    try {
      setIsSaving(true);
      const extensionApi = await context.getExtensionApi();
      await extensionApi.updateConfiguration(config);
      await onSave(config);
      context.uiComponents.Toast.success('Settings saved successfully');
    } catch (error) {
      context.logger.error('Failed to save configuration', error);
      context.uiComponents.Toast.error('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };
  
  if (loading) {
    return <div className="loading">Loading settings...</div>;
  }
  
  return (
    <div className="settings-page">
      <h2>Ticket Statistics Widget Settings</h2>
      
      <div className="form-group">
        <label htmlFor="refreshInterval">Refresh Interval (minutes)</label>
        <context.uiComponents.Input
          id="refreshInterval"
          type="number"
          value={config.refreshInterval}
          min={1}
          max={60}
          onChange={(e) => setConfig({
            ...config,
            refreshInterval: parseInt(e.target.value, 10) || 5
          })}
        />
        <div className="helper-text">
          How often the widget should refresh its data (1-60 minutes)
        </div>
      </div>
      
      <div className="form-group">
        <label htmlFor="chartType">Default Chart Type</label>
        <context.uiComponents.Select
          id="chartType"
          value={config.chartType}
          onChange={(e) => setConfig({
            ...config,
            chartType: e.target.value as 'bar' | 'line' | 'pie'
          })}
        >
          <option value="bar">Bar Chart</option>
          <option value="line">Line Chart</option>
          <option value="pie">Pie Chart</option>
        </context.uiComponents.Select>
        <div className="helper-text">
          The default chart type to display when the widget loads
        </div>
      </div>
      
      <div className="form-group">
        <context.uiComponents.Checkbox
          id="showLegend"
          checked={config.showLegend}
          onChange={(e) => setConfig({
            ...config,
            showLegend: e.target.checked
          })}
        />
        <label htmlFor="showLegend">Show Chart Legend</label>
      </div>
      
      <div className="actions">
        <context.uiComponents.Button
          onClick={handleSave}
          disabled={isSaving}
          loading={isSaving}
        >
          Save Settings
        </context.uiComponents.Button>
      </div>
    </div>
  );
};

export default SettingsPage;
```

## CSS Styles

```css
/* src/components/styles.css */
.ticket-stats-widget {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.widget-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.widget-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.widget-controls select {
  padding: 4px 8px;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  font-size: 14px;
}

.widget-summary {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
}

.stat-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 12px;
  background-color: #f8fafc;
  border-radius: 6px;
  min-width: 70px;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: #334155;
}

.stat-label {
  font-size: 12px;
  color: #64748b;
  margin-top: 4px;
}

.widget-chart {
  flex-grow: 1;
  min-height: 200px;
  position: relative;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top: 4px solid #3498db;
  animation: spin 1s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.ticket-stats-widget.loading,
.ticket-stats-widget.error,
.ticket-stats-widget.empty {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 16px;
  text-align: center;
  color: #64748b;
}

.ticket-stats-widget.error {
  color: #ef4444;
}

/* Settings page styles */
.settings-page {
  padding: 20px;
  max-width: 600px;
}

.settings-page h2 {
  margin-bottom: 24px;
  font-size: 20px;
  font-weight: 600;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
}

.helper-text {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
}

.actions {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
}
```

## README.md

```markdown
# Ticket Statistics Widget Extension for Alga PSA

A dashboard widget that displays comprehensive ticket statistics with interactive charts.

## Features

- Overview of ticket counts by status, priority, and category
- Interactive charts with multiple visualization options
- Configurable refresh interval
- Support for company-specific filtering
- Trend analysis with 7-day historical data

## Installation

1. Download the extension package (.algaext)
2. In Alga PSA, navigate to Settings > Extensions
3. Click "Install Extension" and select the downloaded file
4. Configure extension settings as needed

## Configuration Options

- **Refresh Interval**: How often the widget refreshes data (1-60 minutes)
- **Default Chart Type**: Choose between bar, line, or pie charts
- **Show Legend**: Toggle chart legend visibility

## Permissions Required

This extension requires the following permissions:
- Access to read ticket data
- Access to read company data
- Ability to add widgets to dashboards

## Support

For questions or issues, contact extensions@example.com or visit our support portal at https://example.com/support.

## Version History

- 1.0.0 (2025-06-01): Initial release

## License

This extension is licensed under the MIT License. See LICENSE file for details.
```

## Usage Instructions

### Building and Packaging

To build the extension:

1. Install dependencies:
```bash
npm install
```

2. Build the extension:
```bash
npm run build
```

3. Package the extension:
```bash
npm run package
```

This will create a `.algaext` file in the `dist` directory that can be installed in Alga PSA.

### Local Development

For local development:

1. Run the extension in watch mode:
```bash
npm run dev
```

2. In your Alga PSA development environment, enable the extension development mode and load the local extension:
```bash
alga extension load-dev --path=/path/to/sample-dashboard-extension
```

3. Make changes to your extension code and see them reflected in real-time.

### Testing

To verify your extension works correctly:

1. Check that the widget appears in the dashboard
2. Verify that the API endpoint returns the expected data
3. Test configuration changes in the settings page
4. Ensure the widget updates when new tickets are created