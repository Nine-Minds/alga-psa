'use client'

import React, { useState, useEffect } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { IconPicker, getIconComponent } from 'server/src/components/ui/IconPicker';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { ISystemInteractionType } from 'server/src/interfaces/interaction.interfaces';
import { createInteractionType } from 'server/src/lib/actions/interactionTypeActions';
import { Info } from 'lucide-react';

interface QuickAddInteractionTypeProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  systemTypes: ISystemInteractionType[];
}

export const QuickAddInteractionType: React.FC<QuickAddInteractionTypeProps> = ({
  isOpen,
  onClose,
  onSuccess,
  systemTypes
}) => {
  const [typeName, setTypeName] = useState('');
  const [selectedSystemType, setSelectedSystemType] = useState<string>('');
  const [selectedIcon, setSelectedIcon] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Get the selected system type details
  const linkedSystemType = systemTypes.find(type => type.type_id === selectedSystemType);

  // Auto-set icon when system type is selected
  useEffect(() => {
    if (linkedSystemType && linkedSystemType.icon && !selectedIcon) {
      setSelectedIcon(linkedSystemType.icon);
    }
  }, [linkedSystemType, selectedIcon]);

  const handleClose = () => {
    setTypeName('');
    setSelectedSystemType('');
    setSelectedIcon('');
    setError(null);
    setIsLoading(false);
    onClose();
  };

  const handleCreate = async () => {
    if (!typeName.trim()) {
      setError('Please enter a name for the interaction type.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const typeData = {
        type_name: typeName.trim(),
        system_type_id: selectedSystemType || undefined,
        icon: selectedIcon || undefined
      };

      await createInteractionType(typeData);
      onSuccess();
      handleClose();
    } catch (error) {
      console.error('Error creating interaction type:', error);
      setError('Failed to create interaction type. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const systemTypeOptions = [
    { value: 'standalone', label: '-- Standalone Custom Type (No Category Link) --' },
    ...systemTypes.map(type => ({
      value: type.type_id,
      label: `${type.type_name} - Link to this standard category`
    }))
  ];

  const SelectedIconComponent = selectedIcon ? getIconComponent(selectedIcon) : null;

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={handleClose}
      title="Create a Custom Interaction Type"
      id="add-interaction-type-dialog"
      className="max-w-2xl"
    >
      <div className="max-h-[70vh] overflow-y-auto p-1">

        <div className="space-y-6">
          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* 1. Custom Type Name */}
          <div className="space-y-2">
            <Label htmlFor="type-name" className="text-sm font-medium">
              New Interaction Type Name:
            </Label>
            <Input
              id="type-name"
              value={typeName}
              onChange={(e) => setTypeName(e.target.value)}
              placeholder="e.g., 'Client Onboarding Call', 'Sales Demo'"
              className="w-full"
            />
          </div>

          {/* 2. Link to Standard Category */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              Choose a Standard Category to Link to:
            </Label>
            <CustomSelect
              options={systemTypeOptions}
              value={selectedSystemType || 'standalone'}
              onValueChange={(value) => setSelectedSystemType(value === 'standalone' ? '' : value)}
              placeholder="Select a category or keep standalone"
            />
            
            {/* Explanatory Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-2">Why link to a standard category?</p>
                  <ul className="space-y-1 text-xs">
                    <li><strong>Improved Reporting:</strong> Group similar interactions (e.g., all 'Call' types) for better insights.</li>
                    <li><strong>Consistent Filtering:</strong> Makes it easier to find related interactions system-wide.</li>
                    <li><strong>Future-Ready:</strong> Aligns your custom type with system features for standard categories.</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Dynamic Confirmation Text */}
            {linkedSystemType && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm text-green-800">
                  <strong>Confirmation:</strong> This means '{typeName || 'Your New Type Name'}' will be treated as a type of '{linkedSystemType.type_name}' for broader reporting and filtering.
                </p>
              </div>
            )}
          </div>

          {/* 3. Assign an Icon */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              Custom Icon:
            </Label>
            <IconPicker
              value={selectedIcon}
              onValueChange={setSelectedIcon}
              disabled={isLoading}
            />
          </div>

          {/* 4. Summary Preview */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-sm mb-3 text-gray-700">Summary Preview:</h4>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gray-600">New Type:</span>
                <span className="font-medium">
                  {typeName || '[Enter type name above]'}
                </span>
                {selectedIcon && SelectedIconComponent && <SelectedIconComponent className="h-4 w-4 text-gray-600" />}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">Linked Category:</span>
                <span className="font-medium">
                  {linkedSystemType ? linkedSystemType.type_name : 'Standalone'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">Icon:</span>
                <span className="font-medium">
                  {selectedIcon ? (
                    <span className="flex items-center gap-1">
                      {selectedIcon && SelectedIconComponent && <SelectedIconComponent className="h-4 w-4 text-gray-600" />}
                      Custom ({selectedIcon})
                    </span>
                  ) : linkedSystemType?.icon ? (
                    `Inherited (${linkedSystemType.icon})`
                  ) : (
                    'Default'
                  )}
                </span>
              </div>
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
              id="create-interaction-type"
              onClick={handleCreate}
              disabled={isLoading || !typeName.trim()}
              className="bg-primary-500 text-white hover:bg-primary-600"
            >
              {isLoading ? 'Creating...' : 'Create Type'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};