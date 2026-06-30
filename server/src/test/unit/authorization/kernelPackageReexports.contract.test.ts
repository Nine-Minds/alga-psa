import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

const reexportFiles: Record<string, string> = {
  'server/src/lib/authorization/kernel/contracts.ts': '@alga-psa/authorization/kernel/contracts',
  'server/src/lib/authorization/kernel/engine.ts': '@alga-psa/authorization/kernel/engine',
  'server/src/lib/authorization/kernel/providers/builtinProvider.ts':
    '@alga-psa/authorization/kernel/providers/builtinProvider',
  'server/src/lib/authorization/kernel/providers/bundleProvider.ts':
    '@alga-psa/authorization/kernel/providers/bundleProvider',
  'server/src/lib/authorization/kernel/relationshipTemplates.ts':
    '@alga-psa/authorization/kernel/relationshipTemplates',
  'server/src/lib/authorization/kernel/relationships.ts': '@alga-psa/authorization/kernel/relationships',
  'server/src/lib/authorization/kernel/requestCache.ts': '@alga-psa/authorization/kernel/requestCache',
  'server/src/lib/authorization/kernel/scope.ts': '@alga-psa/authorization/kernel/scope',
};

describe('server authorization kernel package ownership contract', () => {
  it('keeps server-local kernel implementation files as package re-exports', () => {
    for (const [relativePath, packagePath] of Object.entries(reexportFiles)) {
      const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').trim();
      expect(source).toBe(`export * from '${packagePath}';`);
    }
  });
});
