'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import type { IStatus, ItemType } from '@alga-psa/types';
import { createStatus, isStatusActionError, statusActionErrorMessage, updateStatus } from '@alga-psa/reference-data/actions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('common');

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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!statusName.trim()) {
      toast.error(t('statusDialog.nameRequired', 'Status name is required'));
      return;
    }

    // Check if order number is already taken
    const existingWithOrder = existingStatuses.find(s => 
      s.status_type === selectedStatusType && 
      s.order_number === statusOrder &&
      s.status_id !== editingStatus?.status_id
    );
    
    if (existingWithOrder) {
      toast.error(
        t(
          'statusDialog.orderTaken',
          'Order number {{order}} is already taken by "{{name}}". Please choose a different order number.',
          { order: statusOrder, name: existingWithOrder.name },
        ),
      );
      return;
    }

    try {
      if (editingStatus) {
        const updatedStatus = await updateStatus(editingStatus.status_id, {
          ...editingStatus,
          name: statusName,
          order_number: statusOrder,
          is_closed: isClosed,
          is_default: isDefault
        });
        if (isStatusActionError(updatedStatus)) {
          toast.error(statusActionErrorMessage(updatedStatus));
          return;
        }
        toast.success(t('statusDialog.updated', 'Status updated successfully'));
      } else {
        const newStatus: Omit<IStatus, 'status_id'> = {
          name: statusName,
          status_type: selectedStatusType,
          is_closed: isClosed,
          is_default: selectedStatusType === 'ticket' ? isDefault : false,
          order_number: statusOrder,
          created_by: userId
        };
        const createdStatus = await createStatus(newStatus);
        if (isStatusActionError(createdStatus)) {
          toast.error(statusActionErrorMessage(createdStatus));
          return;
        }
        toast.success(t('statusDialog.created', 'Status created successfully'));
      }
      
      onSuccess();
      onOpenChange(false);
      setStatusName('');
      setStatusOrder(0);
      setIsClosed(false);
      setIsDefault(false);
    } catch (error) {
      if (error instanceof Error && error.message.includes('unique_tenant_type_order')) {
        handleError(error, t('statusDialog.orderInUse', 'This order number is already in use. Please choose a different order number.'));
      } else {
        handleError(
          error,
          editingStatus
            ? t('statusDialog.updateFailed', 'Failed to update status')
            : t('statusDialog.createFailed', 'Failed to create status'),
        );
      }
    }
  };

  const footer = (
    <div className="flex justify-end space-x-2">
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
        {t('actions.cancel', 'Cancel')}
      </Button>
      <Button
        id="save-status-button"
        type="button"
        className="bg-primary-500 text-white hover:bg-primary-600"
        onClick={() => (document.getElementById('status-dialog-form') as HTMLFormElement | null)?.requestSubmit()}
      >
        {editingStatus
          ? t('statusDialog.submitUpdate', 'Update Status')
          : t('statusDialog.submitAdd', 'Add Status')}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={editingStatus ? t('statusDialog.editTitle', 'Edit Status') : t('statusDialog.addTitle', 'Add New Status')}
      className="max-w-lg"
      id="status-dialog"
      footer={footer}
    >
      <DialogContent>
        <form id="status-dialog-form" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('statusDialog.nameLabel', 'Status Name')}
              </label>
              <Input
                id="status-name"
                value={statusName}
                onChange={(e) => setStatusName(e.target.value)}
                placeholder={t('statusDialog.namePlaceholder', 'e.g., In Progress')}
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('statusDialog.orderLabel', 'Order Number (1-100, lower numbers appear first)')}
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
                {t(
                  'statusDialog.orderHelp',
                  'Controls the order in which statuses appear in dropdown menus throughout the platform.',
                )}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {(() => {
                  const statusesOfType = existingStatuses.filter(s => s.status_type === selectedStatusType);
                  const usedOrders = statusesOfType
                    .filter(s => s.status_id !== editingStatus?.status_id)
                    .map(s => s.order_number)
                    .filter((n): n is number => n !== null && n !== undefined)
                    .sort((a, b) => a - b);
                  if (usedOrders.length > 0) {
                    return t('statusDialog.usedOrders', 'Used order numbers: {{orders}}', {
                      orders: usedOrders.join(', '),
                    });
                  }
                  return t('statusDialog.noUsedOrders', 'No order numbers used yet');
                })()}
              </p>
            </div>
            
            <div className="space-y-3">
              <Checkbox
                id="status-is-closed"
                label={t('statusDialog.markClosed', 'Mark as closed status')}
                checked={isClosed}
                onChange={(e) => setIsClosed((e.target as HTMLInputElement).checked)}
              />
              
              {selectedStatusType === 'ticket' && (
                <Checkbox
                  id="status-is-default"
                  label={t('statusDialog.setDefault', 'Set as default status for new tickets')}
                  checked={isDefault}
                  onChange={(e) => setIsDefault((e.target as HTMLInputElement).checked)}
                />
              )}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
