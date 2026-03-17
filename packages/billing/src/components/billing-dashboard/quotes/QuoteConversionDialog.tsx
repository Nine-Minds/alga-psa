'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
} from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import type { IQuote, QuoteConversionPreview } from '@alga-psa/types';
import {
  getQuoteConversionPreview,
  convertQuoteToContract,
  convertQuoteToInvoice,
  convertQuoteToBoth,
} from '../../../actions/quoteActions';

type ConversionMode = 'contract' | 'invoice' | 'both';

interface QuoteConversionDialogProps {
  quote: IQuote;
  open: boolean;
  onClose: () => void;
  onConversionComplete?: (result: {
    contractId?: string;
    invoiceId?: string;
  }) => void;
}

function formatCurrency(minorUnits: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format((minorUnits || 0) / 100);
}

function determineSuggestedMode(preview: QuoteConversionPreview): ConversionMode | null {
  const hasContract = preview.contract_items.length > 0;
  const hasInvoice = preview.invoice_items.length > 0;
  if (hasContract && hasInvoice) return 'both';
  if (hasContract) return 'contract';
  if (hasInvoice) return 'invoice';
  return null;
}

const QuoteConversionDialog: React.FC<QuoteConversionDialogProps> = ({
  quote,
  open,
  onClose,
  onConversionComplete,
}) => {
  const [preview, setPreview] = useState<QuoteConversionPreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<ConversionMode | null>(null);

  useEffect(() => {
    if (open) {
      void loadPreview();
    } else {
      setPreview(null);
      setSelectedMode(null);
      setError(null);
    }
  }, [open, quote.quote_id]);

  const loadPreview = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getQuoteConversionPreview(quote.quote_id);

      if (result && typeof result === 'object' && 'permissionError' in result) {
        throw new Error(result.permissionError);
      }

      const previewResult = result as QuoteConversionPreview;
      setPreview(previewResult);
      setSelectedMode(determineSuggestedMode(previewResult));
    } catch (loadError) {
      console.error('Error loading conversion preview:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load conversion preview');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConvert = async () => {
    if (!selectedMode) return;

    try {
      setIsConverting(true);
      setError(null);

      let result: unknown;
      switch (selectedMode) {
        case 'contract':
          result = await convertQuoteToContract(quote.quote_id);
          break;
        case 'invoice':
          result = await convertQuoteToInvoice(quote.quote_id);
          break;
        case 'both':
          result = await convertQuoteToBoth(quote.quote_id);
          break;
      }

      if (result && typeof result === 'object' && 'permissionError' in result) {
        throw new Error((result as { permissionError: string }).permissionError);
      }

      const contractId = (result as { contract?: { contract_id?: string } })?.contract?.contract_id;
      const invoiceId = (result as { invoice?: { invoice_id?: string } })?.invoice?.invoice_id;

      onConversionComplete?.({ contractId, invoiceId });
      onClose();
    } catch (convertError) {
      console.error('Error converting quote:', convertError);
      setError(convertError instanceof Error ? convertError.message : 'Failed to convert quote');
    } finally {
      setIsConverting(false);
    }
  };

  const canConvertToContract = preview && preview.contract_items.length > 0 && !quote.converted_contract_id;
  const canConvertToInvoice = preview && preview.invoice_items.length > 0 && !quote.converted_invoice_id;
  const canConvertToBoth = canConvertToContract && canConvertToInvoice;

  const getModeLabel = (mode: ConversionMode): string => {
    switch (mode) {
      case 'contract': return 'Contract Only';
      case 'invoice': return 'Invoice Only';
      case 'both': return 'Contract + Invoice';
    }
  };

  const getModeDescription = (mode: ConversionMode): string => {
    switch (mode) {
      case 'contract': return 'Creates a draft contract with recurring service lines. One-time items will not be included.';
      case 'invoice': return 'Creates a draft invoice with one-time charges. Recurring items will not be included.';
      case 'both': return 'Creates both a draft contract (for recurring items) and a draft invoice (for one-time items).';
    }
  };

  return (
    <Dialog isOpen={open} onClose={onClose} id="quote-conversion-dialog" title="Convert Quote" className="max-w-2xl">
      <DialogContent className="max-h-[75vh] overflow-y-auto">
        <DialogDescription>
          Convert the accepted quote &ldquo;{quote.title}&rdquo; into contracts and/or invoices.
        </DialogDescription>

        {isLoading ? (
          <div className="py-8">
            <LoadingIndicator
              className="text-muted-foreground"
              layout="stacked"
              spinnerProps={{ size: 'md' }}
              text="Loading conversion preview..."
              textClassName="text-muted-foreground"
            />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : preview ? (
          <div className="space-y-4">
            {quote.converted_contract_id || quote.converted_invoice_id ? (
              <Alert>
                <AlertTitle>Partial Conversion</AlertTitle>
                <AlertDescription>
                  This quote has already been partially converted.
                  {quote.converted_contract_id && ' A contract was created.'}
                  {quote.converted_invoice_id && ' An invoice was created.'}
                  {' '}You can convert the remaining items.
                </AlertDescription>
              </Alert>
            ) : null}

            <section className="space-y-3">
              <h4 className="font-medium text-foreground">Conversion Mode</h4>
              <div className="grid gap-2">
                {(['contract', 'invoice', 'both'] as ConversionMode[]).map((mode) => {
                  const isDisabled =
                    (mode === 'contract' && !canConvertToContract) ||
                    (mode === 'invoice' && !canConvertToInvoice) ||
                    (mode === 'both' && !canConvertToBoth);

                  return (
                    <label
                      key={mode}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        selectedMode === mode
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground/50'
                      } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <input
                        type="radio"
                        name="conversionMode"
                        value={mode}
                        checked={selectedMode === mode}
                        onChange={() => setSelectedMode(mode)}
                        disabled={isDisabled}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="font-medium">{getModeLabel(mode)}</div>
                        <div className="text-sm text-muted-foreground">{getModeDescription(mode)}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <h4 className="font-medium text-foreground">Item Mapping Preview</h4>

              {preview.contract_items.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-emerald-700">
                    Contract Items ({preview.contract_items.length})
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1 pl-4">
                    {preview.contract_items.map((item) => (
                      <li key={item.quote_item_id} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{item.description}</span>
                        <span className="text-xs text-muted-foreground/70">({item.billing_method || 'fixed'})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {preview.invoice_items.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-blue-700">
                    Invoice Items ({preview.invoice_items.length})
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1 pl-4">
                    {preview.invoice_items.map((item) => (
                      <li key={item.quote_item_id} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        <span>{item.description}</span>
                        {item.is_discount ? (
                          <span className="text-xs text-muted-foreground/70">(discount)</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {preview.excluded_items.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-amber-700">
                    Excluded Items ({preview.excluded_items.length})
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1 pl-4">
                    {preview.excluded_items.map((item) => (
                      <li key={item.quote_item_id} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        <span>{item.description}</span>
                        {item.reason ? (
                          <span className="text-xs text-muted-foreground/70">({item.reason})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="rounded-lg bg-muted/50 p-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Quote Total</div>
                  <div className="font-medium">{formatCurrency(quote.total_amount, quote.currency_code || 'USD')}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Status After Conversion</div>
                  <div className="font-medium">Converted</div>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        <DialogFooter>
          <Button id="quote-conversion-cancel" variant="outline" onClick={onClose} disabled={isConverting}>
            Cancel
          </Button>
          <Button
            id="quote-conversion-confirm"
            onClick={() => void handleConvert()}
            disabled={isLoading || isConverting || !selectedMode || !!error}
          >
            {isConverting ? 'Converting...' : 'Convert Quote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default QuoteConversionDialog;
