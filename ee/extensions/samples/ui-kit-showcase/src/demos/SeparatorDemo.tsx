import React from 'react';
import { Separator, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function SeparatorDemo() {
  return (
    <DemoSection
      title="Separator"
      description="A visual divider between content sections, supporting horizontal and vertical orientations."
    >
      <Stack gap={16}>
        <div>
          <Text weight={600}>Horizontal</Text>
          <div style={{ marginTop: 8 }}>
            <Text>Content above the separator</Text>
            <Separator style={{ margin: '12px 0' }} />
            <Text>Content below the separator</Text>
          </div>
        </div>
        <div>
          <Text weight={600}>Vertical</Text>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 8,
              height: 32,
            }}
          >
            <Text>Left</Text>
            <Separator orientation="vertical" />
            <Text>Center</Text>
            <Separator orientation="vertical" />
            <Text>Right</Text>
          </div>
        </div>
      </Stack>
    </DemoSection>
  );
}
