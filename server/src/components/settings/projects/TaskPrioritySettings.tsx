'use client';

import React from 'react';
import PrioritySettings from 'server/src/components/settings/general/PrioritySettings';

/**
 * Task Priority Settings
 * Wrapper component for managing project task priorities in Settings → Projects
 */
const TaskPrioritySettings = (): JSX.Element => {
  return <PrioritySettings initialPriorityType="project_task" />;
};

export default TaskPrioritySettings;
