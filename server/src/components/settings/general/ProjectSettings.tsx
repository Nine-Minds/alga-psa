'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import NumberingSettings from './NumberingSettings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';

const ProjectSettings = (): JSX.Element => {
  const searchParams = useSearchParams();
  const sectionParam = searchParams?.get('section');

  // Map URL slugs to tab labels
  const sectionToLabelMap: Record<string, string> = {
    'project-numbering': 'Project Numbering',
    'statuses': 'Statuses',
    'templates': 'Templates'
  };

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const initialLabel = sectionParam ? sectionToLabelMap[sectionParam.toLowerCase()] : undefined;
    return initialLabel || 'Project Numbering'; // Default to 'Project Numbering'
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const currentLabel = sectionParam ? sectionToLabelMap[sectionParam.toLowerCase()] : undefined;
    const targetTab = currentLabel || 'Project Numbering';
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [sectionParam, activeTab]);

  const tabs = [
    {
      label: "Project Numbering",
      content: <NumberingSettings entityType="PROJECT" />
    },
    {
      label: "Statuses",
      content: (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-gray-400">Status Configuration</CardTitle>
            <CardDescription className="text-gray-400">
              Coming soon: Manage project statuses
            </CardDescription>
          </CardHeader>
        </Card>
      )
    },
    {
      label: "Templates",
      content: (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-gray-400">Project Templates</CardTitle>
            <CardDescription className="text-gray-400">
              Coming soon: Create and manage project templates
            </CardDescription>
          </CardHeader>
        </Card>
      )
    }
  ];

  const updateURL = (tabLabel: string) => {
    // Map tab labels back to URL slugs
    const labelToSlugMap: Record<string, string> = Object.entries(sectionToLabelMap).reduce((acc, [slug, label]) => {
      acc[label] = slug;
      return acc;
    }, {} as Record<string, string>);

    const urlSlug = labelToSlugMap[tabLabel];

    // Build new URL with tab and section parameters
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (urlSlug && urlSlug !== 'project-numbering') {
      currentSearchParams.set('section', urlSlug);
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
