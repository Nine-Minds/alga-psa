import { describe, expect, it } from 'vitest';
import {
  createShortcutAction,
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
      'global.commandPalette',
      'global.toggleChat',
      'global.openShortcuts',
      'global.quickCreate',
      'ai.quickAsk',
      'scroll.halfDown',
      'scroll.fullUp',
      'table.nextRow',
      'table.toggleRow',
      'repeat.lastAction',
      'linkhints.show',
      'macro.record',
      'navigation.goDashboard',
      'navigation.goProjects',
      'navigation.backToParent',
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

  it('creates runtime actions from catalog metadata and rejects unknown ids', () => {
    const handler = () => undefined;
    const action = createShortcutAction('global.search', handler);
    const catalog = getShortcutCatalogEntry('global.search');

    expect(action).toMatchObject({
      id: 'global.search',
      labelKey: catalog?.labelKey,
      groupKey: catalog?.groupKey,
      defaultBindings: catalog?.defaultBindings,
      scope: catalog?.scope,
      priority: catalog?.priority,
    });
    expect(action.handler).toBe(handler);
    expect(() => createShortcutAction('missing.action', handler)).toThrow(/Unknown keyboard shortcut action/);
  });
});
