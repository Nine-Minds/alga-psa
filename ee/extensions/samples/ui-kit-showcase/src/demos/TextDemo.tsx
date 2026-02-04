import React from 'react';
import { Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function TextDemo() {
  return (
    <DemoSection title="Text" description="Typography helpers with size, weight, and element variants.">
      <Stack gap={16}>
        <div>
          <Text weight={600}>Sizes</Text>
          <Stack gap={6} style={{ marginTop: 8 }}>
            <Text size="xs">Extra small text</Text>
            <Text size="sm">Small text</Text>
            <Text size="md">Medium text</Text>
            <Text size="lg">Large text</Text>
          </Stack>
        </div>
        <div>
          <Text weight={600}>Weights</Text>
          <Stack gap={6} style={{ marginTop: 8 }}>
            <Text weight={400}>Regular 400</Text>
            <Text weight={500}>Medium 500</Text>
            <Text weight={600}>Semi-bold 600</Text>
            <Text weight={700}>Bold 700</Text>
          </Stack>
        </div>
        <div>
          <Text weight={600}>Elements</Text>
          <Stack gap={6} style={{ marginTop: 8 }}>
            <Text as={'h1' as any} size="lg" weight={700}>Heading 1</Text>
            <Text as={'h2' as any} size="lg" weight={600}>Heading 2</Text>
            <Text as="p">Paragraph text rendered via Text</Text>
            <Text as="span">Span inline text</Text>
          </Stack>
        </div>
      </Stack>
    </DemoSection>
  );
}
