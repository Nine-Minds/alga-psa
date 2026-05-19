'use client';

import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '../lib/i18n/client';
import { SHORTCUT_ACTION_CATALOG, getDefaultBindingsForPlatform } from './catalog';
import { Kbd } from './display';
import { useClientPlatform } from './platform';
import { useOptionalKeyboardShortcutPreferences } from './provider';

interface ShortcutHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  disabledActionIds?: readonly string[];
}

export function ShortcutHelpDialog({ isOpen, onClose, disabledActionIds = [] }: ShortcutHelpDialogProps): React.JSX.Element | null {
  const { t } = useTranslation('msp/keyboard-shortcuts');
  const platform = useClientPlatform('other');
  const shortcuts = useOptionalKeyboardShortcutPreferences();
  if (!isOpen) return null;
  const disabled = new Set(disabledActionIds);
  const groups = new Map<string, typeof SHORTCUT_ACTION_CATALOG>();
  for (const action of SHORTCUT_ACTION_CATALOG) {
    if (disabled.has(action.id) || shortcuts?.isActionDisabled(action.id)) continue;
    const group = groups.get(action.groupKey) ?? [];
    groups.set(action.groupKey, [...group, action]);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="keyboard-shortcuts-help-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-md bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="keyboard-shortcuts-help-title" className="text-lg font-semibold">{t('help.title')}</h2>
          <button id="keyboard-shortcuts-help-close" type="button" onClick={onClose} aria-label={t('help.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-5">
          {Array.from(groups.entries()).map(([groupKey, actions]) => (
            <section key={groupKey}>
              <h3 className="mb-2 text-sm font-semibold">{t(groupKey)}</h3>
              <div className="space-y-2">
                {actions.map((action) => (
                  <div key={action.id} className="flex items-center justify-between gap-4 text-sm">
                    <span>{t(action.labelKey)}</span>
                    <span className="flex gap-1">
                      {(shortcuts?.getResolvedBindings(action.id) ?? getDefaultBindingsForPlatform(action, platform)).map((binding) => <Kbd key={binding} binding={binding} />)}
                      {shortcuts?.preferences.bindings[action.id] ? (
                        <span className="text-xs text-gray-500">{t('help.custom', { defaultValue: 'Custom' })}</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <a
            id="keyboard-shortcuts-command-palette-syntax"
            href="#command-palette"
            className="block text-sm text-blue-600 underline"
          >
            {t('commandPalette.syntax.summary', { defaultValue: 'Fields, operators, $keywords, and sigils' })}
          </a>
        </div>
      </div>
    </div>
  );
}
