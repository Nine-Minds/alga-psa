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

interface PlanBundleDialogProps {
  onBundleAdded: () => void;
  editingBundle?: IPlanBundle | null;
  onClose?: () => void;
  triggerButton?: React.ReactNode;
}

export function PlanBundleDialog({ onBundleAdded, editingBundle, onClose, triggerButton }: PlanBundleDialogProps) {
  const [open, setOpen] = useState(false);
  const [bundleName, setBundleName] = useState(editingBundle?.bundle_name || '');
  const [bundleDescription, setBundleDescription] = useState(editingBundle?.bundle_description || ''); // Renamed state and field
  const [isActive, setIsActive] = useState<boolean>(editingBundle?.is_active ?? true);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const tenant = useTenant()!;

  // Update form when editingBundle changes
  useEffect(() => {
    if (editingBundle) {
      setBundleName(editingBundle.bundle_name);
      setBundleDescription(editingBundle.bundle_description || ''); // Use renamed state setter and field
      setIsActive(editingBundle.is_active);
      setOpen(true);
    }
  }, [editingBundle]);

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
    if (!bundleName.trim()) {
      errors.push('Bundle name');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    setValidationErrors([]);

    try {
      const bundleData = {
        bundle_name: bundleName,
        bundle_description: bundleDescription || undefined, // Use renamed state variable and field key
        is_active: isActive,
        tenant: tenant
      };

      if (editingBundle?.bundle_id) {
        await updatePlanBundle(editingBundle.bundle_id, bundleData);
      } else {
        await createPlanBundle(bundleData);
      }

      // Clear form fields and close dialog
      resetForm();
      setOpen(false);
      onBundleAdded();
      if (onClose) {
        onClose();
      }
    } catch (error) {
      console.error('Error saving plan bundle:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to save plan bundle';
      setValidationErrors([errorMessage]);
    }
  };

  const resetForm = () => {
    setBundleName('');
    setBundleDescription(''); // Use renamed state setter
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
          if (editingBundle) {
            setBundleName(editingBundle.bundle_name);
            setBundleDescription(editingBundle.bundle_description || '');
            setIsActive(editingBundle.is_active);
          }
          setOpen(true);
        }}>
          {triggerButton}
        </div>
      )}
      <Dialog
        isOpen={open || !!editingBundle}
        onClose={handleClose}
        title={editingBundle ? 'Edit Plan Bundle' : 'Add New Plan Bundle'}
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
              <Label htmlFor="bundle-name">Bundle Name *</Label>
              <Input
                id="bundle-name"
                type="text"
                value={bundleName}
                onChange={(e) => {
                  setBundleName(e.target.value);
                  clearErrorIfSubmitted();
                }}
                placeholder="Enter bundle name"
                required
                className={hasAttemptedSubmit && !bundleName.trim() ? 'border-red-500' : ''}
              />
            </div>
            
            <div>
              <Label htmlFor="bundle_description">Description</Label>
              <TextArea
                id="bundle_description" // Update id
                value={bundleDescription} // Use renamed state variable
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBundleDescription(e.target.value)} // Use renamed state setter
                placeholder="Enter bundle description"
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
                id="cancel-bundle-btn"
                type="button"
                variant="outline"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                id="save-bundle-btn"
                type="submit"
                className={!bundleName.trim() ? 'opacity-50' : ''}
              >
                {editingBundle ? 'Update Bundle' : 'Create Bundle'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}