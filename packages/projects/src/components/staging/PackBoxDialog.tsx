'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { isStockConflictResult } from '@alga-psa/inventory/lib/stockConflict';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { packProjectStagingBox } from '../../actions/stagingActions';
import { isActiveLine, isSingletonLine, stagingLineTitle, type StagingContainerView, type StagingLineView } from './stagingTypes';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPacked: () => void;
  projectId: string;
  box: StagingContainerView | null;
  lines: StagingLineView[];
  /** Lines to tick when the dialog opens (the page's selection). */
  preselected?: string[];
}

const isError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);

/** What is left of a line to pack, and whether it can go in this box at all. */
export function packableQuantity(line: StagingLineView, boxId: string): number {
  if (!isActiveLine(line)) return 0;
  if (isSingletonLine(line)) return line.container_ids.length === 0 ? 1 : 0;
  return Math.max(0, line.quantity - line.packed_quantity);
}

/** Pack lines into an open box. Packing a reserved line stages it: it has been physically picked. */
export default function PackBoxDialog({ isOpen, onClose, onPacked, projectId, box, lines, preselected = [] }: Props) {
  const { t } = useTranslation(['features/projects', 'common']);
  const st = useCallback((key: string, fallback: string, options?: Record<string, unknown>) =>
    t(`staging.pack.${key}`, { defaultValue: fallback, ...(options ?? {}) }), [t]);
  const candidates = useMemo(() => (box ? lines.filter((l) => packableQuantity(l, box.container_id) > 0) : []), [box, lines]);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !box) return;
    const initial: Record<string, number> = {};
    for (const line of candidates) {
      if (preselected.includes(line.staging_line_id)) initial[line.staging_line_id] = packableQuantity(line, box.container_id);
    }
    setPicked(initial);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, box?.container_id]);

  const handlePack = async () => {
    if (!box) return;
    const items = Object.entries(picked)
      .filter(([, quantity]) => quantity > 0)
      .map(([staging_line_id, quantity]) => ({ staging_line_id, quantity }));
    if (items.length === 0) {
      setError(st('nothingChosen', 'Choose something to pack.'));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const result = await packProjectStagingBox(projectId, box.container_id, items);
      if (isStockConflictResult(result)) {
        setError(result.stockConflict.message);
        return;
      }
      if (isError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      onPacked();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : st('failed', 'Could not pack the box.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      id="staging-pack-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={box ? st('title', 'Pack box {{identifier}}', { identifier: box.identifier }) : ''}
    >
      <DialogContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {st('intro', 'Reserved items you pack are staged: their stock is held for this project and can no longer be taken for anything else.')}
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm">{st('nothingToPack', 'Everything in staging is already packed or installed.')}</p>
        ) : (
          <div className="max-h-80 overflow-y-auto divide-y rounded border">
            {candidates.map((line) => {
              const max = packableQuantity(line, box!.container_id);
              const checked = (picked[line.staging_line_id] ?? 0) > 0;
              return (
                <div key={line.staging_line_id} className="flex items-center gap-3 p-2">
                  <Checkbox
                    id={`staging-pack-line-${line.staging_line_id}`}
                    checked={checked}
                    onChange={(event) => {
                      const on = (event.target as HTMLInputElement).checked;
                      setPicked((prev) => ({ ...prev, [line.staging_line_id]: on ? max : 0 }));
                    }}
                  />
                  <div className="flex-1 min-w-0 text-sm">
                    <div className="font-medium truncate">{stagingLineTitle(line)}</div>
                    <div className="text-xs text-muted-foreground">
                      {line.serial_number || line.asset_tag || line.sku || ''}
                    </div>
                  </div>
                  {!isSingletonLine(line) && (
                    <Input
                      id={`staging-pack-qty-${line.staging_line_id}`}
                      type="number"
                      className="w-20"
                      min={1}
                      max={max}
                      disabled={!checked}
                      value={picked[line.staging_line_id] || max}
                      onChange={(event) => {
                        const value = Math.min(max, Math.max(0, Math.floor(Number(event.target.value) || 0)));
                        setPicked((prev) => ({ ...prev, [line.staging_line_id]: value }));
                      }}
                      aria-label={st('quantityFor', 'Quantity of {{item}}', { item: stagingLineTitle(line) })}
                    />
                  )}
                  {!isSingletonLine(line) && <span className="text-xs text-muted-foreground">/ {max}</span>}
                </div>
              );
            })}
          </div>
        )}
        {error && (
          <Alert variant="destructive" id="staging-pack-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
      <DialogFooter>
        <Button id="staging-pack-cancel" variant="outline" onClick={onClose}>
          {t('common:actions.cancel', 'Cancel')}
        </Button>
        <Button id="staging-pack-submit" onClick={handlePack} disabled={isSaving || candidates.length === 0}>
          {isSaving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          {st('submit', 'Pack')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
