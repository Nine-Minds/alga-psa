'use client';

import React, { useEffect, useState } from 'react';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export type WorkflowSaveState =
  | { kind: 'hidden' }
  | { kind: 'saving' }
  | { kind: 'unsaved'; neverSaved: boolean }
  | { kind: 'saved'; at: number | null };

/** What the header says about saving: nothing to say, saving, unsaved edits, or saved (and when). */
export const getWorkflowSaveState = (input: {
  hasDefinition: boolean;
  hasWorkflow: boolean;
  isSaving: boolean;
  isDirty: boolean;
  lastSavedAt: number | null;
}): WorkflowSaveState => {
  if (!input.hasDefinition) return { kind: 'hidden' };
  if (input.isSaving) return { kind: 'saving' };
  if (input.isDirty) return { kind: 'unsaved', neverSaved: !input.hasWorkflow };
  if (!input.hasWorkflow) return { kind: 'hidden' };
  return { kind: 'saved', at: input.lastSavedAt };
};

type Translate = (key: string, options: Record<string, unknown>) => string;

/** "just now", "3 min ago", "at 14:05": how long ago a save happened, in words. */
export const describeSavedAgo = (t: Translate, savedAt: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 45) return t('designer.saveStatus.justNow', { defaultValue: 'just now' });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('designer.saveStatus.minutesAgo', { defaultValue: '{{count}} min ago', count: minutes });
  const time = new Date(savedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return t('designer.saveStatus.atTime', { defaultValue: 'at {{time}}', time });
};

/** A small, persistent "Saved · just now" / "Unsaved changes" note beside Save Draft. */
export const WorkflowSaveStatus: React.FC<{ state: WorkflowSaveState }> = ({ state }) => {
  const { t } = useTranslation('msp/workflows');
  const [now, setNow] = useState(() => Date.now());
  const savedAt = state.kind === 'saved' ? state.at : null;

  // Keep "2 min ago" current while it is shown.
  useEffect(() => {
    if (savedAt === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [savedAt]);

  if (state.kind === 'hidden' || state.kind === 'saving') return null;

  const unsaved = state.kind === 'unsaved';
  const text = unsaved
    ? state.neverSaved
      ? t('designer.saveStatus.notSavedYet', { defaultValue: 'Not saved yet' })
      : t('designer.saveStatus.unsaved', { defaultValue: 'Unsaved changes' })
    : state.at !== null
      ? t('designer.saveStatus.savedAgo', { defaultValue: 'Saved · {{ago}}', ago: describeSavedAgo(t, state.at, now) })
      : t('designer.saveStatus.saved', { defaultValue: 'Saved' });

  return (
    <span
      id="workflow-designer-save-status"
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 text-xs text-[rgb(var(--color-text-500))]"
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full ${unsaved ? 'bg-[rgb(var(--badge-warning-text))]' : 'bg-[rgb(var(--badge-success-text))]'}`}
      />
      {text}
    </span>
  );
};

export default WorkflowSaveStatus;
