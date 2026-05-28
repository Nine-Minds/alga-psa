import type { PersistedShortcuts, ShortcutStorage } from './types';

export const DEFAULT_PERSISTED_SHORTCUTS: PersistedShortcuts = {
  version: 2,
  profile: 'default',
  bindings: {},
  disabled: [],
};

export function createMemoryShortcutStorage(
  initialValue: PersistedShortcuts = DEFAULT_PERSISTED_SHORTCUTS,
): ShortcutStorage {
  let value = initialValue;

  return {
    async load() {
      return value;
    },
    async save(nextValue) {
      value = nextValue;
    },
  };
}
