import React from 'react';
import { ViewSwitcher, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

type View = 'cards' | 'table';

// Simple inline SVG icon components matching the main app pattern
function GridIcon({ size = 16, style }: { size?: number | string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ListIcon({ size = 16, style }: { size?: number | string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={style}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

const viewOptions = [
  { value: 'cards' as View, label: 'Cards', icon: GridIcon },
  { value: 'table' as View, label: 'Table', icon: ListIcon },
];

export function ViewSwitcherDemo() {
  const [currentView, setCurrentView] = React.useState<View>('cards');

  return (
    <DemoSection
      title="ViewSwitcher"
      description="A segmented control for switching between different view modes."
    >
      <Stack gap={12}>
        <ViewSwitcher
          options={viewOptions}
          currentView={currentView}
          onChange={setCurrentView}
        />
        <Text size="sm" color="muted">
          Selected view: <Text as="span" weight={600}>{currentView}</Text>
        </Text>
      </Stack>
    </DemoSection>
  );
}
