'use client'

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { FileText, Settings } from 'lucide-react';
import type { IInvoiceTemplate, IQuote, TaxSource } from '@alga-psa/types';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import { getInvoiceForRendering, getInvoicePurchaseOrderSummary, type InvoicePurchaseOrderSummary } from '@alga-psa/billing/actions/invoiceQueries';
import { getQuoteByConvertedInvoiceId } from '@alga-psa/billing/actions/quoteActions';
import { mapDbInvoiceToWasmViewModel } from '../../../lib/adapters/invoiceAdapters';
import { PurchaseOrderSummaryBanner } from './PurchaseOrderSummaryBanner';
import { TemplateRenderer } from '../TemplateRenderer';
import PaperInvoice from '../PaperInvoice';
import CreditExpirationInfo from '../CreditExpirationInfo';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { InvoiceTaxSourceBadge } from '../../invoices/InvoiceTaxSourceBadge';
import { resolveInvoiceTemplatePrintSettingsFromAst } from '../../../lib/invoice-template-ast/printSettings';

interface InvoicePreviewPanelProps {
  invoiceId: string | null;
  templates: IInvoiceTemplate[];
  selectedTemplateId: string | null;
  onTemplateChange: (templateId: string) => void;
  onFinalize?: () => Promise<void>;
  onDownload?: () => Promise<void>;
  onReverse?: () => Promise<void>;
  onEmail?: () => Promise<void>;
  onEdit?: () => void;
  onUnfinalize?: () => Promise<void>;
  isFinalized: boolean;
  creditApplied?: number;
}

