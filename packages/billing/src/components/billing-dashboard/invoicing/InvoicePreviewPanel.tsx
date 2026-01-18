'use client'

import React, { useEffect, useState } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { FileTextIcon, GearIcon } from '@radix-ui/react-icons';
import type { IInvoiceTemplate, TaxSource } from '@alga-psa/types';
import type { WasmInvoiceViewModel } from 'server/src/lib/invoice-renderer/types';
import { getInvoiceForRendering, getInvoicePurchaseOrderSummary, type InvoicePurchaseOrderSummary } from '@alga-psa/billing/actions/invoiceQueries';
import { mapDbInvoiceToWasmViewModel } from 'server/src/lib/adapters/invoiceAdapters';
import { PurchaseOrderSummaryBanner } from './PurchaseOrderSummaryBanner';
import { TemplateRenderer } from '../TemplateRenderer';
import PaperInvoice from '../PaperInvoice';
import CreditExpirationInfo from '../CreditExpirationInfo';
import { Button } from '@alga-psa/ui/components/Button';
import { InvoiceTaxSourceBadge } from '../../invoices/InvoiceTaxSourceBadge';

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
  const [detailedInvoiceData, setDetailedInvoiceData] = useState<WasmInvoiceViewModel | null>(null);
  const [poSummary, setPoSummary] = useState<InvoicePurchaseOrderSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [taxSource, setTaxSource] = useState<TaxSource>('internal');
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selectedTemplate = templates.find(t => t.template_id === selectedTemplateId) || null;

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
  // Standard US Letter size is 8.5" x 11" = 816px x 1056px at 96 DPI
  // We'll use 816px as our base width
  // A4 paper height is 1123px + padding/container (~1200px total)
  const baseInvoiceWidth = 816;
  const baseInvoiceHeight = 1200; // Approximate total height including paper container
  const scale = containerWidth > 0 ? Math.min(containerWidth / baseInvoiceWidth, 1) : 1;

  if (!invoiceId) {
    return (
      <Card className="h-full">
        <div className="p-6 flex items-center justify-center h-64 text-gray-500">
          <div className="text-center">
            <FileTextIcon className="h-12 w-12 mx-auto mb-2 text-gray-400" />
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
                    <><FileTextIcon className="w-4 h-4" /> {template.name} (Standard)</>
                  ) : (
                    <><GearIcon className="w-4 h-4" /> {template.name}</>
                  )}
                </div>
              )
            }))}
            onValueChange={onTemplateChange}
            value={selectedTemplateId || ''}
            placeholder="Select invoice template..."
          />
        </div>

        {error && (
          <div className="mb-4 text-red-500 text-sm bg-red-50 border border-red-200 rounded p-3">
            {error}
          </div>
        )}

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

            <div className="mb-4 max-h-[600px] overflow-y-auto overflow-x-hidden">
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
                  <PaperInvoice>
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
          <div className="text-gray-500 text-center h-64 flex items-center justify-center">
            Could not display preview. Data might be missing.
          </div>
        )}
      </div>
    </Card>
  );
};

export default InvoicePreviewPanel;
