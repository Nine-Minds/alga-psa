import React from 'react';
import { Skeleton, SkeletonCircle, SkeletonRectangle, SkeletonText, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function SkeletonDemo() {
  return (
    <DemoSection title="Skeleton" description="Loading placeholders for content, text, avatars, and media blocks.">
      <Stack gap={16}>
        <div>
          <Text weight={600}>Basic</Text>
          <div style={{ marginTop: 8, maxWidth: 240 }}>
            <Skeleton height={12} />
          </div>
        </div>
        <div>
          <Text weight={600}>Text Lines</Text>
          <div style={{ marginTop: 8, maxWidth: 320 }}>
            <SkeletonText lines={3} />
          </div>
        </div>
        <div>
          <Text weight={600}>Circle</Text>
          <div style={{ marginTop: 8 }}>
            <SkeletonCircle width={48} height={48} />
          </div>
        </div>
        <div>
          <Text weight={600}>Rectangle</Text>
          <div style={{ marginTop: 8, maxWidth: 320 }}>
            <SkeletonRectangle width="100%" height={120} />
          </div>
        </div>
      </Stack>
    </DemoSection>
  );
}
