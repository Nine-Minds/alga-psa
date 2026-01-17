// TemplateRenderer.tsx
'use client'
import { useEffect, useState } from 'react';
// Removed Buffer import - no longer needed client-side
// Use the InvoiceViewModel type definition expected by the renderer
import type { WasmInvoiceViewModel } from 'server/src/lib/invoice-renderer/types';
import type { IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces'; // Keep this for template structure
// Removed getCompiledWasm, executeWasmTemplate, renderLayout imports
// Import the new server action
import { renderTemplateOnServer } from '@alga-psa/billing/actions/invoiceTemplates';

interface TemplateRendererProps {
  template: IInvoiceTemplate | null; // Allow null template
  // Use the correct InvoiceViewModel type for the prop
  invoiceData: WasmInvoiceViewModel | null; // Allow null invoiceData
}

export function TemplateRenderer({ template, invoiceData }: TemplateRendererProps) {
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [renderedCss, setRenderedCss] = useState<string | null>(null); // Added state for CSS
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const performRender = async () => {
      // Reset state
      setRenderedHtml(null);
      setRenderedCss(null);
      setError(null);

      if (!template || !invoiceData) {
        // Don't show loading if there's nothing to load
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        // Prepare data for the server action, ensuring all numeric fields are numbers
        const processedInvoiceData = {
          ...invoiceData,
          // Convert root-level numeric fields
          subtotal: Number(invoiceData.subtotal || 0),
          tax: Number(invoiceData.tax || 0),
          total: Number(invoiceData.total || 0),
          // Convert item-level numeric fields
          items: invoiceData.items.map(item => ({
            ...item,
            // Convert quantity, unitPrice, and total strings to numbers, defaulting to 0
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            total: Number(item.total || 0)
          }))
        };

        console.log("Processed Invoice Data:", processedInvoiceData);

        // Call the server action with the processed data
        const { html, css } = await renderTemplateOnServer(template.template_id, processedInvoiceData);

        setRenderedHtml(html);
        setRenderedCss(css);

      } catch (err) {
        console.error("Error rendering invoice template:", err);
        setError(err instanceof Error ? err.message : "Failed to render template using Wasm.");
        setRenderedHtml(null); // Clear on error
        setRenderedCss(null);
      } finally {
        setIsLoading(false);
      }
    };

    performRender();
  }, [template, invoiceData]); // Rerun effect when template or invoiceData changes

  if (isLoading) {
    return <div>Loading template preview...</div>; // Or a Skeleton loader
  }

  if (error) {
    return <div className="text-red-600 p-4 border border-red-300 bg-red-50 rounded">Error: {error}</div>;
  }

  // Initial state or missing data message
  if (!template || !invoiceData) {
      return <div className="text-gray-500 p-4 border border-gray-300 bg-gray-50 rounded">Please select an invoice and a template to preview.</div>;
  }

  // Rendered content
  if (renderedHtml !== null && renderedCss !== null) {
    return (
      <>
        <style>{renderedCss}</style>
        <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
      </>
    );
  }

  // Fallback if render hasn't completed but no error/loading (shouldn't usually happen)
  return null;
}
