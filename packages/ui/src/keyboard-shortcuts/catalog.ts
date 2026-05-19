import type { ShortcutAction, ShortcutBindingDefaults, ShortcutScope } from './types';
import { normalizeDefaultBindings } from './registry';
import type { Platform } from './types';

export interface ShortcutActionCatalogEntry {
  id: string;
  labelKey: string;
  descriptionKey?: string;
  groupKey: string;
  defaultBindings: ShortcutBindingDefaults;
  scope: ShortcutScope;
  priority?: number;
  allowInEditable?: boolean;
  sequence?: boolean;
}

const DEFAULT_PRIORITY = {
  global: 0,
  shell: 10,
  page: 20,
  panel: 40,
  dialog: 50,
  editor: 60,
} satisfies Record<ShortcutScope, number>;

function entry(
  id: string,
  group: string,
  scope: ShortcutScope,
  defaultBindings: ShortcutBindingDefaults,
  options: Pick<ShortcutActionCatalogEntry, 'allowInEditable' | 'descriptionKey' | 'priority' | 'sequence'> = {},
): ShortcutActionCatalogEntry {
  return {
    id,
    labelKey: `actions.${id}.label`,
    descriptionKey: options.descriptionKey ?? `actions.${id}.description`,
    groupKey: `groups.${group}`,
    defaultBindings,
    scope,
    priority: options.priority ?? DEFAULT_PRIORITY[scope],
    allowInEditable: options.allowInEditable,
    sequence: options.sequence,
  };
}

export const SHORTCUT_ACTION_CATALOG: readonly ShortcutActionCatalogEntry[] = [
  entry('global.search', 'global', 'global', ['mod+k']),
  entry('global.toggleChat', 'ai', 'global', ['mod+l']),
  entry('global.openShortcuts', 'global', 'global', ['?']),
  entry('global.quickCreate', 'global', 'page', ['c']),
  entry('ai.quickAsk', 'ai', 'global', ['mod+ArrowUp']),

  entry('page.create', 'page', 'page', ['c']),
  entry('page.save', 'page', 'page', ['mod+s']),
  entry('selection.previous', 'selection', 'page', ['k']),
  entry('selection.next', 'selection', 'page', ['j']),
  entry('selection.open', 'selection', 'page', ['Enter']),

  entry('navigation.goTickets', 'navigation', 'global', ['g t'], { sequence: true }),
  entry('navigation.goAssets', 'navigation', 'global', ['g a'], { sequence: true }),
  entry('navigation.goClients', 'navigation', 'global', ['g c'], { sequence: true }),

  entry('assets.commandPalette', 'assets', 'page', ['mod+shift+k']),

  entry('dialog.cancel', 'dialog', 'dialog', ['Escape']),
  entry('panel.close', 'panel', 'panel', ['Escape']),
  entry('drawer.historyBack', 'panel', 'panel', ['alt+ArrowLeft']),
  entry('drawer.historyForward', 'panel', 'panel', ['alt+ArrowRight']),
  entry('record.previous', 'record', 'panel', ['[']),
  entry('record.next', 'record', 'panel', [']']),

  entry('editor.undo', 'editor', 'editor', ['mod+z'], { allowInEditable: true }),
  entry(
    'editor.redo',
    'editor',
    'editor',
    {
      mac: ['mod+shift+z'],
      other: ['ctrl+y', 'ctrl+shift+z'],
    },
    { allowInEditable: true },
  ),
  entry('editor.save', 'editor', 'editor', ['mod+s'], { allowInEditable: true }),
  entry('editor.deleteSelection', 'editor', 'editor', ['Delete', 'Backspace'], { allowInEditable: true }),
  entry('editor.cancel', 'editor', 'editor', ['Escape'], { allowInEditable: true }),
  entry('editor.moveUp', 'editor', 'editor', ['ArrowUp']),
  entry('editor.moveDown', 'editor', 'editor', ['ArrowDown']),
  entry('editor.moveLeft', 'editor', 'editor', ['ArrowLeft']),
  entry('editor.moveRight', 'editor', 'editor', ['ArrowRight']),
];

export const OPTIONAL_ALTERNATE_BINDINGS: Readonly<Record<string, readonly string[]>> = {
  // Ctrl/Cmd+N is browser-owned (new window) in common browsers and may not be interceptable.
  'page.create': ['mod+n'],
  'record.previous': ['alt+ArrowLeft'],
  'record.next': ['alt+ArrowRight'],
};

export function getShortcutCatalogEntry(id: string): ShortcutActionCatalogEntry | undefined {
  return SHORTCUT_ACTION_CATALOG.find((candidate) => candidate.id === id);
}

export function createShortcutAction(
  id: string,
  handler: ShortcutAction['handler'],
  options: Pick<ShortcutAction, 'enabled'> = {},
): ShortcutAction {
  const catalogEntry = getShortcutCatalogEntry(id);
  if (!catalogEntry) {
    throw new Error(`Unknown keyboard shortcut action: ${id}`);
  }

  return {
    ...catalogEntry,
    enabled: options.enabled,
    handler,
  };
}

export function getDefaultBindingsForPlatform(
  entryOrDefaults: ShortcutActionCatalogEntry | ShortcutBindingDefaults,
  platform: Platform,
): readonly string[] {
  const defaults = 'defaultBindings' in entryOrDefaults ? entryOrDefaults.defaultBindings : entryOrDefaults;
  return normalizeDefaultBindings(defaults)[platform];
}
