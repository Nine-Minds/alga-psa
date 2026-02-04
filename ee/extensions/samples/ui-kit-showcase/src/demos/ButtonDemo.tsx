import React from 'react';
import { Button, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function ButtonDemo() {
  return (
    <DemoSection
      title="Button"
      description="Primary actions, alternatives, and destructive actions with size and state variations."
    >
      <Stack gap={16}>
        <div>
          <Text weight={600}>Variants</Text>
          <Stack direction="row" gap={8} style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </Stack>
        </div>
        <div>
          <Text weight={600}>Sizes</Text>
          <Stack direction="row" gap={8} style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </Stack>
        </div>
        <div>
          <Text weight={600}>States</Text>
          <Stack direction="row" gap={8} style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <Button disabled>Disabled</Button>
          </Stack>
        </div>
      </Stack>
    </DemoSection>
  );
}
