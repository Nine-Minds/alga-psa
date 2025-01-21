import { IInvoiceTemplate, InvoiceViewModel } from '@/interfaces/invoice.interfaces';
import { getInvoiceForRendering } from '@/lib/actions/invoiceActions';
import { renderTemplateCore } from './TemplateRendererCore';

interface TemplateRendererProps {
  template: IInvoiceTemplate;
  invoiceId: string;
}

export async function TemplateRenderer({ template, invoiceId }: TemplateRendererProps) {
  const invoiceData = await getInvoiceForRendering(invoiceId);
  if (!invoiceData) {
    throw new Error('Invoice data not found');
  }

  const { html, styles } = renderTemplateCore(template, invoiceData);

  return `
    <style>${styles}</style>
    <div>${html}</div>
  `;
}
