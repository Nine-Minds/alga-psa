'use client';

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Card, CardHeader, CardTitle, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Cloud, Download, Clock, CheckCircle, XCircle, AlertTriangle, History, Info } from 'lucide-react';

import { TaxSource } from 'server/src/interfaces/tax.interfaces';
import {
  importExternalTaxForInvoice,
  getExternalTaxImportHistory,
  getInvoiceTaxReconciliation
} from 'server/src/lib/actions/externalTaxImportActions';

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

const ADAPTER_NAMES: Record<string, string> = {
  quickbooks_online: 'QuickBooks Online',
  xero: 'Xero',
  sage: 'Sage',
};

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function ExternalTaxImportPanel({
  invoiceId,
  taxSource,
  externalAdapter,
  onTaxImported
}: ExternalTaxImportPanelProps) {
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
        toast.success('Tax imported successfully from external system');
        onTaxImported?.();
        loadReconciliation();
      } else {
        toast.error(result.error ?? 'Failed to import tax');
      }
    } catch (error: any) {
      console.error('Failed to import tax:', error);
      toast.error(error.message ?? 'Failed to import tax');
    } finally {
      setIsImporting(false);
    }
  };

  const adapterName = externalAdapter ? ADAPTER_NAMES[externalAdapter] ?? externalAdapter : 'External System';

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
            External Tax Import
          </div>
          <Button
            id="toggle-import-history-button"
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="h-4 w-4 mr-1" />
            {showHistory ? 'Hide History' : 'Show History'}
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
                <p className="font-medium">Tax Pending Import</p>
                <p className="text-sm text-muted-foreground mt-1">
                  This invoice was exported to {adapterName} without tax amounts.
                  Import the calculated tax once the invoice has been processed.
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
                  Importing...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Import Tax from {adapterName}
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
                <p className="font-medium">Tax Imported from {adapterName}</p>
                {reconciliation && (
                  <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Internal:</span>
                      <span className="ml-1 font-medium">
                        {formatCurrency(reconciliation.internalTax)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">External:</span>
                      <span className="ml-1 font-medium">
                        {formatCurrency(reconciliation.externalTax)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Difference:</span>
                      <span className={`ml-1 font-medium ${reconciliation.difference !== 0 ? 'text-amber-600' : 'text-green-600'}`}>
                        {reconciliation.difference >= 0 ? '+' : ''}{formatCurrency(reconciliation.difference)}
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
                  <p className="font-medium">Significant Tax Difference</p>
                  <p className="text-sm mt-1">
                    The external tax differs from the internal calculation by more than 1%.
                    Please review the charges to ensure accuracy.
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Import History */}
        {showHistory && (
          <div className="mt-4 border-t pt-4">
            <h4 className="text-sm font-medium mb-2">Import History</h4>
            {isLoadingHistory ? (
              <p className="text-sm text-muted-foreground">Loading history...</p>
            ) : importHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No import history available.</p>
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
                      <span>{formatDate(item.imported_at)}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <Tooltip content={`External ref: ${item.external_invoice_ref ?? 'N/A'}`}>
                        <span className="text-muted-foreground">
                          {ADAPTER_NAMES[item.adapter_type] ?? item.adapter_type}
                        </span>
                      </Tooltip>
                      {item.tax_difference !== undefined && (
                        <span className={item.tax_difference !== 0 ? 'text-amber-600' : 'text-green-600'}>
                          {item.tax_difference >= 0 ? '+' : ''}{formatCurrency(item.tax_difference)}
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
          External tax is calculated by your accounting system and imported back to update invoice totals.
        </div>
      </CardContent>
    </Card>
  );
}

export default ExternalTaxImportPanel;
