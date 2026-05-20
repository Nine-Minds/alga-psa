import { describe, expect, it } from 'vitest';
import {
  EMPTY_SHORTCUT_PREFERENCES,
  isActionDisabled,
  migrateShortcutPreferences,
  resolveActionBindings,
  setActionBindingsDelta,
  setActionDisabled,
  validateShortcutPreferences,
} from './preferences';
import { getShortcutCatalogEntry } from './catalog';

describe('shortcut preferences', () => {
  it('stores only neutral deltas and drops values equal to the current platform default', () => {
    const search = getShortcutCatalogEntry('global.search')!;
    const customized = setActionBindingsDelta(EMPTY_SHORTCUT_PREFERENCES, search, 'mac', ['mod+j']);
    expect(customized.bindings).toEqual({ 'global.search': ['mod+j'] });

    const reset = setActionBindingsDelta(customized, search, 'mac', ['mod+k']);
    expect(reset.bindings).toEqual({});
  });

  it('resolves user override or platform default without rewriting cross-device mod bindings', () => {
    const search = getShortcutCatalogEntry('global.search')!;
    const preferences = setActionBindingsDelta(EMPTY_SHORTCUT_PREFERENCES, search, 'mac', ['mod+j']);
    expect(resolveActionBindings(search, preferences, 'other')).toEqual(['mod+j']);

    const redo = getShortcutCatalogEntry('editor.redo')!;
    expect(resolveActionBindings(redo, EMPTY_SHORTCUT_PREFERENCES, 'other')).toEqual(['ctrl+y', 'ctrl+shift+z']);
  });

  it('validates hostile/reserved combos without rewriting them', () => {
    const preferences = {
      version: 2,
      profile: 'default',
      bindings: {
        'record.next': ['alt+ArrowRight'],
        'global.search': ['mod+r'],
      },
      disabled: [],
    };

    expect(validateShortcutPreferences(preferences, 'other')).toEqual([
      { actionId: 'record.next', binding: 'alt+ArrowRight', code: 'hostile' },
      { actionId: 'global.search', binding: 'mod+r', code: 'reserved' },
    ]);
    expect(preferences.bindings['record.next']).toEqual(['alt+ArrowRight']);
  });

  it('migrates old or malformed blobs to the current version without data loss', () => {
    expect(migrateShortcutPreferences({ bindings: { 'global.search': ['mod+j'] } })).toEqual({
      version: 2,
      profile: 'default',
      bindings: { 'global.search': ['mod+j'] },
      disabled: [],
    });
    expect(migrateShortcutPreferences({ version: 1, profile: 'vim', bindings: {}, disabled: [] })).toEqual({
      version: 2,
      profile: 'vim',
      bindings: {},
      disabled: [],
    });
    expect(migrateShortcutPreferences(null)).toEqual(EMPTY_SHORTCUT_PREFERENCES);
  });

  it('honors disabled action ids', () => {
    const disabled = setActionDisabled(EMPTY_SHORTCUT_PREFERENCES, 'global.search', true);
    expect(isActionDisabled('global.search', disabled)).toBe(true);
    expect(isActionDisabled('global.search', setActionDisabled(disabled, 'global.search', false))).toBe(false);
  });
});
