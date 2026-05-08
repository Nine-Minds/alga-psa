import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../../..');

function sourceFor(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Standalone extension/integration route product gating contract', () => {
  it('guards extension standalone routes with assertSessionProductAccess', () => {
    const paths = [
      'server/src/app/api/ext/[extensionId]/[[...path]]/route.ts',
      'server/src/app/api/ext-proxy/[extensionId]/[[...path]]/route.ts',
      'server/src/app/api/v1/extensions/install/route.ts',
      'server/src/app/api/v1/extensions/uninstall/route.ts',
      'server/src/app/api' + '/extensions/[extensionId]/sync/route.ts',
    ];

    for (const filePath of paths) {
      const source = sourceFor(filePath);
      expect(source).toContain('assertSessionProductAccess');
      expect(source).toContain("allowedProducts: ['psa']");
    }
  });

  it('guards Entra standalone integration routes with assertSessionProductAccess', () => {
    const paths = [
      'server/src/app/api/integrations/entra/route.ts',
      'server/src/app/api/integrations/entra/connect/route.ts',
      'server/src/app/api/integrations/entra/disconnect/route.ts',
      'server/src/app/api/integrations/entra/discovery/route.ts',
      'server/src/app/api/integrations/entra/mappings/confirm/route.ts',
      'server/src/app/api/integrations/entra/mappings/preview/route.ts',
      'server/src/app/api/integrations/entra/mappings/remap/route.ts',
      'server/src/app/api/integrations/entra/mappings/unmap/route.ts',
      'server/src/app/api/integrations/entra/sync/route.ts',
      'server/src/app/api/integrations/entra/sync/runs/route.ts',
      'server/src/app/api/integrations/entra/sync/runs/[runId]/route.ts',
      'server/src/app/api/integrations/entra/validate-cipp/route.ts',
      'server/src/app/api/integrations/entra/validate-direct/route.ts',
    ];

    for (const filePath of paths) {
      const source = sourceFor(filePath);
      expect(source).toContain('assertSessionProductAccess');
      expect(source).toContain("capability: 'integrations'");
      expect(source).toContain("allowedProducts: ['psa']");
    }
  });
});
