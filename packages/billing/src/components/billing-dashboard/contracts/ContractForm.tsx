'use client';

import React, { useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Save } from 'lucide-react';
import { IContract } from '@alga-psa/types';
import { updateContract } from '@alga-psa/billing/actions/contractActions';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { CURRENCY_OPTIONS } from '@alga-psa/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useBillingFrequencyOptions } from '@alga-psa/billing/hooks/useBillingEnumOptions';

interface ContractFormProps {
  contract: IContract;
  onContractUpdated: () => void;
}

const ContractForm: React.FC<ContractFormProps> = ({ contract, onContractUpdated }) => {
  const { t } = useTranslation('msp/contracts');
  const billingFrequencyOptions = useBillingFrequencyOptions();
  const [contractName, setContractName] = useState(contract.contract_name);
  const [description, setDescription] = useState(contract.contract_description ?? '');
  const [status, setStatus] = useState<string>(contract.status);
  const [billingFrequency, setBillingFrequency] = useState(contract.billing_frequency);
  const [currencyCode, setCurrencyCode] = useState(contract.currency_code || 'USD');
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
      errors.push(t('contractForm.validation.contractName', { defaultValue: 'Contract name' }));
    }
    if (!billingFrequency) {
      errors.push(t('contractForm.validation.billingFrequency', { defaultValue: 'Billing frequency' }));
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
        currency_code: currencyCode,
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
      const errorMessage = error instanceof Error
        ? error.message
        : t('contractForm.errors.failedToUpdateContract', { defaultValue: 'Failed to update contract' });
      setValidationErrors([errorMessage]);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card size="2">
      <Box p="4">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <h3 className="text-lg font-medium mb-4">
            {t('contractForm.heading', { defaultValue: 'Contract Details' })}
          </h3>

          {hasAttemptedSubmit && validationErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-medium mb-2">
                  {t('contractForm.validation.requiredFields', { defaultValue: 'Please fill in the required fields:' })}
                </p>
                <ul className="list-disc list-inside space-y-1">
                  {validationErrors.map((err, index) => (
                    <li key={index}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label htmlFor="contract-name">
              {t('contractForm.fields.contractName', { defaultValue: 'Contract Name' })} *
            </Label>
            <Input
              id="contract-name"
              value={contractName}
              onChange={(e) => {
                setContractName(e.target.value);
                clearErrorIfSubmitted();
              }}
              placeholder={t('contractForm.fields.contractNamePlaceholder', { defaultValue: 'Enter contract name' })}
              required
              className={hasAttemptedSubmit && !contractName.trim() ? 'border-red-500' : ''}
            />
          </div>

          <div>
            <Label htmlFor="description">{t('contractForm.fields.description', { defaultValue: 'Description' })}</Label>
            <TextArea
              id="description"
              value={description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
              placeholder={t('contractForm.fields.descriptionPlaceholder', { defaultValue: 'Enter contract description' })}
              className="min-h-[100px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="billing-frequency">
                {t('contractForm.fields.billingFrequency', { defaultValue: 'Billing Frequency' })} *
              </Label>
              <CustomSelect
                id="billing-frequency"
                value={billingFrequency}
                onValueChange={(value) => {
                  setBillingFrequency(value);
                  clearErrorIfSubmitted();
                }}
                options={billingFrequencyOptions}
                placeholder={t('contractForm.fields.billingFrequencyPlaceholder', { defaultValue: 'Select billing frequency' })}
                className={hasAttemptedSubmit && !billingFrequency ? 'ring-1 ring-red-500' : ''}
              />
            </div>
            <div>
              <Label htmlFor="currency-code">{t('contractForm.fields.currency', { defaultValue: 'Currency' })}</Label>
              <CustomSelect
                id="currency-code"
                value={currencyCode}
                onValueChange={setCurrencyCode}
                options={CURRENCY_OPTIONS}
                placeholder={t('contractForm.fields.currencyPlaceholder', { defaultValue: 'Select currency' })}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="status">{t('contractForm.fields.status', { defaultValue: 'Status' })}</Label>
            <CustomSelect
              id="status"
              value={status}
              onValueChange={(value) => setStatus(value)}
              options={[
                { value: 'active', label: t('contractForm.status.active', { defaultValue: 'Active' }) },
                { value: 'draft', label: t('contractForm.status.draft', { defaultValue: 'Draft' }) },
                { value: 'terminated', label: t('contractForm.status.terminated', { defaultValue: 'Terminated' }) },
                ...(contract.status === 'expired'
                  ? [{ value: 'expired', label: t('contractForm.status.expired', { defaultValue: 'Expired' }) }]
                  : [])
              ]}
              disabled={contract.status === 'expired'}
            />
            {contract.status === 'expired' && (
              <p className="text-xs text-muted-foreground mt-1">
                {t('contractForm.status.expiredHelper', {
                  defaultValue: 'Expired contracts cannot be changed to another status',
                })}
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
              {isSaving
                ? t('contractForm.actions.saving', { defaultValue: 'Saving...' })
                : t('contractForm.actions.saveChanges', { defaultValue: 'Save Changes' })}
              {!isSaving && <Save className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        </form>
      </Box>
    </Card>
  );
};

export default ContractForm;
