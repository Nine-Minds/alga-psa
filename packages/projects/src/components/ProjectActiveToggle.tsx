'use client';

import { Switch } from '@alga-psa/ui/components/Switch';
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
      <span className={`px-2 py-1 rounded text-sm ${isInactive ? 'bg-gray-100 text-gray-800' : 'bg-green-100 text-green-800'}`}>
        {isInactive ? 'Inactive' : 'Active'}
      </span>
      <Switch
        checked={!isInactive}
        onCheckedChange={toggleProjectActive}
      />
    </div>
  );
}
