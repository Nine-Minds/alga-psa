import React, { useEffect, useState } from 'react';
import { Stack, Text, Card, Badge } from '@alga/ui-kit';
import { DemoSection } from '../components/DemoSection';

const TOKEN_GROUPS = [
  {
    label: 'Backgrounds',
    tokens: [
      { name: '--alga-bg', desc: 'Page background' },
      { name: '--alga-card-bg', desc: 'Card / elevated surface' },
      { name: '--alga-muted', desc: 'Muted background' },
    ],
  },
  {
    label: 'Text',
    tokens: [
      { name: '--alga-fg', desc: 'Primary text' },
      { name: '--alga-muted-fg', desc: 'Muted / secondary text' },
    ],
  },
  {
    label: 'Borders',
    tokens: [
      { name: '--alga-border', desc: 'Default border' },
      { name: '--alga-border-light', desc: 'Subtle border' },
    ],
  },
  {
    label: 'Primary',
    tokens: [
      { name: '--alga-primary', desc: 'Primary action' },
      { name: '--alga-primary-foreground', desc: 'Text on primary' },
      { name: '--alga-primary-light', desc: 'Primary light shade' },
      { name: '--alga-primary-dark', desc: 'Primary dark shade' },
      { name: '--alga-primary-50', desc: 'Primary 50' },
      { name: '--alga-primary-100', desc: 'Primary 100' },
      { name: '--alga-primary-soft', desc: 'Soft background' },
      { name: '--alga-primary-soft-fg', desc: 'Soft text' },
      { name: '--alga-primary-soft-hover', desc: 'Soft hover' },
      { name: '--alga-primary-border', desc: 'Primary border' },
    ],
  },
  {
    label: 'Secondary & Accent',
    tokens: [
      { name: '--alga-secondary', desc: 'Secondary action' },
      { name: '--alga-secondary-foreground', desc: 'Text on secondary' },
      { name: '--alga-secondary-light', desc: 'Secondary light' },
      { name: '--alga-accent', desc: 'Accent color' },
      { name: '--alga-accent-foreground', desc: 'Text on accent' },
    ],
  },
  {
    label: 'Status',
    tokens: [
      { name: '--alga-danger', desc: 'Error / danger' },
      { name: '--alga-danger-dark', desc: 'Danger dark shade' },
      { name: '--alga-warning', desc: 'Warning' },
      { name: '--alga-success', desc: 'Success' },
    ],
  },
  {
    label: 'Table Rows',
    tokens: [
      { name: '--alga-row-even', desc: 'Even row bg' },
      { name: '--alga-row-odd', desc: 'Odd row bg' },
      { name: '--alga-row-hover', desc: 'Row hover bg' },
    ],
  },
  {
    label: 'Layout',
    tokens: [
      { name: '--alga-radius', desc: 'Border radius' },
      { name: '--alga-ring', desc: 'Focus ring' },
    ],
  },
];

function getComputedVar(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const swatchStyle = (color: string): React.CSSProperties => ({
  width: 32,
  height: 32,
  borderRadius: 'var(--alga-radius, 6px)',
  border: '1px solid var(--alga-border)',
  background: color,
  flexShrink: 0,
});

const tokenRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '6px 0',
};

const monoStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: 12,
  color: 'var(--alga-muted-fg)',
};

export function ThemeDemo() {
  const [, setTick] = useState(0);
  const mode = typeof document !== 'undefined'
    ? document.documentElement.getAttribute('data-theme') || 'light'
    : 'light';

  // Re-render when theme changes so swatch values update
  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    window.addEventListener('alga-theme-change', handler);
    return () => window.removeEventListener('alga-theme-change', handler);
  }, []);

  return (
    <DemoSection
      title="Theme Tokens"
      description="All CSS custom properties available to extensions. Values shown are the currently resolved values."
    >
      <Stack gap={8} style={{ marginBottom: 16 }}>
        <Text size="sm">
          Current mode: <Badge tone={mode === 'dark' ? 'info' : 'default'}>{mode}</Badge>
        </Text>
      </Stack>

      {TOKEN_GROUPS.map((group) => (
        <Card key={group.label} style={{ marginBottom: 16 }}>
          <Text weight={600} style={{ marginBottom: 8 }}>{group.label}</Text>
          {group.tokens.map((token) => {
            const value = getComputedVar(token.name);
            const isColor = value.startsWith('#') || value.startsWith('rgb');
            return (
              <div key={token.name} style={tokenRowStyle}>
                {isColor && <div style={swatchStyle(value)} />}
                {!isColor && <div style={{ ...swatchStyle('transparent'), border: 'none' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" weight={500}>{token.desc}</Text>
                  <div style={monoStyle}>{token.name}: {value || '(empty)'}</div>
                </div>
              </div>
            );
          })}
        </Card>
      ))}
    </DemoSection>
  );
}
