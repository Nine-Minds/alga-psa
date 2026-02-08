import React from 'react';
import { Spinner, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function SpinnerDemo() {
  return (
    <DemoSection title="Spinner" description="Loading spinner with size, button, and inverted variants.">
      <Stack gap={16}>
        <div>
          <Text weight={600}>Sizes</Text>
          <Stack direction="row" gap={16} align="center" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <Spinner size="xs" />
            <Spinner size="sm" />
            <Spinner size="md" />
            <Spinner size="lg" />
          </Stack>
        </div>
        <div>
          <Text weight={600}>Button Size</Text>
          <Stack direction="row" gap={8} align="center" style={{ marginTop: 8 }}>
            <Spinner size="button" />
            <Text size="sm" tone="muted">Compact size for use inside buttons</Text>
          </Stack>
        </div>
        <div>
          <Text weight={600}>Inverted Variant</Text>
          <Stack direction="row" gap={16} align="center" style={{ marginTop: 8 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px 24px',
              background: 'var(--alga-primary, #9855ee)',
              borderRadius: 'var(--alga-radius, 8px)',
            }}>
              <Spinner size="sm" variant="inverted" />
            </div>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px 24px',
              background: '#1f2937',
              borderRadius: 'var(--alga-radius, 8px)',
            }}>
              <Spinner size="md" variant="inverted" />
            </div>
          </Stack>
        </div>
      </Stack>
    </DemoSection>
  );
}
