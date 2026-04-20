import { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Action } from '@alga-psa/workflows/forms/actionHandlerRegistry';
import {
  Dialog,
  DialogContent,
  DialogFooter
} from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ActionButtonProps {
  action: Action;
  onClick: (actionId: string) => Promise<void>;
  disabled?: boolean;
  className?: string;
}

/**
 * Generic Action Button component for workflow forms
 *
 * This component renders a button for a workflow form action.
 * It supports confirmation dialogs and various button styles.
 */
export function ActionButton({
  action,
  onClick,
  disabled = false,
  className = '',
}: ActionButtonProps) {
  const { t } = useTranslation('msp/workflows');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  
  // If the action is hidden, don't render anything
  if (action.hidden) {
    return null;
  }
  
  // Handle button click
  const handleClick = async () => {
    // If confirmation is required, show the confirmation dialog
    if (action.confirmationMessage) {
      setIsConfirmationOpen(true);
      return;
    }
    
    // Otherwise, execute the action directly
    await executeAction();
  };
  
  // Execute the action
  const executeAction = async () => {
    setIsProcessing(true);
    try {
      await onClick(action.id);
    } catch (error) {
      console.error(`Error executing action ${action.id}:`, error);
    } finally {
      setIsProcessing(false);
      setIsConfirmationOpen(false);
    }
  };
  
  // Handle confirmation dialog close
  const handleDialogClose = () => {
    setIsConfirmationOpen(false);
  };
  
  // Determine button text based on processing state
  const buttonText = isProcessing
    ? t('actionButton.processing', { defaultValue: 'Processing...' })
    : action.label;
  
  // Determine button variant (ensuring it's a valid variant)
  const variant = action.variant || (action.primary ? 'default' : 'secondary');
  
  return (
    <>
      <Button
        id={`action-button-${action.id}`}
        type="button"
        variant={variant}
        disabled={disabled || isProcessing || action.disabled}
        onClick={handleClick}
        className={className}
      >
        {action.icon && <span className={`mr-2 ${action.icon}`}></span>}
        {buttonText}
      </Button>
      
      {/* Confirmation Dialog */}
      {action.confirmationMessage && (
        <Dialog
          isOpen={isConfirmationOpen}
          onClose={handleDialogClose}
          id={`confirm-${action.id}`}
          title={t('actionButton.confirmTitle', { defaultValue: 'Confirm Action' })}
        >
          <DialogContent>
            <div className="py-4">
              {action.confirmationMessage}
            </div>
            <DialogFooter>
              <Button
                id={`cancel-confirm-${action.id}`}
                type="button"
                variant="secondary"
                onClick={handleDialogClose}
                disabled={isProcessing}
              >
                {t('actionButton.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                id={`confirm-action-${action.id}`}
                type="button"
                variant="default"
                onClick={executeAction}
                disabled={isProcessing}
              >
                {isProcessing
                  ? t('actionButton.processing', { defaultValue: 'Processing...' })
                  : t('actionButton.confirm', { defaultValue: 'Confirm' })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
