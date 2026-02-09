import React from 'react';
import { Button, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function ButtonDemo() {
  return (
    <DemoSection
      title="Button"
      description="All button variants and sizes available in the design system."
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
          <Text weight={600}>Sizes</Text>
          <Stack direction="row" gap={8} style={{ flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            <Button size="xs">Extra Small</Button>
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </Button>
          </Stack>
        </div>
        <div>
          <Text weight={600}>Disabled</Text>
          <Stack direction="row" gap={8} style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <Button variant="primary" disabled>Disabled Primary</Button>
            <Button variant="secondary" disabled>Disabled Secondary</Button>
            <Button variant="outline" disabled>Disabled Outline</Button>
          </Stack>
        </div>
      </Stack>
    </DemoSection>
  );
}
