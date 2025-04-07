'use client'

import React, { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
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
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [showValidationSummary, setShowValidationSummary] = useState(false);
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

  // Validate form
  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (!bundleName.trim()) {
      errors.bundleName = 'Bundle name is required';
    }

    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate form
    const errors = validateForm();
    setValidationErrors(errors);

    if (Object.keys(errors).length > 0) {
      setShowValidationSummary(true);
      return;
    }

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
      // Handle error (e.g., show error message to user)
    }
  };

  const resetForm = () => {
    setBundleName('');
    setBundleDescription(''); // Use renamed state setter
    setIsActive(true);
  };

  const handleClose = () => {
    resetForm();
    setOpen(false);
    if (onClose) {
      onClose();
    }
  };

  return (
    <Dialog.Root
      open={open || !!editingBundle}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          handleClose();
        } else if (editingBundle) {
          setBundleName(editingBundle.bundle_name);
          setBundleDescription(editingBundle.bundle_description || ''); // Use renamed state setter and field
          setIsActive(editingBundle.is_active);
        }
        setOpen(isOpen);
      }}
    >
      {triggerButton && (
        <Dialog.Trigger asChild>
          {triggerButton}
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[500px] max-h-[90vh] overflow-y-auto">
          <Dialog.Title className="text-lg font-medium text-gray-900 mb-2">
            {editingBundle ? 'Edit Plan Bundle' : 'Add New Plan Bundle'}
            {showValidationSummary && Object.keys(validationErrors).length > 0 && (
              <Alert variant="destructive" className="mt-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Please fix the following errors:
                  <ul className="list-disc pl-5 mt-1 text-sm">
                    {Object.entries(validationErrors).map(([field, message]) => (
                      <li key={field}>{message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </Dialog.Title>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="bundle-name">Bundle Name</Label>
              <Input
                id="bundle-name"
                type="text"
                value={bundleName}
                onChange={(e) => setBundleName(e.target.value)}
                placeholder="Enter bundle name"
                required
                className={validationErrors.bundleName ? 'border-red-500' : ''}
              />
              {validationErrors.bundleName && (
                <p className="text-red-500 text-xs mt-1">{validationErrors.bundleName}</p>
              )}
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
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="is-active"
                checked={isActive}
                onChange={(checked) => setIsActive(!!checked)}
              />
              <Label htmlFor="is-active" className="cursor-pointer">Active</Label>
            </div>
            
            <div className="flex justify-end gap-2 pt-4">
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
              >
                {editingBundle ? 'Update Bundle' : 'Create Bundle'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}