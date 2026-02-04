import React from 'react';
import { Alert, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function AlertDemo() {
  return (
    <DemoSection title="Alert" description="Contextual alerts for information, success, warning, and danger messages.">
      <Stack gap={12}>
        <Alert tone="info">
          <Text weight={600}>Info</Text>
          <div>Heads up! This is an informational alert.</div>
        </Alert>
        <Alert tone="success">
          <Text weight={600}>Success</Text>
          <div>Operation completed successfully.</div>
        </Alert>
        <Alert tone="warning">
          <Text weight={600}>Warning</Text>
          <div>Double-check your inputs before proceeding.</div>
        </Alert>
        <Alert tone="danger">
          <Text weight={600}>Danger</Text>
          <div>This action cannot be undone.</div>
        </Alert>
      </Stack>
    </DemoSection>
  );
}
