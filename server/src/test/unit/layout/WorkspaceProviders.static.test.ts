import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutDir = path.resolve(process.cwd(), 'src/components/layout');
const workspaceSource = fs.readFileSync(path.join(layoutDir, 'WorkspaceProviders.tsx'), 'utf8');
const defaultLayoutSource = fs.readFileSync(path.join(layoutDir, 'DefaultLayout.tsx'), 'utf8');

const providerOrder = [
  'SchedulingProviderWithCallbacks',
  'MspTicketIntegrationProvider',
  'MspClientIntegrationProvider',
  'ActivityDrawerProvider',
  'MspClientDrawerProvider',
  'MspClientCrossFeatureProvider',
  'MspAssetCrossFeatureProvider',
  'MspDocumentsCrossFeatureProvider',
  'MspSchedulingCrossFeatureProvider',
  'MspActivityCrossFeatureProvider',
  'QuickAddClientProviderWithCallbacks',
  'DrawerOutlet',
] as const;

describe('WorkspaceProviders static structure', () => {
  it('preserves the DefaultLayout workspace provider nesting order', () => {
    let lastIndex = -1;

    for (const provider of providerOrder) {
      const index = workspaceSource.indexOf(`<${provider}`);
      expect(index, `${provider} should be rendered by WorkspaceProviders`).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
  });

  it('keeps only DrawerProvider state in DefaultLayout', () => {
    expect(defaultLayoutSource).toContain('import { DrawerProvider } from "@alga-psa/ui"');
    expect(defaultLayoutSource).toContain('<DrawerProvider>');
    expect(defaultLayoutSource).not.toContain("import WorkspaceProviders from './WorkspaceProviders'");
    expect(defaultLayoutSource).not.toContain('<WorkspaceProviders>');
    expect(defaultLayoutSource).not.toContain('DrawerOutlet');

    for (const provider of providerOrder.slice(0, -1)) {
      expect(defaultLayoutSource).not.toContain(`import { ${provider} }`);
    }
  });
});
