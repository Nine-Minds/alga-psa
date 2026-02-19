'use client';

import React, { useMemo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import type { IClientContractLine } from '@alga-psa/types';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Badge } from '@alga-psa/ui/components/Badge';
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
  const { t } = useTranslation('features/billing');
  const { t: tCommon } = useTranslation('common');
  // Loading state when contract line is null but dialog is open
  const isLoading = isOpen && !contractLine;

  // Memoize the contract line details content to prevent unnecessary re-renders
  const contractLineContent = useMemo(() => {
    if (!contractLine) return null;
    
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-500">{t('contractLine.name')}</p>
            <p className="mt-1">{contractLine.contract_line_name}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">{t('contractLine.frequency')}</p>
            <p className="mt-1">{t(`frequency.${contractLine.billing_frequency?.toLowerCase() || 'monthly'}`, { defaultValue: contractLine.billing_frequency || 'Monthly' })}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">{t('contractLine.startDate')}</p>
            <p className="mt-1">{formatDate(contractLine.start_date)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">{t('contractLine.endDate')}</p>
            <p className="mt-1">{contractLine.end_date ? formatDate(contractLine.end_date) : t('contractLine.noEndDate')}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">{t('contractLine.status')}</p>
            <Badge variant={contractLine.is_active ? 'success' : 'error'} className="mt-1">
              {contractLine.is_active ? tCommon('common.active') : tCommon('common.inactive')}
            </Badge>
          </div>
          {contractLine.custom_rate !== undefined && (
            <div>
              <p className="text-sm font-medium text-gray-500">{t('contractLine.customRate')}</p>
              <p className="mt-1">{formatCurrency(contractLine.custom_rate, contractLine.currency_code)}</p>
            </div>
          )}
          {(contractLine.service_category_name || contractLine.service_category) && (
            <div>
              <p className="text-sm font-medium text-gray-500">{t('contractLine.serviceCategory')}</p>
              <p className="mt-1">{contractLine.service_category_name || contractLine.service_category}</p>
            </div>
          )}
        </div>

        <div className="mt-4">
          <p className="text-sm text-gray-500">
            {t('contractLine.statusDescription', {
              status: contractLine.is_active ? tCommon('common.active').toLowerCase() : tCommon('common.inactive').toLowerCase(),
              expiry: contractLine.end_date ? t('contractLine.expiresOn', { date: formatDate(contractLine.end_date) }) : t('contractLine.noExpiry')
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
      title={t('contractLine.detailsTitle')}
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
          {tCommon('common.close')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
});

// Add display name for debugging
ContractLineDetailsDialog.displayName = 'ContractLineDetailsDialog';

export default ContractLineDetailsDialog;
