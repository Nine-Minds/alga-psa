import { parseBinding } from './parser';
import { getDefaultBindingsForPlatform, type ShortcutActionCatalogEntry } from './catalog';
import type { PersistedShortcuts, Platform } from './types';

export const KEYBOARD_SHORTCUTS_PREFERENCE_KEY = 'keyboard_shortcuts_v1';
export const SHORTCUT_PREFERENCES_VERSION = 1;

export const EMPTY_SHORTCUT_PREFERENCES: PersistedShortcuts = {
  version: SHORTCUT_PREFERENCES_VERSION,
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
]);

export function migrateShortcutPreferences(value: unknown): PersistedShortcuts {
  if (!value || typeof value !== 'object') {
    return EMPTY_SHORTCUT_PREFERENCES;
  }

  const candidate = value as Partial<PersistedShortcuts>;
  return {
    version: SHORTCUT_PREFERENCES_VERSION,
    bindings: candidate.bindings && typeof candidate.bindings === 'object' ? candidate.bindings : {},
    disabled: Array.isArray(candidate.disabled) ? candidate.disabled : [],
  };
}

export function resolveActionBindings(
  action: ShortcutActionCatalogEntry,
  preferences: PersistedShortcuts,
  platform: Platform,
): readonly string[] {
  return preferences.bindings[action.id] ?? getDefaultBindingsForPlatform(action, platform);
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
  const platformDefault = getDefaultBindingsForPlatform(action, platform);
  const nextBindings = { ...preferences.bindings };

  if (arraysEqual(bindings, platformDefault)) {
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
