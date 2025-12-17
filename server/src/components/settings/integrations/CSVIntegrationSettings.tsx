'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/Card';
import { CSVExportPanel } from '../../integrations/csv/CSVExportPanel';
import { CSVTaxImportPanel } from '../../integrations/csv/CSVTaxImportPanel';
import { FileSpreadsheet } from 'lucide-react';
import { CSVMappingManager } from '../../integrations/csv/CSVMappingManager';

/**
 * CSV Integration Settings Component
 *
 * Provides CSV-based export/import for QuickBooks as an alternative
 * to OAuth-based integration. Useful when:
 * - OAuth integration is not available or pending approval
 * - Manual import process is preferred
 * - External tax calculation with report-based feedback is needed
 */
const CSVIntegrationSettings: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card id="csv-integration-overview-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            QuickBooks CSV Integration
          </CardTitle>
          <CardDescription>
            Export invoices to CSV for manual import into QuickBooks, and import tax data from QuickBooks reports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded border border-border/60 bg-muted/40 p-4 text-sm leading-6 text-muted-foreground space-y-3">
            <p>
              This integration provides an alternative to OAuth-based QuickBooks connectivity:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Export</strong>: Generate CSV files compatible with QuickBooks&apos; invoice import feature
              </li>
              <li>
                <strong>Tax Import</strong>: When using external tax calculation, import tax amounts from QuickBooks tax reports
              </li>
            </ul>
            <p className="text-xs">
              Note: Configure mappings below before exporting. These mappings are stored separately from the OAuth-based QuickBooks Online integration.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card id="qbcsv-mapping-settings-card">
        <CardHeader>
          <CardTitle>QuickBooks CSV Mappings</CardTitle>
          <CardDescription>
            Map Alga clients, services, tax codes, and payment terms to the identifiers used in your QuickBooks company. These values are used when generating the CSV export.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CSVMappingManager />
        </CardContent>
      </Card>

      {/* Export Panel */}
      <CSVExportPanel />

      {/* Import Panel */}
      <CSVTaxImportPanel />
    </div>
  );
};

export default CSVIntegrationSettings;
