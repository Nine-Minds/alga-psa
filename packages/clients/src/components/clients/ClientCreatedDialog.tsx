'use client';

import React from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import type { IClient } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ClientCreatedDialogProps {
  isOpen: boolean;
  onClose: () => void;
  client: IClient | null;
  onViewClient: () => void;
  onAddAnother: () => void;
}

const ClientCreatedDialog: React.FC<ClientCreatedDialogProps> = ({
  isOpen,
  onClose,
  client,
  onViewClient,
  onAddAnother,
}) => {
  const { t } = useTranslation('msp/clients');
  const name = client?.client_name || t('clientCreatedDialog.unknownClient', { defaultValue: 'Client' });
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={t('clientCreatedDialog.title', { defaultValue: 'Client Created' })} id="client-created-dialog">
      <DialogContent>
        <p className="text-center">{t('clientCreatedDialog.createdMessage', { defaultValue: '"{{name}}" has been created successfully.', name })}</p>
      </DialogContent>
      <DialogFooter>
        <Button id="view-client-btn" onClick={onViewClient}>
          {t('clientCreatedDialog.viewClient', { defaultValue: 'View Client' })}
        </Button>
        <Button id="add-another-client-btn" variant="secondary" onClick={onAddAnother}>
          {t('clientCreatedDialog.addAnother', { defaultValue: 'Add Another' })}
        </Button>
      </DialogFooter>
    </Dialog>
  );
};

export default ClientCreatedDialog;
