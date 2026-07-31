import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRepoFile } from '../test-utils/repoPaths';

const docsSource = readRepoFile('docs/billing/invoice_templates.md');

describe('invoice template AST architecture docs', () => {
  it('documents AST model, evaluator/renderer pipeline, and strategy allowlist extension mechanism', () => {
    expect(docsSource).toContain('TemplateAst');
    expect(docsSource).toContain('evaluator');
    expect(docsSource).toContain('renderer');
    expect(docsSource).toContain('strategyId');
    expect(docsSource).toContain('allowlisted');
  });

  // The "Removed Architecture Layers" section this used to require was
  // dropped when the doc was rewritten (522d011c96). The removals themselves
  // are asserted against the codebase — where they can actually regress — by
  // invoiceLegacyCompilerRemoval.test.ts, so re-asserting them here only
  // pinned the doc's prose.
});
