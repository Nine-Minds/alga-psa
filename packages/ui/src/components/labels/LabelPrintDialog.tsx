'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MAX_LABELS_PER_REQUEST, type LabelClass, type LabelPrintFailure } from '@alga-psa/types';
import { Dialog, DialogContent, DialogFooter } from '../Dialog';
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
  const tooMany = ids.length > MAX_LABELS_PER_REQUEST;

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

  useEffect(() => {
    if (!isOpen) return;
    setOutcome(null);
    setExcluded(new Set());
    setTitle(defaultTitle);
    setDetail(defaultDetail);
    setLinkedAssetId(NO_LINKED_ASSET);
    setBatch(false);
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

  const templateOptions = (templates?.templates ?? []).map((tpl) => ({ value: tpl.id, label: tpl.name }));

  const run = useCallback(
    async (skipRecordIds: Set<string>, overrideTemplateCode?: string) => {
      const labels: LabelSubject[] = isSingleTicket
        ? buildLabelSubjects(ids[0], linkedAssets, linkedAssetId, batch)
        : ids.filter((id) => !skipRecordIds.has(id)).map((recordId) => ({ recordId }));
      if (labels.length === 0) return;
      const result = await print({
        labelClass,
        labels,
        templateId: overrideTemplateCode ?? (templateId || undefined),
        layout: LABEL_LAYOUT_PRESETS[preset].layout,
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
    [ids, print, labelClass, templateId, preset, isSingleTicket, title, detail, defaultTitle, defaultDetail, linkedAssetId, linkedAssets, batch]
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
    >
      <DialogContent>
        <div className="space-y-4">
          <p className="text-sm text-[rgb(var(--color-text-600))]">
            {t('labels.dialog.count', { defaultValue: '{{count}} selected', count: ids.length })}
          </p>

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
                      : outcome.message ||
                        t('labels.dialog.failed', { defaultValue: 'The labels could not be printed.' })}
                  </p>
                  {failures.length > 0 && (
                    <>
                      <ul className="list-disc pl-5">
                        {failures.map((f) => (
                          <li key={`${f.recordId}-${f.index}`}>
                            <span className="font-medium">{f.identifier}</span>: {f.message}
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
        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LabelPrintDialog;
