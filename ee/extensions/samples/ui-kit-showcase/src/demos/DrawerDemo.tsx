import React from 'react';
import { Button, Drawer, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

const widths = [
  { label: 'Narrow (300px)', value: '300px' },
  { label: 'Default (400px)', value: '400px' },
  { label: 'Wide (600px)', value: '600px' },
  { label: 'Half (50vw)', value: '50vw' },
];

export function DrawerDemo() {
  const [open, setOpen] = React.useState(false);
  const [width, setWidth] = React.useState('400px');

  const openDrawer = (nextWidth: string) => {
    setWidth(nextWidth);
    setOpen(true);
  };

  return (
    <DemoSection title="Drawer" description="Right-side slide-over panel with custom widths.">
      <Stack gap={16}>
        <div>
          <Text weight={600}>Widths</Text>
          <Stack direction="row" gap={8} style={{ marginTop: 8, flexWrap: 'wrap' }}>
            {widths.map((w) => (
              <Button key={w.value} variant="outline" onClick={() => openDrawer(w.value)}>
                {w.label}
              </Button>
            ))}
          </Stack>
        </div>
      </Stack>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width={width}
        title={`Drawer (${width})`}
      >
        <Stack gap={12}>
          <Text>This drawer can contain navigation or forms.</Text>
          <Button onClick={() => setOpen(false)}>Close drawer</Button>
        </Stack>
      </Drawer>
    </DemoSection>
  );
}
