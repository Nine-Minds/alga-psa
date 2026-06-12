import type { BindingDescriptor, Platform, ShortcutModifier } from './types';

export interface KeyboardShortcutEvent {
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  getModifierState?: (keyArg: string) => boolean;
}

type ResolvedModifier = Exclude<ShortcutModifier, 'mod'>;

const RESOLVED_MODIFIER_ORDER: readonly ResolvedModifier[] = ['ctrl', 'meta', 'alt', 'shift'];

function resolveModifier(modifier: ShortcutModifier, platform: Platform): ResolvedModifier {
  if (modifier === 'mod') {
    return platform === 'mac' ? 'meta' : 'ctrl';
  }

  return modifier;
}

export function resolveShortcutModifiers(
  modifiers: readonly ShortcutModifier[],
  platform: Platform,
): readonly ResolvedModifier[] {
  const resolved = new Set<ResolvedModifier>();

  for (const modifier of modifiers) {
    resolved.add(resolveModifier(modifier, platform));
  }

  return RESOLVED_MODIFIER_ORDER.filter((modifier) => resolved.has(modifier));
}

function eventHasModifier(event: KeyboardShortcutEvent, modifier: ResolvedModifier): boolean {
  switch (modifier) {
    case 'ctrl':
      return event.ctrlKey;
    case 'meta':
      return event.metaKey;
    case 'alt':
      return event.altKey;
    case 'shift':
      return event.shiftKey;
  }
}

function modifiersMatchExactly(
  event: KeyboardShortcutEvent,
  required: readonly ResolvedModifier[],
  options?: { ignoreShift?: boolean },
): boolean {
  const requiredSet = new Set(required);

  for (const modifier of RESOLVED_MODIFIER_ORDER) {
    if (modifier === 'shift' && options?.ignoreShift) {
      continue;
    }

    if (eventHasModifier(event, modifier) !== requiredSet.has(modifier)) {
      return false;
    }
  }

  return true;
}

function isAltGraphEvent(event: KeyboardShortcutEvent): boolean {
  return event.getModifierState?.('AltGraph') === true;
}

export function matchEvent(
  event: KeyboardShortcutEvent,
  descriptor: BindingDescriptor,
  platform: Platform,
): boolean {
  const requiredModifiers = resolveShortcutModifiers(descriptor.modifiers, platform);

  if (descriptor.token.kind === 'code') {
    return (
      event.code === descriptor.token.value &&
      modifiersMatchExactly(event, requiredModifiers) &&
      !isAltGraphEvent(event)
    );
  }

  return (
    event.key === descriptor.token.value &&
    modifiersMatchExactly(event, requiredModifiers, { ignoreShift: true }) &&
    !isAltGraphEvent(event)
  );
}
