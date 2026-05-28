export type Platform = 'mac' | 'other';

export type ShortcutScope =
  | 'global'
  | 'shell'
  | 'page'
  | 'panel'
  | 'dialog'
  | 'editor';

export type ShortcutModifier = 'mod' | 'ctrl' | 'meta' | 'shift' | 'alt';

export type ParsedToken =
  | {
      kind: 'code';
      value: string;
      source: string;
    }
  | {
      kind: 'char';
      value: string;
      source: string;
    };

export interface BindingDescriptor {
  readonly modifiers: readonly ShortcutModifier[];
  readonly token: ParsedToken;
  readonly normalized: string;
}

export type ShortcutBindingDefaults =
  | readonly string[]
  | {
      mac: readonly string[];
      other: readonly string[];
    };

export interface ShortcutAction {
  id: string;
  labelKey: string;
  groupKey: string;
  descriptionKey?: string;
  defaultBindings: ShortcutBindingDefaults;
  scope: ShortcutScope;
  priority?: number;
  enabled?: boolean;
  allowInEditable?: boolean;
  sequence?: boolean;
  handler: (event: KeyboardEvent) => void | boolean | Promise<void | boolean>;
}

export interface PersistedShortcuts {
  version: number;
  profile: string;
  bindings: Record<string, readonly string[]>;
  disabled: readonly string[];
}

export interface ShortcutStorage {
  load: () => PersistedShortcuts | Promise<PersistedShortcuts>;
  save: (value: PersistedShortcuts) => void | Promise<void>;
}

export type ShortcutParseErrorCode =
  | 'empty'
  | 'missing-key'
  | 'duplicate-modifier'
  | 'unknown-modifier'
  | 'unsupported-key'
  | 'invalid-sequence';

export type ShortcutParseResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: {
        code: ShortcutParseErrorCode;
        message: string;
        input: string;
        token?: string;
      };
    };
