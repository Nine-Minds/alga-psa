'use client';

import React, { useEffect, useState } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { FileText } from 'lucide-react';
import type { IQuoteDocumentTemplate } from '@alga-psa/types';
import { renderQuotePreview, updateQuote } from '../../../actions/quoteActions';

interface QuotePreviewPanelProps {
  quoteId: string | null;
  templates: IQuoteDocumentTemplate[];
  /** The currently-persisted template_id on the quote (if any). */
  selectedTemplateId?: string | null;
  onDownload?: () => Promise<void>;
  onOpen?: () => void;
}

const QuotePreviewPanel: React.FC<QuotePreviewPanelProps> = ({
  quoteId,
  templates,
  selectedTemplateId: initialTemplateId,
  onDownload,
  onOpen,
}) => {
  const { t } = useTranslation('msp/quotes');
  const [previewHtml, setPreviewHtml] = useState<{ html: string; css: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Local template selection — initialised from the quote's persisted value.
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(initialTemplateId || '');

  // Effective template: fall back to first template when nothing is selected.
  const effectiveTemplateId =
    selectedTemplateId && templates.some((t) => t.template_id === selectedTemplateId)
      ? selectedTemplateId
      : templates[0]?.template_id ?? '';

  // Reset local selection when a different quote is selected.
  useEffect(() => {
    setSelectedTemplateId(initialTemplateId || '');
  }, [quoteId, initialTemplateId]);

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
    const loadPreview = async () => {
      if (!quoteId) {
        setPreviewHtml(null);
        return;
      }

      setIsLoading(true);
      setError(null);
      setPreviewHtml(null);

      try {
        const result = await renderQuotePreview(
          quoteId,
          effectiveTemplateId || undefined,
        );
        if (result && typeof result === 'object' && 'permissionError' in result) {
          throw new Error(result.permissionError);
        }
        setPreviewHtml(result as { html: string; css: string });
      } catch (err) {
        console.error('Error loading quote preview:', err);
        setError(err instanceof Error ? err.message : t('quotePreview.errors.load', {
          defaultValue: 'Failed to load preview',
        }));
      } finally {
        setIsLoading(false);
      }
    };

    void loadPreview();
  }, [quoteId, effectiveTemplateId]);

  const handleTemplateChange = async (templateId: string) => {
    setSelectedTemplateId(templateId);

    // Persist the selection to the quote.
    if (quoteId) {
      try {
        await updateQuote(quoteId, { template_id: templateId || null } as any);
      } catch {
        // Non-blocking — the preview will still reflect the selection.
      }
    }
  };

  const handleAction = async (
    action: () => Promise<void>,
    actionName: string,
    errorMessage: string,
  ) => {
    setIsActionLoading(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      console.error(`Error ${actionName}:`, err);
      setError(errorMessage);
    } finally {
      setIsActionLoading(false);
    }
  };

  const baseWidth = 794; // A4 width in px at 96dpi
  const baseHeight = 1123;
  const scale = containerWidth > 0 ? Math.min(containerWidth / baseWidth, 1) : 1;

  if (!quoteId) {
    return (
      <Card className="h-full">
        <div className="p-6 flex items-center justify-center h-64 text-muted-foreground">
          <div className="text-center">
            <FileText className="h-12 w-12 mx-auto mb-2 text-muted-foreground" />
            <p>{t('quotePreview.empty.selectQuote', { defaultValue: 'Select a quote to preview' })}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <div className="p-6" ref={containerRef}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold mb-2">
            {t('quotePreview.title', { defaultValue: 'Quote Preview' })}
          </h3>
          <CustomSelect
            id="quote-preview-layout-select"
            options={templates.map((template) => ({
              value: template.template_id,
              label: `${template.name}${template.isStandard ? ` (${t('common.badges.standard', { defaultValue: 'Standard' })})` : ''}`,
            }))}
            value={effectiveTemplateId}
            onValueChange={(value) => void handleTemplateChange(value)}
            placeholder={t('quotePreview.placeholders.selectLayout', { defaultValue: 'Select quote layout...' })}
          />
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <LoadingIndicator
              text={t('quotePreview.loading', { defaultValue: 'Loading Preview...' })}
              spinnerProps={{ size: 'sm' }}
            />
          </div>
        ) : previewHtml ? (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {onOpen && (
                <Button
                  id="quote-preview-open"
                  variant="outline"
                  onClick={onOpen}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  {t('quotePreview.actions.openQuote', { defaultValue: 'Open Quote' })}
                </Button>
              )}
              {onDownload && (
                <Button
                  id="quote-preview-download-pdf"
                  onClick={() => handleAction(
                    onDownload,
                    'download PDF',
                    t('quotePreview.errors.downloadPdf', {
                      defaultValue: 'Failed to download PDF. Please try again.',
                    }),
                  )}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  {t('common.actions.downloadPdf', { defaultValue: 'Download PDF' })}
                </Button>
              )}
            </div>

            <div className="mb-4 max-h-[80vh] overflow-y-auto overflow-x-auto">
              <div
                style={{
                  zoom: scale,
                  width: `${baseWidth}px`,
                  transition: 'zoom 0.2s ease-out',
                  colorScheme: 'light',
                  backgroundColor: 'white',
                  color: 'black',
                }}
              >
                <style dangerouslySetInnerHTML={{ __html: previewHtml.css }} />
                <div dangerouslySetInnerHTML={{ __html: previewHtml.html }} />
              </div>
            </div>
          </>
        ) : (
          <div className="text-muted-foreground text-center h-64 flex items-center justify-center">
            {t('quotePreview.empty.unavailable', {
              defaultValue: 'Could not display preview. Data might be missing.',
            })}
          </div>
        )}
      </div>
    </Card>
  );
};

export default QuotePreviewPanel;
