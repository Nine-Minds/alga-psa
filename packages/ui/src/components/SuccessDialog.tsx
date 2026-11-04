'use client';

import React from 'react';
import { Dialog, DialogContent, DialogFooter } from './Dialog';
import { Button } from './Button';
import { useTranslation } from '../lib/i18n/client';

interface SuccessDialogProps {
  isOpen: boolean;
  onClose: () => void;
  message: string;
  id?: string;
}

const SuccessDialog = ({ isOpen, onClose, message, id = 'success-dialog' }: SuccessDialogProps) => {
  const { t } = useTranslation('common');

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={t('dialogs.success.title')} className="max-w-sm" id={id}>
      <DialogContent>
        <p className="text-center">{message}</p>
      </DialogContent>
      <DialogFooter>
        <Button id="success-dialog-ok" onClick={onClose}>{t('dialogs.success.confirm')}</Button>
      </DialogFooter>
    </Dialog>
  );
};

export default SuccessDialog;
