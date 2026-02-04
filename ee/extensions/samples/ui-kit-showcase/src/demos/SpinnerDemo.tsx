import React from 'react';
import { Spinner, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function SpinnerDemo() {
  return (
    <DemoSection title="Spinner" description="Loading spinner with multiple size variants.">
      <Stack gap={12}>
        <Text weight={600}>Sizes</Text>
        <Stack direction="row" gap={16} align="center" style={{ flexWrap: 'wrap' }}>
          <Spinner size="xs" />
          <Spinner size="sm" />
          <Spinner size="md" />
          <Spinner size="lg" />
          <Spinner size="button" />
        </Stack>
      </Stack>
    </DemoSection>
  );
}
