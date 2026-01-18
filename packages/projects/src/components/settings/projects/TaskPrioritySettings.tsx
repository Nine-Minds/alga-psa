'use client';

import React from 'react';
import PrioritySettings from '@alga-psa/ui/components/settings/general/PrioritySettings';

/**
 * Task Priority Settings
 * Wrapper component for managing project task priorities in Settings → Projects
 */
const TaskPrioritySettings = (): React.JSX.Element => {
  return <PrioritySettings initialPriorityType="project_task" />;
};

export default TaskPrioritySettings;
