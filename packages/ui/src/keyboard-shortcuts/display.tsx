'use client';

import React from 'react';
import { useTranslation } from '../lib/i18n/client';
import { parseBinding } from './parser';
import { resolveShortcutModifiers } from './matcher';
import { useClientPlatform } from './platform';
import { useResolvedShortcutBindings } from './provider';
import type { Platform } from './types';

const MAC_LABELS: Record<string, string> = { meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
const OTHER_LABELS: Record<string, string> = { meta: 'Meta', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };

export function formatShortcut(
  binding: string,
  platform: Platform,
  labels: Record<string, string> = platform === 'mac' ? MAC_LABELS : OTHER_LABELS,
  spaceLabel = 'Space',
): string {
  const parsed = parseBinding(binding);
  if (!parsed.ok) return binding;
  const modifiers = resolveShortcutModifiers(parsed.value.modifiers, platform).map((modifier) => labels[modifier]);
  return [...modifiers, parsed.value.token.source === 'space' ? spaceLabel : parsed.value.token.source].join(platform === 'mac' ? '' : '+');
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
  const { t } = useTranslation('msp/keyboard-shortcuts');
  const labels = platform === 'mac'
    ? MAC_LABELS
    : {
        meta: t('platform.modifiers.meta', { defaultValue: OTHER_LABELS.meta }),
        ctrl: t('platform.modifiers.ctrl', { defaultValue: OTHER_LABELS.ctrl }),
        alt: t('platform.modifiers.alt', { defaultValue: OTHER_LABELS.alt }),
        shift: t('platform.modifiers.shift', { defaultValue: OTHER_LABELS.shift }),
      };
  return (
    <kbd className="rounded border px-1.5 py-0.5 text-xs">
      {formatShortcut(binding, platform, labels, t('platform.keys.space', { defaultValue: 'Space' }))}
    </kbd>
  );
}

export function ShortcutHint({ actionId }: { actionId: string }): React.JSX.Element | null {
  const binding = useResolvedShortcutBindings(actionId)[0];
  if (!binding) return null;
  return <Kbd binding={binding} />;
}

export function useAriaKeyShortcuts(actionId: string): string | undefined {
  const platform = useClientPlatform('other');
  const binding = useResolvedShortcutBindings(actionId)[0];
  return binding ? bindingToAriaKeyShortcuts(binding, platform) : undefined;
}
