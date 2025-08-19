"use client";

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from './ui/Dialog';
import { Button } from './ui/Button';
import { EmailProviderSelector } from './EmailProviderSelector';
import { MicrosoftProviderForm } from '@ee/components/MicrosoftProviderForm';
import { GmailProviderForm } from '@ee/components/GmailProviderForm';
import type { EmailProvider } from './EmailProviderConfiguration';

interface ProviderSetupWizardDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (provider: EmailProvider) => void;
  tenant: string;
}

type Step = 'select' | 'setup';

export function ProviderSetupWizardDialog({ isOpen, onClose, onComplete, tenant }: ProviderSetupWizardDialogProps) {
  const [step, setStep] = useState<Step>('select');
  const [providerType, setProviderType] = useState<'microsoft' | 'google' | null>(null);

  const reset = () => {
    setStep('select');
    setProviderType(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleProviderSelected = (type: 'microsoft' | 'google') => {
    setProviderType(type);
    setStep('setup');
  };

  const handleSetupCancel = () => {
    // Go back to selection, keep dialog open
    setStep('select');
    setProviderType(null);
  };

  const handleSetupSuccess = (provider: EmailProvider) => {
    onComplete(provider);
    reset();
  };

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title={step === 'select' ? 'Choose Email Provider' : `${providerType === 'google' ? 'Gmail' : 'Microsoft 365'} Configuration`}> 
      <DialogContent>
        {step === 'select' && (
          <EmailProviderSelector onProviderSelected={handleProviderSelected} hideHeader />
        )}

        {step === 'setup' && providerType === 'microsoft' && (
          <MicrosoftProviderForm tenant={tenant} onSuccess={handleSetupSuccess} onCancel={handleSetupCancel} />
        )}

        {step === 'setup' && providerType === 'google' && (
          <GmailProviderForm tenant={tenant} onSuccess={handleSetupSuccess} onCancel={handleSetupCancel} />
        )}
      </DialogContent>
      <DialogFooter>
        {step === 'select' ? (
          <Button id="provider-wizard-cancel" variant="outline" onClick={handleClose}>Cancel</Button>
        ) : (
          <>
            <Button id="provider-wizard-back" variant="outline" onClick={handleSetupCancel}>Back</Button>
            <Button id="provider-wizard-close" variant="ghost" onClick={handleClose}>Close</Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  );
}
