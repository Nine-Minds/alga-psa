import React from 'react';
import { LoadingIndicator, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function LoadingIndicatorDemo() {
  return (
    <DemoSection title="LoadingIndicator" description="Spinner paired with helper text.">
      <Stack gap={12}>
        <Text weight={600}>Inline</Text>
        <LoadingIndicator size="sm" text="Syncing updates" />
        <Text weight={600}>Stacked</Text>
        <LoadingIndicator size="md" text="Loading dashboard" layout="stacked" />
      </Stack>
    </DemoSection>
  );
}
