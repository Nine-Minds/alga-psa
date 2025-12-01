'use client';

import React from 'react';
import { TemplateCreationWizard } from './TemplateCreationWizard';

interface AddTemplateDialogProps {
  onClose: () => void;
  onTemplateCreated?: (templateId: string) => void;
}

/**
 * Wrapper component that opens the TemplateCreationWizard
 * Maintained for backward compatibility with existing code
 */
const AddTemplateDialog: React.FC<AddTemplateDialogProps> = ({ onClose, onTemplateCreated }) => {
  return (
    <TemplateCreationWizard
      open={true}
      onOpenChange={onClose}
      onComplete={(templateId) => {
        if (onTemplateCreated) {
          onTemplateCreated(templateId);
        }
        onClose();
      }}
    />
  );
};

export default AddTemplateDialog;
