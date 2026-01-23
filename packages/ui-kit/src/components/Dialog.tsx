import React, { useEffect, useCallback } from 'react';
import { Button } from './Button';

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  /** @deprecated Use confirmLabel instead */
  confirmText?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Additional content to render below the message */
  children?: React.ReactNode;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const dialogStyle: React.CSSProperties = {
  backgroundColor: 'var(--alga-bg, #fff)',
  borderRadius: 'var(--alga-radius, 8px)',
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  padding: '24px',
  maxWidth: '500px',
  width: '90%',
  animation: 'dialogFadeIn 0.15s ease-out',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: '1.125rem',
  fontWeight: 600,
  color: 'var(--alga-fg)',
};

const messageStyle: React.CSSProperties = {
  margin: '0 0 24px 0',
  fontSize: '0.875rem',
  color: 'var(--alga-muted-fg)',
  lineHeight: 1.5,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  justifyContent: 'flex-end',
};

const keyframesStyle = `
  @keyframes dialogFadeIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
`;

/**
 * Base Dialog component for custom content
 */
export function Dialog({ isOpen, onClose, title, children }: DialogProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <>
      <style>{keyframesStyle}</style>
      <div
        style={overlayStyle}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'dialog-title' : undefined}
      >
        <div style={dialogStyle}>
          {title && <h3 id="dialog-title" style={titleStyle}>{title}</h3>}
          {children}
        </div>
      </div>
    </>
  );
}

/**
 * Confirmation dialog with confirm/cancel actions
 */
export function ConfirmDialog({
  isOpen,
  title = 'Confirm Action',
  message,
  confirmLabel = 'Confirm',
  confirmText,
  cancelLabel = 'Cancel',
  variant = 'default',
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  // Support both confirmLabel and confirmText for backward compatibility
  const buttonLabel = confirmText || confirmLabel;

  return (
    <Dialog isOpen={isOpen} onClose={onCancel} title={title}>
      <p style={{ ...messageStyle, whiteSpace: 'pre-line' }}>{message}</p>
      {children}
      <div style={actionsStyle}>
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={variant === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={confirmDisabled}
        >
          {buttonLabel}
        </Button>
      </div>
    </Dialog>
  );
}
