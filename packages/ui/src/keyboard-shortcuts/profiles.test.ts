import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHORTCUT_PROFILE,
  EMPTY_SHORTCUT_PREFERENCES,
  getProfileBaselineBindings,
  getShortcutProfiles,
  migrateShortcutPreferences,
  normalizeProfileId,
  resolveActionBindings,
  setActionBindingsDelta,
  setProfilePreference,
} from './preferences';
import { getShortcutCatalogEntry } from './catalog';

const selectionOpen = getShortcutCatalogEntry('selection.open')!;
const search = getShortcutCatalogEntry('global.search')!;

describe('shortcut profile presets', () => {
  it('ships default, vim and emacs profiles', () => {
    expect(getShortcutProfiles().map((p) => p.id)).toEqual(['default', 'vim', 'emacs']);
  });

  it('default profile resolves to factory platform defaults', () => {
    expect(resolveActionBindings(selectionOpen, EMPTY_SHORTCUT_PREFERENCES, 'mac')).toEqual(['Enter']);
  });

  it('vim profile remaps selection.open to l via the baseline layer', () => {
    const prefs = setProfilePreference(EMPTY_SHORTCUT_PREFERENCES, 'vim');
    expect(prefs.profile).toBe('vim');
    expect(getProfileBaselineBindings(selectionOpen, 'vim', 'mac')).toEqual(['l']);
    expect(resolveActionBindings(selectionOpen, prefs, 'mac')).toEqual(['l']);
    // actions the profile does not remap still fall back to factory defaults
    expect(resolveActionBindings(search, prefs, 'mac')).toEqual(['mod+k']);
  });

  it('user override wins over the active profile delta', () => {
    const prefs = setActionBindingsDelta(setProfilePreference(EMPTY_SHORTCUT_PREFERENCES, 'vim'), selectionOpen, 'mac', ['o']);
    expect(prefs.bindings['selection.open']).toEqual(['o']);
    expect(resolveActionBindings(selectionOpen, prefs, 'mac')).toEqual(['o']);
  });

  it('an override equal to the profile baseline is dropped (per-action reset → profile baseline)', () => {
    const vim = setProfilePreference(EMPTY_SHORTCUT_PREFERENCES, 'vim');
    const customized = setActionBindingsDelta(vim, selectionOpen, 'mac', ['o']);
    const resetToBaseline = setActionBindingsDelta(customized, selectionOpen, 'mac', ['l']);
    expect(resetToBaseline.bindings['selection.open']).toBeUndefined();
    expect(resolveActionBindings(selectionOpen, resetToBaseline, 'mac')).toEqual(['l']);
  });

  it('normalizes unknown profile ids back to default', () => {
    expect(normalizeProfileId('nope')).toBe(DEFAULT_SHORTCUT_PROFILE);
    expect(normalizeProfileId(undefined)).toBe(DEFAULT_SHORTCUT_PROFILE);
    expect(normalizeProfileId('emacs')).toBe('emacs');
  });

  it('migrates a v1 blob (no profile) to v2 default and preserves a valid stored profile', () => {
    expect(migrateShortcutPreferences({ version: 1, bindings: {}, disabled: [] }).profile).toBe('default');
    expect(migrateShortcutPreferences({ profile: 'emacs', bindings: {}, disabled: [] })).toEqual({
      version: 2,
      profile: 'emacs',
      bindings: {},
      disabled: [],
    });
  });
});
