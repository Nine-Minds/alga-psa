import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);

type UiTestContract = {
  relativePath: string;
  renderSemanticsOnly?: boolean;
};

const scopedUiTests: UiTestContract[] = [
  { relativePath: 'DesignerShell.insertion.integration.test.tsx' },
  { relativePath: 'palette/ComponentPalette.fields.integration.test.tsx' },
  { relativePath: 'canvas/DesignCanvas.previewMode.test.tsx', renderSemanticsOnly: true },
];

const hasSelectorSignal = (content: string): boolean => {
  const selectorPatterns = [
    /getByRole\(/,
    /getAllByRole\(/,
    /findByRole\(/,
    /findAllByRole\(/,
    /queryByRole\(/,
    /queryAllByRole\(/,
    /data-automation-id/,
  ];

  return selectorPatterns.some((pattern) => pattern.test(content));
};

describe('React UI test implementation standards (plan scope)', () => {
  it('uses Vitest + Testing Library and selector guidance for scoped UI tests', () => {
    const violations: string[] = [];

    for (const testFile of scopedUiTests) {
      const absolutePath = path.resolve(thisDir, testFile.relativePath);
      const content = readFileSync(absolutePath, 'utf8');

      if (!/from ['"]vitest['"]/.test(content)) {
        violations.push(`${testFile.relativePath}: missing vitest import`);
      }

      if (!/from ['"]@testing-library\/react['"]/.test(content)) {
        violations.push(`${testFile.relativePath}: missing @testing-library/react import`);
      }

      if (!testFile.renderSemanticsOnly && !hasSelectorSignal(content)) {
        violations.push(`${testFile.relativePath}: missing role/automation selector usage`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('documents explicit render-semantics exception files', () => {
    const exceptionFiles = scopedUiTests
      .filter((item) => item.renderSemanticsOnly)
      .map((item) => item.relativePath);

    expect(exceptionFiles).toEqual(['canvas/DesignCanvas.previewMode.test.tsx']);
  });
});
