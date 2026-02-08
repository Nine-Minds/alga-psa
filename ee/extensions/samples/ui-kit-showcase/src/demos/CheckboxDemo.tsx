import React from 'react';
import { Checkbox, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function CheckboxDemo() {
  const [checked, setChecked] = React.useState(true);
  const [indeterminate, setIndeterminate] = React.useState(true);

  return (
    <DemoSection title="Checkbox" description="Checkboxes with checked, indeterminate, size variants, and disabled states.">
      <Stack gap={16}>
        <div>
          <Text weight={600}>States</Text>
          <Stack gap={8} style={{ marginTop: 8 }}>
            <Checkbox
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              label={checked ? 'Checked' : 'Unchecked'}
            />
            <Checkbox
              indeterminate={indeterminate}
              onChange={() => setIndeterminate((prev) => !prev)}
              label="Indeterminate"
            />
            <Checkbox label="Disabled" disabled />
          </Stack>
        </div>
        <div>
          <Text weight={600}>Sizes</Text>
          <Stack direction="row" gap={16} style={{ marginTop: 8, alignItems: 'center' }}>
            <Checkbox size="sm" checked label="Small" />
            <Checkbox size="md" checked label="Medium" />
            <Checkbox size="lg" checked label="Large" />
          </Stack>
        </div>
      </Stack>
    </DemoSection>
  );
}
