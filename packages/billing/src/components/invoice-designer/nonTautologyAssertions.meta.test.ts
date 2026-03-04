import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type BehavioralAssertionContract = {
  relativePath: string;
  requiredSignals: Array<{
    description: string;
    pattern: RegExp;
  }>;
};

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);
const repoRoot = path.resolve(thisDir, '../../../../../');

const scopedContracts: BehavioralAssertionContract[] = [
  {
    relativePath: 'packages/billing/src/components/invoice-designer/ast/workspaceAst.test.ts',
    requiredSignals: [
      {
        description: 'single moustache token compiles into AST path expression',
        pattern: /expect\(\s*toLabel\.content\s*\)\.toEqual\(\s*\{\s*type:\s*'path',\s*path:\s*'total'\s*\}\s*\)/,
      },
      {
        description: 'mixed template text compiles to AST template expression',
        pattern: /expect\(\s*interpolated\.content\.type\s*\)\.toBe\(\s*'template'\s*\)/,
      },
      {
        description: 'template args assertions verify resolved semantic binding paths',
        pattern: /expect\(\s*argPaths\s*\)\.toContain\(\s*'invoiceNumber'\s*\)/,
      },
    ],
  },
  {
    relativePath: 'packages/billing/src/components/invoice-designer/DesignerShell.insertion.integration.test.tsx',
    requiredSignals: [
      {
        description: 'insertion fallback asserts model/store mutation',
        pattern: /useInvoiceDesignerStore\.getState\(\)\.nodes\.find\(/,
      },
      {
        description: 'invalid-path insertion asserts user-facing diagnostic feedback',
        pattern: /Unknown path "invoice\.missingField" for current context\./,
      },
      {
        description: 'cursor assertions verify insertion semantics beyond raw text echo',
        pattern: /expect\(\s*input\.selectionStart\s*\)\.toBe\(\s*input\.value\.length\s*\)/,
      },
    ],
  },
  {
    relativePath: 'ee/server/src/components/workflow-designer/__tests__/expressionValidation.test.ts',
    requiredSignals: [
      {
        description: 'shared diagnostics assert path attribution behavior',
        pattern: /const diagnosticPaths = validations\.map\(\(validation\) => validation\.diagnostic\.path\);/,
      },
      {
        description: 'unknown/missing references are asserted from shared validation output',
        pattern: /expect\(diagnosticPaths\)\.toContain\('vars\.missing\.id'\)/,
      },
      {
        description: 'panel grouping asserts severity partition behavior',
        pattern: /expect\(groups\.warnings\.map\(\(entry\) => entry\.field\)\)\.toEqual\(\['config\.b'\]\)/,
      },
    ],
  },
];

describe('non-tautological insertion and validation coverage', () => {
  it('requires semantic assertions on AST/model/diagnostic behavior', () => {
    const failures: string[] = [];

    for (const contract of scopedContracts) {
      const absolutePath = path.resolve(repoRoot, contract.relativePath);
      const content = readFileSync(absolutePath, 'utf8');

      for (const signal of contract.requiredSignals) {
        if (!signal.pattern.test(content)) {
          failures.push(`${contract.relativePath}: missing semantic assertion signal (${signal.description})`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
