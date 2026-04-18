'use client'

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { FileText, Settings } from 'lucide-react';
import type { IInvoiceTemplate, IQuote, TaxSource, InvoiceViewModel as DbInvoiceViewModel } from '@alga-psa/types';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import type { DraftInvoicePropertiesUpdateResult } from '@alga-psa/billing/actions/invoiceModification';
import {
  getEnrichedInvoiceViewModel,
  getInvoicePurchaseOrderSummary,
  getResolvedInvoiceTemplateId,
  type InvoicePurchaseOrderSummary
} from '@alga-psa/billing/actions/invoiceQueries';
import { getQuoteByConvertedInvoiceId } from '@alga-psa/billing/actions/quoteActions';
import { PurchaseOrderSummaryBanner } from './PurchaseOrderSummaryBanner';
import { TemplateRenderer } from '../TemplateRenderer';
import PaperInvoice from '../PaperInvoice';
import CreditExpirationInfo from '../CreditExpirationInfo';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { InvoiceTaxSourceBadge } from '../../invoices/InvoiceTaxSourceBadge';
import { resolveTemplatePrintSettingsFromAst } from '../../../lib/invoice-template-ast/printSettings';
import DraftInvoiceDetailsCard, { type DraftInvoiceDetailsSummary } from './DraftInvoiceDetailsCard';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  onDraftInvoiceUpdated?: (updated: DraftInvoicePropertiesUpdateResult) => Promise<void> | void;
  isFinalized: boolean;
  creditApplied?: number;
  draftInvoiceSummary?: DbInvoiceViewModel | null;
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
  onDraftInvoiceUpdated,
  isFinalized,
  creditApplied = 0,
  draftInvoiceSummary = null
}) => {
  const { t } = useTranslation('msp/invoicing');
  const router = useRouter();
  const [detailedInvoiceData, setDetailedInvoiceData] = useState<WasmInvoiceViewModel | null>(null);
  const [poSummary, setPoSummary] = useState<InvoicePurchaseOrderSummary | null>(null);
  const [resolvedTemplateId, setResolvedTemplateId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [taxSource, setTaxSource] = useState<TaxSource>('internal');
  const [sourceQuote, setSourceQuote] = useState<IQuote | null>(null);
  const [previewRefreshCounter, setPreviewRefreshCounter] = useState(0);
  const [draftInvoiceEditorSummary, setDraftInvoiceEditorSummary] = useState<DraftInvoiceDetailsSummary | null>(draftInvoiceSummary);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Match invoice/PDF rendering: honor an explicit URL template selection first,
  // then fall back to the invoice's resolved client/default template.
  const effectiveTemplateId =
    selectedTemplateId && templates.some((t) => t.template_id === selectedTemplateId)
      ? selectedTemplateId
      : resolvedTemplateId && templates.some((t) => t.template_id === resolvedTemplateId)
        ? resolvedTemplateId
      : templates[0]?.template_id ?? null;

  const selectedTemplate = effectiveTemplateId
    ? templates.find((t) => t.template_id === effectiveTemplateId) ?? null
    : null;

  const resolvedPreviewPrintSettings = useMemo(
    () => resolveTemplatePrintSettingsFromAst(selectedTemplate?.templateAst ?? null),
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
    if (!invoiceId) {
      setDraftInvoiceEditorSummary(null);
      return;
    }

    if (draftInvoiceSummary?.invoice_id === invoiceId) {
      setDraftInvoiceEditorSummary(draftInvoiceSummary);
    }
  }, [draftInvoiceSummary, invoiceId]);

  useEffect(() => {
    const loadInvoiceData = async () => {
      if (!invoiceId) {
        setDetailedInvoiceData(null);
        setTaxSource('internal');
        setResolvedTemplateId(null);
        return;
      }

      setIsLoading(true);
      setError(null);
      setDetailedInvoiceData(null);
      setPoSummary(null);

      try {
        const [viewModel, summary, templateId] = await Promise.all([
          getEnrichedInvoiceViewModel(invoiceId),
          getInvoicePurchaseOrderSummary(invoiceId),
          getResolvedInvoiceTemplateId(invoiceId),
        ]);

        if (!viewModel) {
          throw new Error(`Invoice data for ID ${invoiceId} not found.`);
        }

        // Extract tax source from the enriched view model (mapped as taxSource).
        setTaxSource(((viewModel as unknown as { taxSource?: TaxSource }).taxSource) || 'internal');

        setPoSummary(summary);
        setResolvedTemplateId(templateId);

        setDetailedInvoiceData(viewModel);
      } catch (err) {
        console.error(`Error fetching detailed data for invoice ${invoiceId}:`, err);
        const message = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(t('invoicePreview.errors.loadFailed', {
          message,
          defaultValue: 'Failed to load preview: {{message}}',
        }));
        setDetailedInvoiceData(null);
        setPoSummary(null);
        setResolvedTemplateId(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadInvoiceData();
  }, [invoiceId, previewRefreshCounter]);

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

  const handleAction = async (action: () => Promise<void>, actionLabel: string) => {
    setIsActionLoading(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      console.error(`Error ${actionLabel}:`, err);
      setError(t('invoicePreview.errors.actionFailed', {
        action: actionLabel,
        defaultValue: 'Failed to {{action}}. Please try again.',
      }));
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleDraftInvoiceUpdated = async (updated: DraftInvoicePropertiesUpdateResult) => {
    setDraftInvoiceEditorSummary((current) => {
      if (!current || current.invoice_id !== updated.invoiceId) {
        return current;
      }

      return {
        ...current,
        invoice_number: updated.invoiceNumber,
        invoice_date: updated.invoiceDate,
        due_date: updated.dueDate,
      };
    });

    setPreviewRefreshCounter((current) => current + 1);
    await onDraftInvoiceUpdated?.(updated);
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
            <p>
              {t('invoicePreview.empty', {
                defaultValue: 'Select an invoice to preview',
              })}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <div className="p-6" ref={containerRef}>
        {!isFinalized && draftInvoiceEditorSummary ? (
          <DraftInvoiceDetailsCard
            invoice={draftInvoiceEditorSummary}
            onSaved={handleDraftInvoiceUpdated}
          />
        ) : null}

        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">
              {t('invoicePreview.title', { defaultValue: 'Invoice Preview' })}
            </h3>
            <InvoiceTaxSourceBadge taxSource={taxSource} />
          </div>
          <CustomSelect
            options={templates.map((template) => ({
              value: template.template_id,
              label: (
                <div className="flex items-center gap-2">
                  {template.isStandard ? (
                    <>
                      <FileText className="w-4 h-4" /> {template.name}
                      {t('invoicePreview.labels.standard', { defaultValue: ' (Standard)' })}
                    </>
                  ) : (
                    <><Settings className="w-4 h-4" /> {template.name}</>
                  )}
                </div>
              )
            }))}
            onValueChange={onTemplateChange}
            value={effectiveTemplateId || ''}
            placeholder={t('invoicePreview.templatePlaceholder', {
              defaultValue: 'Select invoice template...',
            })}
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
              {t('invoicePreview.actions.viewSourceQuote', {
                defaultValue: 'View Source Quote',
              })}{' '}
              {sourceQuote.quote_number ? `(${sourceQuote.quote_number})` : ''}
            </Button>
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <LoadingIndicator
              text={t('invoicePreview.loading', {
                defaultValue: 'Loading Preview...',
              })}
              spinnerProps={{ size: "sm" }}
            />
          </div>
        ) : detailedInvoiceData && selectedTemplate ? (
          <>
            <PurchaseOrderSummaryBanner poSummary={poSummary} currencyCode={detailedInvoiceData.currencyCode} />

            <div className="flex flex-wrap gap-2 mb-4">
              {!isFinalized && onFinalize && (
                <Button
                  id="invoice-finalize"
                  onClick={() => handleAction(onFinalize, t('invoicePreview.errors.actionLabels.finalizeInvoice', {
                    defaultValue: 'finalize invoice',
                  }))}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  {t('invoicePreview.actions.finalizeInvoice', {
                    defaultValue: 'Finalize Invoice',
                  })}
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
                  {t('invoicePreview.actions.editItems', {
                    defaultValue: 'Edit Items',
                  })}
                </Button>
              )}

              {onDownload && (
                <Button
                  id="invoice-download-pdf"
                  onClick={() => handleAction(onDownload, t('invoicePreview.errors.actionLabels.downloadPdf', {
                    defaultValue: 'download PDF',
                  }))}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  {t('invoicePreview.actions.downloadPdf', {
                    defaultValue: 'Download PDF',
                  })}
                </Button>
              )}

              {!isFinalized && onReverse && (
                <Button
                  id="invoice-reverse-draft-button"
                  variant="destructive"
                  onClick={() => handleAction(onReverse, t('invoicePreview.errors.actionLabels.reverseDraft', {
                    defaultValue: 'reverse draft',
                  }))}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  {t('invoicePreview.actions.reverseDraft', {
                    defaultValue: 'Reverse Draft',
                  })}
                </Button>
              )}

              {onEmail && (
                <Button
                  id="invoice-send-email"
                  variant="secondary"
                  onClick={() => handleAction(onEmail, t('invoicePreview.errors.actionLabels.sendEmail', {
                    defaultValue: 'send email',
                  }))}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  {t('invoicePreview.actions.sendEmail', {
                    defaultValue: 'Send Email',
                  })}
                </Button>
              )}

              {isFinalized && onUnfinalize && (
                <Button
                  id="invoice-unfinalize"
                  variant="destructive"
                  onClick={() => handleAction(onUnfinalize, t('invoicePreview.errors.actionLabels.unfinalize', {
                    defaultValue: 'unfinalize invoice',
                  }))}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  {t('invoicePreview.actions.unfinalize', {
                    defaultValue: 'Unfinalize',
                  })}
                </Button>
              )}
            </div>

            <div className="mb-4 max-h-[80vh] overflow-y-auto overflow-x-auto">
              <div
                style={{
                  zoom: scale,
                  width: `${baseInvoiceWidth}px`,
                  transition: 'zoom 0.2s ease-out'
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
            {t('invoicePreview.errorDescription', {
              defaultValue: 'Could not display preview. Data might be missing.',
            })}
          </div>
        )}
      </div>
    </Card>
  );
};

export default InvoicePreviewPanel;
