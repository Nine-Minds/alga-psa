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
    <DemoSection title="Tabs" description="Tabbed navigation with default and underline variants.">
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <Text weight={600}>Default</Text>
          <Tabs tabs={baseTabs} defaultActiveKey="overview" />
        </div>
        <div>
          <Text weight={600}>Underline</Text>
          <Tabs tabs={baseTabs} variant="underline" defaultActiveKey="overview" />
        </div>
      </div>
    </DemoSection>
  );
}
