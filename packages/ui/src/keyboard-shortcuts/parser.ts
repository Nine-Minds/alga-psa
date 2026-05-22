import type {
  BindingDescriptor,
  ParsedToken,
  ShortcutModifier,
  ShortcutParseErrorCode,
  ShortcutParseResult,
} from './types';

const MODIFIER_ORDER: readonly ShortcutModifier[] = ['mod', 'ctrl', 'meta', 'alt', 'shift'];
const MODIFIERS = new Set<ShortcutModifier>(MODIFIER_ORDER);

const NAMED_CODE_KEYS: Readonly<Record<string, string>> = {
  enter: 'Enter',
  return: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  tab: 'Tab',
  space: 'Space',
  arrowup: 'ArrowUp',
  up: 'ArrowUp',
  arrowdown: 'ArrowDown',
  down: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  left: 'ArrowLeft',
  arrowright: 'ArrowRight',
  right: 'ArrowRight',
  delete: 'Delete',
  del: 'Delete',
  backspace: 'Backspace',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

const BRACKET_CODE_KEYS: Readonly<Record<string, string>> = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
};

function parseError<T>(
  input: string,
  code: ShortcutParseErrorCode,
  message: string,
  token?: string,
): ShortcutParseResult<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      input,
      token,
    },
  };
}

function normalizeModifier(modifier: string): ShortcutModifier | null {
  const normalized = modifier.trim().toLowerCase();
  return MODIFIERS.has(normalized as ShortcutModifier) ? (normalized as ShortcutModifier) : null;
}

function normalizeModifiers(modifiers: readonly ShortcutModifier[]): readonly ShortcutModifier[] {
  return MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
}

function parseToken(input: string, rawToken: string): ShortcutParseResult<ParsedToken> {
  const token = rawToken.trim();
  const lower = token.toLowerCase();

  if (!token) {
    return parseError(input, 'missing-key', 'Shortcut binding is missing a key token.');
  }

  if (/^[a-z]$/i.test(token)) {
    return {
      ok: true,
      value: {
        kind: 'code',
        value: `Key${lower.toUpperCase()}`,
        source: lower,
      },
    };
  }

  if (/^[0-9]$/.test(token)) {
    return {
      ok: true,
      value: {
        kind: 'code',
        value: `Digit${token}`,
        source: token,
      },
    };
  }

  const functionKeyMatch = /^f([1-9]|1[0-2])$/i.exec(token);
  if (functionKeyMatch) {
    return {
      ok: true,
      value: {
        kind: 'code',
        value: `F${functionKeyMatch[1]}`,
        source: `f${functionKeyMatch[1]}`,
      },
    };
  }

  const namedCode = NAMED_CODE_KEYS[lower];
  if (namedCode) {
    return {
      ok: true,
      value: {
        kind: 'code',
        value: namedCode,
        source: lower,
      },
    };
  }

  const bracketCode = BRACKET_CODE_KEYS[token];
  if (bracketCode) {
    return {
      ok: true,
      value: {
        kind: 'code',
        value: bracketCode,
        source: token,
      },
    };
  }

  if ([...token].length === 1) {
    return {
      ok: true,
      value: {
        kind: 'char',
        value: token,
        source: token,
      },
    };
  }

  return parseError(input, 'unsupported-key', `Unsupported key token "${token}".`, token);
}

export function parseBinding(input: string): ShortcutParseResult<BindingDescriptor> {
  const trimmed = input.trim();
  if (!trimmed) {
    return parseError(input, 'empty', 'Shortcut binding cannot be empty.');
  }

  const parts = trimmed.split('+').map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) {
    return parseError(input, 'missing-key', 'Shortcut binding contains an empty token.');
  }

  const rawKeyToken = parts[parts.length - 1];
  const rawModifierTokens = parts.slice(0, -1);
  const modifiers: ShortcutModifier[] = [];

  for (const rawModifier of rawModifierTokens) {
    const modifier = normalizeModifier(rawModifier);
    if (!modifier) {
      return parseError(input, 'unknown-modifier', `Unknown modifier "${rawModifier}".`, rawModifier);
    }

    if (modifiers.includes(modifier)) {
      return parseError(input, 'duplicate-modifier', `Duplicate modifier "${rawModifier}".`, rawModifier);
    }

    modifiers.push(modifier);
  }

  const tokenResult = parseToken(input, rawKeyToken);
  if (tokenResult.ok === false) {
    return tokenResult as ShortcutParseResult<BindingDescriptor>;
  }

  const normalizedModifiers = normalizeModifiers(modifiers);
  const normalized = [...normalizedModifiers, tokenResult.value.source].join('+');

  return {
    ok: true,
    value: {
      modifiers: normalizedModifiers,
      token: tokenResult.value,
      normalized,
    },
  };
}

export function parseSequence(input: string): ShortcutParseResult<readonly BindingDescriptor[]> {
  const trimmed = input.trim();
  if (!trimmed) {
    return parseError(input, 'empty', 'Shortcut sequence cannot be empty.');
  }

  const chords = trimmed.split(/\s+/);
  const parsed: BindingDescriptor[] = [];

  for (const chord of chords) {
    const result = parseBinding(chord);
    if (!result.ok) {
      return parseError(
        input,
        'invalid-sequence',
        `Shortcut sequence contains an invalid chord "${chord}".`,
        chord,
      );
    }

    parsed.push(result.value);
  }

  return {
    ok: true,
    value: parsed,
  };
}
