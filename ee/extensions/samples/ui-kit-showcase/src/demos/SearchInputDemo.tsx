import React from 'react';
import { SearchInput, Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

export function SearchInputDemo() {
  const [value, setValue] = React.useState('');
  const [debouncedValue, setDebouncedValue] = React.useState('');

  return (
    <DemoSection title="SearchInput" description="Search input with clear, loading, sizing, and debounce behavior.">
      <Stack gap={16}>
        <div style={{ maxWidth: 320 }}>
          <Text weight={600}>Basic</Text>
          <SearchInput
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search accounts"
            style={{ marginTop: 8 }}
          />
        </div>
        <div style={{ maxWidth: 320 }}>
          <Text weight={600}>Clear button</Text>
          <SearchInput
            value={value}
            onChange={(e) => setValue(e.target.value)}
            showClear
            placeholder="Type to show clear"
            style={{ marginTop: 8 }}
          />
        </div>
        <div style={{ maxWidth: 320 }}>
          <Text weight={600}>Loading</Text>
          <SearchInput
            value={value}
            onChange={(e) => setValue(e.target.value)}
            loading
            placeholder="Loading results"
            style={{ marginTop: 8 }}
          />
        </div>
        <div>
          <Text weight={600}>Sizes</Text>
          <Stack gap={8} style={{ marginTop: 8, maxWidth: 320 }}>
            <SearchInput size="sm" placeholder="Small" />
            <SearchInput size="md" placeholder="Medium" />
            <SearchInput size="lg" placeholder="Large" />
          </Stack>
        </div>
        <div style={{ maxWidth: 320 }}>
          <Text weight={600}>Debounce</Text>
          <SearchInput
            debounceMs={400}
            onSearch={(next) => setDebouncedValue(next)}
            placeholder="Debounced search"
            style={{ marginTop: 8 }}
          />
          <Text size="sm" tone="muted" style={{ marginTop: 6 }}>
            Debounced value: {debouncedValue || '—'}
          </Text>
        </div>
      </Stack>
    </DemoSection>
  );
}
