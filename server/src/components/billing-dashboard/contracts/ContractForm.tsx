'use client';

import React, { useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Save } from 'lucide-react';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { updateContract } from '@product/actions/contractActions';
import { useTenant } from 'server/src/components/TenantProvider';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';

interface ContractFormProps {
  contract: IContract;
  onContractUpdated: () => void;
}

const ContractForm: React.FC<ContractFormProps> = ({ contract, onContractUpdated }) => {
  const [contractName, setContractName] = useState(contract.contract_name);
  const [description, setDescription] = useState(contract.contract_description ?? '');
  const [status, setStatus] = useState<string>(contract.status);
  const [billingFrequency, setBillingFrequency] = useState(contract.billing_frequency);
  const [isSaving, setIsSaving] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const tenant = useTenant()!;

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    const errors: string[] = [];
    if (!contractName.trim()) {
      errors.push('Contract name');
    }
    if (!billingFrequency) {
      errors.push('Billing frequency');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    setIsSaving(true);

    try {
      const updatePayload: any = {
        contract_name: contractName,
        contract_description: description || undefined,
        billing_frequency: billingFrequency,
        tenant
      };

      // Only include status if the contract is not expired
      // Expired contracts cannot have their status changed manually
      if (contract.status !== 'expired') {
        updatePayload.status = status;
      }

      await updateContract(contract.contract_id, updatePayload);

      onContractUpdated();
    } catch (error) {
      console.error('Error updating contract:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to update contract';
      setValidationErrors([errorMessage]);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card size="2">
      <Box p="4">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <h3 className="text-lg font-medium mb-4">Contract Details</h3>

          {hasAttemptedSubmit && validationErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-medium mb-2">Please fill in the required fields:</p>
                <ul className="list-disc list-inside space-y-1">
                  {validationErrors.map((err, index) => (
                    <li key={index}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label htmlFor="contract-name">Contract Name *</Label>
            <Input
              id="contract-name"
              value={contractName}
              onChange={(e) => {
                setContractName(e.target.value);
                clearErrorIfSubmitted();
              }}
              placeholder="Enter contract name"
              required
              className={hasAttemptedSubmit && !contractName.trim() ? 'border-red-500' : ''}
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <TextArea
              id="description"
              value={description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
              placeholder="Enter contract description"
              className="min-h-[100px]"
            />
          </div>

          <div>
            <Label htmlFor="billing-frequency">Billing Frequency *</Label>
            <CustomSelect
              id="billing-frequency"
              value={billingFrequency}
              onValueChange={(value) => {
                setBillingFrequency(value);
                clearErrorIfSubmitted();
              }}
              options={BILLING_FREQUENCY_OPTIONS}
              placeholder="Select billing frequency"
              className={hasAttemptedSubmit && !billingFrequency ? 'ring-1 ring-red-500' : ''}
            />
          </div>

          <div>
            <Label htmlFor="status">Status</Label>
            <CustomSelect
              id="status"
              value={status}
              onValueChange={(value) => setStatus(value)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'draft', label: 'Draft' },
                { value: 'terminated', label: 'Terminated' },
                ...(contract.status === 'expired' ? [{ value: 'expired', label: 'Expired' }] : [])
              ]}
              disabled={contract.status === 'expired'}
            />
            {contract.status === 'expired' && (
              <p className="text-xs text-gray-500 mt-1">
                Expired contracts cannot be changed to another status
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              id="save-contract-details-btn"
              type="submit"
              disabled={isSaving}
              className={!contractName.trim() || !billingFrequency ? 'opacity-50' : ''}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
              {!isSaving && <Save className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </form>
      </Box>
    </Card>
  );
};

export default ContractForm;
