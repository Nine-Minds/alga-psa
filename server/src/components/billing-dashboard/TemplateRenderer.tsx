// TemplateRenderer.tsx
'use client'
import { useEffect, useState } from 'react';
import { IInvoiceTemplate } from '@/interfaces/invoice.interfaces';
import { getInvoiceForRendering } from '@/lib/actions/invoiceActions';
import { renderTemplateCore } from './TemplateRendererCore';

interface TemplateRendererProps {
  template: IInvoiceTemplate;
  invoiceId: string;
}

export function TemplateRenderer({ template, invoiceId }: TemplateRendererProps) {
  const [content, setContent] = useState<{ html: string; styles: string } | null>(null);

  useEffect(() => {
    const loadTemplate = async () => {
      try {
        const invoiceData = await getInvoiceForRendering(invoiceId);
        if (!invoiceData) throw new Error('Invoice data not found');
        setContent(renderTemplateCore(template, invoiceData));
      } catch (error) {
        console.error('Error rendering template:', error);
      }
    };

    loadTemplate();
  }, [template, invoiceId]);

  if (!content) return null;

  return (
    <>
      <style>{content.styles}</style>
      <div dangerouslySetInnerHTML={{ __html: content.html }} />
    </>
  );
}
