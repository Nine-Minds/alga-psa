import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('CommentItem clipboard image rendering contract', () => {
  it('T012: renders saved BlockNote content through RichTextViewer for inline image display', () => {
    const filePath = path.resolve(__dirname, './CommentItem.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).toContain("if (noteContent.trim().startsWith('['))");
    expect(source).toContain('const result = JSON.parse(noteContent)');
    expect(source).toContain('<RichTextViewer');
    expect(source).toContain('content={parsed as any}');
  });

  it('wires clipboard image upload for edit-mode TextEditor in existing comments', () => {
    const filePath = path.resolve(__dirname, './CommentItem.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).toContain('uploadFile?: (file: File, blockId?: string) => Promise<string>;');
    expect(source).toContain('uploadFile={uploadFile}');
  });
});