const InvoicePreviewPanel: React.FC<InvoicePreviewPanelProps> = ({
  invoiceId,
  templates,
  selectedTemplateId,
  onTemplateChange,
  onFinalize,
  onDownload,
  onReverse,
  onEmail,
  onEdit,
  onUnfinalize,
  isFinalized,
  creditApplied = 0
}) => {
  const router = useRouter();
  const [detailedInvoiceData, setDetailedInvoiceData] = useState<WasmInvoiceViewModel | null>(null);
  const [poSummary, setPoSummary] = useState<InvoicePurchaseOrderSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [taxSource, setTaxSource] = useState<TaxSource>('internal');
  const [sourceQuote, setSourceQuote] = useState<IQuote | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Match Drafts/Finalized row selection: default to first template when URL has invoiceId but no templateId (e.g. deep link from recurring history).
  const effectiveTemplateId =
    selectedTemplateId && templates.some((t) => t.template_id === selectedTemplateId)
      ? selectedTemplateId
      : templates[0]?.template_id ?? null;

  const selectedTemplate = effectiveTemplateId
    ? templates.find((t) => t.template_id === effectiveTemplateId) ?? null
    : null;

  const resolvedPreviewPrintSettings = useMemo(
    () => resolveInvoiceTemplatePrintSettingsFromAst(selectedTemplate?.templateAst ?? null),
    [selectedTemplate]
  );

  // Track container width for dynamic scaling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const loadInvoiceData = async () => {
      if (!invoiceId) {
        setDetailedInvoiceData(null);
        setTaxSource('internal');
        return;
      }

      setIsLoading(true);
      setError(null);
      setDetailedInvoiceData(null);
      setPoSummary(null);

      try {
        const dbInvoiceData = await getInvoiceForRendering(invoiceId);

        if (!dbInvoiceData) {
          throw new Error(`Invoice data for ID ${invoiceId} not found.`);
        }

        // Extract tax_source from the invoice data
        setTaxSource(dbInvoiceData.tax_source || 'internal');

        const viewModel = mapDbInvoiceToWasmViewModel(dbInvoiceData);

        if (!viewModel) {
          throw new Error(`Failed to map invoice data for ID ${invoiceId} to view model.`);
        }

        const summary = await getInvoicePurchaseOrderSummary(invoiceId);
        setPoSummary(summary);

        setDetailedInvoiceData(viewModel);
      } catch (err) {
        console.error(`Error fetching detailed data for invoice ${invoiceId}:`, err);
        const message = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to load preview: ${message}`);
        setDetailedInvoiceData(null);
        setPoSummary(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadInvoiceData();
  }, [invoiceId]);

  useEffect(() => {
    let isMounted = true;

    const loadSourceQuote = async () => {
      if (!invoiceId) {
        if (isMounted) {
          setSourceQuote(null);
        }
        return;
      }

      try {
        const result = await getQuoteByConvertedInvoiceId(invoiceId);
        if (!isMounted) {
          return;
        }

        if (result && !('permissionError' in result)) {
          setSourceQuote(result);
          return;
        }

        setSourceQuote(null);
      } catch (sourceQuoteError) {
        console.error(`Error fetching source quote for invoice ${invoiceId}:`, sourceQuoteError);
        if (isMounted) {
          setSourceQuote(null);
        }
      }
    };

    void loadSourceQuote();

    return () => {
      isMounted = false;
    };
  }, [invoiceId]);

  const handleAction = async (action: () => Promise<void>, actionName: string) => {
    setIsActionLoading(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      console.error(`Error ${actionName}:`, err);
      setError(`Failed to ${actionName}. Please try again.`);
    } finally {
      setIsActionLoading(false);
    }
  };

  // Calculate scale based on container width
  const paperShellChromePx = 24;
  const baseInvoiceWidth = resolvedPreviewPrintSettings.pageWidthPx + paperShellChromePx;
  const baseInvoiceHeight = resolvedPreviewPrintSettings.pageHeightPx + paperShellChromePx;
  const scale = containerWidth > 0 ? Math.min(containerWidth / baseInvoiceWidth, 1) : 1;

  if (!invoiceId) {
    return (
      <Card className="h-full">
        <div className="p-6 flex items-center justify-center h-64 text-muted-foreground">
          <div className="text-center">
            <FileText className="h-12 w-12 mx-auto mb-2 text-muted-foreground" />
            <p>Select an invoice to preview</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <div className="p-6" ref={containerRef}>
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">Invoice Preview</h3>
            <InvoiceTaxSourceBadge taxSource={taxSource} />
          </div>
          <CustomSelect
            options={templates.map((template) => ({
              value: template.template_id,
              label: (
                <div className="flex items-center gap-2">
                  {template.isStandard ? (
                    <><FileText className="w-4 h-4" /> {template.name} (Standard)</>
                  ) : (
                    <><Settings className="w-4 h-4" /> {template.name}</>
                  )}
                </div>
              )
            }))}
            onValueChange={onTemplateChange}
            value={effectiveTemplateId || ''}
            placeholder="Select invoice template..."
          />
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {sourceQuote ? (
          <div className="mb-4">
            <Button
              id="invoice-preview-open-source-quote"
              variant="outline"
              onClick={() => router.push(`/msp/billing?tab=quotes&quoteId=${sourceQuote.quote_id}`)}
            >
              View Source Quote {sourceQuote.quote_number ? `(${sourceQuote.quote_number})` : ''}
            </Button>
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <LoadingIndicator text="Loading Preview..." spinnerProps={{ size: "sm" }} />
          </div>
        ) : detailedInvoiceData && selectedTemplate ? (
          <>
            <PurchaseOrderSummaryBanner poSummary={poSummary} currencyCode={detailedInvoiceData.currencyCode} />

            <div className="flex flex-wrap gap-2 mb-4">
              {!isFinalized && onFinalize && (
                <Button
                  id="invoice-finalize"
                  onClick={() => handleAction(onFinalize, 'finalize invoice')}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  Finalize Invoice
                </Button>
              )}

              {!isFinalized && onEdit && (
                <Button
                  id="invoice-edit-items"
                  variant="outline"
                  onClick={onEdit}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  Edit Items
                </Button>
              )}

              {onDownload && (
                <Button
                  id="invoice-download-pdf"
                  onClick={() => handleAction(onDownload, 'download PDF')}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  Download PDF
                </Button>
              )}

              {!isFinalized && onReverse && (
                <Button
                  id="invoice-reverse-draft-button"
                  variant="destructive"
                  onClick={() => handleAction(onReverse, 'reverse draft')}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  Reverse Draft
                </Button>
              )}

              {onEmail && (
                <Button
                  id="invoice-send-email"
                  variant="secondary"
                  onClick={() => handleAction(onEmail, 'send email')}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  Send Email
                </Button>
              )}

              {isFinalized && onUnfinalize && (
                <Button
                  id="invoice-unfinalize"
                  variant="destructive"
                  onClick={() => handleAction(onUnfinalize, 'unfinalize invoice')}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  Unfinalize
                </Button>
              )}
            </div>

            <div className="mb-4 max-h-[600px] overflow-y-auto overflow-x-auto">
              <div
                style={{
                  width: `${baseInvoiceWidth * scale}px`,
                  height: `${baseInvoiceHeight * scale}px`
                }}
              >
                <div
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    width: `${baseInvoiceWidth}px`,
                    transition: 'transform 0.2s ease-out'
                  }}
                >
                  <PaperInvoice templateAst={selectedTemplate?.templateAst ?? null}>
                    <TemplateRenderer
                      template={selectedTemplate}
                      invoiceData={detailedInvoiceData}
                    />
                  </PaperInvoice>
                </div>
              </div>
            </div>

            {creditApplied > 0 && (
              <div className="mb-4">
                <CreditExpirationInfo
                  creditApplied={creditApplied}
                  invoiceId={invoiceId}
                />
              </div>
            )}
          </>
        ) : (
          <div className="text-muted-foreground text-center h-64 flex items-center justify-center">
            Could not display preview. Data might be missing.
          </div>
        )}
      </div>
    </Card>
  );
};

export default InvoicePreviewPanel;
