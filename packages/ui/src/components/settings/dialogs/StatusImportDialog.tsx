'use client';

import React from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import type { IStandardStatus } from '@alga-psa/types';

interface StatusImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableStatuses: IStandardStatus[];
  selectedStatuses: string[];
  onSelectionChange: (statusId: string) => void;
  onImport: () => void;
}

export const StatusImportDialog: React.FC<StatusImportDialogProps> = ({
  open,
  onOpenChange,
  availableStatuses,
  selectedStatuses,
  onSelectionChange,
  onImport
}) => {
  const toggleSelectAll = () => {
    if (selectedStatuses.length === availableStatuses.length) {
      // Deselect all
      availableStatuses.forEach(status => {
        if (selectedStatuses.includes(status.standard_status_id)) {
          onSelectionChange(status.standard_status_id);
        }
      });
    } else {
      // Select all
      availableStatuses.forEach(status => {
        if (!selectedStatuses.includes(status.standard_status_id)) {
          onSelectionChange(status.standard_status_id);
        }
      });
    }
  };

  return (
    <Dialog 
      isOpen={open} 
      onClose={() => onOpenChange(false)}
      title="Import Standard Statuses"
      className="max-w-2xl"
      id="import-status-dialog"
    >
      <DialogContent>
        <div className="flex flex-col h-full">
          <p className="text-sm text-gray-500 mb-4">
            Select the standard statuses you want to import
          </p>
          
          <div className="flex items-center justify-between py-3 border-b">
            <div className="flex items-center space-x-2">
              <Checkbox
                checked={selectedStatuses.length === availableStatuses.length && availableStatuses.length > 0}
                onChange={toggleSelectAll}
                id="select-all"
              />
              <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                Select All ({selectedStatuses.length}/{availableStatuses.length})
              </label>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto py-4">
            <div className="space-y-3">
              {availableStatuses.map((status) => (
                <div
                  key={status.standard_status_id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      checked={selectedStatuses.includes(status.standard_status_id)}
                      onChange={() => onSelectionChange(status.standard_status_id)}
                      id={`status-${status.standard_status_id}`}
                    />
                    <label
                      htmlFor={`status-${status.standard_status_id}`}
                      className="cursor-pointer flex-1"
                    >
                      <div>
                        <span className="font-medium">{status.name}</span>
                      </div>
                    </label>
                  </div>
                  <div className="flex gap-2">
                    {status.is_closed && (
                      <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-md">
                        Closed
                      </span>
                    )}
                    {status.is_default && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-md">
                        Default
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {availableStatuses.length === 0 && (
                <p className="text-center text-gray-500 py-8">
                  No standard statuses available for import
                </p>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
            <Button
              id="cancel-import-button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              id="confirm-import-button"
              onClick={onImport}
              disabled={selectedStatuses.length === 0}
              className="bg-primary-500 text-white hover:bg-primary-600"
            >
              Import Selected ({selectedStatuses.length})
            </Button>
      </DialogFooter>
    </Dialog>
  );
};
