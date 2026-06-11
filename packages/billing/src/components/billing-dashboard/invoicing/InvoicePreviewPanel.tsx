'use client'

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { FileText, Settings } from 'lucide-react';
import type { IInvoiceAnnotation, IInvoiceTemplate, IQuote, TaxSource, InvoiceViewModel as DbInvoiceViewModel } from '@alga-psa/types';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import type { DraftInvoicePropertiesUpdateResult } from '@alga-psa/billing/actions/invoiceModification';
import {
  getEnrichedInvoiceViewModel,
  getInvoicePurchaseOrderSummary,
  getResolvedInvoiceTemplateId,
  type InvoicePurchaseOrderSummary
} from '@alga-psa/billing/actions/invoiceQueries';
import { getInvoiceAnnotations } from '@alga-psa/billing/actions/invoiceTemplates';
import { getQuoteByConvertedInvoiceId } from '@alga-psa/billing/actions/quoteActions';
import { PurchaseOrderSummaryBanner } from './PurchaseOrderSummaryBanner';
import { TemplateRenderer } from '../TemplateRenderer';
import PaperInvoice from '../PaperInvoice';
import CreditExpirationInfo from '../CreditExpirationInfo';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { voidInvoice } from '../../../actions/voidInvoiceActions';
import { InvoiceTaxSourceBadge } from '../../invoices/InvoiceTaxSourceBadge';
import { InvoiceSyncBadge, qboInvoiceDeepLink } from '../../invoices/InvoiceSyncBadge';
import { useInvoiceSyncStatuses } from '../../invoices/useInvoiceSyncStatuses';
import { resolveTemplatePrintSettingsFromAst } from '../../../lib/invoice-template-ast/printSettings';
import DraftInvoiceDetailsCard, { type DraftInvoiceDetailsSummary } from './DraftInvoiceDetailsCard';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  queueInvoiceSync,
  runAccountingSyncNow,
  resolveAccountingDriftReExport,
  resolveAccountingDriftAccept,
} from '../../../actions/accountingSyncActions';

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
  const [invoiceAnnotations, setInvoiceAnnotations] = useState<IInvoiceAnnotation[]>([]);
  const [previewRefreshCounter, setPreviewRefreshCounter] = useState(0);
  const [draftInvoiceEditorSummary, setDraftInvoiceEditorSummary] = useState<DraftInvoiceDetailsSummary | null>(draftInvoiceSummary);
  const [highlightedAnchor, setHighlightedAnchor] = useState<string | null>(null);
  const [syncActionLoading, setSyncActionLoading] = useState(false);
  const [syncActionFeedback, setSyncActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidLoading, setVoidLoading] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // QBO sync status for this invoice
  const syncIds = invoiceId ? [invoiceId] : [];
  const { statuses: syncStatuses, hidden: syncHidden } = useInvoiceSyncStatuses(syncIds);
  const syncStatus = invoiceId ? syncStatuses[invoiceId] : undefined;

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

  useEffect(() => {
    if (!detailedInvoiceData || typeof window === 'undefined') {
      return;
    }

    const anchorId = window.location.hash.slice(1);
    if (!anchorId.startsWith('item-') && !anchorId.startsWith('annotation-')) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(anchorId);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedAnchor(anchorId);
    });
    const timeout = window.setTimeout(() => setHighlightedAnchor(null), 2000);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [detailedInvoiceData, invoiceAnnotations]);

  useEffect(() => {
    if (!invoiceId || typeof window === 'undefined') {
      setInvoiceAnnotations([]);
      return;
    }

    const anchorId = window.location.hash.slice(1);
    if (!anchorId.startsWith('annotation-')) {
      setInvoiceAnnotations([]);
      return;
    }

    let isMounted = true;
    getInvoiceAnnotations(invoiceId)
      .then((annotations) => {
        if (isMounted) {
          setInvoiceAnnotations(annotations);
        }
      })
      .catch((annotationError) => {
        console.error(`Error fetching annotations for invoice ${invoiceId}:`, annotationError);
        if (isMounted) {
          setInvoiceAnnotations([]);
        }
      });

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

  const handleVoidConfirm = async () => {
    if (!invoiceId) return;
    setVoidError(null);
    setVoidLoading(true);
    try {
      await voidInvoice(invoiceId, voidReason);
      setVoidDialogOpen(false);
      setVoidReason('');
      setPreviewRefreshCounter((c) => c + 1);
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : 'Failed to void invoice.');
    } finally {
      setVoidLoading(false);
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
            <div className="flex items-center gap-2">
              <InvoiceTaxSourceBadge taxSource={taxSource} />
              {!syncHidden && syncStatus && (
                <InvoiceSyncBadge status={syncStatus} environment={syncStatus.environment} />
              )}
            </div>
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

        {syncActionFeedback && (
          <Alert variant={syncActionFeedback.type === 'success' ? 'success' : 'destructive'} className="mb-4">
            <AlertDescription className="text-sm">{syncActionFeedback.message}</AlertDescription>
          </Alert>
        )}

        {!syncHidden && invoiceId && syncStatus && (
          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              id="invoice-sync-now-button"
              variant="outline"
              size="sm"
              disabled={syncActionLoading}
              onClick={async () => {
                if (!invoiceId) return;
                setSyncActionLoading(true);
                setSyncActionFeedback(null);
                try {
                  await queueInvoiceSync(invoiceId);
                  await runAccountingSyncNow();
                  setSyncActionFeedback({ type: 'success', message: 'Invoice queued for QuickBooks sync.' });
                } catch (err) {
                  setSyncActionFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Sync failed.' });
                } finally {
                  setSyncActionLoading(false);
                }
              }}
            >
              {t('invoicePreview.actions.syncNow', { defaultValue: 'Sync to QuickBooks' })}
            </Button>

            {syncStatus.state === 'drift' && (
              <>
                <Button
                  id="invoice-drift-reexport-button"
                  variant="outline"
                  size="sm"
                  disabled={syncActionLoading}
                  onClick={async () => {
                    if (!invoiceId) return;
                    setSyncActionLoading(true);
                    setSyncActionFeedback(null);
                    try {
                      await resolveAccountingDriftReExport(invoiceId);
                      setSyncActionFeedback({ type: 'success', message: 'Re-export to QuickBooks queued.' });
                    } catch (err) {
                      setSyncActionFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Re-export failed.' });
                    } finally {
                      setSyncActionLoading(false);
                    }
                  }}
                >
                  {t('invoicePreview.actions.driftReexport', { defaultValue: 'Re-export to QuickBooks' })}
                </Button>

                <Button
                  id="invoice-drift-accept-button"
                  variant="outline"
                  size="sm"
                  disabled={syncActionLoading}
                  onClick={async () => {
                    if (!invoiceId) return;
                    setSyncActionLoading(true);
                    setSyncActionFeedback(null);
                    try {
                      await resolveAccountingDriftAccept(invoiceId);
                      setSyncActionFeedback({ type: 'success', message: 'QuickBooks version accepted.' });
                    } catch (err) {
                      setSyncActionFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Accept failed.' });
                    } finally {
                      setSyncActionLoading(false);
                    }
                  }}
                >
                  {t('invoicePreview.actions.driftAccept', { defaultValue: 'Accept QuickBooks Version' })}
                </Button>
              </>
            )}

            {syncStatus.state === 'synced' && syncStatus.externalId && (
              <Button
                id="invoice-view-in-qbo-button"
                variant="outline"
                size="sm"
                asChild
              >
                <a
                  href={qboInvoiceDeepLink(syncStatus.externalId, syncStatus.environment)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('invoicePreview.actions.viewInQbo', { defaultValue: 'View in QuickBooks' })}
                </a>
              </Button>
            )}
          </div>
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

              {isFinalized && (detailedInvoiceData as any)?.status !== 'cancelled' && (
                <Button
                  id="invoice-void-button"
                  variant="destructive"
                  onClick={() => {
                    setVoidReason('');
                    setVoidError(null);
                    setVoidDialogOpen(true);
                  }}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  {t('invoicePreview.actions.voidInvoice', { defaultValue: 'Void Invoice' })}
                </Button>
              )}
            </div>

            <Dialog
              id="void-invoice-dialog"
              isOpen={voidDialogOpen}
              onClose={() => setVoidDialogOpen(false)}
              title={t('invoicePreview.voidDialog.title', { defaultValue: 'Void Invoice' })}
            >
              <div className="space-y-4 p-4">
                <p className="text-sm text-muted-foreground">
                  {t('invoicePreview.voidDialog.description', {
                    defaultValue: 'Voiding this invoice is permanent. Please provide a reason.',
                  })}
                </p>
                <textarea
                  className="w-full rounded border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={3}
                  placeholder={t('invoicePreview.voidDialog.reasonPlaceholder', { defaultValue: 'Reason for voiding...' })}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  disabled={voidLoading}
                />
                {voidError && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-sm">{voidError}</AlertDescription>
                  </Alert>
                )}
                <div className="flex gap-2 justify-end">
                  <Button
                    id="void-invoice-cancel-button"
                    variant="outline"
                    onClick={() => setVoidDialogOpen(false)}
                    disabled={voidLoading}
                  >
                    {t('invoicePreview.voidDialog.cancel', { defaultValue: 'Cancel' })}
                  </Button>
                  <Button
                    id="void-invoice-confirm-button"
                    variant="destructive"
                    onClick={handleVoidConfirm}
                    disabled={voidLoading || !voidReason.trim()}
                  >
                    {voidLoading
                      ? t('invoicePreview.voidDialog.voiding', { defaultValue: 'Voiding...' })
                      : t('invoicePreview.voidDialog.confirm', { defaultValue: 'Void Invoice' })}
                  </Button>
                </div>
              </div>
            </Dialog>

            <div className="mb-4 max-h-[80vh] overflow-y-auto overflow-x-auto">
              <div className="space-y-1">
                {detailedInvoiceData.items.map((item) => {
                  const anchorId = `item-${item.id}`;
                  const isHighlighted = highlightedAnchor === anchorId;
                  return (
                    <div
                      key={anchorId}
                      id={anchorId}
                      className={`scroll-mt-24 rounded px-2 py-1 text-xs ${
                        isHighlighted
                          ? 'search-highlight mb-2 border border-yellow-400 bg-yellow-50 text-yellow-900'
                          : 'sr-only'
                      }`}
                    >
                      {item.description}
                    </div>
                  );
                })}
                {invoiceAnnotations.map((annotation) => {
                  const anchorId = `annotation-${annotation.annotation_id}`;
                  const isHighlighted = highlightedAnchor === anchorId;
                  return (
                    <div
                      key={anchorId}
                      id={anchorId}
                      className={`scroll-mt-24 rounded px-2 py-1 text-xs ${
                        isHighlighted
                          ? 'search-highlight mb-2 border border-yellow-400 bg-yellow-50 text-yellow-900'
                          : 'sr-only'
                      }`}
                    >
                      {annotation.content}
                    </div>
                  );
                })}
              </div>
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
