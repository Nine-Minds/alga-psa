'use client';

import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import type { IClient, IProject } from '@alga-psa/types';
import ProjectQuickAdd from '@alga-psa/projects/components/ProjectQuickAdd';
import { getAllClients } from '@alga-psa/clients/actions/queryActions';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  type QuickCreateRouteCloseMode,
  useQuickCreateRouteClose,
} from './useQuickCreateRouteClose';

interface CreateProjectRouteClientProps {
  closeMode: QuickCreateRouteCloseMode;
}

export default function CreateProjectRouteClient({ closeMode }: CreateProjectRouteClientProps) {
  const { t } = useTranslation('msp/core');
  const { close, router } = useQuickCreateRouteClose(closeMode, '/msp/projects');
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);

  useEffect(() => {
    getAllClients(false)
      .then(setClients)
      .catch((error) => {
        handleError(
          error,
          t('quickCreate.errors.loadClients', { defaultValue: 'Failed to load clients' }),
        );
      })
      .finally(() => setIsLoadingClients(false));
  }, [t]);

  const handleProjectAdded = (project: IProject) => {
    toast.success(
      t('quickCreate.success.project', {
        defaultValue: 'Project "{{name}}" created successfully',
        name: project.project_name,
      }),
    );
    router.refresh();
    close();
  };

  if (isLoadingClients) {
    return (
      <Dialog isOpen={true} onClose={close} title={t('quickCreate.dialogTitles.project', { defaultValue: 'Add New Project' })}>
        <DialogContent className="max-w-2xl">
          <div className="flex justify-center items-center p-8">
            <LoadingIndicator />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <ProjectQuickAdd
      onClose={close}
      onProjectAdded={handleProjectAdded}
      clients={clients}
    />
  );
}
