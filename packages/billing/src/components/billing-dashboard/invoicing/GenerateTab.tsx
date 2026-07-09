'use client'

import React, { useState, useEffect } from 'react';
import type { IService, IClient } from '@alga-psa/types';
import { getAllClientsForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import {
  getServices,
  listInvoiceableSalesOrdersForBilling,
  type InvoiceableSalesOrderForBilling,
} from '@alga-psa/billing/actions';
import AutomaticInvoices from '../AutomaticInvoices';
import ManualInvoices from '../ManualInvoices';
import PrepaymentInvoices from '../PrepaymentInvoices';
import SuccessDialog from '@alga-psa/ui/components/SuccessDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from 'react-i18next';

export type InvoiceType = 'automatic' | 'manual' | 'prepayment';

interface GenerateTabProps {
  initialServices: IService[];
  // Invoice type is owned by InvoicingHub (the selector rides the tab-bar row).
  invoiceType: InvoiceType;
  onGenerateSuccess: () => void;
  refreshTrigger: number;
  sourceSalesOrderId?: string | null;
}

const GenerateTab: React.FC<GenerateTabProps> = ({
  initialServices,
  invoiceType,
  onGenerateSuccess,
  refreshTrigger,
  sourceSalesOrderId
}) => {
  const { t } = useTranslation('msp/invoicing');
  const { enabled: billingEnabled } = useFeatureFlag('billing-enabled');
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<IClient[]>([]);
  const [services, setServices] = useState<IService[]>([]);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [internalRefreshTrigger, setInternalRefreshTrigger] = useState(0);
  const [invoiceableSalesOrders, setInvoiceableSalesOrders] = useState<InvoiceableSalesOrderForBilling[]>([]);

  // Only load clients and services for manual/prepayment invoices
  useEffect(() => {
    if (invoiceType !== 'automatic') {
      loadManualInvoiceData();
    }
  }, [invoiceType, refreshTrigger]);

  const loadManualInvoiceData = async () => {
    try {
      const [clientsData, servicesData, invoiceableSalesOrdersData] = await Promise.all([
        getAllClientsForBilling(),
        getServices(1, 999, { item_kind: 'any' }),
        invoiceType === 'manual' ? listInvoiceableSalesOrdersForBilling() : Promise.resolve([])
      ]);

      setClients(clientsData);
      setInvoiceableSalesOrders(invoiceableSalesOrdersData);

      if (servicesData && Array.isArray(servicesData.services)) {
        setServices(servicesData.services);
      } else {
        console.warn('Services data is not in the expected format:', servicesData);
        setServices([]);
      }
    } catch (err) {
      setError(t('generateTab.messages.loadFailed', { defaultValue: 'Failed to load data' }));
      console.error('Error loading data:', err);
    }
  };

  const handleGenerateSuccess = () => {
    setInternalRefreshTrigger(prev => prev + 1);
    setSuccessMessage(t('generateTab.messages.success', { defaultValue: 'Invoice generated successfully!' }));
    setShowSuccessDialog(true);
    onGenerateSuccess();
  };

  const handleRefreshNeeded = () => {
    setInternalRefreshTrigger(prev => prev + 1);
    onGenerateSuccess();
  };

  const renderContent = () => {
    switch (invoiceType) {
      case 'automatic':
        return (
          <AutomaticInvoices
            onGenerateSuccess={handleGenerateSuccess}
            onRefreshNeeded={handleRefreshNeeded}
            refreshTrigger={refreshTrigger + internalRefreshTrigger}
          />
        );
      case 'manual':
        return (
          <ManualInvoices
            clients={clients}
            services={services}
            onGenerateSuccess={handleGenerateSuccess}
            invoiceableSalesOrders={invoiceableSalesOrders}
            sourceSalesOrderId={sourceSalesOrderId}
          />
        );
      case 'prepayment':
        if (!billingEnabled) {
          return null;
        }
        return (
          <PrepaymentInvoices
            clients={clients}
            onGenerateSuccess={handleGenerateSuccess}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      {/* The invoice-type selector lives in the tab bar (InvoicingHub); every
          invoice type renders its own elevated surface, so the content rests
          directly on the page background — one level of elevation, not three. */}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {renderContent()}

      <SuccessDialog
        isOpen={showSuccessDialog}
        onClose={() => setShowSuccessDialog(false)}
        message={successMessage}
        id="invoice-success-dialog"
      />
    </>
  );
};

export default GenerateTab;
