'use client'

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { createPlanBundle, updatePlanBundle } from 'server/src/lib/actions/planBundleActions';
import { useTenant } from 'server/src/components/TenantProvider';

interface ContractDialogProps {
  onContractAdded: () => void;
  editingContract?: IPlanBundle | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
}

export function ContractDialog({ onContractAdded, editingContract, onClose, triggerButton }: ContractDialogProps) {
  const [open, setOpen] = useState(false);
  const [contractName, setContractName] = useState(editingContract?.bundle_name || '');
  const [contractDescription, setContractDescription] = useState(editingContract?.bundle_description || '');
  const [isActive, setIsActive] = useState<boolean>(editingContract?.is_active ?? true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const tenant = useTenant()!;

  // Update form when editingContract changes
  useEffect(() => {
    if (editingContract) {
      setContractName(editingContract.bundle_name);
      setContractDescription(editingContract.bundle_description || '');
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
      const bundleData = {
        bundle_name: contractName,
        bundle_description: contractDescription || undefined,
        is_active: isActive,
        tenant: tenant
      };

      if (editingContract?.bundle_id) {
        await updatePlanBundle(editingContract.bundle_id, bundleData);
      } else {
        await createPlanBundle(bundleData);
      }

      // Clear form fields and close dialog
      resetForm();
      setOpen(false);
      onContractAdded();
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
            setContractName(editingContract.bundle_name);
            setContractDescription(editingContract.bundle_description || '');
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
              <Label htmlFor="contract_description">Description</Label>
              <TextArea
                id="contract_description"
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