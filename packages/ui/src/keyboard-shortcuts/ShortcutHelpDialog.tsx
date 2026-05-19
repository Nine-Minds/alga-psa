'use client';

import React from 'react';
import { X } from 'lucide-react';
import { SHORTCUT_ACTION_CATALOG, getDefaultBindingsForPlatform } from './catalog';
import { Kbd } from './display';
import { useClientPlatform } from './platform';

interface ShortcutHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  disabledActionIds?: readonly string[];
}

export function ShortcutHelpDialog({ isOpen, onClose, disabledActionIds = [] }: ShortcutHelpDialogProps): React.JSX.Element | null {
  const platform = useClientPlatform('other');
  if (!isOpen) return null;
  const disabled = new Set(disabledActionIds);
  const groups = new Map<string, typeof SHORTCUT_ACTION_CATALOG>();
  for (const action of SHORTCUT_ACTION_CATALOG) {
    if (disabled.has(action.id)) continue;
    const group = groups.get(action.groupKey) ?? [];
    groups.set(action.groupKey, [...group, action]);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="keyboard-shortcuts-help-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-md bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="keyboard-shortcuts-help-title" className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button id="keyboard-shortcuts-help-close" type="button" onClick={onClose} aria-label="Close keyboard shortcuts">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-5">
          {Array.from(groups.entries()).map(([groupKey, actions]) => (
            <section key={groupKey}>
              <h3 className="mb-2 text-sm font-semibold">{groupKey.replace('groups.', '')}</h3>
              <div className="space-y-2">
                {actions.map((action) => (
                  <div key={action.id} className="flex items-center justify-between gap-4 text-sm">
                    <span>{action.id}</span>
                    <span className="flex gap-1">
                      {getDefaultBindingsForPlatform(action, platform).map((binding) => <Kbd key={binding} binding={binding} />)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
