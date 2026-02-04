import React from 'react';
import { Badge, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function BadgeDemo() {
  return (
    <DemoSection title="Badge" description="Compact status labels with semantic tones.">
      <Stack gap={12}>
        <Text weight={600}>Tones</Text>
        <Stack direction="row" gap={8} style={{ flexWrap: 'wrap' }}>
          <Badge tone="default">Default</Badge>
          <Badge tone="info">Info</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
        </Stack>
      </Stack>
    </DemoSection>
  );
}
