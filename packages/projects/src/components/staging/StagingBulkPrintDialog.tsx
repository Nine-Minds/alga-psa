'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  DEFAULT_LABEL_LAYOUT_PRESET,
  LABEL_LAYOUT_PRESETS,
  isLabelLayoutPresetId,
  type LabelLayoutPresetId,
} from '@alga-psa/ui/components/labels/labelLayoutPresets';
import { useLabelPrint } from '@alga-psa/ui/components/labels/useLabelPrint';
import { MAX_LABELS_PER_REQUEST } from '@alga-psa/types';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { planStagingPrint } from '../../lib/stagingPrintItems';
import type { StagingContainerView, StagingLineView } from './stagingTypes';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  boxes: StagingContainerView[];
  lines: StagingLineView[];
  canReadInventory: boolean;
  /** Boxes ticked when the dialog opens; all when absent. */
  initialBoxIds?: string[] | null;
}

/**
 * Print a project's staged equipment as ONE PDF: each box's label followed by its unit and client-asset
 * labels, box by box, then staged items that are in no box. Printing changes nothing.
 */
export default function StagingBulkPrintDialog({ isOpen, onClose, boxes, lines, canReadInventory, initialBoxIds }: Props) {
  const { t } = useTranslation(['features/projects', 'common']);
  const st = useCallback((key: string, fallback: string, options?: Record<string, unknown>) =>
    t(`staging.print.${key}`, { defaultValue: fallback, ...(options ?? {}) }), [t]);
  const { print, isPrinting } = useLabelPrint();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [includeUnboxed, setIncludeUnboxed] = useState(true);
  const [preset, setPreset] = useState<LabelLayoutPresetId>(DEFAULT_LABEL_LAYOUT_PRESET);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setChosen(new Set(initialBoxIds ?? boxes.map((b) => b.container_id)));
    setIncludeUnboxed(!initialBoxIds);
    setMessage(null);
  }, [isOpen, boxes, initialBoxIds]);

  const plan = useMemo(
    () => planStagingPrint(boxes, lines, { canReadInventory, boxIds: [...chosen], includeUnboxed }),
    [boxes, lines, canReadInventory, chosen, includeUnboxed],
  );

  const handlePrint = async () => {
    setMessage(null);
    const outcome = await print({ labels: plan.labels, layout: LABEL_LAYOUT_PRESETS[preset].layout });
    if (outcome.status === 'failed') {
      setMessage({ kind: 'error', text: outcome.message || st('failed', 'The labels could not be printed.') });
      return;
    }
    if (outcome.skipped > 0 || outcome.popupBlocked) {
      setMessage({
        kind: 'info',
        text: [
          outcome.skipped > 0 ? st('skipped', '{{count}} label(s) you cannot view were left out.', { count: outcome.skipped }) : '',
          outcome.popupBlocked ? st('popupBlocked', 'Your browser blocked the PDF window; allow pop-ups and try again.') : '',
        ].filter(Boolean).join(' '),
      });
      return;
    }
    onClose();
  };

  return (
    <Dialog id="staging-bulk-print-dialog" isOpen={isOpen} onClose={onClose} title={st('title', 'Print staging labels')}>
      <DialogContent className="space-y-4">
        <div className="space-y-2">
          <Label>{st('boxes', 'Boxes')}</Label>
          <div className="max-h-56 overflow-y-auto rounded border p-2 space-y-1">
            {boxes.length === 0 && <p className="text-sm text-muted-foreground">{st('noBoxes', 'No boxes yet.')}</p>}
            {boxes.map((box) => (
              <Checkbox
                key={box.container_id}
                id={`staging-print-box-${box.container_id}`}
                checked={chosen.has(box.container_id)}
                onChange={(event) => {
                  const next = new Set(chosen);
                  if ((event.target as HTMLInputElement).checked) next.add(box.container_id);
                  else next.delete(box.container_id);
                  setChosen(next);
                }}
                label={st('boxOption', '{{identifier}} (box {{n}} of {{total}}){{name}}', {
                  identifier: box.identifier,
                  n: box.position.n,
                  total: box.position.total,
                  name: box.name ? `: ${box.name}` : '',
                })}
              />
            ))}
          </div>
          <Checkbox
            id="staging-print-unboxed"
            checked={includeUnboxed}
            onChange={(event) => setIncludeUnboxed((event.target as HTMLInputElement).checked)}
            label={st('includeUnboxed', 'Also print staged items that are not in a box')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="staging-print-layout">{st('layout', 'Layout')}</Label>
          <CustomSelect
            id="staging-print-layout"
            options={Object.entries(LABEL_LAYOUT_PRESETS).map(([value, p]) => ({
              value,
              label: t(`common:labels.layout.${value}`, { defaultValue: p.defaultLabel }),
            }))}
            value={preset}
            onValueChange={(value) => isLabelLayoutPresetId(value) && setPreset(value)}
          />
        </div>
        <p className="text-sm" id="staging-print-count">
          {st('count', '{{count}} label(s) in one PDF.', { count: plan.labels.length })}
        </p>
        {plan.droppedUnitLabels > 0 && (
          <Alert variant="info" id="staging-print-no-inventory">
            <AlertDescription>
              {st('noInventory', '{{count}} stock unit label(s) are not included because you cannot view inventory.', { count: plan.droppedUnitLabels })}
            </AlertDescription>
          </Alert>
        )}
        {plan.overCap && (
          <Alert variant="warning" id="staging-print-over-cap">
            <AlertDescription>
              {st('overCap', 'One print holds at most {{max}} labels. Choose fewer boxes and print the rest separately.', { max: MAX_LABELS_PER_REQUEST })}
            </AlertDescription>
          </Alert>
        )}
        {message && (
          <Alert variant={message.kind === 'error' ? 'destructive' : 'info'} id="staging-print-message">
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
      <DialogFooter>
        <Button id="staging-print-cancel" variant="outline" onClick={onClose}>
          {t('common:actions.cancel', 'Cancel')}
        </Button>
        <Button id="staging-print-submit" onClick={handlePrint} disabled={isPrinting || plan.labels.length === 0 || plan.overCap}>
          {isPrinting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          {st('submit', 'Print')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
