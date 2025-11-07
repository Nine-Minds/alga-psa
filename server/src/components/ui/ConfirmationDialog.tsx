import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './Dialog';
import { Button } from './Button';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { DialogComponent, ButtonComponent, AutomationProps } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedValue?: string) => Promise<void> | void;
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isConfirming?: boolean;
  options?: Array<{ value: string; label: string }>;
  id?: string;
  className?: string;
  dialogClassName?: string;
  onCancel?: () => Promise<void> | void;
  thirdButtonLabel?: string;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps & AutomationProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isConfirming,
  options,
  id,
  className,
  onCancel,
  thirdButtonLabel
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedValue, setSelectedValue] = useState('');
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (options?.[0]?.value) {
      setSelectedValue(options[0].value);
    }
  }, [isOpen, options]);

  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      await onConfirm(options ? selectedValue : undefined);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = async () => {
    if (onCancel) {
      setIsProcessing(true);
      try {
        await onCancel();
      } finally {
        setIsProcessing(false);
      }
    }
  };

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose}
      id={id}
      title={title}
      className={className}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        confirmButtonRef.current?.focus();
      }}
    >
      <DialogContent>
        {typeof message === 'string' ? (
          <p className="text-gray-600">{message}</p>
        ) : (
          <div className="text-gray-600">{message}</div>
        )}
        {options && (
          <div className="space-y-2 mt-4">
            {options.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="dialog-option"
                  value={opt.value}
                  checked={selectedValue === opt.value}
                  onChange={(e) => setSelectedValue(e.target.value)}
                  className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-300"
                  id={`${id}-option-${opt.value}`}
                />
                {opt.label}
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <div className="mt-4 flex justify-end gap-2">
            {/* Render Cancel/Close button */}
            <Button
              variant="outline"
              onClick={onClose}
              id={`${id}-close`}
              disabled={isProcessing}
            >
              {cancelLabel}
            </Button>
            {/* Render third button if provided */}
            {thirdButtonLabel && onCancel && (
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={isProcessing}
                id={`${id}-cancel`}
              >
                {thirdButtonLabel}
              </Button>
            )}
            {/* Render Confirm button (last focusable element) */}
            <Button
              onClick={handleConfirm}
              disabled={isConfirming || isProcessing}
              id={`${id}-confirm`}
              ref={confirmButtonRef}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
