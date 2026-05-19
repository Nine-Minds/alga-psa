'use client';

import React, { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  EMPTY_SHORTCUT_PREFERENCES,
  SHORTCUT_ACTION_CATALOG,
  getDefaultBindingsForPlatform,
  isActionDisabled,
  resolveActionBindings,
  setActionBindingsDelta,
  setActionDisabled,
  useClientPlatform,
  type PersistedShortcuts,
  type ShortcutActionCatalogEntry,
} from '@alga-psa/ui/keyboard-shortcuts';
import { useKeyboardShortcutPreferenceStorage } from '@/hooks/useKeyboardShortcutPreferenceStorage';

interface ConflictState {
  action: ShortcutActionCatalogEntry;
  binding: string;
  conflictingAction: ShortcutActionCatalogEntry;
}

function bindingFromEvent(event: React.KeyboardEvent): string | null {
  const keyToken = tokenFromEvent(event.nativeEvent);
  if (!keyToken) return null;

  const modifiers: string[] = [];
  if (event.metaKey || event.ctrlKey) modifiers.push('mod');
  if (event.altKey) modifiers.push('alt');
  if (event.shiftKey && keyToken.length !== 1) modifiers.push('shift');

  return [...modifiers, keyToken].join('+');
}

function tokenFromEvent(event: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (event.code === 'BracketLeft') return '[';
  if (event.code === 'BracketRight') return ']';
  if (/^F([1-9]|1[0-2])$/.test(event.code)) return event.code.toLowerCase();
  if (['Enter', 'Escape', 'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
    return event.key;
  }
  if (event.key.length === 1) return event.key;
  return null;
}

export default function KeyboardShortcutsSettings(): React.JSX.Element {
  const { t } = useTranslation('msp/keyboard-shortcuts');
  const platform = useClientPlatform('other');
  const preference = useKeyboardShortcutPreferenceStorage();
  const [capturingActionId, setCapturingActionId] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<ConflictState | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);

  const groupedActions = useMemo(() => {
    const groups = new Map<string, ShortcutActionCatalogEntry[]>();
    for (const action of SHORTCUT_ACTION_CATALOG) {
      const group = groups.get(action.groupKey) ?? [];
      group.push(action);
      groups.set(action.groupKey, group);
    }
    return Array.from(groups.entries());
  }, []);

  const updatePreference = (updater: (current: PersistedShortcuts) => PersistedShortcuts, successKey: string) => {
    try {
      preference.setValue((current) => updater(current));
      toast.success(t(successKey, { defaultValue: 'Keyboard shortcut updated' }));
    } catch (error) {
      handleError(error, t('settings.errors.saveFailed', { defaultValue: 'Failed to save keyboard shortcut preferences' }));
    }
  };

  const findConflict = (action: ShortcutActionCatalogEntry, binding: string): ShortcutActionCatalogEntry | null => {
    return SHORTCUT_ACTION_CATALOG.find((candidate) => {
      if (candidate.id === action.id) return false;
      return resolveActionBindings(candidate, preference.value, platform).includes(binding);
    }) ?? null;
  };

  const commitBinding = (action: ShortcutActionCatalogEntry, binding: string) => {
    updatePreference(
      (current) => setActionBindingsDelta(current, action, platform, [binding]),
      'settings.messages.bindingUpdated',
    );
  };

  const handleCapture = (action: ShortcutActionCatalogEntry, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (capturingActionId !== action.id) return;
    event.preventDefault();
    event.stopPropagation();
    const binding = bindingFromEvent(event);
    if (!binding) return;

    const conflict = findConflict(action, binding);
    if (conflict) {
      setPendingConflict({ action, binding, conflictingAction: conflict });
      setCapturingActionId(null);
      return;
    }

    commitBinding(action, binding);
    setCapturingActionId(null);
  };

  if (preference.isLoading && !preference.hasLoadedInitial) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator layout="stacked" text={t('settings.loading', { defaultValue: 'Loading keyboard shortcuts...' })} spinnerProps={{ size: 'md' }} />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.title', { defaultValue: 'Keyboard Shortcuts' })}</CardTitle>
        <CardDescription>{t('settings.description', { defaultValue: 'Customize keyboard shortcuts for this device and account.' })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-end">
          <Button id="keyboard-shortcuts-reset-all" variant="destructive" onClick={() => setResetAllOpen(true)}>
            {t('settings.actions.resetAll', { defaultValue: 'Reset all' })}
          </Button>
        </div>
        {groupedActions.map(([groupKey, actions]) => (
          <section key={groupKey} className="space-y-2">
            <h3 className="text-sm font-semibold">{t(groupKey, { defaultValue: groupKey.replace('groups.', '') })}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.columns.action', { defaultValue: 'Action' })}</TableHead>
                  <TableHead>{t('settings.columns.scope', { defaultValue: 'Scope' })}</TableHead>
                  <TableHead>{t('settings.columns.default', { defaultValue: 'Default' })}</TableHead>
                  <TableHead>{t('settings.columns.effective', { defaultValue: 'Effective binding' })}</TableHead>
                  <TableHead>{t('settings.columns.enabled', { defaultValue: 'Enabled' })}</TableHead>
                  <TableHead>{t('settings.columns.reset', { defaultValue: 'Reset' })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((action) => {
                  const effective = resolveActionBindings(action, preference.value, platform);
                  const defaults = getDefaultBindingsForPlatform(action, platform);
                  const enabled = !isActionDisabled(action.id, preference.value);
                  return (
                    <TableRow key={action.id}>
                      <TableCell>
                        <div className="font-medium">{t(action.labelKey, { defaultValue: action.id })}</div>
                        <div className="text-xs text-gray-500">{t(action.descriptionKey ?? action.labelKey, { defaultValue: action.id })}</div>
                      </TableCell>
                      <TableCell>{action.scope}</TableCell>
                      <TableCell>{defaults.join(', ')}</TableCell>
                      <TableCell>
                        <Button
                          id={`keyboard-shortcut-capture-${action.id.replace(/\./g, '-')}`}
                          variant="outline"
                          size="sm"
                          onClick={() => setCapturingActionId(action.id)}
                          onKeyDown={(event) => handleCapture(action, event)}
                        >
                          {capturingActionId === action.id
                            ? t('settings.capturePrompt', { defaultValue: 'Press keys' })
                            : effective.join(', ')}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Switch
                          id={`keyboard-shortcut-enabled-${action.id.replace(/\./g, '-')}`}
                          checked={enabled}
                          onCheckedChange={(checked) => updatePreference(
                            (current) => setActionDisabled(current, action.id, !checked),
                            'settings.messages.enabledUpdated',
                          )}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          id={`keyboard-shortcut-reset-${action.id.replace(/\./g, '-')}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => updatePreference(
                            (current) => {
                              const withoutBinding = setActionBindingsDelta(current, action, platform, defaults);
                              return setActionDisabled(withoutBinding, action.id, false);
                            },
                            'settings.messages.resetOne',
                          )}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
        ))}
      </CardContent>
      <ConfirmationDialog
        id="keyboard-shortcuts-reset-all-confirmation"
        isOpen={resetAllOpen}
        onClose={() => setResetAllOpen(false)}
        onConfirm={() => {
          preference.setValue(EMPTY_SHORTCUT_PREFERENCES);
          toast.success(t('settings.messages.resetAll', { defaultValue: 'Keyboard shortcuts reset' }));
          setResetAllOpen(false);
        }}
        title={t('settings.resetAll.title', { defaultValue: 'Reset all shortcuts?' })}
        message={t('settings.resetAll.message', { defaultValue: 'All custom keyboard shortcuts will be removed.' })}
        confirmLabel={t('settings.actions.resetAll', { defaultValue: 'Reset all' })}
      />
      <ConfirmationDialog
        id="keyboard-shortcuts-conflict-confirmation"
        isOpen={pendingConflict !== null}
        onClose={() => setPendingConflict(null)}
        onConfirm={() => {
          if (pendingConflict) {
            commitBinding(pendingConflict.action, pendingConflict.binding);
          }
          setPendingConflict(null);
        }}
        title={t('settings.conflict.title', { defaultValue: 'Replace existing shortcut?' })}
        message={pendingConflict
          ? t('settings.conflict.message', {
              defaultValue: '{{binding}} is already assigned to {{action}}.',
              binding: pendingConflict.binding,
              action: t(pendingConflict.conflictingAction.labelKey, { defaultValue: pendingConflict.conflictingAction.id }),
            })
          : ''}
        confirmLabel={t('settings.actions.replace', { defaultValue: 'Replace' })}
      />
    </Card>
  );
}
