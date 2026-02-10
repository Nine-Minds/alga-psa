import React from 'react';
import { Tabs, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

const baseTabs = [
  { key: 'overview', label: 'Overview', content: <Text>Overview content</Text> },
  { key: 'details', label: 'Details', content: <Text>Details content</Text> },
  { key: 'settings', label: 'Settings', content: <Text>Settings content</Text>, disabled: true },
];

export function TabsDemo() {
  return (
    <DemoSection title="Tabs" description="Tabbed navigation with underline indicator.">
      <Tabs tabs={baseTabs} defaultActiveKey="overview" />
    </DemoSection>
  );
}
