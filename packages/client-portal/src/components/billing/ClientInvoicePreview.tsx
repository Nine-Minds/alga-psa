'use client';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal invoice preview intentionally reuses billing feature presentation components and the scoped invoice template resolver so customer invoice views honor the same configured template as MSP preview and PDF rendering. */

import React, { useEffect, useState, useRef } from 'react';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { TemplateRenderer, PaperInvoice } from '@alga-psa/billing/components';
import { getClientInvoicePreview } from '@alga-psa/client-portal/actions';
import { mapDbInvoiceToWasmViewModel } from '@alga-psa/billing/lib/adapters/invoiceAdapters';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import type { IInvoiceTemplate } from '@alga-psa/types';

interface ClientInvoicePreviewProps {
  invoiceId: string;
  className?: string;
}

const isBillingActionError = (
  value: unknown
): value is { readonly actionError: string } | { readonly permissionError: string } =>
  isActionMessageError(value) || isActionPermissionError(value);

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
  const { t } = useTranslation('client-portal');
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
        // One server action resolves the invoice and its template and inlines
        // the logo / designer images, which the browser cannot fetch itself.
        const preview = await getClientInvoicePreview(invoiceId);

        if (isBillingActionError(preview)) {
          setInvoiceData(null);
          setTemplate(null);
          setError(getErrorMessage(preview));
          return;
        }

        if (!preview?.invoice) {
          throw new Error('Invoice not found');
        }

        // Map to view model for renderer
        const viewModel = mapDbInvoiceToWasmViewModel(preview.invoice);
        if (!viewModel) {
          throw new Error('Failed to process invoice data');
        }

        setInvoiceData(viewModel);
        setTemplate(preview.template);

      } catch (err) {
        console.error('Error loading invoice preview:', err);
        setError(t('billing.invoicePreview.loadFailed', { defaultValue: 'Failed to load invoice' }));
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [invoiceId, t]);

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
      <div className={`text-destructive p-4 border border-destructive/30 bg-destructive/10 rounded ${className}`}>
        {error}
      </div>
    );
  }

  if (!invoiceData || !template) {
    return (
      <div className={`text-gray-500 p-4 border border-gray-200 bg-gray-50 rounded ${className}`}>
        {t('billing.invoicePreview.unavailable', { defaultValue: 'Unable to display invoice preview.' })}
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
                invoiceId={invoiceId}
              />
            </PaperInvoice>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientInvoicePreview;
