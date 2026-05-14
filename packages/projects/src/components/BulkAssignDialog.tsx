'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import type { IUserWithRoles } from '@alga-psa/types';
import { useTranslation } from 'react-i18next';

interface BulkAssignDialogProps {
  isOpen: boolean;
  onClose: () => void;
  taskCount: number;
  users: IUserWithRoles[];
  onConfirm: (userId: string | null) => Promise<void>;
}

export default function BulkAssignDialog({
  isOpen,
  onClose,
  taskCount,
  users,
  onConfirm,
}: BulkAssignDialogProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedUserId('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm(selectedUserId || null);
    } catch (error) {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('dialogs.bulkAssign.title', 'Assign Tasks')}
      className="max-w-md"
    >
      <DialogContent>
        <div className="mb-3 text-sm text-gray-600">
          {t('dialogs.bulkAssign.message', 'Assign {{count}} selected task(s) to:', { count: taskCount })}
        </div>

        <div className="mb-6">
          <UserPicker
            value={selectedUserId}
            onValueChange={setSelectedUserId}
            users={users}
            getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
            buttonWidth="full"
            labelStyle="none"
            placeholder={t('dialogs.bulkAssign.unassigned', 'Not assigned')}
          />
        </div>

        <div className="flex justify-end space-x-2">
          <Button id="cancel-bulk-assign-button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('common:actions.cancel', 'Cancel')}
          </Button>
          <Button id="confirm-bulk-assign-button" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting
              ? t('dialogs.bulkAssign.assigning', 'Assigning...')
              : t('dialogs.bulkAssign.confirm', 'Assign Tasks')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
