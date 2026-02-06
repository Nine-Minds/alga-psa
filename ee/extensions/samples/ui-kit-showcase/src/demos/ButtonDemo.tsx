import React from 'react';
import { Button, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function ButtonDemo() {
  return (
    <DemoSection
      title="Button"
      description="All button variants available in the design system."
    >
      <Stack gap={16}>
        <div>
          <Text weight={600}>Variants</Text>
          <Stack direction="row" gap={8} style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
            <Button variant="soft">Soft</Button>
            <Button variant="dashed">Dashed</Button>
          </Stack>
        </div>
        <div>
          <Text weight={600}>Disabled</Text>
          <Stack direction="row" gap={8} style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <Button variant="primary" disabled style={{ opacity: 0.5 }}>Disabled Primary</Button>
            <Button variant="secondary" disabled style={{ opacity: 0.5 }}>Disabled Secondary</Button>
            <Button variant="outline" disabled style={{ opacity: 0.5 }}>Disabled Outline</Button>
          </Stack>
        </div>
      </Stack>
    </DemoSection>
  );
}
