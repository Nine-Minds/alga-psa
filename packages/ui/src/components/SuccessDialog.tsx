'use client';

import React from 'react';
import { Dialog, DialogContent, DialogFooter } from './Dialog';
import { Button } from './Button';

interface SuccessDialogProps {
  isOpen: boolean;
  onClose: () => void;
  message: string;
  id?: string;
}

const SuccessDialog = ({ isOpen, onClose, message, id = 'success-dialog' }: SuccessDialogProps) => (
  <Dialog isOpen={isOpen} onClose={onClose} title="Success" className="max-w-sm" id={id}>
    <DialogContent>
      <p className="text-center">{message}</p>
    </DialogContent>
    <DialogFooter>
      <Button id="success-dialog-ok" onClick={onClose}>OK</Button>
    </DialogFooter>
  </Dialog>
);

export default SuccessDialog;
