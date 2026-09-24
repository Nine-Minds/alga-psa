'use client';

import React, { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { IClient, IService, InvoiceViewModel } from '@alga-psa/types';
import { getAllClientsForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { getServices } from '@alga-psa/billing/actions/serviceActions';
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
  const [clients, setClients] = useState<IClient[]>([]);
  const [services, setServices] = useState<IService[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [capability, setCapability] = useState<InvoiceAdjustmentCapability | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [clientsResult, servicesResult, capabilityResult] = await Promise.all([
          getAllClientsForBilling(),
          getServices(1, 999, { item_kind: 'any' }),
          getInvoiceAdjustmentCapability(invoice.invoice_id),
        ]);
        if (cancelled) return;
        if (isActionMessageError(clientsResult) || isActionPermissionError(clientsResult)) {
          setLoadError(getErrorMessage(clientsResult));
          return;
        }
        if (isActionMessageError(servicesResult) || isActionPermissionError(servicesResult)) {
          setLoadError(getErrorMessage(servicesResult));
          return;
        }
        setClients(clientsResult as IClient[]);
        const loadedServices = Array.isArray((servicesResult as { services?: IService[] }).services)
          ? (servicesResult as { services: IService[] }).services
          : [];
        setServices(loadedServices);
        if (!isActionPermissionError(capabilityResult)) {
          setCapability(capabilityResult);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load adjustment data.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [invoice.invoice_id]);

  // The server capability is authoritative: a draft that is already posted to an
  // accounting system, or one a permission check rejects, is blocked here even
  // when the optimistic sync badge has not caught up yet.
  const serverBlockedReason = capability && !capability.editable
    ? capability.reason
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

  return (
    <div id="draft-invoice-adjustments-section">
      <ManualInvoices
        clients={clients}
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
