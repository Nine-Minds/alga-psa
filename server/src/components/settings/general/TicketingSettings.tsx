'use client';

import React from 'react';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import NumberingSettings from './NumberingSettings';
import ChannelsSettings from './ChannelsSettings';
import CategoriesSettings from './CategoriesSettings';
import DisplaySettings from './DisplaySettings';
import StatusSettings from './StatusSettings';
import PrioritySettings from './PrioritySettings';

const TicketingSettingsRefactored = (): JSX.Element => {
  const tabs = [
    {
      label: "Display",
      content: <DisplaySettings />
    },
    {
      label: "Ticket Numbering",
      content: <NumberingSettings entityType="TICKET" />
    },
    {
      label: "Boards",
      content: <ChannelsSettings />
    },
    {
      label: "Statuses",
      content: <StatusSettings />
    },
    {
      label: "Priorities",
      content: <PrioritySettings />
    },
    {
      label: "Categories",
      content: <CategoriesSettings />
    }
  ];

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Ticket Settings</h2>
      <CustomTabs tabs={tabs} defaultTab="Categories" />
    </div>
  );
};

export default TicketingSettingsRefactored;