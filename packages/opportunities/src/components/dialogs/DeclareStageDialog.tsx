'use client';

import React, { useEffect, useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CitableOpportunitySource } from '../../actions/opportunityActions';

const NO_SOURCE = '';

/**
 * Declaring a stage, optionally citing one of this deal's own interactions or
 * documents as the support. "No source" is the default: the picker never gates
 * the declaration, and a failed source lookup leaves Declare fully usable.
 */
export function DeclareStageDialog({
  isOpen,
  stageLabel,
  loadSources,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  stageLabel: string;
  /** Resolves this opportunity's citable interactions and documents. */
  loadSources: () => Promise<CitableOpportunitySource[]>;
  onClose: () => void;
  onSubmit: (ref: { type: 'interaction' | 'document'; id: string } | null) => Promise<void> | void;
}) {
  const { t } = useTranslation('msp/opportunities');
  const [sources, setSources] = useState<CitableOpportunitySource[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(NO_SOURCE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setSelected(NO_SOURCE);
    setLoading(true);
    loadSources()
      .then((rows) => {
        if (active) setSources(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (active) setSources([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // loadSources is recreated by the host on each render; the dialog opening is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const optionFor = (source: CitableOpportunitySource) => {
    const kind = source.type === 'interaction'
      ? t('opportunities.declare.interactionFallback', 'Interaction')
      : t('opportunities.declare.documentFallback', 'Document');
    const date = source.date ? new Date(source.date).toLocaleDateString() : '';
    return {
      // The value is an internal key; only the label is ever shown.
      value: `${source.type}:${source.id}`,
      label: [kind, source.label, date].filter(Boolean).join(' · '),
    };
  };

  const submit = async () => {
    const source = sources.find((candidate) => `${candidate.type}:${candidate.id}` === selected);
    setSaving(true);
    try {
      await onSubmit(source ? { type: source.type, id: source.id } : null);
      onClose();
    } catch {
      // The host has already toasted the failure; keep the dialog open to retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      id="opportunity-declare-stage-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={t('opportunities.declare.title', 'Move to {{stage}}', { stage: stageLabel })}
    >
      <div className="space-y-4 pt-1">
        <CustomSelect
          id="opportunity-declare-source"
          label={t('opportunities.declare.sourceLabel', 'Supporting source')}
          value={selected}
          onValueChange={setSelected}
          disabled={loading || saving}
          options={[
            { value: NO_SOURCE, label: t('opportunities.declare.noSource', 'No source') },
            ...sources.map(optionFor),
          ]}
        />
        <p className="text-xs text-[rgb(var(--color-text-500))]">
          {t('opportunities.declare.sourceHelp', "Optional. Cite an interaction or document from this deal. Attach a document to the deal first if it isn't listed.")}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button id="opportunity-declare-cancel" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button id="opportunity-declare-submit" size="sm" onClick={submit} disabled={saving}>
            {t('opportunities.declare.submit', 'Declare')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
