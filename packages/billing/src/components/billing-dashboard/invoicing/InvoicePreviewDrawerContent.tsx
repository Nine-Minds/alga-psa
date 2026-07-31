'use client';

import { useEffect, useState } from 'react';
import type { IInvoiceTemplate } from '@alga-psa/types';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getInvoiceTemplates } from '../../../actions/invoiceTemplates';
import { getEnrichedInvoiceViewModel } from '../../../actions/invoiceQueries';
import InvoicePreviewPanel from './InvoicePreviewPanel';

interface InvoicePreviewDrawerContentProps {
  invoiceId: string;
}

/** Billing-authorized, read-only invoice detail suitable for cross-feature drawers. */
export default function InvoicePreviewDrawerContent({ invoiceId }: InvoicePreviewDrawerContentProps) {
  const { t } = useTranslation('msp/invoicing');
  const [templates, setTemplates] = useState<IInvoiceTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isFinalized, setIsFinalized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([getInvoiceTemplates(), getEnrichedInvoiceViewModel(invoiceId)])
      .then(([templateResult, invoiceResult]) => {
        if (!active) return;
        if (isActionMessageError(templateResult) || isActionPermissionError(templateResult)) {
          setError(getErrorMessage(templateResult));
          return;
        }
        if (isActionMessageError(invoiceResult) || isActionPermissionError(invoiceResult)) {
          setError(getErrorMessage(invoiceResult));
          return;
        }
        if (!invoiceResult) {
          setError(t('invoicePreview.errors.notFound', { defaultValue: 'Invoice not found.' }));
          return;
        }
        const defaultTemplate = templateResult.find((template) => template.isStandard) ?? templateResult[0];
        if (!defaultTemplate) {
          setError(t('invoicePreview.errors.noTemplates', { defaultValue: 'No invoice templates are available.' }));
          return;
        }
        setTemplates(templateResult);
        setSelectedTemplateId(defaultTemplate.template_id);
        const status = String((invoiceResult as { status?: unknown }).status ?? '').toLowerCase();
        setIsFinalized(status !== '' && status !== 'draft');
      })
      .catch((reason) => {
        if (active) setError(getErrorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [invoiceId, t]);

  if (loading) {
    return <div className="flex min-h-64 items-center justify-center"><LoadingIndicator /></div>;
  }
  if (error || !selectedTemplateId) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertDescription>{error ?? t('invoicePreview.errors.loadFailed', { defaultValue: 'Unable to load invoice.' })}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <InvoicePreviewPanel
      invoiceId={invoiceId}
      templates={templates}
      selectedTemplateId={selectedTemplateId}
      onTemplateChange={setSelectedTemplateId}
      isFinalized={isFinalized}
      readOnly
    />
  );
}
