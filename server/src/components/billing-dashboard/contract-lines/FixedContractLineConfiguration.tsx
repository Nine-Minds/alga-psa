// server/src/components/billing-dashboard/FixedContractLineConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { ContractLineDialog } from '../ContractLineDialog';
import Spinner from 'server/src/components/ui/Spinner';
import { getServices } from 'server/src/lib/actions/serviceActions';
import {
  getContractLineById
} from 'server/src/lib/actions/contractLineAction';
import { getContractLineServices } from 'server/src/lib/actions/contractLineServiceActions';
import { IService, IContractLine } from 'server/src/interfaces/billing.interfaces';
import FixedContractLineServicesList from '../FixedContractLineServicesList'; // Import the actual component

interface FixedContractLineConfigurationProps {
  contractLineId: string;
  className?: string;
}

export function FixedContractLineConfiguration({
  contractLineId,
  className = '',
}: FixedContractLineConfigurationProps) {
  const [contractLine, setContractLine] = useState<IContractLine | null>(null);

  const [services, setServices] = useState<IService[]>([]);
  const [contractLineLoading, setContractLineLoading] = useState(true);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContractLineData = useCallback(async () => {
    setContractLineLoading(true);
    setError(null);
    try {
      // Fetch the basic contract line data
      const fetchedContractLine = await getContractLineById(contractLineId);
      if (fetchedContractLine && fetchedContractLine.contract_line_type === 'Fixed') {
        setContractLine(fetchedContractLine);
      } else {
        setError('Invalid contract line type or contract line not found.');
      }
    } catch (err) {
      console.error('Error fetching contract line data:', err);
      setError('Failed to load contract line configuration. Please try again.');
    } finally {
      setContractLineLoading(false);
    }
  }, [contractLineId]);

  useEffect(() => {
    fetchContractLineData();
  }, [fetchContractLineData]);


  if (contractLineLoading && !contractLine) {
    return <div className="flex justify-center items-center p-8"><Spinner size="sm" /></div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className={`m-4 ${className}`}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!contractLine) {
      return <div className="p-4">Contract line not found or invalid type.</div>; // Should not happen if error handling is correct
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>Edit Contract Line: {contractLine?.contract_line_name || '...'} (Fixed)</CardTitle>
          {contractLine && (
            <ContractLineDialog
              editingContractLine={contractLine}
              onContractLineAdded={() => fetchContractLineData()}
              triggerButton={<Button id="edit-contract-line-basics-button" variant="outline" size="sm">Edit Contract Line Basics</Button>}
              allServiceTypes={[]}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Base rate and proration settings are configured in the contract line basics above. Use the "Edit Contract Line Basics" button to modify these settings.
          </p>
        </CardContent>
      </Card>

      {/* Services List */}
      <Card>
          <CardHeader>
              <CardTitle>Associated Services</CardTitle>
          </CardHeader>
          <CardContent>
              <FixedContractLineServicesList
                  contractLineId={contractLineId}
                  onServiceAdded={() => {
                      // Refresh the contract line data when a service is added
                      fetchContractLineData();
                  }}
              />
          </CardContent>
      </Card>
    </div>
  );
}