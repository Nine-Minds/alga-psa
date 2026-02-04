import React from 'react';
import { Stack, Text } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

const boxStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 8,
  background: 'var(--alga-primary)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 600,
};

export function StackDemo() {
  return (
    <DemoSection title="Stack" description="Layout helper for vertical and horizontal arrangements with spacing and alignment.">
      <Stack gap={16}>
        <div>
          <Text weight={600}>Direction</Text>
          <Stack direction="row" gap={8} style={{ marginTop: 8 }}>
            <div style={boxStyle}>A</div>
            <div style={boxStyle}>B</div>
            <div style={boxStyle}>C</div>
          </Stack>
          <Stack direction="column" gap={8} style={{ marginTop: 12, maxWidth: 80 }}>
            <div style={boxStyle}>1</div>
            <div style={boxStyle}>2</div>
          </Stack>
        </div>
        <div>
          <Text weight={600}>Gap + Alignment</Text>
          <Stack direction="row" gap={24} align="center" justify="space-between" style={{ marginTop: 8, background: 'var(--alga-muted)', padding: 12, borderRadius: 8 }}>
            <div style={boxStyle}>L</div>
            <div style={boxStyle}>M</div>
            <div style={boxStyle}>R</div>
          </Stack>
        </div>
      </Stack>
    </DemoSection>
  );
}
