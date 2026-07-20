'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  getProjectPaymentWarning,
  type ProjectPaymentWarning,
} from '../../actions/projectBillingWarningActions';
import { useTranslation } from 'react-i18next';

interface ProjectPaymentWarningBannerProps {
  projectId: string;
  className?: string;
}

export default function ProjectPaymentWarningBanner({
  projectId,
  className,
}: ProjectPaymentWarningBannerProps) {
  const { t } = useTranslation('features/projects');
  const [warning, setWarning] = useState<ProjectPaymentWarning | null>(null);

  useEffect(() => {
    let stale = false;
    getProjectPaymentWarning(projectId)
      .then((result) => {
        if (stale) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setWarning(null);
          return;
        }
        setWarning(result);
      })
      .catch(() => {
        if (!stale) setWarning(null);
      });
    return () => {
      stale = true;
    };
  }, [projectId]);

  if (!warning) return null;

  const genericMessage = t(
    'billing.paymentWarning.generic',
    'Payment is required for a flagged project billing milestone and has not been confirmed. Confirm payment before continuing work.',
  );

  let message = genericMessage;
  if (warning.has_billing_details) {
    const invoiceNumber = warning.invoice_number ?? t('billing.paymentWarning.invoiceFallback', 'the linked invoice');
    if (warning.kind === 'invoice_preparation') {
      message = t(
        'billing.paymentWarning.preparation',
        'Payment is required before work continues. Invoice {{invoiceNumber}} is still being prepared.',
        { invoiceNumber },
      );
    } else if (warning.kind === 'replacement_needed') {
      message = t(
        'billing.paymentWarning.replacement',
        'Payment is required before work continues. Invoice {{invoiceNumber}} was cancelled or voided and needs a replacement.',
        { invoiceNumber },
      );
    } else {
      message = t(
        'billing.paymentWarning.outstanding',
        'Payment is required before work continues. Invoice {{invoiceNumber}} has not been paid.',
        { invoiceNumber },
      );
    }
  }

  return (
    <Alert id="project-payment-warning" variant="warning" className={className}>
      <AlertDescription>
        <span className="font-medium">
          {t('billing.paymentWarning.title', 'Payment prerequisite warning')}
        </span>{' '}
        {message}
      </AlertDescription>
    </Alert>
  );
}
