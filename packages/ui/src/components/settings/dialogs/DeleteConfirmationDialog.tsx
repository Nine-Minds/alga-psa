'use client';

import React, { useState } from 'react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface DeleteConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  itemName: string;
  itemType: string;
}

export const DeleteConfirmationDialog: React.FC<DeleteConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  itemName,
  itemType
}) => {
  const { t } = useTranslation('common');
  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title={t('dialogs.confirmDelete.title', { itemType })}
      message={t('dialogs.confirmDelete.message', { itemName })}
      confirmLabel={t('actions.delete')}
      cancelLabel={t('actions.cancel')}
    />
  );
};
