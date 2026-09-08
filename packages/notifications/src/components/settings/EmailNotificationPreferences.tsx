'use client';

import { useEffect, useRef, useState } from 'react';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getUserEmailPreferenceStateAction,
  updateUserEmailCategoryPreferencesAction,
  updateUserEmailSubtypePreferenceAction,
} from '../../actions/notification-actions/notificationActions';
import { isNotificationActionError } from '../../actions/notificationActionErrors';
import type { UserEmailPreferenceCategoryState } from '../../types/notification';
import { createSerialMutationQueue } from './serialMutationQueue';

// A re-entered panel waits for an already accepted save before loading its snapshot.
const operations = createSerialMutationQueue();
type State = UserEmailPreferenceCategoryState[];

export function EmailNotificationPreferences() {
  const { t } = useTranslation('common');
  const [categories, setCategories] = useState<State>([]);
  const [busy, setBusy] = useState(true);
  const [slow, setSlow] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const confirmed = useRef<State>([]);
  const busyRef = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [busy]);

  const load = () => {
    const version = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    setLoadError(false);
    void operations.enqueue(getUserEmailPreferenceStateAction).then(state => {
      if (version !== generation.current) return;
      confirmed.current = state;
      setCategories(state);
    }).catch(() => {
      if (version === generation.current) setLoadError(true);
    }).finally(() => {
      if (version !== generation.current) return;
      busyRef.current = false;
      setBusy(false);
    });
  };

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, []);

  const save = (category: UserEmailPreferenceCategoryState, enabled: boolean, subtypeId?: number) => {
    // Synchronous guard also rejects a second event before React paints disabled controls.
    if (busyRef.current || !category.is_enabled) return;
    const eligible = category.subtypes.filter(subtype => subtype.is_enabled && (subtypeId === undefined || subtype.id === subtypeId));
    if (!eligible.length) return;
    busyRef.current = true;
    setBusy(true);
    setSaveError(false);
    const version = ++generation.current;
    const ids = new Set(eligible.map(subtype => subtype.id));
    setCategories(state => state.map(current => current.id === category.id ? {
      ...current,
      subtypes: current.subtypes.map(subtype => ids.has(subtype.id)
        ? { ...subtype, user_is_enabled: enabled, effective_is_enabled: enabled, has_user_override: true }
        : subtype),
    } : current));

    void operations.enqueue(async () => {
      try {
        const result = subtypeId === undefined
          ? await updateUserEmailCategoryPreferencesAction(category.id, enabled)
          : await updateUserEmailSubtypePreferenceAction(subtypeId, enabled);
        if (isNotificationActionError(result)) throw new Error('Preference save rejected');
        if (version !== generation.current) return;
        confirmed.current = result;
        setCategories(result);
      } catch {
        if (version !== generation.current) return;
        setCategories(confirmed.current);
        setSaveError(true);
        try {
          // A lost response can mean the write committed. Reconcile before accepting another edit.
          const state = await getUserEmailPreferenceStateAction();
          if (version !== generation.current) return;
          confirmed.current = state;
          setCategories(state);
        } catch {
          if (version === generation.current) setLoadError(true);
        }
      }
    }).finally(() => {
      if (version !== generation.current) return;
      busyRef.current = false;
      setBusy(false);
    });
  };

  const message = (key: string) => t(`emailPreferences.${key}`);
  if (loadError) return (
    <div role="alert" className="space-y-2">
      <p>{message('loadError')}</p>
      <Button id="retry-email-preferences-button" onClick={load} disabled={busy}>{message('retry')}</Button>
    </div>
  );

  return (
    <div className="space-y-6" aria-busy={busy}>
      {saveError && <p role="alert">{message('saveError')}</p>}
      {busy && <p role="status">{message(slow ? 'slow' : categories.length ? 'saving' : 'loading')}</p>}
      {categories.map(category => {
        const eligible = category.is_enabled ? category.subtypes.filter(subtype => subtype.is_enabled) : [];
        const count = eligible.filter(subtype => subtype.effective_is_enabled).length;
        const checked = eligible.length > 0 && count === eligible.length;
        const mixed = count > 0 && count < eligible.length;
        const categoryControl = `email-category-${category.id}`;
        return (
          <div key={category.id} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor={categoryControl}>{category.name}</Label>
                {!category.is_enabled && <p className="text-sm text-[rgb(var(--color-text-500))]">{message('disabledByAdmin')}</p>}
                {mixed && <p className="text-sm text-[rgb(var(--color-text-500))]">{message('mixed')}</p>}
              </div>
              <Checkbox id={categoryControl} checked={checked} indeterminate={mixed}
                aria-checked={mixed ? 'mixed' : checked}
                disabled={busy || !eligible.length}
                onChange={() => save(category, !checked)} />
            </div>
            <div className="ml-6 space-y-2">
              {category.subtypes.map(subtype => {
                const disabled = !category.is_enabled || !subtype.is_enabled;
                const control = `email-subtype-${subtype.id}`;
                return (
                  <div key={subtype.id} className="flex items-center justify-between gap-3">
                    <div>
                      <Label htmlFor={control} className="text-sm">{subtype.name}</Label>
                      {disabled && <p className="text-sm text-[rgb(var(--color-text-500))]">{message('disabledByAdmin')}</p>}
                    </div>
                    <Switch id={control} checked={subtype.effective_is_enabled}
                      disabled={busy || disabled} onCheckedChange={enabled => save(category, enabled, subtype.id)} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {!busy && categories.length === 0 && <p>{message('empty')}</p>}
    </div>
  );
}
