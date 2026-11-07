'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MAX_LABELS_PER_REQUEST, type LabelClass, type LabelPrintErrorCode, type LabelPrintFailure } from '@alga-psa/types';
import { Dialog, DialogContent } from '../Dialog';
import { Button } from '../Button';
import { Input } from '../Input';
import { Checkbox } from '../Checkbox';
import CustomSelect from '../CustomSelect';
import { Alert, AlertDescription } from '../Alert';
import { useTranslation } from '../../lib/i18n/client';
import {
  DEFAULT_LABEL_LAYOUT_PRESET,
  LABEL_LAYOUT_PRESETS,
  LABEL_LAYOUT_STORAGE_KEY,
  isLabelLayoutPresetId,
  type LabelLayoutPresetId,
} from './labelLayoutPresets';
import {
  useLabelPrint,
  type LabelPrintOutcome,
  type LabelTemplateList,
  type LabelSubject,
  type LinkedAssetChoice,
} from './useLabelPrint';

const MAX_OVERRIDE_LENGTH = 120;
const NO_LINKED_ASSET = '__none__';

/** Expand physical asset labels in stable adjacent groups: A,A,B,B. */
export function expandAssetLabelCopies<T>(subjects: readonly T[], copiesPerAsset: number): T[] {
  const copies = Math.max(1, Math.min(10, Math.trunc(copiesPerAsset) || 1));
  return subjects.flatMap((subject) => Array.from({ length: copies }, () => subject));
}

export interface LabelPrintDialogProps {
  isOpen: boolean;
  onClose: () => void;
  labelClass: LabelClass;
  ids: string[];
  /** Single-ticket extras: prefill for the editable Item / Reason fields. */
  defaultTitle?: string;
  defaultDetail?: string;
  idPrefix?: string;
}

/**
 * The label subjects for a ticket work tag: batch -> one per held item (custody !== null), in choice order;
 * otherwise one subject carrying the current pick, if any.
 */
export function buildLabelSubjects(
  ticketId: string,
  choices: ReadonlyArray<LinkedAssetChoice>,
  pickedAssetId: string,
  batch: boolean
): LabelSubject[] {
  if (batch) {
    return choices.filter((c) => c.custody).map((c) => ({ recordId: ticketId, linkedAssetId: c.assetId }));
  }
  return [{ recordId: ticketId, ...(pickedAssetId !== NO_LINKED_ASSET ? { linkedAssetId: pickedAssetId } : {}) }];
}

