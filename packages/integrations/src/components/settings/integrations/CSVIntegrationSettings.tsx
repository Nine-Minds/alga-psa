'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { FileSpreadsheet } from 'lucide-react';
import { CSVMappingManager } from '@alga-psa/integrations/components/csv/CSVMappingManager';
import { Button } from '@alga-psa/ui/components/Button';
import { FileText, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card id="csv-integration-overview-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            {t('integrations.csv.settings.qbo.title', { defaultValue: 'QuickBooks CSV Integration' })}
          </CardTitle>
          <CardDescription>
            {t('integrations.csv.settings.qbo.description', { defaultValue: 'Export invoices to CSV for manual import into QuickBooks, and import tax data from QuickBooks reports.' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded border border-border/60 bg-muted/40 p-4 text-sm leading-6 text-muted-foreground space-y-3">
            <p>
              {t('integrations.csv.settings.qbo.intro', { defaultValue: 'This integration provides an alternative to OAuth-based QuickBooks connectivity:' })}
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>{t('integrations.csv.settings.qbo.bullets.exportLabel', { defaultValue: 'Export' })}</strong>: {t('integrations.csv.settings.qbo.bullets.exportText', { defaultValue: "Generate CSV files compatible with QuickBooks' invoice import feature" })}
              </li>
              <li>
                <strong>{t('integrations.csv.settings.qbo.bullets.taxImportLabel', { defaultValue: 'Tax Import' })}</strong>: {t('integrations.csv.settings.qbo.bullets.taxImportText', { defaultValue: 'When using external tax calculation, import tax amounts from QuickBooks tax reports' })}
              </li>
            </ul>
            <p className="text-xs">
              {t('integrations.csv.settings.qbo.note', { defaultValue: 'Note: Configure mappings below before exporting. CSV exports and tax imports are managed from Billing → Accounting Exports.' })}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card id="qbcsv-mapping-settings-card">
        <CardHeader>
          <CardTitle>{t('integrations.csv.settings.qbo.mappings.title', { defaultValue: 'QuickBooks CSV Mappings' })}</CardTitle>
          <CardDescription>
            {t('integrations.csv.settings.qbo.mappings.description', { defaultValue: 'Map Alga clients, services, tax codes, and payment terms to the identifiers used in your QuickBooks company. These values are used when generating the CSV export.' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CSVMappingManager />
        </CardContent>
      </Card>

      <Card id="qbcsv-export-navigation-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t('integrations.csv.settings.exports.title', { defaultValue: 'Accounting Exports' })}
          </CardTitle>
          <CardDescription>
            {t('integrations.csv.settings.exports.description', { defaultValue: 'Create export batches, download CSV files, import tax reports, and review export history.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="info">
            <AlertTitle>{t('integrations.csv.settings.exports.managedTitle', { defaultValue: 'Managed from Billing' })}</AlertTitle>
            <AlertDescription>
              {t('integrations.csv.settings.qbo.exports.managedPrefix', { defaultValue: 'Go to' })}{' '}
              <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
                {t('integrations.csv.settings.exports.path', { defaultValue: 'Billing → Accounting Exports' })}
              </span>{' '}
              {t('integrations.csv.settings.qbo.exports.managedSuffix', { defaultValue: 'to select invoices, generate QuickBooks CSV exports, import tax reports, and manage batches.' })}
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter className="justify-end">
          <Button id="qbcsv-open-accounting-exports" asChild size="lg">
            <Link href="/msp/billing?tab=accounting-exports" className="inline-flex items-center gap-2">
              {t('integrations.csv.settings.exports.openButton', { defaultValue: 'Open Accounting Exports' })}
              <ExternalLink className="h-4 w-4 opacity-90" />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default CSVIntegrationSettings;
