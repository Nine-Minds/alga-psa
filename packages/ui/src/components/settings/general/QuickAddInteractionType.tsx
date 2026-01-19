'use client'

import React, { useState, useEffect } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { IconPicker, getIconComponent } from '@alga-psa/ui/components/IconPicker';
import { createInteractionType, updateInteractionType, getAllInteractionTypes } from '@alga-psa/clients/actions';
import { IInteractionType } from '@alga-psa/types';

interface QuickAddInteractionTypeProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingType?: IInteractionType | null;
}

export const QuickAddInteractionType: React.FC<QuickAddInteractionTypeProps> = ({
  isOpen,
  onClose,
  onSuccess,
  editingType
}) => {
  const [typeName, setTypeName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState<string>('');
  const [displayOrder, setDisplayOrder] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Populate form when editing or get next order for new
  useEffect(() => {
    const loadData = async () => {
      if (editingType) {
        setTypeName(editingType.type_name);
        setSelectedIcon(editingType.icon || '');
        setDisplayOrder(editingType.display_order || 0);
      } else {
        setTypeName('');
        setSelectedIcon('');
        // Get next available order
        try {
          const types = await getAllInteractionTypes();
          const maxOrder = types.reduce((max, t) => Math.max(max, t.display_order || 0), 0);
          setDisplayOrder(maxOrder + 1);
        } catch (error) {
          console.error('Error getting max order:', error);
          setDisplayOrder(1);
        }
      }
    };
    loadData();
  }, [editingType]);

  const handleClose = () => {
    setTypeName('');
    setSelectedIcon('');
    setDisplayOrder(0);
    setError(null);
    setIsLoading(false);
    setHasAttemptedSubmit(false);
    onClose();
  };

  const handleSubmit = async () => {
    setHasAttemptedSubmit(true);
    if (!typeName.trim()) {
      setError('Please enter a name for the interaction type.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const typeData = {
        type_name: typeName.trim(),
        icon: selectedIcon || undefined,
        display_order: displayOrder
      };

      if (editingType) {
        // Update existing type
        await updateInteractionType(editingType.type_id, typeData);
      } else {
        // Create new type
        await createInteractionType(typeData);
      }
      
      onSuccess();
      setHasAttemptedSubmit(false);
      handleClose();
    } catch (error) {
      console.error('Error saving interaction type:', error);
      setError(`Failed to ${editingType ? 'update' : 'create'} interaction type. Please try again.`);
    } finally {
      setIsLoading(false);
    }
  };

  const SelectedIconComponent = selectedIcon ? getIconComponent(selectedIcon) : null;

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={handleClose}
      title={editingType ? "Edit Interaction Type" : "Create Interaction Type"}
      id={editingType ? "edit-interaction-type-dialog" : "add-interaction-type-dialog"}
      className="max-w-xl"
    >
      <div className="space-y-6">
        {/* Error Alert */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Type Name */}
        <div className="space-y-2">
          <Label htmlFor="type-name" className="text-sm font-medium">
            Interaction Type Name: *
          </Label>
          <Input
            id="type-name"
            value={typeName}
            onChange={(e) => setTypeName(e.target.value)}
            placeholder="e.g., 'Client Onboarding Call', 'Sales Demo', 'Project Review'"
            className={`w-full ${hasAttemptedSubmit && !typeName.trim() ? 'border-red-500' : ''}`}
          />
        </div>

        {/* Display Order */}
        <div className="space-y-2">
          <Label htmlFor="display-order" className="text-sm font-medium">
            Display Order:
          </Label>
          <Input
            id="display-order"
            type="number"
            min="1"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(parseInt(e.target.value) || 0)}
            placeholder="e.g., 1, 2, 3..."
            className="w-full"
          />
        </div>

        {/* Icon Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">
            Choose an Icon:
          </Label>
          <IconPicker
            value={selectedIcon}
            onValueChange={setSelectedIcon}
            disabled={isLoading}
          />
        </div>

        {/* Preview */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <h4 className="font-medium text-sm mb-3 text-gray-700">Preview:</h4>
          <div className="flex items-center gap-2">
            {selectedIcon && SelectedIconComponent && (
              <SelectedIconComponent className="h-4 w-4 text-gray-600" />
            )}
            <span className="font-medium">
              {typeName || 'Enter type name above'}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button
            id="cancel-interaction-type"
            variant="outline"
            onClick={handleClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            id={editingType ? "update-interaction-type" : "create-interaction-type"}
            onClick={handleSubmit}
            disabled={isLoading}
            className={`bg-primary-500 text-white hover:bg-primary-600 ${!typeName.trim() ? 'opacity-50' : ''}`}
          >
            {isLoading 
              ? (editingType ? 'Updating...' : 'Creating...') 
              : (editingType ? 'Update Type' : 'Create Type')
            }
          </Button>
        </div>
      </div>
    </Dialog>
  );
};