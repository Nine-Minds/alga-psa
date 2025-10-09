'use client'

import React, { useEffect, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import CustomSelect from '../../ui/CustomSelect';
import LoadingIndicator from '../../ui/LoadingIndicator';
import { FileTextIcon, GearIcon } from '@radix-ui/react-icons';
import { IInvoiceTemplate } from '../../../interfaces/invoice.interfaces';
import { WasmInvoiceViewModel } from '../../../lib/invoice-renderer/types';
import { getInvoiceForRendering } from '../../../lib/actions/invoiceQueries';
import { mapDbInvoiceToWasmViewModel } from '../../../lib/adapters/invoiceAdapters';
import { TemplateRenderer } from '../TemplateRenderer';
import PaperInvoice from '../PaperInvoice';
import CreditExpirationInfo from '../CreditExpirationInfo';

interface InvoicePreviewPanelProps {
  invoiceId: string | null;
  templates: IInvoiceTemplate[];
  selectedTemplateId: string | null;
  onTemplateChange: (templateId: string) => void;
  onFinalize?: () => Promise<void>;
  onDownload?: () => Promise<void>;
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
  onEmail,
  onEdit,
  onUnfinalize,
  isFinalized,
  creditApplied = 0
}) => {
  const [detailedInvoiceData, setDetailedInvoiceData] = useState<WasmInvoiceViewModel | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(0);
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
        return;
      }

      setIsLoading(true);
      setError(null);
      setDetailedInvoiceData(null);

      try {
        const dbInvoiceData = await getInvoiceForRendering(invoiceId);

        if (!dbInvoiceData) {
          throw new Error(`Invoice data for ID ${invoiceId} not found.`);
        }

        const viewModel = mapDbInvoiceToWasmViewModel(dbInvoiceData);

        if (!viewModel) {
          throw new Error(`Failed to map invoice data for ID ${invoiceId} to view model.`);
        }

        setDetailedInvoiceData(viewModel);
      } catch (err) {
        console.error(`Error fetching detailed data for invoice ${invoiceId}:`, err);
        const message = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to load preview: ${message}`);
        setDetailedInvoiceData(null);
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
          <h3 className="text-lg font-semibold mb-2">Invoice Preview</h3>
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

            <div className="flex flex-wrap gap-2">
              {!isFinalized && onFinalize && (
                <Button
                  onClick={() => handleAction(onFinalize, 'finalize invoice')}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  Finalize Invoice
                </Button>
              )}

              {!isFinalized && onEdit && (
                <Button
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
                  variant="outline"
                  onClick={() => handleAction(onDownload, 'download PDF')}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  Download PDF
                </Button>
              )}

              {onEmail && (
                <Button
                  variant="outline"
                  onClick={() => handleAction(onEmail, 'send email')}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  Send Email
                </Button>
              )}

              {isFinalized && onUnfinalize && (
                <Button
                  variant="outline"
                  onClick={() => handleAction(onUnfinalize, 'unfinalize invoice')}
                  disabled={isActionLoading}
                  className="flex-1"
                >
                  Unfinalize
                </Button>
              )}
            </div>
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
