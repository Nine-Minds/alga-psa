/* @vitest-environment node */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDefaultBindingsForPlatform, getShortcutCatalogEntry } from './catalog';

const repoRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('editor shortcut migration contract', () => {
  it('migrates invoice designer shortcuts into editor-scoped actions', () => {
    const source = read('packages/billing/src/components/invoice-designer/hooks/useDesignerShortcuts.ts');
    expect(source).toContain("useShortcutScope('editor')");
    expect(source).toContain("id: 'editor.undo'");
    expect(source).toContain("id: 'editor.redo'");
    expect(source).toContain("id: 'editor.deleteSelection'");
    expect(source).toContain("id: 'editor.cancel'");
    expect(source).toContain("id: 'editor.moveUp'");
    expect(source).not.toContain("window.addEventListener('keydown'");
  });

  it('keeps editor.redo cross-platform defaults in the catalog', () => {
    const redo = getShortcutCatalogEntry('editor.redo');
    expect(redo).toBeDefined();
    expect(getDefaultBindingsForPlatform(redo!, 'mac')).toEqual(['mod+shift+z']);
    expect(getDefaultBindingsForPlatform(redo!, 'other')).toEqual(['ctrl+y', 'ctrl+shift+z']);
  });

  it('marks BlockNote text editor roots as editor scope without registering undo/redo handlers', () => {
    const source = read('packages/ui/src/editor/TextEditor.tsx');
    expect(source).toContain("useShortcutScope('editor')");
    expect(source).toContain('data-keyboard-shortcuts-editor-root="true"');
    expect(source).not.toContain("id: 'editor.undo'");
    expect(source).not.toContain("id: 'editor.redo'");
  });
});
