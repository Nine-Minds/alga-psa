import React from 'react';
import { Button, DropdownMenu, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function DropdownMenuDemo() {
  const [lastAction, setLastAction] = React.useState('');

  const items = [
    { key: 'new', label: 'New item', onClick: () => setLastAction('New item') },
    { key: 'edit', label: 'Edit item', onClick: () => setLastAction('Edit item') },
    { key: 'divider-1', label: 'divider', divider: true },
    { key: 'disabled', label: 'Disabled action', disabled: true },
    { key: 'divider-2', label: 'divider', divider: true },
    { key: 'delete', label: 'Delete item', danger: true, onClick: () => setLastAction('Delete item') },
  ];

  return (
    <DemoSection title="DropdownMenu" description="Contextual menu with dividers, disabled, danger items, and alignment.">
      <Stack gap={12}>
        <Stack direction="row" gap={12} style={{ flexWrap: 'wrap' }}>
          <DropdownMenu
            items={items}
            trigger={<Button variant="secondary">Open Menu</Button>}
            align="left"
          />
          <DropdownMenu
            items={items}
            trigger={<Button variant="secondary">Right Align</Button>}
            align="right"
          />
        </Stack>
        {lastAction && <Text tone="muted">Last action: {lastAction}</Text>}
      </Stack>
    </DemoSection>
  );
}
