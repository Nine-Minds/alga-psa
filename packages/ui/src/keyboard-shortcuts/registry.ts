import type { ShortcutAction, ShortcutBindingDefaults } from './types';

export class ShortcutRegistry {
  private actions = new Map<string, ShortcutAction>();

  add(action: ShortcutAction): () => void {
    this.actions.set(action.id, action);

    return () => {
      if (this.actions.get(action.id) === action) {
        this.actions.delete(action.id);
      }
    };
  }

  remove(id: string): void {
    this.actions.delete(id);
  }

  get(id: string): ShortcutAction | undefined {
    return this.actions.get(id);
  }

  list(): readonly ShortcutAction[] {
    return Array.from(this.actions.values());
  }

  clear(): void {
    this.actions.clear();
  }
}

export function normalizeDefaultBindings(
  defaultBindings: ShortcutBindingDefaults,
): { mac: readonly string[]; other: readonly string[] } {
  if (!('mac' in defaultBindings)) {
    return {
      mac: defaultBindings,
      other: defaultBindings,
    };
  }

  return defaultBindings;
}
