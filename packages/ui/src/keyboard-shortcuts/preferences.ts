import { parseBinding } from './parser';
import { getDefaultBindingsForPlatform, type ShortcutActionCatalogEntry } from './catalog';
import type { PersistedShortcuts, Platform, ShortcutBindingDefaults } from './types';

export const KEYBOARD_SHORTCUTS_PREFERENCE_KEY = 'keyboard_shortcuts_v1';
export const SHORTCUT_PREFERENCES_VERSION = 2;
export const DEFAULT_SHORTCUT_PROFILE = 'default';

export interface ShortcutProfile {
  id: string;
  /** i18n key for the display name; `name` is the English fallback. */
  nameKey: string;
  name: string;
  /** Per-action binding overrides applied on top of factory defaults. */
  deltas: Readonly<Record<string, readonly string[]>>;
}

// Preset profiles. `default` is factory defaults (no deltas). The vim/emacs
// deltas are deliberately conservative, parser-valid single chords keyed by
// real catalog action ids — multi-chord Emacs sequences are intentionally NOT
// assigned to non-sequence actions (they would silently never dispatch). These
// presets are best-guess pending team confirmation (design handoff open Q).
export const SHORTCUT_PROFILES: readonly ShortcutProfile[] = [
  { id: 'default', nameKey: 'profiles.default', name: 'Default', deltas: {} },
  {
    id: 'vim',
    nameKey: 'profiles.vim',
    name: 'Vim-style',
    deltas: {
      'global.quickCreate': ['i'],
      'selection.open': ['l'],
      'record.next': ['j'],
      'record.previous': ['k'],
    },
  },
  {
    id: 'emacs',
    nameKey: 'profiles.emacs',
    name: 'Emacs-style',
    deltas: {
      'selection.next': ['ctrl+n'],
      'selection.previous': ['ctrl+p'],
      'selection.open': ['ctrl+m'],
    },
  },
];

const PROFILE_BY_ID = new Map(SHORTCUT_PROFILES.map((profile) => [profile.id, profile]));

export function getShortcutProfiles(): readonly ShortcutProfile[] {
  return SHORTCUT_PROFILES;
}

export function normalizeProfileId(profileId: string | undefined): string {
  return profileId && PROFILE_BY_ID.has(profileId) ? profileId : DEFAULT_SHORTCUT_PROFILE;
}

export const EMPTY_SHORTCUT_PREFERENCES: PersistedShortcuts = {
  version: SHORTCUT_PREFERENCES_VERSION,
  profile: DEFAULT_SHORTCUT_PROFILE,
  bindings: {},
  disabled: [],
};

export interface ShortcutAdvisory {
  actionId: string;
  binding: string;
  code: 'reserved' | 'hostile';
}

const RESERVED_BINDINGS = new Set([
  'mod+r',
  'mod+f',
  'mod+p',
  'mod+w',
  'mod+t',
  'mod+n',
  'mod+shift+n',
]);

export function migrateShortcutPreferences(value: unknown): PersistedShortcuts {
  if (!value || typeof value !== 'object') {
    return EMPTY_SHORTCUT_PREFERENCES;
  }

  const candidate = value as Partial<PersistedShortcuts>;
  return {
    version: SHORTCUT_PREFERENCES_VERSION,
    profile: normalizeProfileId(candidate.profile),
    bindings: candidate.bindings && typeof candidate.bindings === 'object' ? candidate.bindings : {},
    disabled: Array.isArray(candidate.disabled) ? candidate.disabled : [],
  };
}

type ActionLike =
  | Pick<ShortcutActionCatalogEntry, 'id' | 'defaultBindings'>
  | { id: string; defaultBindings: ShortcutBindingDefaults };

/**
 * Binding a never-customized action falls back to: profile delta (if the
 * active profile remaps this action) else the platform factory default.
 */
export function getProfileBaselineBindings(
  action: ActionLike,
  profileId: string | undefined,
  platform: Platform,
): readonly string[] {
  const profile = PROFILE_BY_ID.get(normalizeProfileId(profileId));
  const delta = profile?.deltas[action.id];
  if (delta) {
    return delta;
  }

  return getDefaultBindingsForPlatform(action.defaultBindings, platform);
}

export function resolveActionBindings(
  action: ActionLike,
  preferences: PersistedShortcuts,
  platform: Platform,
): readonly string[] {
  return (
    preferences.bindings[action.id] ??
    getProfileBaselineBindings(action, preferences.profile, platform)
  );
}

export function isActionDisabled(actionId: string, preferences: PersistedShortcuts): boolean {
  return preferences.disabled.includes(actionId);
}

export function setActionBindingsDelta(
  preferences: PersistedShortcuts,
  action: ShortcutActionCatalogEntry,
  platform: Platform,
  bindings: readonly string[],
): PersistedShortcuts {
  // A user value equal to the active profile baseline is dropped, not frozen,
  // so per-action reset returns to the profile baseline (not raw factory).
  const baseline = getProfileBaselineBindings(action, preferences.profile, platform);
  const nextBindings = { ...preferences.bindings };

  if (arraysEqual(bindings, baseline)) {
    delete nextBindings[action.id];
  } else {
    nextBindings[action.id] = bindings;
  }

  return {
    ...preferences,
    version: SHORTCUT_PREFERENCES_VERSION,
    bindings: nextBindings,
  };
}

export function setActionDisabled(
  preferences: PersistedShortcuts,
  actionId: string,
  disabled: boolean,
): PersistedShortcuts {
  const disabledSet = new Set(preferences.disabled);
  if (disabled) {
    disabledSet.add(actionId);
  } else {
    disabledSet.delete(actionId);
  }

  return {
    ...preferences,
    version: SHORTCUT_PREFERENCES_VERSION,
    disabled: Array.from(disabledSet),
  };
}

export function setProfilePreference(
  preferences: PersistedShortcuts,
  profileId: string,
): PersistedShortcuts {
  return {
    ...preferences,
    version: SHORTCUT_PREFERENCES_VERSION,
    profile: normalizeProfileId(profileId),
  };
}

export function validateShortcutPreferences(
  preferences: PersistedShortcuts,
  platform: Platform,
): readonly ShortcutAdvisory[] {
  const advisories: ShortcutAdvisory[] = [];

  for (const [actionId, bindings] of Object.entries(preferences.bindings)) {
    for (const binding of bindings) {
      const parsed = parseBinding(binding);
      if (!parsed.ok) {
        advisories.push({ actionId, binding, code: 'reserved' });
        continue;
      }

      if (RESERVED_BINDINGS.has(parsed.value.normalized)) {
        advisories.push({ actionId, binding, code: 'reserved' });
      }

      if (
        platform === 'other' &&
        (parsed.value.normalized === 'alt+arrowleft' || parsed.value.normalized === 'alt+arrowright')
      ) {
        advisories.push({ actionId, binding, code: 'hostile' });
      }
    }
  }

  return advisories;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
