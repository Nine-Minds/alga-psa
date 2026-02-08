import React from 'react';
import { Alert, AlertTitle, AlertDescription, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function AlertDemo() {
  return (
    <DemoSection title="Alert" description="Contextual alerts with built-in icons, titles, and descriptions.">
      <Stack gap={16}>
        <div>
          <Text weight={600}>Tones with Title and Description</Text>
          <Stack gap={12} style={{ marginTop: 8 }}>
            <Alert tone="info">
              <AlertTitle>Information</AlertTitle>
              <AlertDescription>This is an informational message.</AlertDescription>
            </Alert>
            <Alert tone="success">
              <AlertTitle>Success</AlertTitle>
              <AlertDescription>Operation completed successfully.</AlertDescription>
            </Alert>
            <Alert tone="warning">
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>Double-check your inputs before proceeding.</AlertDescription>
            </Alert>
            <Alert tone="danger">
              <AlertTitle>Danger</AlertTitle>
              <AlertDescription>This action cannot be undone.</AlertDescription>
            </Alert>
          </Stack>
        </div>
        <div>
          <Text weight={600}>Without Icon</Text>
          <Stack gap={12} style={{ marginTop: 8 }}>
            <Alert tone="info" showIcon={false}>
              <AlertTitle>No Icon</AlertTitle>
              <AlertDescription>This alert has showIcon set to false.</AlertDescription>
            </Alert>
          </Stack>
        </div>
      </Stack>
    </DemoSection>
  );
}
