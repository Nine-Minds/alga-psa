'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { getContractById } from '@alga-psa/billing/actions/contractActions';
import ContractTemplateDetail from './ContractTemplateDetail';
import ContractDetail from './ContractDetail';
import { getClientContractByIdForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { IClient, IDocument } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type ViewMode = 'loading' | 'template' | 'client' | 'error';

interface ContractDetailSwitcherProps {
  /** Documents fetched server-side when viewing contract documents tab */
  contractDocuments?: IDocument[] | null;
  /** Current user ID fetched server-side */
  currentUserId?: string | null;
  /** Optional injected UI for client quick view. */
  renderClientDetails?: (args: { id: string; client: IClient }) => React.ReactNode;
}

const ContractDetailSwitcher: React.FC<ContractDetailSwitcherProps> = ({
  contractDocuments,
  currentUserId,
  renderClientDetails
}) => {
  const { t } = useTranslation('msp/contracts');
  const router = useRouter();
  const searchParams = useSearchParams();
  const contractId = searchParams?.get('contractId') ?? null;
  const clientContractId = searchParams?.get('clientContractId') ?? null;

  const [viewMode, setViewMode] = useState<ViewMode>('loading');
  const [error, setError] = useState<string | null>(null);
  const [resolvedContractId, setResolvedContractId] = useState<string | null>(contractId);

  useEffect(() => {
    let isMounted = true;

    const resolveContractType = async () => {
      if (!contractId && !clientContractId) {
        if (isMounted) {
          setViewMode('error');
          setError(t('detailSwitcher.errors.missingContractIdentifier', { defaultValue: 'Missing contract identifier' }));
        }
        return;
      }

      if (isMounted) {
        setViewMode('loading');
        setError(null);
      }

      try {
        if (clientContractId) {
          const clientContract = await getClientContractByIdForBilling(clientContractId);
          if (!isMounted) {
            return;
          }
          if (clientContract) {
            setResolvedContractId(clientContract.contract_id);
            if (!contractId) {
              const params = new URLSearchParams(searchParams?.toString() ?? '');
              params.set('tab', 'client-contracts');
              params.set('clientContractId', clientContractId);
              params.set('contractId', clientContract.contract_id);
              router.replace(`/msp/billing?${params.toString()}`, { scroll: false });
            }
            setViewMode('client');
            return;
          }
        }

        if (!contractId) {
          setViewMode('error');
          setError(t('detailSwitcher.errors.contractNotFound', { defaultValue: 'Contract not found' }));
          return;
        }

        const contract = await getContractById(contractId);

        if (!isMounted) {
          return;
        }

        if (!contract) {
          setViewMode('error');
          setError(t('detailSwitcher.errors.contractNotFound', { defaultValue: 'Contract not found' }));
          return;
        }

        setResolvedContractId(contractId);
        setViewMode(contract.is_template ? 'template' : 'client');
      } catch (contractError) {
        console.error('Failed to determine contract type', contractError);
        if (isMounted) {
          setViewMode('error');
          setError(t('detailSwitcher.errors.unableToLoadContractDetails', {
            defaultValue: 'Unable to load contract details',
          }));
        }
      }
    };

    void resolveContractType();

    return () => {
      isMounted = false;
    };
  }, [clientContractId, contractId, router, searchParams, t]);

  if (!contractId && !clientContractId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('detailSwitcher.errors.noContractSelected', { defaultValue: 'No contract selected.' })}</AlertDescription>
      </Alert>
    );
  }

  if (viewMode === 'loading') {
    return (
      <div className="p-6">
        <LoadingIndicator
          className="py-12 text-muted-foreground"
          layout="stacked"
          spinnerProps={{ size: 'md' }}
          text={t('detailSwitcher.loading.contract', { defaultValue: 'Loading contract...' })}
        />
      </div>
    );
  }

  if (viewMode === 'error') {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>
            {error ?? t('detailSwitcher.errors.failedToLoadContractDetails', { defaultValue: 'Failed to load contract details' })}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return viewMode === 'template' ? (
    <ContractTemplateDetail />
  ) : (
    <ContractDetail
      resolvedContractId={resolvedContractId}
      resolvedClientContractId={clientContractId}
      serverDocuments={contractDocuments}
      serverUserId={currentUserId}
      renderClientDetails={renderClientDetails}
    />
  );
};

export default ContractDetailSwitcher;
