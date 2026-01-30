"use client";

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { EmailProviderSelector } from './EmailProviderSelector';
import {
  GmailProviderForm,
  ImapProviderForm,
  MicrosoftProviderForm,
} from '@alga-psa/integrations/email/providers/entry';
import type { EmailProvider } from './types';

interface ProviderSetupWizardDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (provider: EmailProvider) => void;
  tenant: string;
}

type Step = 'select' | 'setup';

export function ProviderSetupWizardDialog({ isOpen, onClose, onComplete, tenant }: ProviderSetupWizardDialogProps) {
  const [step, setStep] = useState<Step>('select');
  const [providerType, setProviderType] = useState<'microsoft' | 'google' | 'imap' | null>(null);

  const reset = () => {
    setStep('select');
    setProviderType(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleProviderSelected = (type: 'microsoft' | 'google' | 'imap') => {
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
    <Dialog isOpen={isOpen} onClose={handleClose} title={step === 'select' ? 'Choose Email Provider' : `${providerType === 'google' ? 'Gmail' : providerType === 'microsoft' ? 'Microsoft 365' : 'IMAP'} Configuration`}>
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

        {step === 'setup' && providerType === 'imap' && (
          <ImapProviderForm tenant={tenant} onSuccess={handleSetupSuccess} onCancel={handleSetupCancel} />
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
