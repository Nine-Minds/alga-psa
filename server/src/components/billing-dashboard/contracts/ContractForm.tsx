'use client';

import React, { useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Save } from 'lucide-react';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { updatePlanBundle } from 'server/src/lib/actions/planBundleActions';
import { useTenant } from 'server/src/components/TenantProvider';

interface ContractFormProps {
  bundle: IPlanBundle;
  onBundleUpdated: () => void;
}

const ContractForm: React.FC<ContractFormProps> = ({ bundle, onBundleUpdated }) => {
  const [contractName, setContractName] = useState(bundle.bundle_name);
  const [description, setDescription] = useState(bundle.bundle_description || '');
  const [isActive, setIsActive] = useState<boolean>(bundle.is_active);
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

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    setIsSaving(true);

    try {
      await updatePlanBundle(bundle.bundle_id, {
        bundle_name: contractName,
        bundle_description: description || undefined,
        is_active: isActive,
        tenant
      });

      onBundleUpdated();
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

          <div className="flex items-center space-x-2">
            <Checkbox
              id="is-active"
              checked={isActive}
              onChange={(checked) => setIsActive(!!checked)}
            />
            <Label htmlFor="is-active" className="cursor-pointer">Active</Label>
          </div>

          <div className="flex justify-end">
            <Button
              id="save-contract-details-btn"
              type="submit"
              disabled={isSaving}
              className={!contractName.trim() ? 'opacity-50' : ''}
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