import React from 'react';
import { CustomSelect, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

const options = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];

export function SelectDemo() {
  const [value, setValue] = React.useState<string | null>('active');

  return (
    <DemoSection title="CustomSelect" description="Dropdown select with placeholder, options, and disabled state.">
      <Stack gap={12}>
        <div style={{ maxWidth: 240 }}>
          <Text weight={600}>Default</Text>
          <CustomSelect
            options={options}
            value={value}
            onValueChange={(next) => setValue(next)}
            placeholder="Select a status"
            style={{ marginTop: 8 }}
          />
        </div>
        <div style={{ maxWidth: 240 }}>
          <Text weight={600}>Disabled</Text>
          <CustomSelect
            options={options}
            value={value}
            onValueChange={(next) => setValue(next)}
            placeholder="Disabled"
            disabled
            style={{ marginTop: 8 }}
          />
        </div>
      </Stack>
    </DemoSection>
  );
}
