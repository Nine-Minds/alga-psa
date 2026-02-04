import React from 'react';
import { Button, Drawer, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

const sizes: Array<'sm' | 'md' | 'lg' | 'full'> = ['sm', 'md', 'lg', 'full'];
const positions: Array<'right' | 'left' | 'bottom'> = ['right', 'left', 'bottom'];

export function DrawerDemo() {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<'right' | 'left' | 'bottom'>('right');
  const [size, setSize] = React.useState<'sm' | 'md' | 'lg' | 'full'>('md');

  const openDrawer = (nextPosition: typeof position, nextSize: typeof size) => {
    setPosition(nextPosition);
    setSize(nextSize);
    setOpen(true);
  };

  return (
    <DemoSection title="Drawer" description="Slide-over panel with positions, sizes, and header content.">
      <Stack gap={16}>
        <div>
          <Text weight={600}>Positions</Text>
          <Stack direction="row" gap={8} style={{ marginTop: 8, flexWrap: 'wrap' }}>
            {positions.map((pos) => (
              <Button key={pos} variant="secondary" onClick={() => openDrawer(pos, size)}>
                Open {pos}
              </Button>
            ))}
          </Stack>
        </div>
        <div>
          <Text weight={600}>Sizes</Text>
          <Stack direction="row" gap={8} style={{ marginTop: 8, flexWrap: 'wrap' }}>
            {sizes.map((s) => (
              <Button key={s} variant="ghost" onClick={() => openDrawer(position, s)}>
                {s.toUpperCase()}
              </Button>
            ))}
          </Stack>
        </div>
      </Stack>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        position={position}
        size={size}
        title={`Drawer ${position} (${size})`}
      >
        <Stack gap={12}>
          <Text>This drawer can contain navigation or forms.</Text>
          <Button onClick={() => setOpen(false)}>Close drawer</Button>
        </Stack>
      </Drawer>
    </DemoSection>
  );
}
