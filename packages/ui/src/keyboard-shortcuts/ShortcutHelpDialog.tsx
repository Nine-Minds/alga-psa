'use client';

import React from 'react';
import { useTranslation } from '../lib/i18n/client';
import { Dialog, DialogContent } from '../components/Dialog';
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
    <Dialog
      id="keyboard-shortcuts-help"
      isOpen={isOpen}
      onClose={onClose}
      title={t('help.title')}
      className="max-w-3xl"
    >
      <DialogContent>
        <div className="space-y-5 max-h-[60vh] overflow-auto pr-1">
          {Array.from(groups.entries()).map(([groupKey, actions]) => (
            <section key={groupKey} aria-labelledby={`keyboard-shortcuts-help-group-${groupKey}`}>
              <h3
                id={`keyboard-shortcuts-help-group-${groupKey}`}
                className="mb-2 text-sm font-semibold text-[rgb(var(--color-text-700))]"
              >
                {t(groupKey)}
              </h3>
              <div className="space-y-2">
                {actions.map((action) => (
                  <div key={action.id} className="flex items-center justify-between gap-4 text-sm">
                    <span>{t(action.labelKey)}</span>
                    <span className="flex items-center gap-1">
                      {(shortcuts?.getResolvedBindings(action.id) ?? getDefaultBindingsForPlatform(action, platform)).map((binding) => (
                        <Kbd key={binding} binding={binding} />
                      ))}
                      {shortcuts?.preferences.bindings[action.id] ? (
                        <span className="text-xs text-[rgb(var(--color-text-500))]">{t('help.custom', { defaultValue: 'Custom' })}</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
