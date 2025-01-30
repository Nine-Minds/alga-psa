// TemplateRenderer.tsx
'use client'
import { useEffect, useState } from 'react';
import { IInvoiceTemplate, InvoiceViewModel } from '@/interfaces/invoice.interfaces';
import { renderTemplateCore } from './TemplateRendererCore';

interface TemplateRendererProps {
  template: IInvoiceTemplate;
  invoiceData: InvoiceViewModel;
}

export function TemplateRenderer({ template, invoiceData }: TemplateRendererProps) {
  const content = renderTemplateCore(template, invoiceData);

  return (
    <>
      <style>{content.styles}</style>
      <div dangerouslySetInnerHTML={{ __html: content.html }} />
    </>
  );
}
