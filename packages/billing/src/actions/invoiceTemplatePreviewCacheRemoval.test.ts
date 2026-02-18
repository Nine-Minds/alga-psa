import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('invoice template preview cache removal', () => {
  it('removes the preview compile cache module', () => {
    const cacheModulePath = path.resolve(
      process.cwd(),
      'packages/billing/src/actions/invoiceTemplatePreviewCache.ts'
    );
    expect(fs.existsSync(cacheModulePath)).toBe(false);
  });

  it('keeps preview action free of preview compile cache references', () => {
    const previewActionSource = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/billing/src/actions/invoiceTemplatePreview.ts'),
      'utf8'
    );

    expect(previewActionSource).not.toContain('invoiceTemplatePreviewCache');
    expect(previewActionSource).not.toContain('getCachedPreviewCompileArtifact');
    expect(previewActionSource).not.toContain('setCachedPreviewCompileArtifact');
  });
});
