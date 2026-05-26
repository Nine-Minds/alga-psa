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
  entry('global.commandPalette', 'global', 'global', ['mod+shift+k']),
  entry('global.toggleChat', 'ai', 'global', ['mod+l']),
  entry('global.openShortcuts', 'global', 'global', ['?']),
  entry('global.quickCreate', 'global', 'page', ['alt+n']),
  entry('ai.quickAsk', 'ai', 'global', ['mod+ArrowUp']),

  entry('scroll.halfDown', 'scroll', 'page', ['ctrl+d']),
  entry('scroll.halfUp', 'scroll', 'page', ['ctrl+u']),
  entry('scroll.fullDown', 'scroll', 'page', ['ctrl+f']),
  entry('scroll.fullUp', 'scroll', 'page', ['ctrl+b']),
  entry('scroll.top', 'scroll', 'page', ['g g'], { sequence: true }),
  entry('scroll.bottom', 'scroll', 'page', ['shift+g']),
  entry('focus.primarySearch', 'navigation', 'page', ['/']),

  entry('table.nextRow', 'selection', 'page', ['j'], { priority: 21 }),
  entry('table.previousRow', 'selection', 'page', ['k'], { priority: 21 }),
  entry('table.toggleRow', 'selection', 'page', ['x']),
  entry('table.visualRange', 'selection', 'page', ['shift+v']),
  entry('table.openRow', 'selection', 'page', ['o']),

  entry('repeat.lastAction', 'global', 'page', ['.']),
  entry('linkhints.show', 'navigation', 'page', ['f']),
  entry('linkhints.showNewTab', 'navigation', 'page', ['shift+f']),
  entry('macro.record', 'global', 'page', ['q']),
  entry('macro.play', 'global', 'page', ['@']),

  entry('page.create', 'page', 'page', ['c']),
  entry('page.save', 'page', 'page', ['mod+s']),
  entry('selection.previous', 'selection', 'page', ['k']),
  entry('selection.next', 'selection', 'page', ['j']),
  entry('selection.open', 'selection', 'page', ['Enter']),

  entry('navigation.goDashboard', 'navigation', 'global', ['g d'], { sequence: true }),
  entry('navigation.goTickets', 'navigation', 'global', ['g t'], { sequence: true }),
  entry('navigation.goAssets', 'navigation', 'global', ['g a'], { sequence: true }),
  entry('navigation.goClients', 'navigation', 'global', ['g c'], { sequence: true }),
  entry('navigation.goProjects', 'navigation', 'global', ['g p'], { sequence: true }),
  entry('navigation.goBilling', 'navigation', 'global', ['g i'], { sequence: true }),
  entry('navigation.goSettings', 'navigation', 'global', ['g s'], { sequence: true }),
  entry('navigation.goSearch', 'navigation', 'global', ['g /'], { sequence: true }),
  entry('navigation.goHelp', 'navigation', 'global', ['g h'], { sequence: true }),
  entry('navigation.backToParent', 'navigation', 'global', ['g b'], { sequence: true }),

  entry('assets.commandPalette', 'assets', 'page', ['mod+shift+k']),

  entry('dialog.cancel', 'dialog', 'dialog', ['Escape']),
  entry('dialog.submit', 'dialog', 'dialog', ['mod+s', 'mod+Enter'], { allowInEditable: true }),
  entry('panel.close', 'panel', 'panel', ['Escape']),
  entry('drawer.historyBack', 'panel', 'panel', ['alt+ArrowLeft']),
  entry('drawer.historyForward', 'panel', 'panel', ['alt+ArrowRight']),
  entry('record.previous', 'record', 'page', ['[']),
  entry('record.next', 'record', 'page', [']']),
  entry('record.addTime', 'record', 'page', ['shift+t']),

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
