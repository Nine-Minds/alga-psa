'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { QuickAddService } from '@alga-psa/billing/components/settings/billing/QuickAddService';
import { getServiceTypesForSelection } from '@alga-psa/billing/actions/serviceActions';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  type QuickCreateRouteCloseMode,
  useQuickCreateRouteClose,
} from './useQuickCreateRouteClose';

interface CreateServiceRouteClientProps {
  closeMode: QuickCreateRouteCloseMode;
}

export default function CreateServiceRouteClient({ closeMode }: CreateServiceRouteClientProps) {
  const { t } = useTranslation('msp/core');
  const { close, router } = useQuickCreateRouteClose(closeMode, '/msp/billing');
  const [serviceTypes, setServiceTypes] = useState<{ id: string; name: string; is_standard?: boolean }[]>([]);
  const [isLoadingServiceTypes, setIsLoadingServiceTypes] = useState(true);

  const refreshServiceTypes = () => {
    getServiceTypesForSelection()
      .then(setServiceTypes)
      .catch((error) => {
        handleError(
          error,
          t('quickCreate.errors.loadServiceTypes', {
            defaultValue: 'Failed to load service types',
          }),
        );
      })
      .finally(() => setIsLoadingServiceTypes(false));
  };

  useEffect(refreshServiceTypes, [t]);

  const handleServiceAdded = () => {
    toast.success(
      t('quickCreate.success.service', { defaultValue: 'Service created successfully' }),
    );
    router.refresh();
    close();
  };

  if (isLoadingServiceTypes) {
    return (
      <Dialog isOpen={true} onClose={close} title={t('quickCreate.dialogTitles.service', { defaultValue: 'Add New Service' })}>
        <DialogContent className="max-w-2xl">
          <div className="flex justify-center items-center p-8">
            <LoadingIndicator />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <QuickAddService
      isOpen={true}
      onClose={close}
      onServiceAdded={handleServiceAdded}
      allServiceTypes={serviceTypes}
      onServiceTypesChange={refreshServiceTypes}
    />
  );
}
