import React from 'react';
import { Progress, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';
 
export function ProgressDemo() {
  return (
    <DemoSection title="Progress" description="Progress indicators with value, size, colors, labels, and indeterminate mode.">
      <Stack gap={16}>
        <div>
          <Text weight={600}>Values</Text>
          <Stack gap={8} style={{ marginTop: 8, maxWidth: 320 }}>
            <Progress value={0} showLabel />
            <Progress value={50} showLabel />
            <Progress value={100} showLabel />
          </Stack>
        </div>
        <div>
          <Text weight={600}>Colors</Text>
          <Stack gap={8} style={{ marginTop: 8, maxWidth: 320 }}>
            <Progress value={60} variant="default" showLabel />
            <Progress value={75} variant="success" showLabel />
            <Progress value={45} variant="warning" showLabel />
            <Progress value={30} variant="danger" showLabel />
          </Stack>
        </div>
        <div>
          <Text weight={600}>Sizes</Text>
          <Stack gap={8} style={{ marginTop: 8, maxWidth: 320 }}>
            <Progress value={35} size="sm" />
            <Progress value={35} size="md" />
            <Progress value={35} size="lg" />
          </Stack>
        </div>
        <div>
          <Text weight={600}>Labels</Text>
          <Stack gap={8} style={{ marginTop: 8, maxWidth: 320 }}>
            <Progress value={40} showLabel labelPosition="outside" />
            <Progress value={65} size="lg" showLabel labelPosition="inside" />
          </Stack>
        </div>
        <div>
          <Text weight={600}>Animated and Striped</Text>
          <Stack gap={8} style={{ marginTop: 8, maxWidth: 320 }}>
            <Progress value={70} animated showLabel />
            <Progress value={60} striped showLabel />
          </Stack>
        </div>
        <div>
          <Text weight={600}>Indeterminate</Text>
          <Stack gap={8} style={{ marginTop: 8, maxWidth: 320 }}>
            <Progress value={0} indeterminate />
            <Progress value={0} indeterminate variant="success" />
          </Stack>
        </div>
      </Stack>
    </DemoSection>
  );
}
