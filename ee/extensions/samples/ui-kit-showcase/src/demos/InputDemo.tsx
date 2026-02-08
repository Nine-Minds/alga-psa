import React from 'react';
import { Input, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function InputDemo() {
  return (
    <DemoSection title="Input" description="Single-line text input fields with placeholder and disabled states.">
      <Stack gap={12}>
        <div>
          <Text weight={600}>Default</Text>
          <Input placeholder="Enter a value" style={{ marginTop: 8, width: 240 }} />
        </div>
        <div>
          <Text weight={600}>Disabled</Text>
          <Input placeholder="Disabled" disabled style={{ marginTop: 8, width: 240 }} />
        </div>
        <div>
          <Text weight={600}>Error State</Text>
          <Input error errorMessage="This field is required" placeholder="Error state" style={{ marginTop: 8, width: 240 }} />
        </div>
      </Stack>
    </DemoSection>
  );
}
