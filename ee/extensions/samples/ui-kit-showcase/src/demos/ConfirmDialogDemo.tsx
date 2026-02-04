import React from 'react';
import { Button, ConfirmDialog, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function ConfirmDialogDemo() {
  const [mode, setMode] = React.useState<'default' | 'danger' | null>(null);
  const [lastAction, setLastAction] = React.useState<string>('');

  const close = () => setMode(null);

  return (
    <DemoSection title="ConfirmDialog" description="Confirmation dialog with confirm/cancel actions and danger variant.">
      <Stack gap={12}>
        <Stack direction="row" gap={8} style={{ flexWrap: 'wrap' }}>
          <Button onClick={() => setMode('default')}>Open Confirm</Button>
          <Button variant="danger" onClick={() => setMode('danger')}>Open Danger Confirm</Button>
        </Stack>
        {lastAction && <Text tone="muted">Last action: {lastAction}</Text>}
        <ConfirmDialog
          isOpen={mode === 'default'}
          title="Confirm update"
          message="Are you sure you want to apply these changes?"
          onConfirm={() => {
            setLastAction('Confirmed');
            close();
          }}
          onCancel={() => {
            setLastAction('Canceled');
            close();
          }}
        />
        <ConfirmDialog
          isOpen={mode === 'danger'}
          title="Delete project"
          message="This action permanently removes the project."
          variant="danger"
          confirmLabel="Delete"
          onConfirm={() => {
            setLastAction('Deleted');
            close();
          }}
          onCancel={() => {
            setLastAction('Canceled');
            close();
          }}
        />
      </Stack>
    </DemoSection>
  );
}
