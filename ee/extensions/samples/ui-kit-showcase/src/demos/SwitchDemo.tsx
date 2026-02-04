import React from 'react';
import { Stack, Switch, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function SwitchDemo() {
  const [enabled, setEnabled] = React.useState(true);

  return (
    <DemoSection title="Switch" description="Toggle switches with size and disabled variants.">
      <Stack gap={16}>
        <div>
          <Text weight={600}>States</Text>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            label={enabled ? 'On' : 'Off'}
          />
        </div>
        <div>
          <Text weight={600}>Sizes</Text>
          <Stack direction="row" gap={12} style={{ marginTop: 8, alignItems: 'center' }}>
            <Switch size="sm" checked label="Sm" />
            <Switch size="md" checked label="Md" />
            <Switch size="lg" checked label="Lg" />
          </Stack>
        </div>
        <div>
          <Text weight={600}>Disabled</Text>
          <Switch disabled checked label="Disabled" />
        </div>
      </Stack>
    </DemoSection>
  );
}
