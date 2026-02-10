import React from 'react';
import { Label, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function LabelDemo() {
  return (
    <DemoSection title="Label" description="Form labels with required indicator and size variants.">
      <Stack gap={12}>
        <div>
          <Text weight={600}>Basic</Text>
          <div style={{ marginTop: 8 }}>
            <Label>Email address</Label>
          </div>
        </div>
        <div>
          <Text weight={600}>Required</Text>
          <div style={{ marginTop: 8 }}>
            <Label required>Company name</Label>
          </div>
        </div>
        <div>
          <Text weight={600}>Sizes</Text>
          <Stack direction="row" gap={12} style={{ marginTop: 8, alignItems: 'center' }}>
            <Label size="sm">Small</Label>
            <Label size="md">Medium</Label>
            <Label size="lg">Large</Label>
          </Stack>
        </div>
      </Stack>
    </DemoSection>
  );
}
