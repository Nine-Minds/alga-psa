'use client'

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Coins, FileText, Receipt } from 'lucide-react';
import type { IService, IClient } from '@alga-psa/types';
import { getAllClientsForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { getServices } from '@alga-psa/billing/actions';
import AutomaticInvoices from '../AutomaticInvoices';
import ManualInvoices from '../ManualInvoices';
import PrepaymentInvoices from '../PrepaymentInvoices';
import SuccessDialog from '@alga-psa/ui/components/SuccessDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from 'react-i18next';

interface GenerateTabProps {
  initialServices: IService[];
  onGenerateSuccess: () => void;
  refreshTrigger: number;
}

type InvoiceType = 'automatic' | 'manual' | 'prepayment';

interface SelectOption {
  value: string;
  label: React.JSX.Element;
  textValue?: string;
}

const GenerateTab: React.FC<GenerateTabProps> = ({
  initialServices,
  onGenerateSuccess,
  refreshTrigger
}) => {
  const { t } = useTranslation('msp/invoicing');
  const router = useRouter();
  const { enabled: billingEnabled } = useFeatureFlag('billing-enabled');
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('automatic');
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<IClient[]>([]);
  const [services, setServices] = useState<IService[]>([]);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [internalRefreshTrigger, setInternalRefreshTrigger] = useState(0);

  // Only load clients and services for manual/prepayment invoices
  useEffect(() => {
    if (invoiceType !== 'automatic') {
      loadManualInvoiceData();
    }
  }, [invoiceType, refreshTrigger]);

  const loadManualInvoiceData = async () => {
    try {
      const [clientsData, servicesData] = await Promise.all([
        getAllClientsForBilling(),
        getServices(1, 999, { item_kind: 'any' })
      ]);

      setClients(clientsData);

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

  const handleViewDrafts = () => {
    setShowSuccessDialog(false);
    router.push('/msp/billing?tab=invoicing&subtab=drafts');
  };

  const allInvoiceTypeOptions: SelectOption[] = [
    {
      value: 'automatic',
      textValue: t('generateTab.types.automatic', { defaultValue: 'Automatic Invoices' }),
      label: (
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          <span>{t('generateTab.types.automatic', { defaultValue: 'Automatic Invoices' })}</span>
        </div>
      )
    },
    {
      value: 'manual',
      textValue: t('generateTab.types.manual', { defaultValue: 'Manual Invoice' }),
      label: (
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <span>{t('generateTab.types.manual', { defaultValue: 'Manual Invoice' })}</span>
        </div>
      )
    },
    {
      value: 'prepayment',
      textValue: t('generateTab.types.prepayment', { defaultValue: 'Prepayment' }),
      label: (
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4" />
          <span>{t('generateTab.types.prepayment', { defaultValue: 'Prepayment' })}</span>
        </div>
      )
    }
  ];

  const invoiceTypeOptions = useMemo(() => {
    if (billingEnabled) {
      return allInvoiceTypeOptions;
    }
    return allInvoiceTypeOptions.filter(option => option.value !== 'prepayment');
  }, [billingEnabled]);

  const invoiceTypeDescription = {
    automatic: t('generateTab.descriptions.automatic', {
      defaultValue: 'Generate invoices for the recurring service periods that are due.',
    }),
    manual: t('generateTab.descriptions.manual', {
      defaultValue: 'Use manual invoices for one-off or adjustment lines. They do not redefine recurring service periods.',
    }),
    prepayment: t('generateTab.descriptions.prepayment', {
      defaultValue: 'Use prepayment and credit flows for financial value that should stay separate from recurring service-period coverage.',
    }),
  } satisfies Record<InvoiceType, string>;

  const renderContent = () => {
    switch (invoiceType) {
      case 'automatic':
        return (
          <AutomaticInvoices
            onGenerateSuccess={handleGenerateSuccess}
            refreshTrigger={refreshTrigger + internalRefreshTrigger}
          />
        );
      case 'manual':
        return (
          <ManualInvoices
            clients={clients}
            services={services}
            onGenerateSuccess={handleGenerateSuccess}
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
      {/* No enclosing card here: every invoice type renders its own elevated surface
          (the automatic grid, and the manual/prepayment forms each wrap themselves in a
          Card). Wrapping them again was a pane-on-a-pane. The type selector and content
          rest directly on the page background — one level of elevation, not three. */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-2">
            {t('generateTab.fields.invoiceType', { defaultValue: 'Invoice Type' })}
          </label>
          <CustomSelect
            value={invoiceType}
            onValueChange={(value: string) => setInvoiceType(value as InvoiceType)}
            options={invoiceTypeOptions}
            className="w-full md:w-80"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {invoiceTypeDescription[invoiceType]}
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {renderContent()}
      </div>

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
