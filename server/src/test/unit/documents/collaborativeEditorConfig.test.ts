import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const editorPath = resolve(
  __dirname,
  '../../../../../packages/documents/src/components/CollaborativeEditor.tsx'
);

describe('CollaborativeEditor configuration', () => {
  it('includes the Emoticon extension', () => {
    const contents = readFileSync(editorPath, 'utf8');

    expect(contents).toContain('Emoticon');
  });

  it('configures Link with autolink and safe target attributes', () => {
    const contents = readFileSync(editorPath, 'utf8');

    expect(contents).toContain('Link.configure');
    expect(contents).toContain('openOnClick: false');
    expect(contents).toContain('autolink: true');
    expect(contents).toContain('linkOnPaste: true');
    expect(contents).toContain("target: '_blank'");
    expect(contents).toContain("rel: 'noopener noreferrer'");
  });
});
