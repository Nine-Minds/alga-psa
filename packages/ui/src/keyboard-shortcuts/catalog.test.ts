import { describe, expect, it } from 'vitest';
import {
  getDefaultBindingsForPlatform,
  getShortcutCatalogEntry,
  SHORTCUT_ACTION_CATALOG,
} from './catalog';

describe('shortcut action catalog', () => {
  it('resolves editor.redo defaults per platform', () => {
    const redo = getShortcutCatalogEntry('editor.redo');
    expect(redo).toBeDefined();
    expect(getDefaultBindingsForPlatform(redo!, 'mac')).toEqual(['mod+shift+z']);
    expect(getDefaultBindingsForPlatform(redo!, 'other')).toEqual(['ctrl+y', 'ctrl+shift+z']);
  });

  it('defines per-platform defaults and i18n keys for every catalogued action', () => {
    const ids = new Set<string>();

    for (const action of SHORTCUT_ACTION_CATALOG) {
      expect(action.id).toMatch(/^[a-z]+(\.[A-Za-z0-9]+)+$/);
      expect(ids.has(action.id)).toBe(false);
      ids.add(action.id);

      expect(action.labelKey).toBe(`actions.${action.id}.label`);
      expect(action.groupKey).toMatch(/^groups\.[a-z]+$/);
      expect(getDefaultBindingsForPlatform(action, 'mac').length).toBeGreaterThan(0);
      expect(getDefaultBindingsForPlatform(action, 'other').length).toBeGreaterThan(0);
    }

    expect(Array.from(ids)).toEqual(expect.arrayContaining([
      'global.search',
      'global.toggleChat',
      'global.openShortcuts',
      'global.quickCreate',
      'ai.quickAsk',
      'assets.commandPalette',
      'panel.close',
      'drawer.historyBack',
      'drawer.historyForward',
      'record.previous',
      'record.next',
      'editor.undo',
      'editor.redo',
      'editor.save',
      'editor.deleteSelection',
    ]));
  });
});
