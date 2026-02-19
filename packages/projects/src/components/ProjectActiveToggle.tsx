'use client';

import { Switch } from '@alga-psa/ui/components/Switch';
import { Badge } from '@alga-psa/ui/components/Badge';
import { updateProject } from '../actions/projectActions';
import { useState } from 'react';

interface ProjectActiveToggleProps {
  projectId: string;
  initialIsInactive: boolean;
}

export default function ProjectActiveToggle({ projectId, initialIsInactive }: ProjectActiveToggleProps) {
  const [isInactive, setIsInactive] = useState(initialIsInactive);

  const toggleProjectActive = async () => {
    try {
      const updatedProject = await updateProject(projectId, { is_inactive: !isInactive });
      setIsInactive(updatedProject.is_inactive);
    } catch (error) {
      console.error('Error updating project status:', error);
    }
  };

  return (
    <div className="flex items-center space-x-2">
      <Badge variant={isInactive ? 'default-muted' : 'success'}>
        {isInactive ? 'Inactive' : 'Active'}
      </Badge>
      <Switch
        checked={!isInactive}
        onCheckedChange={toggleProjectActive}
      />
    </div>
  );
}
