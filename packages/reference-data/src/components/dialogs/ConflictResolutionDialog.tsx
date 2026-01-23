'use client';

import React from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import type { ImportConflict } from '@alga-psa/reference-data/actions';
import { AlertCircle } from 'lucide-react';

interface ConflictResolutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: ImportConflict[];
  resolutions: Record<string, { 
    action: 'skip' | 'rename' | 'reorder', 
    newName?: string, 
    newOrder?: number 
  }>;
  onResolutionChange: (itemId: string, resolution: { 
    action: 'skip' | 'rename' | 'reorder', 
    newName?: string, 
    newOrder?: number 
  }) => void;
  onResolve: () => void;
  onCancel: () => void;
}

export const ConflictResolutionDialog: React.FC<ConflictResolutionDialogProps> = ({
  open,
  onOpenChange,
  conflicts,
  resolutions,
  onResolutionChange,
  onResolve,
  onCancel
}) => {
  const handleActionChange = (index: number, action: 'skip' | 'rename' | 'reorder') => {
    const conflict = conflicts[index];
    if (!conflict) return;
    
    const itemId = conflict.referenceItem?.standard_status_id || conflict.referenceItem?.name || `conflict_${index}`;
    const itemName = conflict.referenceItem?.name || 'Unknown';
    const existingOrder = conflict.existingItem?.order_number || conflict.existingItem?.display_order || 0;

    const resolution: any = { action };
    
    if (action === 'rename') {
      resolution.newName = resolutions[itemId]?.newName || `${itemName}_imported`;
    } else if (action === 'reorder') {
      resolution.newOrder = resolutions[itemId]?.newOrder || existingOrder + 1;
    }
    
    onResolutionChange(itemId, resolution);
  };

  const handleNameChange = (index: number, newName: string) => {
    const conflict = conflicts[index];
    const itemId = conflict.referenceItem?.standard_status_id || conflict.referenceItem?.name || `conflict_${index}`;
    const currentResolution = resolutions[itemId] || { action: 'rename' };
    onResolutionChange(itemId, {
      ...currentResolution,
      action: 'rename',
      newName
    });
  };

  const handleOrderChange = (index: number, newOrder: number) => {
    const conflict = conflicts[index];
    const itemId = conflict.referenceItem?.standard_status_id || conflict.referenceItem?.name || `conflict_${index}`;
    const currentResolution = resolutions[itemId] || { action: 'reorder' };
    onResolutionChange(itemId, {
      ...currentResolution,
      action: 'reorder',
      newOrder
    });
  };

  return (
    <Dialog 
      isOpen={open} 
      onClose={() => onOpenChange(false)}
      title="Resolve Import Conflicts"
      className="max-w-3xl"
      id="conflict-resolution-dialog"
    >
      <DialogContent>
        <div className="flex flex-col h-full">
          <div className="pb-4 border-b">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              <p className="text-sm text-gray-500">
                Some items already exist. Choose how to handle each conflict.
              </p>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto py-4">
            <div className="space-y-6">
              {conflicts.map((conflict, index) => {
                const itemId = conflict.referenceItem?.standard_status_id || conflict.referenceItem?.name || `conflict_${index}`;
                const itemName = conflict.referenceItem?.name || 'Unknown';
                const existingOrder = conflict.existingItem?.order_number || conflict.existingItem?.display_order || 0;
                const resolution = resolutions[itemId] || { action: 'skip' };
                
                return (
                  <div key={itemId} className="border rounded-lg p-4">
                    <div className="mb-3">
                      <h3 className="font-medium text-sm">
                        {itemName}
                      </h3>
                      <p className="text-xs text-gray-500 mt-1">
                        Conflict: {conflict.conflictType === 'name' ? 'Name already exists' : 
                                  conflict.conflictType === 'order' ? `Order ${existingOrder} already taken` :
                                  'Item already exists'}
                      </p>
                    </div>
                    
                    <div className="space-y-3">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`conflict-${itemId}`}
                          value="skip"
                          checked={resolution.action === 'skip'}
                          onChange={() => handleActionChange(index, 'skip')}
                          className="w-4 h-4"
                        />
                        <span className="font-normal">Skip this item</span>
                      </label>
                      
                      {conflict.conflictType === 'name' && (
                        <div className="space-y-2">
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`conflict-${itemId}`}
                              value="rename"
                              checked={resolution.action === 'rename'}
                              onChange={() => handleActionChange(index, 'rename')}
                              className="w-4 h-4"
                            />
                            <span className="font-normal">Import with a different name</span>
                          </label>
                          {resolution.action === 'rename' && (
                            <div className="ml-6">
                              <Input
                                value={resolution.newName || `${itemName}_imported`}
                                onChange={(e) => handleNameChange(index, e.target.value)}
                                placeholder="Enter new name"
                                className="max-w-xs"
                              />
                            </div>
                          )}
                        </div>
                      )}
                      
                      {conflict.conflictType === 'order' && (
                        <div className="space-y-2">
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`conflict-${itemId}`}
                              value="reorder"
                              checked={resolution.action === 'reorder'}
                              onChange={() => handleActionChange(index, 'reorder')}
                              className="w-4 h-4"
                            />
                            <span className="font-normal">Import with a different order</span>
                          </label>
                          {resolution.action === 'reorder' && (
                            <div className="ml-6">
                              <Input
                                type="number"
                                value={resolution.newOrder || existingOrder + 1}
                                onChange={(e) => handleOrderChange(index, parseInt(e.target.value) || 0)}
                                placeholder="Enter new order"
                                className="max-w-xs"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
            <Button
              id="cancel-conflict-button"
              variant="outline"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              id="apply-resolutions-button"
              onClick={onResolve}
              className="bg-primary-500 text-white hover:bg-primary-600"
            >
              Apply Resolutions
            </Button>
      </DialogFooter>
    </Dialog>
  );
};
