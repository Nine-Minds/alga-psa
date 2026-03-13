'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import { NumberingSettings } from '@alga-psa/reference-data/components';
import { TenantProjectTaskStatusSettings } from './projects/TenantProjectTaskStatusSettings';
import { ProjectStatusSettings } from './projects/ProjectStatusSettings';
import TaskPrioritySettings from './projects/TaskPrioritySettings';

const DEFAULT_TAB = 'project-numbering';

const ProjectSettings = (): React.JSX.Element => {
  const searchParams = useSearchParams();
  const sectionParam = searchParams?.get('section');

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    return sectionParam?.toLowerCase() || DEFAULT_TAB;
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const targetTab = sectionParam?.toLowerCase() || DEFAULT_TAB;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [sectionParam, activeTab]);

  const tabs = [
    {
      id: 'project-numbering',
      label: "Project Numbering",
      content: <NumberingSettings entityType="PROJECT" />
    },
    {
      id: 'project-statuses',
      label: "Project Statuses",
      content: <ProjectStatusSettings />
    },
    {
      id: 'task-statuses',
      label: "Task Statuses",
      content: <TenantProjectTaskStatusSettings />
    },
    {
      id: 'task-priorities',
      label: "Task Priorities",
      content: <TaskPrioritySettings />
    }
  ];

  const updateURL = (tabId: string) => {
    // Build new URL with tab and section parameters
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId !== DEFAULT_TAB) {
      currentSearchParams.set('section', tabId);
    } else {
      currentSearchParams.delete('section');
    }

    // Keep existing tab parameter
    const newUrl = currentSearchParams.toString()
      ? `/msp/settings?${currentSearchParams.toString()}`
      : '/msp/settings?tab=projects';

    window.history.pushState({}, '', newUrl);
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Project Settings</h2>
      <CustomTabs
        tabs={tabs}
        defaultTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          updateURL(tab);
        }}
      />
    </div>
  );
};

export default ProjectSettings;
