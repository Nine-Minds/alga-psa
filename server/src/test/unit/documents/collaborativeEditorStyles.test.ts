import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('CollaborativeEditor styles', () => {
  it('uses design system color variables for cursor labels', () => {
    const cssPath = resolve(
      __dirname,
      '../../../../../packages/documents/src/components/CollaborativeEditor.module.css'
    );
    const contents = readFileSync(cssPath, 'utf8');

    expect(contents).toContain('.collaboration-caret__label');
    expect(contents).toContain('.collaboration-cursor__label');
    expect(contents).toContain('--color-text-0');
    expect(contents).toContain('--color-text-900');
  });
});
