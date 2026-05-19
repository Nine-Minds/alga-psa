'use client';

import React from 'react';
import { getShortcutCatalogEntry, getDefaultBindingsForPlatform } from './catalog';
import { parseBinding } from './parser';
import { resolveShortcutModifiers } from './matcher';
import { useClientPlatform } from './platform';
import type { Platform } from './types';

const MAC_LABELS: Record<string, string> = { meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
const OTHER_LABELS: Record<string, string> = { meta: 'Meta', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };

export function formatShortcut(binding: string, platform: Platform): string {
  const parsed = parseBinding(binding);
  if (!parsed.ok) return binding;
  const labels = platform === 'mac' ? MAC_LABELS : OTHER_LABELS;
  const modifiers = resolveShortcutModifiers(parsed.value.modifiers, platform).map((modifier) => labels[modifier]);
  return [...modifiers, parsed.value.token.source === 'space' ? 'Space' : parsed.value.token.source].join(platform === 'mac' ? '' : '+');
}

export function bindingToAriaKeyShortcuts(binding: string, platform: Platform): string {
  const parsed = parseBinding(binding);
  if (!parsed.ok) return '';
  const modifiers = resolveShortcutModifiers(parsed.value.modifiers, platform).map((modifier) => {
    if (modifier === 'ctrl') return 'Control';
    if (modifier === 'meta') return 'Meta';
    if (modifier === 'alt') return 'Alt';
    return 'Shift';
  });
  const key = parsed.value.token.kind === 'code'
    ? parsed.value.token.value.replace(/^Key/, '').replace(/^Digit/, '')
    : parsed.value.token.value;
  return [...modifiers, key].join('+');
}

export function Kbd({ binding }: { binding: string }): React.JSX.Element {
  const platform = useClientPlatform('other');
  return <kbd className="rounded border px-1.5 py-0.5 text-xs">{formatShortcut(binding, platform)}</kbd>;
}

export function ShortcutHint({ actionId }: { actionId: string }): React.JSX.Element | null {
  const platform = useClientPlatform('other');
  const action = getShortcutCatalogEntry(actionId);
  if (!action) return null;
  const binding = getDefaultBindingsForPlatform(action, platform)[0];
  if (!binding) return null;
  return <Kbd binding={binding} />;
}

export function useAriaKeyShortcuts(actionId: string): string | undefined {
  const platform = useClientPlatform('other');
  const action = getShortcutCatalogEntry(actionId);
  const binding = action ? getDefaultBindingsForPlatform(action, platform)[0] : undefined;
  return binding ? bindingToAriaKeyShortcuts(binding, platform) : undefined;
}