function readStoredPreset(): LabelLayoutPresetId {
  try {
    const stored = window.localStorage.getItem(LABEL_LAYOUT_STORAGE_KEY);
    if (isLabelLayoutPresetId(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LABEL_LAYOUT_PRESET;
}

export function LabelPrintDialog({
  isOpen,
  onClose,
  labelClass,
  ids,
  defaultTitle = '',
  defaultDetail = '',
  idPrefix = 'label-print',
}: LabelPrintDialogProps) {
  const { t } = useTranslation('common');
  const { print, loadTemplates, loadLinkedAssets, isPrinting } = useLabelPrint();

  const isSingleTicket = labelClass === 'ticket-work-tag' && ids.length === 1;

  const [templates, setTemplates] = useState<LabelTemplateList | null>(null);
  const [templateId, setTemplateId] = useState<string>('');
  const [preset, setPreset] = useState<LabelLayoutPresetId>(DEFAULT_LABEL_LAYOUT_PRESET);
  const [title, setTitle] = useState(defaultTitle);
  const [detail, setDetail] = useState(defaultDetail);
  const [linkedAssets, setLinkedAssets] = useState<LinkedAssetChoice[]>([]);
  const [linkedAssetId, setLinkedAssetId] = useState<string>(NO_LINKED_ASSET);
  const [batch, setBatch] = useState(false);
  const [outcome, setOutcome] = useState<LabelPrintOutcome | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [copiesPerAsset, setCopiesPerAsset] = useState(2);
  const labelCount = labelClass === 'asset-identity' ? ids.length * copiesPerAsset : ids.length;
  const tooMany = labelCount > MAX_LABELS_PER_REQUEST;

  useEffect(() => {
    if (!isOpen) return;
    setOutcome(null);
    setExcluded(new Set());
    setTitle(defaultTitle);
    setDetail(defaultDetail);
    setLinkedAssetId(NO_LINKED_ASSET);
    setBatch(false);
    setCopiesPerAsset(2);
    setPreset(readStoredPreset());
    let cancelled = false;
    void loadTemplates(labelClass).then((list) => {
      if (cancelled) return;
      setTemplates(list);
      setTemplateId(list?.defaultTemplateId ?? list?.templates[0]?.id ?? '');
    });
    if (isSingleTicket) {
      void loadLinkedAssets(ids[0]).then((assets) => {
        if (!cancelled) setLinkedAssets(assets);
      });
    } else {
      setLinkedAssets([]);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, labelClass, isSingleTicket, ids.join(','), defaultTitle, defaultDetail]);

  const onPresetChange = (value: string) => {
    if (!isLabelLayoutPresetId(value)) return;
    setPreset(value);
    try {
      window.localStorage.setItem(LABEL_LAYOUT_STORAGE_KEY, value);
    } catch {
      /* storage unavailable */
    }
  };

  const presetOptions = useMemo(
    () =>
      (Object.keys(LABEL_LAYOUT_PRESETS) as LabelLayoutPresetId[]).map((id) => ({
        value: id,
        label: t(`labels.layout.${id}`, { defaultValue: LABEL_LAYOUT_PRESETS[id].defaultLabel }),
      })),
    [t]
  );

  const templateOptions = (templates?.templates ?? []).map((tpl) => ({
    value: tpl.id,
    label: tpl.source === 'standard'
      ? t(`labels.standardTemplates.${tpl.id}`, { defaultValue: tpl.name })
      : tpl.name,
  }));

  // Human-readable page size for a template or layout preset, used by the paper-mismatch warning.
  const formatPaper = (size?: { width: number; height: number } | null): string | null => {
    if (!size) return null;
    const near = (w: number, h: number) => Math.abs(size.width - w) < 1 && Math.abs(size.height - h) < 1;
    if (near(210, 297)) return t('labels.paper.a4', { defaultValue: 'A4' });
    if (near(215.9, 279.4)) return t('labels.paper.letter', { defaultValue: 'Letter' });
    if (near(215.9, 355.6)) return t('labels.paper.legal', { defaultValue: 'Legal' });
    return `${Math.round(size.width)} × ${Math.round(size.height)} mm`;
  };
  const mmFromLayout = (layout: unknown): { width: number; height: number } | null => {
    if (!layout || typeof layout !== 'object') return null;
    const l = layout as {
      kind?: string;
      pageSize?: { width: number; height: number; unit: string };
      labelWidth?: number;
      labelHeight?: number;
      unit?: string;
    };
    const source = l.kind === 'grid' ? { width: l.labelWidth, height: l.labelHeight, unit: l.unit } : l.pageSize;
    if (!source || typeof source.width !== 'number' || typeof source.height !== 'number') return null;
    const factor = source.unit === 'in' ? 25.4 : 1;
    return { width: source.width * factor, height: source.height * factor };
  };
  // True when the chosen layout prints on a different paper than the template declares (e.g. an A4
  // template sent through the Letter layout), which the server rejects with a paper-size error.
  const paperMismatch = (() => {
    if (preset === 'template-preferred') return null;
    const tpl = (templates?.templates ?? []).find((candidate) => candidate.id === templateId);
    if (!tpl?.prefersPaperPage) return null;
    const templatePaper = tpl.paperSizeMm ?? null;
    const layoutPaper = mmFromLayout(LABEL_LAYOUT_PRESETS[preset].layout);
    if (!templatePaper || !layoutPaper) return null;
    const same = Math.abs(templatePaper.width - layoutPaper.width) < 1 && Math.abs(templatePaper.height - layoutPaper.height) < 1;
    if (same) return null;
    return { template: formatPaper(templatePaper), layout: formatPaper(layoutPaper) };
  })();

  const run = useCallback(
    async (skipRecordIds: Set<string>, overrideTemplateCode?: string) => {
      const selectedLabels: LabelSubject[] = isSingleTicket
        ? buildLabelSubjects(ids[0], linkedAssets, linkedAssetId, batch)
        : ids.filter((id) => !skipRecordIds.has(id)).map((recordId) => ({ recordId }));
      const labels: LabelSubject[] = labelClass === 'asset-identity'
        ? expandAssetLabelCopies(selectedLabels, copiesPerAsset).map((subject) => ({ ...subject }))
        : selectedLabels;
      if (labels.length === 0) return;
      const presetLayout = LABEL_LAYOUT_PRESETS[preset].layout;
      const result = await print({
        labelClass,
        labels,
        templateId: overrideTemplateCode ?? (templateId || undefined),
        // `template-preferred` sends no layout: the server prints on the template's own paper.
        ...(presetLayout !== null ? { layout: presetLayout } : {}),
        ...(isSingleTicket
          ? {
              overrides: {
                ...(title !== defaultTitle ? { title } : {}),
                ...(detail !== defaultDetail ? { detail } : {}),
              },
            }
          : {}),
      });
      setOutcome(result);
    },
    [ids, print, labelClass, templateId, preset, isSingleTicket, title, detail, defaultTitle, defaultDetail, linkedAssetId, linkedAssets, batch, copiesPerAsset]
  );

  const heldAssets = linkedAssets.filter((a) => a.custody);
  const pickedAsset = linkedAssetId !== NO_LINKED_ASSET ? linkedAssets.find((a) => a.assetId === linkedAssetId) : undefined;
  // What the tag will show, in plain language. Null = nothing worth saying (no custody on the tag).
  let preview: string | null = null;
  if (isSingleTicket) {
    if (batch && heldAssets.length > 1) {
      preview = t('labels.dialog.previewBatch', {
        defaultValue: 'Print {{count}} tags, one per held item.',
        count: heldAssets.length,
      });
    } else if (pickedAsset) {
      preview = pickedAsset.custody
        ? t('labels.dialog.previewPicked', { defaultValue: "The tag will show this item's location and next action." })
        : t('labels.dialog.previewPickedNotHeld', { defaultValue: 'This item is not held, so the tag shows no location.' });
    } else if (heldAssets.length > 1) {
      preview = t('labels.dialog.previewSummary', { defaultValue: '{{count}} items held.', count: heldAssets.length });
    } else if (heldAssets.length === 1) {
      const location = heldAssets[0].custody?.custodyLocation;
      preview = location
        ? t('labels.dialog.previewSingle', { defaultValue: 'The tag will show {{location}}.', location })
        : t('labels.dialog.previewSingleNoLocation', { defaultValue: "The tag will show this item's next action." });
    }
  }

  const failures: LabelPrintFailure[] = outcome?.status === 'failed' ? outcome.failures : [];
  const localizedWorksheetError = (code?: LabelPrintErrorCode, worksheetNumbers?: number[]): string | null => {
    if (code === 'worksheetPageSize') {
      return t('labels.dialog.worksheetPageSizeError', {
        defaultValue: 'The worksheet does not fit the selected print layout. Use "Template paper" or a layout on the same paper as the template.',
      });
    }
    if (code === 'worksheetTextOverflow' && worksheetNumbers?.length) {
      return t('labels.dialog.worksheetTextOverflowError', {
        defaultValue: 'Worksheet {{numbers}} contains text that will not fit. Adjust the layout or shorten the content before printing.',
        numbers: worksheetNumbers.join(', '),
      });
    }
    return null;
  };

  const skipFailures = () => {
    const next = new Set(excluded);
    failures.forEach((f) => next.add(f.recordId));
    setExcluded(next);
    void run(next);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={`${idPrefix}-dialog`}
      title={
        labelClass === 'asset-identity'
          ? t('labels.dialog.assetTitle', { defaultValue: 'Print asset labels' })
          : t('labels.dialog.ticketTitle', { defaultValue: 'Print work tags' })
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button id={`${idPrefix}-cancel-button`} variant="outline" onClick={onClose}>
            {t('actions.close', { defaultValue: 'Close' })}
          </Button>
          <Button
            id={`${idPrefix}-submit-button`}
            disabled={isPrinting || tooMany || ids.length === 0}
            onClick={() => void run(excluded)}
          >
            {isPrinting
              ? t('labels.dialog.printing', { defaultValue: 'Preparing…' })
              : t('labels.dialog.print', { defaultValue: 'Print' })}
          </Button>
        </div>
      }
    >
      <DialogContent>
        <div className="space-y-4">
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            {t('labels.dialog.count', { defaultValue: '{{count}} selected', count: ids.length })}
          </p>

          {labelClass === 'asset-identity' && (
            <div>
              <label htmlFor={`${idPrefix}-copies-per-asset`} className="mb-1 block text-sm font-medium">
                {t('labels.dialog.copiesPerAsset', { defaultValue: 'Copies per asset' })}
              </label>
              <Input
                id={`${idPrefix}-copies-per-asset`}
                type="number"
                min={1}
                max={10}
                value={copiesPerAsset}
                onChange={(event) => setCopiesPerAsset(Math.max(1, Math.min(10, Number(event.target.value) || 1)))}
              />
              <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{t('labels.dialog.adjacentCopies', { defaultValue: 'Copies print together for each asset.' })}</p>
            </div>
          )}

          {tooMany && (
            <Alert variant="warning">
              <AlertDescription>
                {t('labels.dialog.tooMany', {
                  defaultValue: 'You can print at most {{max}} labels at a time.',
                  max: MAX_LABELS_PER_REQUEST,
                })}
              </AlertDescription>
            </Alert>
          )}

          {templateOptions.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t('labels.dialog.template', { defaultValue: 'Template' })}
              </label>
              <CustomSelect
                id={`${idPrefix}-template-select`}
                options={templateOptions}
                value={templateId}
                onValueChange={setTemplateId}
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">
              {t('labels.dialog.layout', { defaultValue: 'Layout' })}
            </label>
            <CustomSelect
              id={`${idPrefix}-layout-select`}
              options={presetOptions}
              value={preset}
              onValueChange={onPresetChange}
            />
          </div>

          {/* A worksheet template declares a full-sheet page; a different paper cannot hold it, so say
              so before the print fails with "does not fit on the label". */}
          {paperMismatch && (
            <Alert variant="warning">
              <AlertDescription>
                {t('labels.dialog.paperMismatchWarning', {
                  defaultValue:
                    'This template is designed for {{template}} paper, but the selected layout prints on {{layout}}. Choose "Template paper" or the matching full-sheet layout, or the content will not fit.',
                  template: paperMismatch.template,
                  layout: paperMismatch.layout,
                })}
              </AlertDescription>
            </Alert>
          )}

          {isSingleTicket && (
            <>
              <Input
                id={`${idPrefix}-item-input`}
                label={t('labels.dialog.item', { defaultValue: 'Item' })}
                value={title}
                maxLength={MAX_OVERRIDE_LENGTH}
                onChange={(e) => setTitle(e.target.value)}
              />
              <Input
                id={`${idPrefix}-reason-input`}
                label={t('labels.dialog.reason', { defaultValue: 'Reason' })}
                value={detail}
                maxLength={MAX_OVERRIDE_LENGTH}
                onChange={(e) => setDetail(e.target.value)}
              />
              {linkedAssets.length > 1 && (
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('labels.dialog.linkedAsset', { defaultValue: 'Linked asset' })}
                  </label>
                  <CustomSelect
                    id={`${idPrefix}-linked-asset-select`}
                    options={[
                      { value: NO_LINKED_ASSET, label: t('labels.dialog.noAsset', { defaultValue: 'No asset' }) },
                      ...linkedAssets.map((a) => ({
                        value: a.assetId,
                        label:
                          [[a.assetTag, a.name].filter(Boolean).join(' - ') || t('labels.dialog.unnamedAsset', { defaultValue: 'Unnamed asset' }), a.custody?.custodyLocation]
                            .filter(Boolean)
                            .join(' \u2014 '),
                      })),
                    ]}
                    value={linkedAssetId}
                    onValueChange={setLinkedAssetId}
                    disabled={batch}
                  />
                </div>
              )}
              {heldAssets.length > 1 && (
                <Checkbox
                  id={`${idPrefix}-batch-checkbox`}
                  label={t('labels.dialog.batch', {
                    defaultValue: 'One tag per held item ({{count}})',
                    count: heldAssets.length,
                  })}
                  checked={batch}
                  onChange={(e) => setBatch(e.target.checked)}
                />
              )}
              {preview && (
                <p id={`${idPrefix}-preview`} className="text-sm text-[rgb(var(--color-text-600))]">
                  {preview}
                </p>
              )}
            </>
          )}

          {outcome?.status === 'printed' && (
            <Alert variant="success">
              <AlertDescription>
                <div id={`${idPrefix}-result`}>
                  {t('labels.dialog.printed', {
                    defaultValue: 'Printed {{count}} labels.',
                    count: outcome.printed,
                  })}
                  {outcome.skipped > 0 && (
                    <>
                      {' '}
                      {t('labels.dialog.skipped', {
                        defaultValue: '{{count}} records were skipped because they could not be opened.',
                        count: outcome.skipped,
                      })}
                    </>
                  )}
                  {outcome.popupBlocked && (
                    <>
                      {' '}
                      <a
                        id={`${idPrefix}-open-pdf-link`}
                        href={outcome.blobUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {t('labels.dialog.openPdf', { defaultValue: 'Open PDF' })}
                      </a>
                    </>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {outcome?.status === 'failed' && (
            <Alert variant="destructive">
              <AlertDescription>
                <div id={`${idPrefix}-error`} className="space-y-2">
                  <p>
                    {outcome.httpStatus === 404
                      ? t('labels.dialog.notFound', { defaultValue: 'These records could not be opened.' })
                      : localizedWorksheetError(outcome.errorCode, outcome.worksheetNumbers) ||
                        (failures.some((failure) => failure.errorCode)
                         ? t('labels.dialog.failed', { defaultValue: 'The labels could not be printed.' })
                         : outcome.message) ||
                        t('labels.dialog.failed', { defaultValue: 'The labels could not be printed.' })}
                  </p>
                  {failures.length > 0 && (
                    <>
                      <ul className="list-disc pl-5">
                        {failures.map((f) => (
                          <li key={`${f.recordId}-${f.index}`}>
                            <span className="font-medium">{f.identifier}</span>: {localizedWorksheetError(f.errorCode) || f.message}
                            {f.suggestedTemplateCode && (
                              <Button
                                id={`${idPrefix}-use-${f.recordId}`}
                                variant="link"
                                size="sm"
                                onClick={() => void run(excluded, f.suggestedTemplateCode)}
                              >
                                {t('labels.dialog.useTemplate', {
                                  defaultValue: 'Use {{template}}',
                                  template: f.suggestedTemplateCode,
                                })}
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                      <Button id={`${idPrefix}-skip-failures-button`} variant="outline" size="sm" onClick={skipFailures}>
                        {t('labels.dialog.skipFailures', { defaultValue: 'Skip these and print the rest' })}
                      </Button>
                    </>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default LabelPrintDialog;
