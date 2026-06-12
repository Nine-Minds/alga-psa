'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../lib/i18n/client';
import { SHORTCUT_ACTION_CATALOG, getDefaultBindingsForPlatform } from './catalog';
import type { ShortcutActionCatalogEntry } from './catalog';
import { Kbd } from './display';
import { useClientPlatform } from './platform';
import { useOptionalKeyboardShortcutPreferences } from './provider';
import { parseBinding } from './parser';
import { resolveShortcutModifiers } from './matcher';
import type { ParsedToken, Platform, ShortcutModifier } from './types';

const SHOW_DELAY_MS = 400;
const STICKY_HIDE_MS = 600;
const SEQUENCE_RESET_MS = 1500;

const MODIFIER_KEY_NAMES = new Set(['Control', 'Alt', 'Shift', 'Meta', 'ContextMenu']);

type ModifierName = 'ctrl' | 'alt' | 'shift' | 'meta';

interface HudEntry {
  actionId: string;
  labelKey: string;
  groupKey: string;
  display: string;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"),
  );
}

function eventModifiers(event: KeyboardEvent): Set<ModifierName> {
  const out = new Set<ModifierName>();
  if (event.ctrlKey) out.add('ctrl');
  if (event.altKey) out.add('alt');
  if (event.shiftKey) out.add('shift');
  if (event.metaKey) out.add('meta');
  return out;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function isMeaningfulModifierSet(mods: Set<ModifierName>): boolean {
  if (mods.size === 0) return false;
  if (mods.size === 1 && mods.has('shift')) return false;
  return true;
}

function modifiersEqual(
  parsedMods: readonly ShortcutModifier[],
  held: Set<ModifierName>,
  platform: Platform,
): boolean {
  const resolved = resolveShortcutModifiers(parsedMods, platform);
  if (resolved.length !== held.size) return false;
  for (const m of resolved) if (!held.has(m as ModifierName)) return false;
  return true;
}

function tokenLabel(token: ParsedToken): string {
  if (token.kind === 'code') {
    return token.value.replace(/^Key/, '').replace(/^Digit/, '');
  }
  return token.source || token.value;
}

export function ShortcutHintHud(): React.JSX.Element | null {
  const { t } = useTranslation('msp/keyboard-shortcuts');
  const platform = useClientPlatform('other');
  const shortcuts = useOptionalKeyboardShortcutPreferences();

  const [visible, setVisible] = useState(false);
  const [heldModifiers, setHeldModifiers] = useState<Set<ModifierName>>(() => new Set());
  const [sequencePrefix, setSequencePrefix] = useState<string | null>(null);

  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldModifiersRef = useRef<Set<ModifierName>>(new Set());
  const sequencePrefixRef = useRef<string | null>(null);

  const resolveBindings = useCallback(
    (action: ShortcutActionCatalogEntry): readonly string[] => {
      return shortcuts?.getResolvedBindings(action.id) ?? getDefaultBindingsForPlatform(action, platform);
    },
    [shortcuts, platform],
  );

  const sequencePrefixes = useMemo(() => {
    const prefixes = new Set<string>();
    for (const action of SHORTCUT_ACTION_CATALOG) {
      for (const binding of resolveBindings(action)) {
        const trimmed = binding.trim();
        if (trimmed.includes(' ')) {
          prefixes.add(trimmed.split(/\s+/)[0].toLowerCase());
        }
      }
    }
    return prefixes;
  }, [resolveBindings]);

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const clearSequenceTimer = useCallback(() => {
    if (sequenceTimerRef.current) {
      clearTimeout(sequenceTimerRef.current);
      sequenceTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      setSequencePrefix(null);
      sequencePrefixRef.current = null;
    }, STICKY_HIDE_MS);
  }, [clearHideTimer]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const newMods = eventModifiers(event);
      const isModifierKey = MODIFIER_KEY_NAMES.has(event.key);

      if (isModifierKey) {
        if (!setsEqual(heldModifiersRef.current, newMods)) {
          heldModifiersRef.current = newMods;
          setHeldModifiers(newMods);
          clearShowTimer();
          clearHideTimer();
          if (isMeaningfulModifierSet(newMods)) {
            showTimerRef.current = setTimeout(() => {
              showTimerRef.current = null;
              setVisible(true);
            }, SHOW_DELAY_MS);
          } else {
            setVisible(false);
          }
        }
        return;
      }

      // Non-modifier key — if sequence-prefix mode is active, the next key likely
      // completes the sequence; clear and let the sticky timer hide the HUD.
      if (sequencePrefixRef.current) {
        clearSequenceTimer();
        sequencePrefixRef.current = null;
        setSequencePrefix(null);
        scheduleHide();
        return;
      }

      // If no modifiers held and the key is a known sequence prefix, enter sequence mode.
      if (newMods.size === 0 && event.key.length === 1) {
        const key = event.key.toLowerCase();
        if (sequencePrefixes.has(key)) {
          sequencePrefixRef.current = key;
          setSequencePrefix(key);
          clearShowTimer();
          clearHideTimer();
          setVisible(true);
          clearSequenceTimer();
          sequenceTimerRef.current = setTimeout(() => {
            sequenceTimerRef.current = null;
            sequencePrefixRef.current = null;
            setSequencePrefix(null);
            setVisible(false);
          }, SEQUENCE_RESET_MS);
          return;
        }
      }

      // Any other non-modifier key: cancel the show-delay so a quick chord
      // like Ctrl+S doesn't flash the HUD, then sticky-hide if it was visible.
      if (heldModifiersRef.current.size > 0) {
        clearShowTimer();
        scheduleHide();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const newMods = eventModifiers(event);
      const isModifierKey = MODIFIER_KEY_NAMES.has(event.key);
      if (!isModifierKey) return;

      heldModifiersRef.current = newMods;
      setHeldModifiers(newMods);
      clearShowTimer();
      if (!isMeaningfulModifierSet(newMods)) {
        scheduleHide();
      }
    };

    const handleBlur = () => {
      heldModifiersRef.current = new Set();
      sequencePrefixRef.current = null;
      setHeldModifiers(new Set());
      setSequencePrefix(null);
      clearShowTimer();
      clearSequenceTimer();
      setVisible(false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
      clearShowTimer();
      clearHideTimer();
      clearSequenceTimer();
    };
  }, [clearHideTimer, clearSequenceTimer, clearShowTimer, scheduleHide, sequencePrefixes]);

  const entries = useMemo<HudEntry[]>(() => {
    if (!visible) return [];

    const out: HudEntry[] = [];
    const seen = new Set<string>();

    if (sequencePrefix) {
      for (const action of SHORTCUT_ACTION_CATALOG) {
        for (const binding of resolveBindings(action)) {
          const trimmed = binding.trim();
          if (!trimmed.includes(' ')) continue;
          const [first, ...rest] = trimmed.split(/\s+/);
          if (first.toLowerCase() !== sequencePrefix) continue;
          const remainder = rest.join(' ');
          const display = remainder.toUpperCase();
          if (seen.has(action.id)) continue;
          seen.add(action.id);
          out.push({
            actionId: action.id,
            labelKey: action.labelKey,
            groupKey: action.groupKey,
            display,
          });
        }
      }
      return out;
    }

    if (heldModifiers.size > 0) {
      for (const action of SHORTCUT_ACTION_CATALOG) {
        for (const binding of resolveBindings(action)) {
          const trimmed = binding.trim();
          if (trimmed.includes(' ')) continue; // skip sequences
          const parsed = parseBinding(trimmed);
          if (!parsed.ok) continue;
          if (!modifiersEqual(parsed.value.modifiers, heldModifiers, platform)) continue;
          if (seen.has(action.id)) continue;
          seen.add(action.id);
          out.push({
            actionId: action.id,
            labelKey: action.labelKey,
            groupKey: action.groupKey,
            display: tokenLabel(parsed.value.token),
          });
        }
      }
    }

    return out;
  }, [visible, sequencePrefix, heldModifiers, resolveBindings]);

  if (!visible || entries.length === 0) return null;

  const macLabels: Record<ModifierName, string> = { meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
  const otherLabels: Record<ModifierName, string> = { meta: 'Meta', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  const modLabels = platform === 'mac' ? macLabels : otherLabels;
  const modOrder: ModifierName[] = ['ctrl', 'alt', 'shift', 'meta'];
  const orderedHeldModifiers = modOrder.filter((m) => heldModifiers.has(m));

  const groupedEntries = entries.reduce<Map<string, HudEntry[]>>((acc, entry) => {
    const list = acc.get(entry.groupKey) ?? [];
    list.push(entry);
    acc.set(entry.groupKey, list);
    return acc;
  }, new Map());

  return (
    <div
      data-shortcut-hint-hud="true"
      className="pointer-events-none fixed bottom-4 right-4 z-[9998] max-w-sm select-none"
      aria-hidden="true"
    >
      <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]/95 px-3 py-2 shadow-lg backdrop-blur">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[rgb(var(--color-text-600))]">
          {sequencePrefix ? (
            <Kbd binding={sequencePrefix} />
          ) : (
            <span className="flex items-center gap-0.5">
              {orderedHeldModifiers.map((m) => (
                <kbd
                  key={m}
                  className="rounded border border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-background))] px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {modLabels[m]}
                </kbd>
              ))}
              <span className="ml-1">+</span>
            </span>
          )}
          <span>{sequencePrefix ? t('hud.thenPress', { defaultValue: 'then…' }) : t('hud.combinations', { defaultValue: 'combinations' })}</span>
        </div>
        <div className="max-h-[60vh] space-y-2 overflow-auto pr-1">
          {Array.from(groupedEntries.entries()).map(([groupKey, items]) => (
            <div key={groupKey}>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-[rgb(var(--color-text-500))]">
                {t(groupKey)}
              </div>
              <ul className="space-y-0.5">
                {items.map((entry) => (
                  <li
                    key={entry.actionId}
                    className="flex items-center justify-between gap-3 text-xs text-[rgb(var(--color-text-800))]"
                  >
                    <span className="truncate">{t(entry.labelKey)}</span>
                    <kbd className="rounded border border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-background))] px-1.5 py-0.5 font-mono text-[10px] uppercase">
                      {entry.display}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
