import React from 'react';
import { Button, Dialog, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function DialogDemo() {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <DemoSection title="Dialog" description="Modal dialog with title, content, and custom footer actions.">
      <Stack gap={12}>
        <Button onClick={() => setIsOpen(true)}>Open Dialog</Button>
        <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="Invite teammates">
          <Stack gap={12}>
            <Text tone="muted">Invite teammates to collaborate on this account.</Text>
            <Stack direction="row" gap={8} justify="flex-end">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button onClick={() => setIsOpen(false)}>Send Invite</Button>
            </Stack>
          </Stack>
        </Dialog>
      </Stack>
    </DemoSection>
  );
}
