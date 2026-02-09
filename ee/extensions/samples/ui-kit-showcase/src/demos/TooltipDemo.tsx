import React from 'react';
import { Button, Stack, Text, Tooltip } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function TooltipDemo() {
  return (
    <DemoSection title="Tooltip" description="Hover or focus to reveal contextual hints in multiple positions.">
      <Stack gap={12}>
        <Text weight={600}>Positions</Text>
        <Stack direction="row" gap={12} style={{ flexWrap: 'wrap' }}>
          <Tooltip content="Tooltip on top" position="top">
            <Button variant="secondary">Top</Button>
          </Tooltip>
          <Tooltip content="Tooltip on bottom" position="bottom">
            <Button variant="secondary">Bottom</Button>
          </Tooltip>
          <Tooltip content="Tooltip on left" position="left">
            <Button variant="secondary">Left</Button>
          </Tooltip>
          <Tooltip content="Tooltip on right" position="right">
            <Button variant="secondary">Right</Button>
          </Tooltip>
        </Stack>
      </Stack>
    </DemoSection>
  );
}
