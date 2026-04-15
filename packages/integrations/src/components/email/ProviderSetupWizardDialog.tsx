"use client";

import React, { useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { EmailProviderSelector } from './EmailProviderSelector';
import {
  GmailProviderForm,
  ImapProviderForm,
  MicrosoftProviderForm,
} from '@alga-psa/integrations/email/providers/entry';
import type { EmailProvider } from './types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ProviderSetupWizardDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (provider: EmailProvider) => void;
  tenant: string;
}

type Step = 'select' | 'setup';

export function ProviderSetupWizardDialog({ isOpen, onClose, onComplete, tenant }: ProviderSetupWizardDialogProps) {
  const { t } = useTranslation('msp/email-providers');
  const [step, setStep] = useState<Step>('select');
  const [providerType, setProviderType] = useState<'microsoft' | 'google' | 'imap' | null>(null);

  const providerTitle = providerType === 'google'
    ? t('selector.cards.google.title', { defaultValue: 'Gmail' })
    : providerType === 'microsoft'
    ? t('selector.cards.microsoft.title', { defaultValue: 'Microsoft 365' })
    : t('selector.cards.imap.title', { defaultValue: 'IMAP' });

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

  const footer = (
    <div className="flex justify-end space-x-2">
      {step === 'select' ? (
        <Button id="provider-wizard-cancel" variant="outline" onClick={handleClose}>
          {t('wizard.actions.cancel', { defaultValue: 'Cancel' })}
        </Button>
      ) : (
        <>
          <Button id="provider-wizard-back" variant="outline" onClick={handleSetupCancel}>
            {t('wizard.actions.back', { defaultValue: 'Back' })}
          </Button>
          <Button id="provider-wizard-close" variant="ghost" onClick={handleClose}>
            {t('wizard.actions.close', { defaultValue: 'Close' })}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={step === 'select'
        ? t('wizard.title.select', { defaultValue: 'Choose Email Provider' })
        : t('wizard.title.setup', { defaultValue: '{{provider}} Configuration', provider: providerTitle })}
      footer={footer}
    >
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
    </Dialog>
  );
}
