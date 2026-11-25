'use client';

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import SearchableSelect from '@alga-psa/ui/components/SearchableSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CitableOpportunitySource } from '../../actions/opportunityActions';

export type DeclarationSourceType = 'interaction' | 'document';

/** A source already on the declaration, as the ladder resolved it. */
export interface DeclarationDialogSource {
  type: DeclarationSourceType;
  id: string;
  label: string | null;
  missing: boolean;
}

/** What the dialog hands back. In declare mode an untouched half is `undefined` (keep); in edit mode every half is explicit. */
export interface DeclarationDialogContent {
  note?: string | null;
  citations?: Array<{ type: DeclarationSourceType; id: string }>;
}

const keyOf = (source: { type: DeclarationSourceType; id: string }) => `${source.type}:${source.id}`;

/**
 * The declaration behind a stage: an optional note and any number of this deal's
 * own interactions or documents as sources. One dialog, two jobs: "declare"
 * moves the deal to the stage; "edit" changes what an already-reached stage says
 * and moves nothing. Neither field gates the submit, and a failed source lookup
 * leaves the note and the submit button fully usable.
 */
export function DeclareStageDialog({
  isOpen,
  mode = 'declare',
  stageLabel,
  initialNote = null,
  initialSources = [],
  loadSources,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  mode?: 'declare' | 'edit';
  stageLabel: string;
  /** Edit mode: the declaration's current note. */
  initialNote?: string | null;
  /** Edit mode: the declaration's current sources, in order. */
  initialSources?: DeclarationDialogSource[];
  /** Resolves this opportunity's citable interactions and documents. */
  loadSources: () => Promise<CitableOpportunitySource[]>;
  onClose: () => void;
  onSubmit: (content: DeclarationDialogContent) => Promise<void> | void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const [available, setAvailable] = useState<CitableOpportunitySource[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [chosen, setChosen] = useState<DeclarationDialogSource[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setNote(mode === 'edit' ? initialNote ?? '' : '');
    setChosen(mode === 'edit' ? initialSources : []);
    setLoading(true);
    loadSources()
      .then((rows) => {
        if (active) setAvailable(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setAvailable([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // loadSources and the initial values are recreated by the host on each render; opening is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode]);

  const kindLabel = (type: DeclarationSourceType) => type === 'interaction'
    ? t('opportunities.declare.interactionFallback', 'Interaction')
    : t('opportunities.declare.documentFallback', 'Document');

  const withDate = (label: string, date: string | null | undefined) =>
    [label, date ? new Date(date).toLocaleDateString() : ''].filter(Boolean).join(' · ');

  const labelOf = (source: DeclarationDialogSource) => {
    if (source.missing) return t('opportunities.declare.sourceRemoved', 'Source removed');
    const found = available.find((candidate) => keyOf(candidate) === keyOf(source));
    return withDate(found?.label || source.label || kindLabel(source.type), found?.date);
  };

  const chosenKeys = new Set(chosen.map(keyOf));
  const options = available
    .filter((source) => !chosenKeys.has(keyOf(source)))
    .map((source) => ({
      // The value is an internal key; only the label is ever shown.
      value: keyOf(source),
      label: withDate(source.label || kindLabel(source.type), source.date),
      group: source.type === 'interaction'
        ? t('opportunities.declare.groupInteractions', 'Interactions')
        : t('opportunities.declare.groupDocuments', 'Documents'),
    }));

  const addSource = (value: string) => {
    const source = available.find((candidate) => keyOf(candidate) === value);
    if (!source) return;
    setChosen((current) => [...current, { type: source.type, id: source.id, label: source.label, missing: false }]);
  };

  const removeSource = (source: DeclarationDialogSource) =>
    setChosen((current) => current.filter((candidate) => keyOf(candidate) !== keyOf(source)));

  const submit = async () => {
    const trimmed = note.trim();
    const citations = chosen.map(({ type, id }) => ({ type, id }));
    // Edit says exactly what the declaration should be, so an emptied field clears it.
    // Declare only adds: a field left untouched keeps what the stage already has.
    const content: DeclarationDialogContent = mode === 'edit'
      ? { note: trimmed || null, citations }
      : { note: trimmed || undefined, citations: citations.length > 0 ? citations : undefined };
    setSaving(true);
    try {
      await onSubmit(content);
      onClose();
    } catch {
      // The host has already toasted the failure; keep the dialog open to retry.
    } finally {
      setSaving(false);
    }
  };

  const title = mode === 'edit'
    ? t('opportunities.declare.editTitle', 'Evidence for {{stage}}', { stage: stageLabel })
    : t('opportunities.declare.title', 'Move to {{stage}}', { stage: stageLabel });

  return (
    <Dialog id="opportunity-declare-stage-dialog" isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4 pt-1">
        <TextArea
          id="opportunity-declare-note"
          label={t('opportunities.declare.noteLabel', 'Note')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('opportunities.declare.notePlaceholder', 'What shows the deal is at this stage?')}
          rows={3}
          disabled={saving}
        />

        <div className="space-y-2">
          <span className="text-sm font-medium text-[rgb(var(--color-text-700))]">
            {t('opportunities.declare.sourcesLabel', 'Supporting sources')}
          </span>
          {chosen.length > 0 ? (
            <ul id="opportunity-declare-sources" className="space-y-1">
              {chosen.map((source) => (
                <li
                  key={keyOf(source)}
                  className="flex items-center gap-2 rounded-md border border-[rgb(var(--color-border-200))] px-2 py-1 text-sm"
                >
                  {source.missing ? (
                    <Badge variant="default-muted" size="sm">{labelOf(source)}</Badge>
                  ) : (
                    <>
                      <Badge variant="default-muted" size="sm">{kindLabel(source.type)}</Badge>
                      <span className="min-w-0 flex-1 truncate" title={labelOf(source)}>{labelOf(source)}</span>
                    </>
                  )}
                  <span className="flex-1" />
                  <Button
                    id={`opportunity-declare-remove-${keyOf(source)}`}
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-none"
                    label={t('opportunities.declare.removeSource', 'Remove source')}
                    aria-label={t('opportunities.declare.removeSource', 'Remove source')}
                    onClick={() => removeSource(source)}
                    disabled={saving}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <SearchableSelect
            id="opportunity-declare-source"
            value=""
            options={options}
            onChange={addSource}
            disabled={loading || saving}
            dropdownMode="overlay"
            placeholder={loading
              ? t('opportunities.declare.sourcesLoading', 'Loading sources…')
              : t('opportunities.declare.addSource', 'Add a source')}
            emptyMessage={t('opportunities.declare.noSourcesAvailable', 'No other interactions or documents on this deal')}
          />
          <p className="text-xs text-[rgb(var(--color-text-500))]">
            {t('opportunities.declare.sourceHelp', "Optional. Cite interactions or documents from this deal. Attach a document to the deal first if it isn't listed.")}
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button id="opportunity-declare-cancel" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button id="opportunity-declare-submit" size="sm" onClick={submit} disabled={saving}>
            {mode === 'edit'
              ? t('opportunities.declare.save', 'Save')
              : t('opportunities.declare.submit', 'Declare')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
