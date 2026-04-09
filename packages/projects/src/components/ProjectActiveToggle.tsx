'use client';

import { Switch } from '@alga-psa/ui/components/Switch';
import { Badge } from '@alga-psa/ui/components/Badge';
import { updateProject } from '../actions/projectActions';
import { useState } from 'react';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from 'react-i18next';

interface ProjectActiveToggleProps {
  projectId: string;
  initialIsInactive: boolean;
}

export default function ProjectActiveToggle({ projectId, initialIsInactive }: ProjectActiveToggleProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [isInactive, setIsInactive] = useState(initialIsInactive);

  const toggleProjectActive = async () => {
    try {
      const updatedProject = await updateProject(projectId, { is_inactive: !isInactive });
      if (isActionPermissionError(updatedProject)) {
        handleError(updatedProject.permissionError);
        return;
      }
      setIsInactive(updatedProject.is_inactive);
    } catch (error) {
      handleError(error, t('projectEdit.updateError', 'Failed to update project status'));
    }
  };

  return (
    <div className="flex items-center space-x-2">
      <Badge variant={isInactive ? 'default-muted' : 'success'}>
        {isInactive ? t('status.inactive', 'Inactive') : t('status.active', 'Active')}
      </Badge>
      <Switch
        checked={!isInactive}
        onCheckedChange={toggleProjectActive}
      />
    </div>
  );
}
