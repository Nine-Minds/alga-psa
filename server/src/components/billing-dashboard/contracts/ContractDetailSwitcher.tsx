'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { getContractById } from 'server/src/lib/actions/contractActions';
import ContractTemplateDetail from './ContractTemplateDetail';
import ContractDetail from './ContractDetail';
import { getClientContractById } from 'server/src/lib/actions/client-actions/clientContractActions';

type ViewMode = 'loading' | 'template' | 'client' | 'error';

const ContractDetailSwitcher: React.FC = () => {
  const searchParams = useSearchParams();
  const contractId = searchParams?.get('contractId') ?? null;
  const clientContractId = searchParams?.get('clientContractId') ?? null;

  const [viewMode, setViewMode] = useState<ViewMode>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const resolveContractType = async () => {
      if (!contractId) {
        if (isMounted) {
          setViewMode('error');
          setError('Missing contract identifier');
        }
        return;
      }

      if (isMounted) {
        setViewMode('loading');
        setError(null);
      }

      try {
        if (clientContractId) {
          const clientContract = await getClientContractById(clientContractId);
          if (!isMounted) {
            return;
          }
          if (clientContract && clientContract.contract_id === contractId) {
            setViewMode('client');
            return;
          }
        }

        const contract = await getContractById(contractId);

        if (!isMounted) {
          return;
        }

        if (!contract) {
          setViewMode('error');
          setError('Contract not found');
          return;
        }

        setViewMode(contract.is_template ? 'template' : 'client');
      } catch (contractError) {
        console.error('Failed to determine contract type', contractError);
        if (isMounted) {
          setViewMode('error');
          setError('Unable to load contract details');
        }
      }
    };

    void resolveContractType();

    return () => {
      isMounted = false;
    };
  }, [contractId, clientContractId]);

  if (!contractId) {
    return (
      <Alert variant="destructive">
        <AlertDescription>No contract selected.</AlertDescription>
      </Alert>
    );
  }

  if (viewMode === 'loading') {
    return (
      <div className="p-6">
        <LoadingIndicator
          className="py-12 text-gray-600"
          layout="stacked"
          spinnerProps={{ size: 'md' }}
          text="Loading contract..."
        />
      </div>
    );
  }

  if (viewMode === 'error') {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{error ?? 'Failed to load contract details'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return viewMode === 'template' ? <ContractTemplateDetail /> : <ContractDetail />;
};

export default ContractDetailSwitcher;
