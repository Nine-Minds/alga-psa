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
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { IQuote, QuoteConversionPreview } from '@alga-psa/types';
import {
  getQuoteConversionPreview,
  convertQuoteToContract,
  convertQuoteToInvoice,
  convertQuoteToBoth,
  convertQuoteToSalesOrder,
} from '../../../actions/quoteActions';

type ConversionMode = 'contract' | 'invoice' | 'both' | 'sales_order';

// Product one-time lines are what convert to a sales order (F002/D2): a product-kind
// service, not recurring, not a discount, and either non-optional or an accepted option.
function hasConvertibleProductOneTimeItems(quote: IQuote): boolean {
  return Boolean(
    (quote.quote_items || []).some(
      (item) =>
        item.service_item_kind === 'product' &&
        !item.is_recurring &&
        !item.is_discount &&
        (!item.is_optional || item.is_selected !== false),
    ),
  );
}

interface QuoteConversionDialogProps {
  quote: IQuote;
  open: boolean;
  onClose: () => void;
  onConversionComplete?: (result: {
    contractId?: string;
    invoiceId?: string;
  }) => void;
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
  const { t } = useTranslation('msp/quotes');
  const { formatCurrency } = useFormatters();
  const [preview, setPreview] = useState<QuoteConversionPreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<ConversionMode | null>(null);
  // Sales-order success state (F002): the created SO is shown with a link, not auto-closed.
  const [soSuccess, setSoSuccess] = useState<{ so_id: string; so_number: string } | null>(null);

  useEffect(() => {
    if (open) {
      void loadPreview();
    } else {
      setPreview(null);
      setSelectedMode(null);
      setError(null);
      setSoSuccess(null);
    }
  }, [open, quote.quote_id]);

  const loadPreview = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getQuoteConversionPreview(quote.quote_id);

      if (isActionMessageError(result) || isActionPermissionError(result)) {
        throw new Error(getErrorMessage(result));
      }

