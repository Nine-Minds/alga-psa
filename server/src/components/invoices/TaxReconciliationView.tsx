'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Calculator, Cloud, ArrowRight, AlertTriangle, CheckCircle, Info } from 'lucide-react';

import { getInvoiceTaxReconciliation } from 'server/src/lib/actions/externalTaxImportActions';

interface TaxReconciliationViewProps {
  invoiceId: string;
}

interface ReconciliationData {
  invoiceId: string;
  internalTax: number;
  externalTax: number;
  difference: number;
  differencePercent: number;
  hasSignificantDifference: boolean;
  lineComparisons: Array<{
    chargeId: string;
    description?: string;
    internalTax: number;
    externalTax: number;
    difference: number;
  }>;
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function TaxReconciliationView({ invoiceId }: TaxReconciliationViewProps) {
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getInvoiceTaxReconciliation(invoiceId);
      setData(result as ReconciliationData);
    } catch (error) {
      console.error('Failed to load reconciliation data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (isLoading) {
    return (
      <Card id="tax-reconciliation-view-loading">
        <CardContent className="p-6">
          <div className="text-center text-muted-foreground">Loading reconciliation data...</div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card id="tax-reconciliation-view-no-data">
        <CardContent className="p-6">
          <div className="text-center text-muted-foreground">No reconciliation data available.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="tax-reconciliation-view">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Tax Reconciliation
          {data.hasSignificantDifference ? (
            <Tooltip content="Difference exceeds 1%">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </Tooltip>
          ) : (
            <Tooltip content="Tax amounts match within acceptable range">
              <CheckCircle className="h-5 w-5 text-green-500" />
            </Tooltip>
          )}
        </CardTitle>
        <CardDescription>
          Compare internal and external tax calculations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Comparison */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center gap-2 text-green-700 mb-2">
              <Calculator className="h-4 w-4" />
              <span className="text-sm font-medium">Internal (Alga PSA)</span>
            </div>
            <p className="text-2xl font-bold text-green-800">
              {formatCurrency(data.internalTax)}
            </p>
          </div>

          <div className="flex items-center justify-center">
            <div className="flex flex-col items-center">
              <ArrowRight className="h-6 w-6 text-muted-foreground" />
              <span className={`text-sm font-medium mt-1 ${
                data.hasSignificantDifference ? 'text-amber-600' : 'text-green-600'
              }`}>
                {formatCurrency(data.difference)}
              </span>
              <span className={`text-xs ${
                data.hasSignificantDifference ? 'text-amber-600' : 'text-muted-foreground'
              }`}>
                ({formatPercent(data.differencePercent)})
              </span>
            </div>
          </div>

          <Alert variant="info" className="p-4">
            <Cloud className="h-4 w-4" />
            <AlertDescription>
              <span className="text-sm font-medium block mb-2">External (Accounting)</span>
              <p className="text-2xl font-bold">
                {formatCurrency(data.externalTax)}
              </p>
            </AlertDescription>
          </Alert>
        </div>

        {/* Warning for significant differences */}
        {data.hasSignificantDifference && (
          <Alert variant="destructive" showIcon={false}>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">Significant Tax Difference Detected</p>
              <p className="text-sm mt-1">
                The difference between internal and external tax calculations exceeds 1%.
                Please review the line-by-line breakdown below to identify discrepancies.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Line-by-Line Comparison */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Line-by-Line Breakdown</h4>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Internal Tax</th>
                  <th className="px-4 py-2 text-right font-medium">External Tax</th>
                  <th className="px-4 py-2 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {data.lineComparisons.map((line, index) => (
                  <tr
                    key={line.chargeId}
                    className={`border-t ${line.difference !== 0 ? 'bg-amber-50' : ''}`}
                  >
                    <td className="px-4 py-2">
                      {line.description || `Line ${index + 1}`}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {formatCurrency(line.internalTax)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {formatCurrency(line.externalTax)}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono ${
                      line.difference !== 0 ? 'text-amber-600 font-medium' : 'text-green-600'
                    }`}>
                      {line.difference >= 0 ? '+' : ''}{formatCurrency(line.difference)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted font-medium">
                <tr className="border-t-2">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {formatCurrency(data.internalTax)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {formatCurrency(data.externalTax)}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${
                    data.difference !== 0 ? 'text-amber-600' : 'text-green-600'
                  }`}>
                    {data.difference >= 0 ? '+' : ''}{formatCurrency(data.difference)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Help Text */}
        <div className="text-xs text-muted-foreground flex items-center gap-1 pt-4 border-t">
          <Info className="h-3 w-3" />
          <span>
            Differences may occur due to rounding, tax rule variations, or timing differences
            between systems.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default TaxReconciliationView;
