'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { createContract, updateContract } from 'server/src/lib/actions/contractActions';
import { useTenant } from 'server/src/components/TenantProvider';
import CustomSelect from 'server/src/components/ui/CustomSelect';

interface ContractDialogProps {
  onContractSaved: () => void;
  editingContract?: IContract | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
}

export function ContractDialog({ onContractSaved, editingContract, onClose, triggerButton }: ContractDialogProps) {
  const [open, setOpen] = useState(false);
  const [contractName, setContractName] = useState(editingContract?.contract_name ?? '');
  const [contractDescription, setContractDescription] = useState(editingContract?.contract_description ?? '');
  const [billingFrequency, setBillingFrequency] = useState(editingContract?.billing_frequency ?? 'monthly');
  const [isActive, setIsActive] = useState<boolean>(editingContract?.is_active ?? true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const tenant = useTenant()!;

  useEffect(() => {
    if (editingContract) {
      setContractName(editingContract.contract_name);
      setContractDescription(editingContract.contract_description ?? '');
      setBillingFrequency(editingContract.billing_frequency);
      setIsActive(editingContract.is_active);
      setOpen(true);
    }
  }, [editingContract]);

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    // Validate form
    const errors: string[] = [];
    if (!contractName.trim()) {
      errors.push('Contract name');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    setValidationErrors([]);

    try {
      const contractData = {
        contract_name: contractName,
        contract_description: contractDescription || undefined,
        billing_frequency: billingFrequency,
        is_active: isActive,
        tenant: tenant
      };

      if (editingContract?.contract_id) {
        await updateContract(editingContract.contract_id, contractData);
      } else {
        await createContract(contractData);
      }

      resetForm();
      setOpen(false);
      onContractSaved();
      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error('Error saving contract:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save contract';
      setValidationErrors([errorMessage]);
    }
  };

  const resetForm = () => {
    setContractName('');
    setContractDescription('');
    setBillingFrequency('monthly');
    setIsActive(true);
    setHasAttemptedSubmit(false);
    setValidationErrors([]);
  };

  const handleClose = () => {
    resetForm();
    setOpen(false);
    if (onClose) {
      onClose();
    }
  };

  return (
    <>
      {triggerButton && (
        <div onClick={() => {
          if (editingContract) {
            setContractName(editingContract.contract_name);
            setContractDescription(editingContract.contract_description ?? '');
            setIsActive(editingContract.is_active);
          }
          setOpen(true);
        }}>
          {triggerButton}
        </div>
      )}
      <Dialog
        isOpen={open || !!editingContract}
        onClose={handleClose}
        title={editingContract ? 'Edit Contract' : 'Add New Contract'}
        className="max-w-lg"
      >
        <DialogContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive" className="mb-4">
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
                type="text"
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
              <Label htmlFor="contract-description">Description</Label>
              <TextArea
                id="contract-description"
                value={contractDescription}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContractDescription(e.target.value)}
                placeholder="Enter contract description"
                className="min-h-[100px]"
              />
            </div>
            
            <SwitchWithLabel
              label="Active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
            
            <DialogFooter>
              <Button
                id="cancel-contract-btn"
                type="button"
                variant="outline"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                id="save-contract-btn"
                type="submit"
                className={!contractName.trim() ? 'opacity-50' : ''}
              >
                {editingContract ? 'Update Contract' : 'Create Contract'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
