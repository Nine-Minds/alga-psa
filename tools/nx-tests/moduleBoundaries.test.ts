import path from 'node:path';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('module boundary enforcement (eslint rule)', () => {
  it('blocks vertical-to-vertical imports', async () => {
    const { default: rule } = await import('../../eslint-plugin-custom-rules/no-feature-to-feature-imports.js');

    const linter = new Linter();

    const messages = linter.verify(
      "import '@alga-psa/billing';\nexport {};\n",
      [{
        files: ['**/*.ts'],
        languageOptions: { ecmaVersion: 2020, sourceType: 'module' },
        plugins: { 'custom-rules': { rules: { 'no-feature-to-feature-imports': rule } } },
        rules: { 'custom-rules/no-feature-to-feature-imports': 'error' },
      }],
      {
        filename: path.join(process.cwd(), 'packages/clients/src/__lintTmp_invalid.ts'),
      }
    );

    expect(messages.some((m) => m.ruleId === 'custom-rules/no-feature-to-feature-imports')).toBe(true);
  });

  it('allows vertical-to-horizontal imports', async () => {
    const { default: rule } = await import('../../eslint-plugin-custom-rules/no-feature-to-feature-imports.js');

    const linter = new Linter();

    const messages = linter.verify(
      "import '@alga-psa/types';\nexport {};\n",
      [{
        files: ['**/*.ts'],
        languageOptions: { ecmaVersion: 2020, sourceType: 'module' },
        plugins: { 'custom-rules': { rules: { 'no-feature-to-feature-imports': rule } } },
        rules: { 'custom-rules/no-feature-to-feature-imports': 'error' },
      }],
      {
        filename: path.join(process.cwd(), 'packages/clients/src/__lintTmp_valid.ts'),
      }
    );

    expect(messages).toHaveLength(0);
  });
});

describe('appointment-request review links (alga-2026-0002367)', () => {
  it('client-portal appointment request actions import the link builders without crossing a feature boundary', async () => {
    const { readFile } = await import('node:fs/promises');
    const { default: rule } = await import('../../eslint-plugin-custom-rules/no-feature-to-feature-imports.js');
    const { default: tsParser } = await import('@typescript-eslint/parser');

    const filename = path.resolve(
      __dirname,
      '../../packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts',
    );
    const source = await readFile(filename, 'utf8');
    expect(source).toContain('buildAppointmentRequestReviewUrl');

    const messages = new Linter().verify(
      source,
      [{
        files: ['**/*.ts'],
        languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
        plugins: { 'custom-rules': { rules: { 'no-feature-to-feature-imports': rule } } },
        rules: { 'custom-rules/no-feature-to-feature-imports': 'error' },
      }],
      { filename },
    );

    expect(messages.filter((m) => m.fatal)).toEqual([]);
    expect(messages.filter((m) => m.ruleId === 'custom-rules/no-feature-to-feature-imports')).toEqual([]);
  });
});
