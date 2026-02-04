import React from 'react';
import { Stack, Text, TextArea } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function TextAreaDemo() {
  return (
    <DemoSection title="TextArea" description="Multi-line text inputs with rows, resize, and disabled states.">
      <Stack gap={16}>
        <div style={{ maxWidth: 360 }}>
          <Text weight={600}>Default</Text>
          <TextArea placeholder="Write a message..." style={{ marginTop: 8 }} />
        </div>
        <div style={{ maxWidth: 360 }}>
          <Text weight={600}>Rows</Text>
          <TextArea rows={2} placeholder="2 rows" style={{ marginTop: 8 }} />
          <TextArea rows={4} placeholder="4 rows" style={{ marginTop: 8 }} />
        </div>
        <div style={{ maxWidth: 360 }}>
          <Text weight={600}>Resize options</Text>
          <TextArea rows={2} placeholder="No resize" style={{ marginTop: 8, resize: 'none' }} />
          <TextArea rows={2} placeholder="Vertical resize" style={{ marginTop: 8, resize: 'vertical' }} />
          <TextArea rows={2} placeholder="Horizontal resize" style={{ marginTop: 8, resize: 'horizontal' }} />
          <TextArea rows={2} placeholder="Both" style={{ marginTop: 8, resize: 'both' }} />
        </div>
        <div style={{ maxWidth: 360 }}>
          <Text weight={600}>Disabled</Text>
          <TextArea placeholder="Disabled" disabled style={{ marginTop: 8 }} />
        </div>
      </Stack>
    </DemoSection>
  );
}
