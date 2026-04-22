'use client';

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Cloud, Download, Clock, CheckCircle, XCircle, AlertTriangle, History, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@alga-psa/ui/lib/i18n/client';

import { TaxSource } from '@alga-psa/types';
import {
  importExternalTaxForInvoice,
  getExternalTaxImportHistory,
  getInvoiceTaxReconciliation
} from '@alga-psa/billing/actions';

interface ExternalTaxImportPanelProps {
  invoiceId: string;
  taxSource: TaxSource;
  externalAdapter?: string;
  onTaxImported?: () => void;
}

interface ImportHistoryItem {
  import_id: string;
  adapter_type: string;
  external_invoice_ref?: string;
  imported_at: string;
  import_status: string;
  original_internal_tax?: number;
  imported_external_tax?: number;
  tax_difference?: number;
}

const ADAPTER_NAME_KEYS: Record<string, 'quickbooks' | 'xero' | 'sage'> = {
  quickbooks_online: 'quickbooks',
  xero: 'xero',
  sage: 'sage',
};

export function ExternalTaxImportPanel({
  invoiceId,
  taxSource,
  externalAdapter,
  onTaxImported
}: ExternalTaxImportPanelProps) {
  const { t } = useTranslation('msp/invoicing');
  const { formatCurrency, formatDate } = useFormatters();
  const [isImporting, setIsImporting] = useState(false);
  const [importHistory, setImportHistory] = useState<ImportHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [reconciliation, setReconciliation] = useState<{
    internalTax: number;
    externalTax: number;
    difference: number;
    hasSignificantDifference: boolean;
  } | null>(null);

  const getAdapterName = useCallback((adapterType?: string) => {
    if (!adapterType) {
      return t('externalTax.values.externalSystem', { defaultValue: 'External System' });
    }

    const adapterKey = ADAPTER_NAME_KEYS[adapterType];
    if (adapterKey) {
      return t(`externalTax.adapterNames.${adapterKey}`, {
        defaultValue:
          adapterKey === 'quickbooks'
            ? 'QuickBooks Online'
            : adapterKey === 'xero'
              ? 'Xero'
              : 'Sage',
      });
    }

    return adapterType;
  }, [t]);

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const history = await getExternalTaxImportHistory(invoiceId);
      setImportHistory(history as ImportHistoryItem[]);
    } catch (error) {
      console.error('Failed to load import history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [invoiceId]);

  const loadReconciliation = useCallback(async () => {
    if (taxSource === 'external') {
      try {
        const result = await getInvoiceTaxReconciliation(invoiceId);
        if (result) {
          setReconciliation({
            internalTax: result.internalTax,
            externalTax: result.externalTax,
            difference: result.difference,
            hasSignificantDifference: result.hasSignificantDifference
          });
        }
      } catch (error) {
        console.error('Failed to load reconciliation:', error);
      }
    }
  }, [invoiceId, taxSource]);

  useEffect(() => {
    loadReconciliation();
  }, [loadReconciliation]);

  useEffect(() => {
    if (showHistory) {
      loadHistory();
    }
  }, [showHistory, loadHistory]);

  const handleImportTax = async () => {
    setIsImporting(true);
    try {
      const result = await importExternalTaxForInvoice(invoiceId);

      if (result.success) {
        toast.success(t('externalTax.toasts.taxImportedFromAdapter', {
          adapter: adapterName,
          defaultValue: `Tax imported successfully from ${adapterName}`,
        }));
        onTaxImported?.();
        loadReconciliation();
      } else {
        toast.error(result.error ?? t('externalTax.toasts.taxImportFailed', { defaultValue: 'Failed to import tax' }));
      }
    } catch (error: any) {
      handleError(error, t('externalTax.errors.importTaxFailed', { defaultValue: 'Failed to import tax' }));
    } finally {
      setIsImporting(false);
    }
  };

  const adapterName = getAdapterName(externalAdapter);

  // Render different content based on tax source status
  if (taxSource === 'internal') {
    return null; // Don't show panel for internal tax
  }

  return (
    <Card id="external-tax-import-panel">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-blue-600" />
            {t('externalTax.title', { defaultValue: 'External Tax Import' })}
          </div>
          <Button
            id="toggle-import-history-button"
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="h-4 w-4 mr-1" />
            {showHistory
              ? t('externalTax.actions.hideHistory', { defaultValue: 'Hide History' })
              : t('externalTax.actions.showHistory', { defaultValue: 'Show History' })}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pending External Tax - Show Import Button */}
        {taxSource === 'pending_external' && (
          <div className="space-y-4">
            <Alert variant="default" showIcon={false}>
              <Clock className="h-4 w-4 text-amber-600" />
              <AlertDescription>
                <p className="font-medium">
                  {t('externalTax.alerts.pendingTitle', { defaultValue: 'Tax Pending Import' })}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('externalTax.alerts.pendingDescription', {
                    adapter: adapterName,
                    defaultValue: `This invoice was exported to ${adapterName} without tax amounts. Import the calculated tax once the invoice has been processed.`,
                  })}
                </p>
              </AlertDescription>
            </Alert>

            <Button
              id="import-external-tax-button"
              onClick={handleImportTax}
              disabled={isImporting}
              className="w-full"
            >
              {isImporting ? (
                <>
                  <Download className="h-4 w-4 mr-2 animate-spin" />
                  {t('externalTax.actions.importing', { defaultValue: 'Importing...' })}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  {t('externalTax.actions.importFromAdapter', {
                    adapter: adapterName,
                    defaultValue: `Import Tax from ${adapterName}`,
                  })}
                </>
              )}
            </Button>
          </div>
        )}

        {/* External Tax - Show Reconciliation Info */}
        {taxSource === 'external' && (
          <div className="space-y-4">
            <Alert variant="info" showIcon={false}>
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription>
                <p className="font-medium">
                  {t('externalTax.alerts.importedTitle', {
                    adapter: adapterName,
                    defaultValue: `Tax Imported from ${adapterName}`,
                  })}
                </p>
                {reconciliation && (
                  <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">
                        {t('externalTax.reconciliation.internal', { defaultValue: 'Internal' })}:
                      </span>
                      <span className="ml-1 font-medium">
                        {formatCurrency(reconciliation.internalTax / 100, 'USD')}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t('externalTax.reconciliation.external', { defaultValue: 'External' })}:
                      </span>
                      <span className="ml-1 font-medium">
                        {formatCurrency(reconciliation.externalTax / 100, 'USD')}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t('externalTax.reconciliation.difference', { defaultValue: 'Difference' })}:
                      </span>
                      <span className={`ml-1 font-medium ${reconciliation.difference !== 0 ? 'text-amber-600' : 'text-green-600'}`}>
                        {reconciliation.difference >= 0 ? '+' : ''}{formatCurrency(reconciliation.difference / 100, 'USD')}
                      </span>
                    </div>
                  </div>
                )}
              </AlertDescription>
            </Alert>

            {reconciliation?.hasSignificantDifference && (
              <Alert variant="destructive" showIcon={false}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium">
                    {t('externalTax.alerts.significantDifferenceTitle', {
                      defaultValue: 'Significant Tax Difference',
                    })}
                  </p>
                  <p className="text-sm mt-1">
                    {t('externalTax.alerts.significantDifferenceDescription', {
                      defaultValue: 'The external tax differs from the internal calculation by more than 1%. Please review the charges to ensure accuracy.',
                    })}
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Import History */}
        {showHistory && (
          <div className="mt-4 border-t pt-4">
            <h4 className="text-sm font-medium mb-2">
              {t('externalTax.reconciliation.history', { defaultValue: 'Import History' })}
            </h4>
            {isLoadingHistory ? (
              <p className="text-sm text-muted-foreground">
                {t('externalTax.states.loadingHistory', { defaultValue: 'Loading history...' })}
              </p>
            ) : importHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('externalTax.empty.history', { defaultValue: 'No import history available.' })}
              </p>
            ) : (
              <div className="space-y-2">
                {importHistory.map((item) => (
                  <div
                    key={item.import_id}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                  >
                    <div className="flex items-center gap-2">
                      {item.import_status === 'success' ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : item.import_status === 'partial' ? (
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600" />
                      )}
                      <span>{formatDate(item.imported_at, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <Tooltip content={t('externalTax.tooltips.externalRef', {
                        reference: item.external_invoice_ref ?? t('externalTax.values.notAvailable', { defaultValue: 'N/A' }),
                        defaultValue: `External ref: ${item.external_invoice_ref ?? 'N/A'}`,
                      })}>
                        <span className="text-muted-foreground">
                          {getAdapterName(item.adapter_type)}
                        </span>
                      </Tooltip>
                      {item.tax_difference !== undefined && (
                        <span className={item.tax_difference !== 0 ? 'text-amber-600' : 'text-green-600'}>
                          {item.tax_difference >= 0 ? '+' : ''}{formatCurrency(item.tax_difference / 100, 'USD')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Help Text */}
        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-4">
          <Info className="h-3 w-3" />
          {t('externalTax.helpText', {
            defaultValue: 'Invoices appear here when they are exported with external tax delegation enabled. Import the tax once your accounting system has calculated the tax amounts.',
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default ExternalTaxImportPanel;
