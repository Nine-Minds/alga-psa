'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { IStatus, ItemType } from 'server/src/interfaces/status.interface';
import { createStatus, updateStatus } from 'server/src/lib/actions/status-actions/statusActions';
import { toast } from 'react-hot-toast';

interface StatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingStatus: IStatus | null;
  selectedStatusType: ItemType;
  userId: string;
  onSuccess: () => void;
}

export const StatusDialog: React.FC<StatusDialogProps> = ({
  open,
  onOpenChange,
  editingStatus,
  selectedStatusType,
  userId,
  onSuccess
}) => {
  const [statusName, setStatusName] = useState('');
  const [statusOrder, setStatusOrder] = useState(0);

  useEffect(() => {
    if (editingStatus) {
      setStatusName(editingStatus.name);
      setStatusOrder(editingStatus.order_number || 0);
    } else {
      setStatusName('');
      setStatusOrder(0);
    }
  }, [editingStatus]);

  const handleSubmit = async () => {
    if (!statusName.trim()) {
      toast.error('Status name is required');
      return;
    }

    try {
      if (editingStatus) {
        await updateStatus(editingStatus.status_id, {
          ...editingStatus,
          name: statusName,
          order_number: statusOrder
        });
        toast.success('Status updated successfully');
      } else {
        const newStatus: Omit<IStatus, 'status_id'> = {
          name: statusName,
          status_type: selectedStatusType,
          is_closed: false,
          is_default: false,
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
    } catch (error) {
      console.error('Error saving status:', error);
      toast.error(editingStatus ? 'Failed to update status' : 'Failed to create status');
    }
  };

  return (
    <Dialog isOpen={open} onClose={() => onOpenChange(false)}>
      <DialogContent className="sm:max-w-[425px]">
        <div className="grid gap-4 py-4">
          <h2 className="text-lg font-semibold">
            {editingStatus ? 'Edit Status' : 'Add New Status'}
          </h2>
          <div className="grid gap-2">
            <label htmlFor="status-name" className="text-sm font-medium">
              Status Name
            </label>
            <Input
              id="status-name"
              value={statusName}
              onChange={(e) => setStatusName(e.target.value)}
              placeholder="Enter status name"
              className="col-span-3"
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="status-order" className="text-sm font-medium">
              Order
            </label>
            <Input
              id="status-order"
              type="number"
              value={statusOrder}
              onChange={(e) => setStatusOrder(parseInt(e.target.value) || 0)}
              placeholder="Enter order number"
              className="col-span-3"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            id="cancel-status-button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setStatusName('');
              setStatusOrder(0);
            }}
          >
            Cancel
          </Button>
          <Button
            id="save-status-button"
            onClick={handleSubmit}
            className="bg-primary-500 text-white hover:bg-primary-600"
          >
            {editingStatus ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};