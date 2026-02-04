import React from 'react';
import { Card, Stack, Text, Button } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function CardDemo() {
  return (
    <DemoSection title="Card" description="Container for grouped content with padding and border.">
      <Card style={{ maxWidth: 360 }}>
        <Stack gap={12}>
          <Text weight={600} as={'p' as any}>Starter Plan</Text>
          <Text tone="muted">Great for small teams getting started.</Text>
          <Text size="lg" weight={700}>$24 / month</Text>
          <Button>Choose Plan</Button>
        </Stack>
      </Card>
    </DemoSection>
  );
}
