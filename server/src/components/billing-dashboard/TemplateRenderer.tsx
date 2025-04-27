// TemplateRenderer.tsx
'use client'
import { useEffect, useState } from 'react';
// Use the InvoiceViewModel type definition expected by the renderer
import type { InvoiceViewModel } from 'server/src/lib/invoice-renderer/types';
import type { IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces'; // Keep this for template structure
import { getCompiledWasm } from 'server/src/lib/actions/invoiceTemplates'; // Use the new action
import { executeWasmTemplate } from 'server/src/lib/invoice-renderer/wasm-executor';
import { renderLayout } from 'server/src/lib/invoice-renderer/layout-renderer';
// Buffer is returned by getCompiledWasm, so no explicit import needed here unless manipulating it

interface TemplateRendererProps {
  template: IInvoiceTemplate | null; // Allow null template
  // Use the correct InvoiceViewModel type for the prop
  invoiceData: InvoiceViewModel | null; // Allow null invoiceData
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

      if (!template.wasmPath) {
         setError("Selected template does not have a compiled Wasm module path.");
         setIsLoading(false);
         return;
      }


      setIsLoading(true);

      try {
        // 1. Fetch Wasm Module Content using the server action
        const wasmBuffer = await getCompiledWasm(template.template_id);

        // 2. Execute Wasm Template (invoiceData prop now uses the correct type)
        const layout = await executeWasmTemplate(wasmBuffer, invoiceData);

        // 3. Render Layout to HTML & CSS
        const { html, css } = renderLayout(layout);

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
