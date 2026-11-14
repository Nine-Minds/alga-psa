'use client';

import { toast } from 'react-hot-toast';
import type { IProject } from '@alga-psa/types';
import ProjectQuickAdd from '@alga-psa/projects/components/ProjectQuickAdd';
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

  return (
    <ProjectQuickAdd
      onClose={close}
      onProjectAdded={handleProjectAdded}
    />
  );
}
