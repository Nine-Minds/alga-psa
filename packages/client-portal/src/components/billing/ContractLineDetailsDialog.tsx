'use client';

import React, { useMemo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import type { IClientContractLine } from '@alga-psa/types';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { X, Package } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ContractLineDetailsDialogProps {
  contractLine: IClientContractLine | null;
  isOpen: boolean;
  onClose: () => void;
  formatCurrency?: (amount: number, currencyCode?: string) => string;
  formatDate: (date: string | { toString(): string } | undefined | null) => string;
};

const ContractLineDetailsDialog: React.FC<ContractLineDetailsDialogProps> = React.memo(({
  contractLine,
  isOpen,
  onClose,
  formatCurrency = (amount: number, currencyCode: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode
    }).format(amount / 100);
  },
  formatDate
}) => {
  const { t } = useTranslation('clientPortal');
  // Loading state when contract line is null but dialog is open
  const isLoading = isOpen && !contractLine;

  // Memoize the contract line details content to prevent unnecessary re-renders
  const contractLineContent = useMemo(() => {
    if (!contractLine) return null;
    
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-500">{t('billing.contractLine.name')}</p>
            <p className="mt-1">{contractLine.contract_line_name}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">{t('billing.contractLine.frequency')}</p>
            <p className="mt-1">{t(`billing.frequency.${contractLine.billing_frequency?.toLowerCase() || 'monthly'}`, { defaultValue: contractLine.billing_frequency || 'Monthly' })}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">{t('billing.contractLine.startDate')}</p>
            <p className="mt-1">{formatDate(contractLine.start_date)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">{t('billing.contractLine.endDate')}</p>
            <p className="mt-1">{contractLine.end_date ? formatDate(contractLine.end_date) : t('billing.contractLine.noEndDate')}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">{t('billing.contractLine.status')}</p>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${
              contractLine.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {contractLine.is_active ? t('common.active') : t('common.inactive')}
            </span>
          </div>
          {contractLine.custom_rate !== undefined && (
            <div>
              <p className="text-sm font-medium text-gray-500">{t('billing.contractLine.customRate')}</p>
              <p className="mt-1">{formatCurrency(contractLine.custom_rate, contractLine.currency_code)}</p>
            </div>
          )}
          {(contractLine.service_category_name || contractLine.service_category) && (
            <div>
              <p className="text-sm font-medium text-gray-500">{t('billing.contractLine.serviceCategory')}</p>
              <p className="mt-1">{contractLine.service_category_name || contractLine.service_category}</p>
            </div>
          )}
        </div>

        <div className="mt-4">
          <p className="text-sm text-gray-500">
            {t('billing.contractLine.statusDescription', {
              status: contractLine.is_active ? t('common.active').toLowerCase() : t('common.inactive').toLowerCase(),
              expiry: contractLine.end_date ? t('billing.contractLine.expiresOn', { date: formatDate(contractLine.end_date) }) : t('billing.contractLine.noExpiry')
            })}
          </p>
        </div>
      </div>
    );
  }, [contractLine, formatCurrency, formatDate]);

  // Loading skeleton for when contract line is being fetched
  const loadingSkeleton = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i}>
            <Skeleton className="h-4 w-24 mb-1" />
            <Skeleton className="h-6 w-32" />
          </div>
        ))}
      </div>
      
      <div>
        <Skeleton className="h-4 w-full mt-4" />
      </div>
    </div>
  );
  
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('billing.contractLine.detailsTitle')}
      data-automation-id="contract-line-details-dialog"
    >
      <DialogContent>
        <div data-automation-id="contract-line-details-content">
          {isLoading ? loadingSkeleton : contractLineContent}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button id="close-contract-line-dialog-button" variant="outline" onClick={onClose}>
          <X className="mr-2 h-4 w-4" />
          {t('common.close')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
});

// Add display name for debugging
ContractLineDetailsDialog.displayName = 'ContractLineDetailsDialog';

export default ContractLineDetailsDialog;
