'use client';

import React from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { CSVMappingManager } from '@alga-psa/integrations/components/csv/CSVMappingManager';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * QuickBooks CSV settings — a file-based workflow: map your billing data once,
 * then generate CSVs from Billing → Accounting Exports and (optionally) import
 * tax totals back from QuickBooks reports.
 */
const CSVIntegrationSettings: React.FC = () => {
  const { t } = useTranslation('msp/integrations');

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t('integrations.csv.settings.qbo.summary', {
            defaultValue:
              'Generate a CSV of your finalized invoices to import into QuickBooks. When you calculate tax outside Alga, you can import the tax totals back from QuickBooks reports. Map your billing data below, then run exports from Billing → Accounting Exports.'
          })}
        </p>
      </section>

      <section id="qbcsv-mapping-settings-card" className="space-y-4 border-t pt-6">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {t('integrations.csv.settings.qbo.mappings.title', {
              defaultValue: 'Mappings'
            })}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('integrations.csv.settings.qbo.mappings.description', {
              defaultValue:
                'Match your clients, services, tax codes, and payment terms to the identifiers used in QuickBooks. These values are written into every CSV export.'
            })}
          </p>
        </div>
        <CSVMappingManager />
      </section>

      <section
        id="qbcsv-export-navigation-card"
        className="flex flex-wrap items-end justify-between gap-4 border-t pt-6"
      >
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {t('integrations.csv.settings.exports.title', {
              defaultValue: 'Accounting exports'
            })}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('integrations.csv.settings.exports.description', {
              defaultValue:
                'Create export batches, download CSV files, import tax reports, and review history from Billing → Accounting Exports.'
            })}
          </p>
        </div>
        <Button id="qbcsv-open-accounting-exports" asChild>
          <Link
            href="/msp/billing?tab=accounting-exports"
            className="inline-flex items-center gap-2"
          >
            {t('integrations.csv.settings.exports.openButton', {
              defaultValue: 'Open Accounting Exports'
            })}
            <ExternalLink className="h-4 w-4" />
          </Link>
        </Button>
      </section>
    </div>
  );
};

export default CSVIntegrationSettings;
