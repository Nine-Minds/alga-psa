import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The asset focus drawer: one scroll container and a pinned footer.
 *
 * Without a `footer`, `Drawer` makes the panel itself `overflow-y-auto` on top
 * of the content pane — two nested scrollbars — and the edit form's Save sat
 * at the end of a 1500px form, far below the fold.
 */
describe('AssetBentoLayout focus drawer', () => {
  const source = readFileSync(resolve(__dirname, 'AssetBentoLayout.tsx'), 'utf8');

  it('pins a footer on every view so the panel is not a second scroller', () => {
    expect(source).toContain('footer={activeView?.footer ?? closeFooter}');
    expect(source).toContain('id="asset-bento-focus-done"');
    // Exactly one scrollable region for the view content.
    expect(source.match(/className="flex-1 overflow-y-auto min-w-0 pl-4 pr-1 pt-4"/g)).toHaveLength(1);
  });

  it('gives the edit view Save and Cancel in that footer', () => {
    expect(source).toContain('id="asset-bento-focus-cancel"');
    expect(source).toContain('id="asset-bento-focus-save"');
    expect(source).toContain('type="submit" form="asset-edit-form"');
    expect(source).toContain('onSavingChange={setEditSaving}');
    // The form's own trailing row would otherwise duplicate them.
    expect(source).toContain('hideActions');
  });

  it('names the form the footer submits', () => {
    const form = readFileSync(resolve(__dirname, 'AssetForm.tsx'), 'utf8');
    expect(form).toContain('id="asset-edit-form"');
  });
});
