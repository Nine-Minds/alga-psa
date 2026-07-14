import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

const readFile = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), 'utf-8');

describe('MSP workspace includes SchedulingProviderWithCallbacks', () => {
  it('wires SchedulingProviderWithCallbacks around the shared workspace providers', () => {
    const content = readFile('server/src/components/layout/WorkspaceProviders.tsx');
    expect(content).toContain("import { SchedulingProviderWithCallbacks } from '@alga-psa/scheduling/providers/SchedulingProviderWithCallbacks'");
    expect(content).toContain('<SchedulingProviderWithCallbacks>');
    expect(content).toContain('</SchedulingProviderWithCallbacks>');
  });

  it('mounts WorkspaceProviders from the MSP route layout', () => {
    const content = readFile('server/src/app/msp/_components/WorkspaceRouteLayout.tsx');
    expect(content).toContain("import WorkspaceProviders from '@/components/layout/WorkspaceProviders'");
    expect(content).toContain('<WorkspaceProviders>{children}</WorkspaceProviders>');
  });
});
