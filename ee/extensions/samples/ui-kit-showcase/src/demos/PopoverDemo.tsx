import React from 'react';
import { Button, Popover, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function PopoverDemo() {
  return (
    <DemoSection
      title="Popover"
      description="Click-triggered floating panel positioned relative to a trigger element."
    >
      <Stack gap={16}>
        <div>
          <Text weight={600}>Basic</Text>
          <div style={{ marginTop: 8 }}>
            <Popover trigger={<Button variant="secondary">Open Popover</Button>}>
              <Text>This is the popover content. Click outside or press Escape to close.</Text>
            </Popover>
          </div>
        </div>
        <div>
          <Text weight={600}>Alignments</Text>
          <Stack direction="row" gap={16} style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <Popover
              trigger={<Button variant="outline">Start</Button>}
              align="start"
            >
              <Text>Aligned to start</Text>
            </Popover>
            <Popover
              trigger={<Button variant="outline">Center</Button>}
              align="center"
            >
              <Text>Aligned to center</Text>
            </Popover>
            <Popover
              trigger={<Button variant="outline">End</Button>}
              align="end"
            >
              <Text>Aligned to end</Text>
            </Popover>
          </Stack>
        </div>
        <div>
          <Text weight={600}>Top Side</Text>
          <div style={{ marginTop: 8 }}>
            <Popover
              trigger={<Button variant="secondary">Opens Above</Button>}
              side="top"
              align="start"
            >
              <Text>This popover appears above the trigger.</Text>
            </Popover>
          </div>
        </div>
      </Stack>
    </DemoSection>
  );
}