      const previewResult = result as QuoteConversionPreview;
      setPreview(previewResult);
      setSelectedMode(determineSuggestedMode(previewResult));
    } catch (loadError) {
      console.error('Error loading conversion preview:', loadError);
      setError(loadError instanceof Error ? loadError.message : t('quoteConversion.errors.load', {
        defaultValue: 'Failed to load conversion preview',
      }));
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
        case 'sales_order':
          result = await convertQuoteToSalesOrder(quote.quote_id);
          break;
      }

      if (isActionMessageError(result) || isActionPermissionError(result)) {
        throw new Error(getErrorMessage(result));
      }

      if (selectedMode === 'sales_order') {
        // Keep the dialog open on a success panel so the user can jump to the SO (F002).
        const so = result as { so_id: string; so_number: string };
        setSoSuccess({ so_id: so.so_id, so_number: so.so_number });
        return;
      }

      const contractId = (result as { contract?: { contract_id?: string } })?.contract?.contract_id;
      const invoiceId = (result as { invoice?: { invoice_id?: string } })?.invoice?.invoice_id;

      onConversionComplete?.({ contractId, invoiceId });
      onClose();
    } catch (convertError) {
      console.error('Error converting quote:', convertError);
      setError(convertError instanceof Error ? convertError.message : t('quoteConversion.errors.convert', {
        defaultValue: 'Failed to convert quote',
      }));
    } finally {
      setIsConverting(false);
    }
  };

  const canConvertToContract = preview && preview.contract_items.length > 0 && !quote.converted_contract_id;
  const canConvertToInvoice = preview && preview.invoice_items.length > 0 && !quote.converted_invoice_id;
  const canConvertToBoth = canConvertToContract && canConvertToInvoice;
  const canConvertToSalesOrder = hasConvertibleProductOneTimeItems(quote);

  const getModeLabel = (mode: ConversionMode): string => {
    switch (mode) {
      case 'contract':
        return t('quoteConversion.mode.contract.label', { defaultValue: 'Contract Only' });
      case 'invoice':
        return t('quoteConversion.mode.invoice.label', { defaultValue: 'Invoice Only' });
      case 'both':
        return t('quoteConversion.mode.both.label', { defaultValue: 'Contract + Invoice' });
      case 'sales_order':
        return t('quoteConversion.mode.salesOrder.label', { defaultValue: 'Sales order (product lines)' });
    }
  };

  const getModeDescription = (mode: ConversionMode): string => {
    switch (mode) {
      case 'contract':
        return t('quoteConversion.mode.contract.description', {
          defaultValue: 'Creates a draft contract with recurring service lines. One-time items will not be included.',
        });
      case 'invoice':
        return t('quoteConversion.mode.invoice.description', {
          defaultValue: 'Creates a draft invoice with one-time charges. Recurring items will not be included.',
        });
      case 'both':
        return t('quoteConversion.mode.both.description', {
          defaultValue: 'Creates both a draft contract (for recurring items) and a draft invoice (for one-time items).',
        });
      case 'sales_order':
        return t('quoteConversion.mode.salesOrder.description', {
          defaultValue: 'Moves product one-time lines to a draft sales order that bills on fulfillment. These lines are excluded from the draft invoice, so nothing double-bills.',
        });
    }
  };

  return (
    <Dialog
      isOpen={open}
      onClose={onClose}
      id="quote-conversion-dialog"
      title={t('quoteConversion.title', { defaultValue: 'Convert Quote' })}
      className="max-w-2xl"
    >
      <DialogContent className="max-h-[75vh] overflow-y-auto">
        <DialogDescription>
          {t('quoteConversion.description', {
            defaultValue: 'Convert the accepted quote "{{title}}" into contracts and/or invoices.',
            title: quote.title,
          })}
        </DialogDescription>

        {soSuccess ? (
          <Alert>
            <AlertTitle>
              {t('quoteConversion.salesOrder.successTitle', {
                defaultValue: 'Sales order {{number}} created',
                number: soSuccess.so_number,
              })}
            </AlertTitle>
            <AlertDescription>
              {t('quoteConversion.salesOrder.successBody', {
                defaultValue: 'Product lines will bill on fulfillment.',
              })}{' '}
              <a
                id="quote-convert-open-sales-order"
                href="/msp/inventory/sales-orders"
                className="text-primary-600 underline"
              >
                {t('quoteConversion.salesOrder.openSalesOrders', { defaultValue: 'Open sales orders' })}
              </a>
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div className="py-8">
            <LoadingIndicator
              className="text-muted-foreground"
              layout="stacked"
              spinnerProps={{ size: 'md' }}
              text={t('quoteConversion.loading', { defaultValue: 'Loading conversion preview...' })}
              textClassName="text-muted-foreground"
            />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>{t('quoteConversion.errors.title', { defaultValue: 'Error' })}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : preview ? (
          <div className="space-y-4">
            {quote.converted_contract_id || quote.converted_invoice_id ? (
              <Alert>
                <AlertTitle>{t('quoteConversion.partial.title', { defaultValue: 'Partial Conversion' })}</AlertTitle>
                <AlertDescription>
                  {t('quoteConversion.partial.alreadyConverted', {
                    defaultValue: 'This quote has already been partially converted.',
                  })}
                  {quote.converted_contract_id ? ` ${t('quoteConversion.partial.contractCreated', {
                    defaultValue: 'A contract was created.',
                  })}` : ''}
                  {quote.converted_invoice_id ? ` ${t('quoteConversion.partial.invoiceCreated', {
                    defaultValue: 'An invoice was created.',
                  })}` : ''}
                  {` ${t('quoteConversion.partial.remainingItems', {
                    defaultValue: 'You can convert the remaining items.',
                  })}`}
                </AlertDescription>
              </Alert>
            ) : null}

            <section className="space-y-3">
              <h4 className="font-medium text-foreground">
                {t('quoteConversion.sections.conversionMode', { defaultValue: 'Conversion Mode' })}
              </h4>
              <RadioGroup
                id="quote-conversion-mode"
                name="conversionMode"
                value={selectedMode ?? undefined}
                onChange={(value) => setSelectedMode(value as ConversionMode)}
                orientation="vertical"
                options={([
                  { value: 'contract', label: getModeLabel('contract'), description: getModeDescription('contract'), disabled: !canConvertToContract },
                  { value: 'invoice', label: getModeLabel('invoice'), description: getModeDescription('invoice'), disabled: !canConvertToInvoice },
                  { value: 'both', label: getModeLabel('both'), description: getModeDescription('both'), disabled: !canConvertToBoth },
                  { value: 'sales_order', label: getModeLabel('sales_order'), description: getModeDescription('sales_order'), disabled: !canConvertToSalesOrder },
                ])}
              />
            </section>

            <section className="space-y-3">
              <h4 className="font-medium text-foreground">
                {t('quoteConversion.sections.itemMappingPreview', { defaultValue: 'Item Mapping Preview' })}
              </h4>

              {preview.contract_items.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-emerald-700">
                    {t('quoteConversion.sections.contractItems', { defaultValue: 'Contract Items' })} ({preview.contract_items.length})
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1 pl-4">
                    {preview.contract_items.map((item) => (
                      <li key={item.quote_item_id} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{item.description}</span>
                        <span className="text-xs text-muted-foreground/70">
                          ({item.billing_method || t('quoteConversion.summary.fixed', { defaultValue: 'fixed' })})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {preview.invoice_items.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-blue-700">
                    {t('quoteConversion.sections.invoiceItems', { defaultValue: 'Invoice Items' })} ({preview.invoice_items.length})
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1 pl-4">
                    {preview.invoice_items.map((item) => (
                      <li key={item.quote_item_id} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        <span>{item.description}</span>
                        {item.is_discount ? (
                          <span className="text-xs text-muted-foreground/70">
                            ({t('quoteConversion.summary.discount', { defaultValue: 'Discount' })})
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {preview.excluded_items.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-amber-700">
                    {t('quoteConversion.sections.excludedItems', { defaultValue: 'Excluded Items' })} ({preview.excluded_items.length})
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
                  <div className="text-muted-foreground">
                    {t('quoteConversion.sections.quoteTotal', { defaultValue: 'Quote Total' })}
                  </div>
                  <div className="font-medium">
                    {formatCurrency((quote.total_amount || 0) / 100, quote.currency_code || 'USD')}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">
                    {t('quoteConversion.sections.statusAfterConversion', { defaultValue: 'Status After Conversion' })}
                  </div>
                  <div className="font-medium">
                    {t('quoteConversion.summary.converted', { defaultValue: 'Converted' })}
                  </div>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        <DialogFooter>
          {soSuccess ? (
            <Button id="quote-conversion-done" onClick={onClose}>
              {t('common.actions.done', { defaultValue: 'Done' })}
            </Button>
          ) : (
            <>
              <Button id="quote-conversion-cancel" variant="outline" onClick={onClose} disabled={isConverting}>
                {t('common.actions.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                id="quote-conversion-confirm"
                onClick={() => void handleConvert()}
                disabled={isLoading || isConverting || !selectedMode || !!error}
              >
                {isConverting
                  ? t('quoteConversion.actions.converting', { defaultValue: 'Converting...' })
                  : t('quoteConversion.actions.convertQuote', { defaultValue: 'Convert Quote' })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default QuoteConversionDialog;
