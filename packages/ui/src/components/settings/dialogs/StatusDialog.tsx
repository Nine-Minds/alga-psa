'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import type { IStatus, ItemType } from '@alga-psa/types';
import { createStatus, updateStatus } from '@alga-psa/reference-data/actions';
import { toast } from 'react-hot-toast';

interface StatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingStatus: IStatus | null;
  selectedStatusType: ItemType;
  userId: string;
  onSuccess: () => void;
  existingStatuses: IStatus[];
}

export const StatusDialog: React.FC<StatusDialogProps> = ({
  open,
  onOpenChange,
  editingStatus,
  selectedStatusType,
  userId,
  onSuccess,
  existingStatuses
}) => {
  const [statusName, setStatusName] = useState('');
  const [statusOrder, setStatusOrder] = useState(0);
  const [isClosed, setIsClosed] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    if (editingStatus) {
      setStatusName(editingStatus.name);
      setStatusOrder(editingStatus.order_number || 0);
      setIsClosed(editingStatus.is_closed || false);
      setIsDefault(editingStatus.is_default || false);
    } else {
      setStatusName('');
      // Suggest next available order number for new status
      const statusesOfType = existingStatuses.filter(s => s.status_type === selectedStatusType);
      const maxOrder = Math.max(...statusesOfType.map(s => s.order_number || 0), 0);
      setStatusOrder(Math.min(maxOrder + 1, 100));
      setIsClosed(false);
      setIsDefault(false);
    }
  }, [editingStatus, existingStatuses, selectedStatusType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!statusName.trim()) {
      toast.error('Status name is required');
      return;
    }

    // Check if order number is already taken
    const existingWithOrder = existingStatuses.find(s => 
      s.status_type === selectedStatusType && 
      s.order_number === statusOrder &&
      s.status_id !== editingStatus?.status_id
    );
    
    if (existingWithOrder) {
      toast.error(`Order number ${statusOrder} is already taken by "${existingWithOrder.name}". Please choose a different order number.`);
      return;
    }

    try {
      if (editingStatus) {
        await updateStatus(editingStatus.status_id, {
          ...editingStatus,
          name: statusName,
          order_number: statusOrder,
          is_closed: isClosed,
          is_default: isDefault
        });
        toast.success('Status updated successfully');
      } else {
        const newStatus: Omit<IStatus, 'status_id'> = {
          name: statusName,
          status_type: selectedStatusType,
          is_closed: isClosed,
          is_default: selectedStatusType === 'ticket' ? isDefault : false,
          order_number: statusOrder,
          created_by: userId
        };
        await createStatus(newStatus);
        toast.success('Status created successfully');
      }
      
      onSuccess();
      onOpenChange(false);
      setStatusName('');
      setStatusOrder(0);
      setIsClosed(false);
      setIsDefault(false);
    } catch (error) {
      console.error('Error saving status:', error);
      if (error instanceof Error && error.message.includes('unique_tenant_type_order')) {
        toast.error('This order number is already in use. Please choose a different order number.');
      } else {
        toast.error(editingStatus ? 'Failed to update status' : 'Failed to create status');
      }
    }
  };

  return (
    <Dialog 
      isOpen={open} 
      onClose={() => onOpenChange(false)}
      title={editingStatus ? 'Edit Status' : 'Add New Status'}
      className="max-w-lg"
      id="status-dialog"
    >
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status Name
              </label>
              <Input
                id="status-name"
                value={statusName}
                onChange={(e) => setStatusName(e.target.value)}
                placeholder="e.g., In Progress"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Order Number (1-100, lower numbers appear first)
              </label>
              <Input
                id="status-order"
                type="number"
                min="1"
                max="100"
                value={statusOrder}
                onChange={(e) => setStatusOrder(parseInt(e.target.value) || 0)}
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Controls the order in which statuses appear in dropdown menus throughout the platform.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {(() => {
                  const statusesOfType = existingStatuses.filter(s => s.status_type === selectedStatusType);
                  const usedOrders = statusesOfType
                    .filter(s => s.status_id !== editingStatus?.status_id)
                    .map(s => s.order_number)
                    .filter(n => n !== null && n !== undefined)
                    .sort((a, b) => a - b);
                  if (usedOrders.length > 0) {
                    return `Used order numbers: ${usedOrders.join(', ')}`;
                  }
                  return 'No order numbers used yet';
                })()}
              </p>
            </div>
            
            <div className="space-y-3">
              <Checkbox
                id="status-is-closed"
                label="Mark as closed status"
                checked={isClosed}
                onChange={(e) => setIsClosed((e.target as HTMLInputElement).checked)}
              />
              
              {selectedStatusType === 'ticket' && (
                <Checkbox
                  id="status-is-default"
                  label="Set as default status for new tickets"
                  checked={isDefault}
                  onChange={(e) => setIsDefault((e.target as HTMLInputElement).checked)}
                />
              )}
            </div>
          </div>
          
          <DialogFooter>
            <Button
              id="cancel-status-button"
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                setStatusName('');
                setStatusOrder(0);
                setIsClosed(false);
                setIsDefault(false);
              }}
            >
              Cancel
            </Button>
            <Button
              id="save-status-button"
              type="submit"
              className="bg-primary-500 text-white hover:bg-primary-600"
            >
              {editingStatus ? 'Update' : 'Add'} Status
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
