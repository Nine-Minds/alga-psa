import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

const kernelFiles = [
  'server/src/lib/authorization/kernel/engine.ts',
  'server/src/lib/authorization/kernel/index.ts',
  'server/src/lib/authorization/kernel/providers/builtinProvider.ts',
  'server/src/lib/authorization/kernel/providers/bundleProvider.ts',
  'ee/server/src/lib/authorization/kernel.ts',
  'packages/ee/src/lib/authorization/kernel.ts',
];

const forbidden = [
  'PolicyEngine',
  'policyParser',
  'policyEngine',
  'packages/auth/src/actions/policyActions',
  'server/src/lib/policy/PolicyEngine',
  'ee/server/src/lib/auth/policyEngine',
];

describe('authorization kernel legacy direction boundary', () => {
  it('does not depend on legacy policy DSL runtime modules', () => {
    for (const relativePath of kernelFiles) {
      const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
      for (const blockedToken of forbidden) {
        expect(source.includes(blockedToken)).toBe(false);
      }
    }
  });
});
