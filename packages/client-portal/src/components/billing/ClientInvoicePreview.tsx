'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { TemplateRenderer, PaperInvoice } from '@alga-psa/billing/components';
import { getClientInvoiceById, getClientInvoiceTemplates } from 'server/src/lib/actions/client-portal-actions/client-billing';
import { mapDbInvoiceToWasmViewModel } from 'server/src/lib/adapters/invoiceAdapters';
import type { WasmInvoiceViewModel } from 'server/src/lib/invoice-renderer/types';
import type { IInvoiceTemplate } from '@alga-psa/types';

interface ClientInvoicePreviewProps {
  invoiceId: string;
  className?: string;
}

/**
 * Client Portal Invoice Preview Component
 *
 * Renders an invoice using the same template renderer as the MSP portal,
 * providing a consistent invoice appearance across the application.
 */
const ClientInvoicePreview: React.FC<ClientInvoicePreviewProps> = ({
  invoiceId,
  className = '',
}) => {
  const [invoiceData, setInvoiceData] = useState<WasmInvoiceViewModel | null>(null);
  const [template, setTemplate] = useState<IInvoiceTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Load invoice data and template
  useEffect(() => {
    const loadData = async () => {
      if (!invoiceId) {
        setInvoiceData(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Fetch invoice and templates in parallel
        const [dbInvoiceData, templates] = await Promise.all([
          getClientInvoiceById(invoiceId),
          getClientInvoiceTemplates(),
        ]);

        if (!dbInvoiceData) {
          throw new Error('Invoice not found');
        }

        // Map to view model for renderer
        const viewModel = mapDbInvoiceToWasmViewModel(dbInvoiceData);
        if (!viewModel) {
          throw new Error('Failed to process invoice data');
        }

        setInvoiceData(viewModel);

        // Use the first available template (standard template)
        // In future, could use tenant's default template preference
        const defaultTemplate = templates.find(t => t.isStandard) || templates[0];
        setTemplate(defaultTemplate || null);

      } catch (err) {
        console.error('Error loading invoice preview:', err);
        setError(err instanceof Error ? err.message : 'Failed to load invoice');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [invoiceId]);

  // Calculate scale based on container width
  // Standard US Letter size is 8.5" x 11" = 816px x 1056px at 96 DPI
  const baseInvoiceWidth = 816;
  const baseInvoiceHeight = 1100;
  const scale = containerWidth > 0 ? Math.min(containerWidth / baseInvoiceWidth, 1) : 1;

  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-red-500 p-4 border border-red-200 bg-red-50 rounded ${className}`}>
        {error}
      </div>
    );
  }

  if (!invoiceData || !template) {
    return (
      <div className={`text-gray-500 p-4 border border-gray-200 bg-gray-50 rounded ${className}`}>
        Unable to display invoice preview.
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className}>
      <div
        className="overflow-auto"
        style={{
          maxHeight: '600px',
        }}
      >
        <div
          style={{
            width: `${baseInvoiceWidth * scale}px`,
            height: `${baseInvoiceHeight * scale}px`,
          }}
        >
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              width: `${baseInvoiceWidth}px`,
              transition: 'transform 0.2s ease-out',
            }}
          >
            <PaperInvoice>
              <TemplateRenderer
                template={template}
                invoiceData={invoiceData}
              />
            </PaperInvoice>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientInvoicePreview;
