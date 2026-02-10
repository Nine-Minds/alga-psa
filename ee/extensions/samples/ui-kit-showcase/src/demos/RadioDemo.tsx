import React from 'react';
import { RadioGroup, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

const fruitOptions = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
];

const disabledOptions = [
  { value: 'on', label: 'Enabled option' },
  { value: 'off', label: 'Disabled option', disabled: true },
  { value: 'also', label: 'Another enabled option' },
];

export function RadioDemo() {
  const [basic, setBasic] = React.useState('apple');
  const [horizontal, setHorizontal] = React.useState('banana');
  const [sm, setSm] = React.useState('apple');
  const [md, setMd] = React.useState('apple');
  const [lg, setLg] = React.useState('apple');
  const [disabled, setDisabled] = React.useState('on');

  return (
    <DemoSection
      title="RadioGroup"
      description="Radio groups with orientation, size, and disabled options."
    >
      <Stack gap={16}>
        <div>
          <Text weight={600}>Basic (vertical)</Text>
          <div style={{ marginTop: 8 }}>
            <RadioGroup
              options={fruitOptions}
              value={basic}
              onChange={setBasic}
            />
          </div>
        </div>
        <div>
          <Text weight={600}>Horizontal</Text>
          <div style={{ marginTop: 8 }}>
            <RadioGroup
              options={fruitOptions}
              value={horizontal}
              onChange={setHorizontal}
              orientation="horizontal"
            />
          </div>
        </div>
        <div>
          <Text weight={600}>Sizes</Text>
          <Stack gap={12} style={{ marginTop: 8 }}>
            <div>
              <Text size="sm" color="muted">Small</Text>
              <RadioGroup
                options={fruitOptions}
                value={sm}
                onChange={setSm}
                orientation="horizontal"
                size="sm"
              />
            </div>
            <div>
              <Text size="sm" color="muted">Medium (default)</Text>
              <RadioGroup
                options={fruitOptions}
                value={md}
                onChange={setMd}
                orientation="horizontal"
                size="md"
              />
            </div>
            <div>
              <Text size="sm" color="muted">Large</Text>
              <RadioGroup
                options={fruitOptions}
                value={lg}
                onChange={setLg}
                orientation="horizontal"
                size="lg"
              />
            </div>
          </Stack>
        </div>
        <div>
          <Text weight={600}>Disabled</Text>
          <div style={{ marginTop: 8 }}>
            <RadioGroup
              options={disabledOptions}
              value={disabled}
              onChange={setDisabled}
            />
          </div>
        </div>
      </Stack>
    </DemoSection>
  );
}
