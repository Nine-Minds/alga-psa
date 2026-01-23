import path from 'node:path';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('module boundary enforcement (eslint rule)', () => {
  it('blocks vertical-to-vertical imports', async () => {
    const { default: rule } = await import('../../eslint-plugin-custom-rules/no-feature-to-feature-imports.js');

    const linter = new Linter();
    linter.defineRule('custom-rules/no-feature-to-feature-imports', rule);

    const messages = linter.verify(
      "import '@alga-psa/billing';\nexport {};\n",
      {
        parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
        rules: { 'custom-rules/no-feature-to-feature-imports': 'error' },
      },
      {
        filename: path.join(process.cwd(), 'packages/clients/src/__lintTmp_invalid.ts'),
      }
    );

    expect(messages.some((m) => m.ruleId === 'custom-rules/no-feature-to-feature-imports')).toBe(true);
  });

  it('allows vertical-to-horizontal imports', async () => {
    const { default: rule } = await import('../../eslint-plugin-custom-rules/no-feature-to-feature-imports.js');

    const linter = new Linter();
    linter.defineRule('custom-rules/no-feature-to-feature-imports', rule);

    const messages = linter.verify(
      "import '@alga-psa/types';\nexport {};\n",
      {
        parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
        rules: { 'custom-rules/no-feature-to-feature-imports': 'error' },
      },
      {
        filename: path.join(process.cwd(), 'packages/clients/src/__lintTmp_valid.ts'),
      }
    );

    expect(messages).toHaveLength(0);
  });
});
