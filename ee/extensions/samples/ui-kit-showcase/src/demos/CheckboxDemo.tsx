import React from 'react';
import { Checkbox, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function CheckboxDemo() {
  const [checked, setChecked] = React.useState(true);
  const [indeterminate, setIndeterminate] = React.useState(true);

  return (
    <DemoSection title="Checkbox" description="Checkboxes with checked, indeterminate, labeled, and disabled states.">
      <Stack gap={12}>
        <Text weight={600}>States</Text>
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
    </DemoSection>
  );
}
