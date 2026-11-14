'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IClient, IService, InvoiceViewModel } from '@alga-psa/types';
import { getClientByIdForBillingRecoverable } from '@alga-psa/billing/actions/billingClientsActions';
import { getServicesRecoverable } from '@alga-psa/billing/actions/serviceActions';
import {
  getInvoiceAdjustmentCapability,
  type InvoiceAdjustmentCapability,
} from '@alga-psa/billing/actions/invoiceModification';
import ManualInvoices from '../ManualInvoices';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

interface DraftInvoiceAdjustmentsCardProps {
  invoice: InvoiceViewModel;
  /** Supplied when the invoice cannot accept manual adjustments. */
  blockedReason?: string | null;
  onUpdated?: () => void | Promise<void>;
}

/**
 * Hosts the reusable manual-line editor for an existing contract draft.
 *
 * Generated recurring charges are rendered read-only by the editor; only
 * operator-created adjustment lines are editable. When the invoice is past the
 * editable lifecycle the card explains the supported path instead of hiding
 * the capability.
 */
const DraftInvoiceAdjustmentsCard: React.FC<DraftInvoiceAdjustmentsCardProps> = ({
  invoice,
  blockedReason = null,
  onUpdated,
}) => {
  const { t } = useTranslation('msp/invoicing');
  const [client, setClient] = useState<IClient | null>(null);
  const [services, setServices] = useState<IService[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [capability, setCapability] = useState<InvoiceAdjustmentCapability | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [authenticationExpired, setAuthenticationExpired] = useState(false);

  const retryLoad = useCallback(() => setLoadAttempt((attempt) => attempt + 1), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      setAuthenticationExpired(false);
      setCapability(null);
      try {
        const [clientResult, servicesResult, capabilityResult] = await Promise.all([
          getClientByIdForBillingRecoverable(invoice.client_id),
          getServicesRecoverable(1, 999, { item_kind: 'any' }),
          getInvoiceAdjustmentCapability(invoice.invoice_id),
        ]);
        if (cancelled) return;
        if (isAuthenticationFailure(clientResult)) {
          setAuthenticationExpired(true);
          return;
        }
        if (isActionMessageError(clientResult) || isActionPermissionError(clientResult)) {
          setLoadError(getErrorMessage(clientResult));
          return;
        }
        if (isAuthenticationFailure(servicesResult)) {
          setAuthenticationExpired(true);
          return;
        }
        if (isActionMessageError(servicesResult) || isActionPermissionError(servicesResult)) {
          setLoadError(getErrorMessage(servicesResult));
          return;
        }
        setClient((clientResult as IClient | null) ?? null);
        const loadedServices = Array.isArray((servicesResult as { services?: IService[] }).services)
          ? (servicesResult as { services: IService[] }).services
          : [];
        setServices(loadedServices);
        if (isActionPermissionError(capabilityResult)) {
          setLoadError(getErrorMessage(capabilityResult));
          return;
        }
        if (isAuthenticationFailure(capabilityResult)) {
          setAuthenticationExpired(true);
          return;
        }
        setCapability(capabilityResult as InvoiceAdjustmentCapability);
      } catch (error) {
        if (!cancelled) {
          if (isAuthenticationFailure(error)) setAuthenticationExpired(true);
          else setLoadError(error instanceof Error ? error.message : 'Failed to load adjustment data.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [invoice.invoice_id, loadAttempt]);

  // The server capability is authoritative: a draft that is already posted to an
  // accounting system, or one a permission check rejects, is blocked here even
  // when the optimistic sync badge has not caught up yet.
  const serverBlockedReason = capability && !capability.editable
    ? capability.code === 'exporting'
      ? t('draftInvoiceAdjustments.blocked.exporting', { defaultValue: capability.reason })
      : capability.reason
    : null;
  const effectiveBlockedReason = serverBlockedReason ?? blockedReason;

  if (effectiveBlockedReason) {
    return (
      <Card className="mb-4" id="draft-invoice-adjustments-card">
        <div className="p-6">
          <h3 className="text-lg font-semibold">
            {t('draftInvoiceAdjustments.blockedTitle', { defaultValue: 'Invoice adjustments unavailable' })}
          </h3>
          <Alert variant="warning" className="mt-3">
            <AlertDescription>{effectiveBlockedReason}</AlertDescription>
          </Alert>
        </div>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="mb-4" id="draft-invoice-adjustments-card">
        <div className="p-6 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[rgb(var(--color-border-900))]"></div>
        </div>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="mb-4" id="draft-invoice-adjustments-card">
        <div className="p-6">
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        </div>
      </Card>
    );
  }

  if (authenticationExpired) {
    return (
      <Card className="mb-4" id="draft-invoice-adjustments-card">
        <div className="p-6">
          <Alert variant="warning">
            <AlertDescription>{t('draftInvoiceAdjustments.sessionExpired', { defaultValue: 'Your session expired while loading invoice adjustments. Sign in again, then retry loading this invoice.' })}</AlertDescription>
          </Alert>
          <div className="mt-3 flex gap-2">
            <a id="draft-adjustments-sign-in" href="/auth/msp/signin" target="_blank" rel="noreferrer" className="text-primary underline">
              {t('draftInvoiceAdjustments.signIn', { defaultValue: 'Sign in' })}
            </a>
            <Button id="draft-adjustments-retry" type="button" variant="secondary" onClick={retryLoad}>
              {t('draftInvoiceAdjustments.retry', { defaultValue: 'Retry loading' })}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div id="draft-invoice-adjustments-section">
      <ManualInvoices
        client={client}
        services={services}
        invoice={invoice}
        variant="draftAdjustments"
        onGenerateSuccess={() => { /* refresh handled via onSaved */ }}
        onSaved={onUpdated}
      />
    </div>
  );
};

export default DraftInvoiceAdjustmentsCard;

function isAuthenticationFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const error = value as { name?: string; message?: string; code?: string };
  return error.name === 'AuthenticationError' || error.code === 'UNAUTHENTICATED'
    || error.message === 'User not authenticated';
}
