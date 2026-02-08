import React from 'react';
import { Breadcrumbs, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function BreadcrumbsDemo() {
  return (
    <DemoSection
      title="Breadcrumbs"
      description="Navigation breadcrumbs showing the current page location within a hierarchy."
    >
      <Stack gap={16}>
        <div>
          <Text weight={600}>Basic</Text>
          <div style={{ marginTop: 8 }}>
            <Breadcrumbs
              items={[
                { label: 'Home', href: '#' },
                { label: 'Products', href: '#' },
                { label: 'Categories', href: '#' },
                { label: 'Item' },
              ]}
            />
          </div>
        </div>
        <div>
          <Text weight={600}>Custom Separator</Text>
          <div style={{ marginTop: 8 }}>
            <Breadcrumbs
              separator=">"
              items={[
                { label: 'Dashboard', href: '#' },
                { label: 'Settings', href: '#' },
                { label: 'Profile' },
              ]}
            />
          </div>
        </div>
        <div>
          <Text weight={600}>With onClick handlers</Text>
          <div style={{ marginTop: 8 }}>
            <Breadcrumbs
              items={[
                { label: 'Home', onClick: () => alert('Home clicked') },
                { label: 'Library', onClick: () => alert('Library clicked') },
                { label: 'Current Page' },
              ]}
            />
          </div>
        </div>
      </Stack>
    </DemoSection>
  );
}
