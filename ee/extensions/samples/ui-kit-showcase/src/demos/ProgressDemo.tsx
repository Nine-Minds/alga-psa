import React from 'react';
import { Progress, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

function StripedProgress({ value }: { value: number }) {
  const percentage = Math.min(100, Math.max(0, value));
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <Progress value={percentage} animated />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          height: 8,
          borderRadius: 999,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: `${percentage}%`,
            height: '100%',
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(255,255,255,0.25) 0, rgba(255,255,255,0.25) 6px, rgba(255,255,255,0) 6px, rgba(255,255,255,0) 12px)',
          }}
        />
      </div>
    </div>
  );
}

export function ProgressDemo() {
  return (
    <DemoSection title="Progress" description="Progress indicators with value, size, variants, and indeterminate mode.">
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
          <Text weight={600}>Variants</Text>
          <Stack gap={8} style={{ marginTop: 8, maxWidth: 320 }}>
            <Progress value={40} variant="default" showLabel />
            <StripedProgress value={60} />
            <Progress value={70} animated showLabel />
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
          <Text weight={600}>Indeterminate</Text>
          <div style={{ marginTop: 8, maxWidth: 320 }}>
            <Progress value={25} indeterminate />
          </div>
        </div>
      </Stack>
    </DemoSection>
  );
}
