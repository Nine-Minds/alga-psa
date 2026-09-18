'use client';

/**
 * Update-action patch UX (Option C — summary-first with drill-in).
 *
 * Update-style business actions (tickets.update_fields, contacts.update, …)
 * take a `patch` object where every field is optional and only configured
 * fields change on the existing record. Instead of rendering that object as a
 * flat pile of fields, the mapping panel shows a summary-first card ("Changes
 * Status, Priority · everything else keeps its current value") and edits
 * happen in a two-pane dialog: a grouped field catalog on the left, the
 * authored "Set <Field> to <value>" change rows on the right.
 *
 * The dialog hosts the existing mapping-field components (source modes,
 * pickers, expression editor) unchanged — it is a different arrangement of the
 * same rows, not a fork. Detection is schema-driven (an object input named
 * `patch` with children), so all update actions get this automatically.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { PencilLine, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TFunction } from 'i18next';
import type { InputMapping, MappingValue, Expr } from '@alga-psa/workflows/runtime';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import type { ExpressionContext } from '../expression-editor';
import type { DataTreeContext } from './SourceDataTree';
import {
  createWorkflowActionInputValueForMode,
  deriveWorkflowActionInputSourceMode,
  getDefaultWorkflowActionInputSourceMode,
} from '../WorkflowActionInputSourceMode';
import { extractPrimaryPath } from '../workflowReferenceSelector';
import { MappingFieldEditor, type ActionInputField } from './InputMappingEditor';

/**
 * Schema-driven detection of an update-style "patch" input: an object field
 * named `patch` whose children describe the individual updatable fields.
 */
export const isWorkflowUpdatePatchField = (field: ActionInputField): boolean =>
  field.name === 'patch' && field.type === 'object' && (field.children?.length ?? 0) > 0;

const isRecordValue = (value: unknown): value is Record<string, MappingValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !('$expr' in value) && !('$secret' in value);

/**
 * Whether the current patch mapping value can be edited with the change
 * dialog. Whole-object references/expressions fall back to the generic editor.
 */
export const isEditableWorkflowPatchValue = (value: MappingValue | undefined): boolean =>
  value === undefined || isRecordValue(value);

/**
 * Human label for a patch field name: "status_id" → "Status",
 * "due_date" → "Due date", "custom_fields" → "Custom fields".
 */
export const humanizeWorkflowPatchFieldLabel = (name: string): string => {
  const cleaned = name.replace(/_id$/, '').replace(/_/g, ' ').trim();
  if (!cleaned) return name;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

/**
 * Labels of the fields a patch mapping value currently changes, in the order
 * they were configured. Returns [] for whole-object references/expressions.
 */
export const summarizeWorkflowPatchChanges = (value: MappingValue | undefined): string[] => {
  if (!isRecordValue(value)) return [];
  return Object.keys(value).map(humanizeWorkflowPatchFieldLabel);
};

const SUMMARY_LABEL_CAP = 3;

export const formatWorkflowPatchChangeSummary = (t: TFunction, labels: string[]): string => {
  const shown = labels.slice(0, SUMMARY_LABEL_CAP);
  const extra = labels.length - shown.length;
  const list = shown.join(', ');
  if (extra > 0) {
    return t('inputMappingEditor.updatePatch.summaryChangesMore', {
      defaultValue: 'Changes {{list}} +{{count}} more',
      list,
      count: extra,
    });
  }
  return t('inputMappingEditor.updatePatch.summaryChanges', {
    defaultValue: 'Changes {{list}}',
    list,
  });
};

type PatchCatalogGroupKey = 'details' | 'assignment' | 'datesTags' | 'advanced';

const CATALOG_GROUP_ORDER: PatchCatalogGroupKey[] = ['details', 'assignment', 'datesTags', 'advanced'];

const isRecordTypedField = (field: ActionInputField): boolean =>
  field.type === 'object' && (field.children?.length ?? 0) === 0;

const getCatalogGroupKey = (field: ActionInputField): PatchCatalogGroupKey => {
  if (isRecordTypedField(field)) return 'advanced';
  const name = field.name.toLowerCase();
  if (name.includes('assign')) return 'assignment';
  if (name.includes('date') || name.endsWith('_at') || name === 'tags') return 'datesTags';
  return 'details';
};

const getCatalogGroupLabel = (t: TFunction, key: PatchCatalogGroupKey): string => {
  switch (key) {
    case 'assignment':
      return t('inputMappingEditor.updatePatch.group.assignment', { defaultValue: 'Assignment' });
    case 'datesTags':
      return t('inputMappingEditor.updatePatch.group.datesTags', { defaultValue: 'Dates & tags' });
    case 'advanced':
      return t('inputMappingEditor.updatePatch.group.advanced', { defaultValue: 'Advanced' });
    default:
      return t('inputMappingEditor.updatePatch.group.details', { defaultValue: 'Details' });
  }
};

/**
 * Plain-language phrase describing which record the step updates, derived
 * from the action's target id field ("ticket_id") and its configured source.
 */
export const buildWorkflowUpdateTargetPhrase = (
  t: TFunction,
  targetIdField: ActionInputField | undefined,
  targetIdValue: MappingValue | undefined
): string => {
  const record = targetIdField
    ? humanizeWorkflowPatchFieldLabel(targetIdField.name).toLowerCase()
    : t('inputMappingEditor.updatePatch.target.genericRecord', { defaultValue: 'record' });

  if (targetIdValue === undefined) {
    return t('inputMappingEditor.updatePatch.target.unset', {
      defaultValue: 'the {{record}} selected above',
      record,
    });
  }

  const mode = deriveWorkflowActionInputSourceMode(targetIdValue).mode;
  if (mode === 'reference') {
    const path = extractPrimaryPath((targetIdValue as Expr).$expr ?? '');
    const segments = path?.split('.') ?? [];
    const sourceName = segments[0] === 'vars' && segments.length > 1 ? segments[1] : path;
    if (sourceName) {
      return t('inputMappingEditor.updatePatch.target.fromReference', {
        defaultValue: 'the {{record}} from “{{source}}”',
        record,
        source: sourceName,
      });
    }
    return t('inputMappingEditor.updatePatch.target.unset', {
      defaultValue: 'the {{record}} selected above',
      record,
    });
  }
  if (mode === 'expression') {
    return t('inputMappingEditor.updatePatch.target.fromExpression', {
      defaultValue: 'the {{record}} chosen by an expression',
      record,
    });
  }
  return t('inputMappingEditor.updatePatch.target.fixed', {
    defaultValue: 'a specific {{record}}',
    record,
  });
};

interface UpdatePatchSharedProps {
  patchField: ActionInputField;
  value: MappingValue | undefined;
  onChange: (value: MappingValue | undefined) => void;
  rootInputMapping: InputMapping;
  fieldOptions: SelectOption[];
  stepId: string;
  actionId?: string;
  disabled?: boolean;
  sourceTypeMap?: Map<string, string>;
  expressionContext?: ExpressionContext;
  referenceBrowseContext?: DataTreeContext;
}

/**
 * Summary-first card for the patch object plus the two-pane change dialog.
 */
export const UpdatePatchSection: React.FC<UpdatePatchSharedProps & {
  targetPhrase: string;
}> = ({
  patchField,
  value,
  onChange,
  rootInputMapping,
  fieldOptions,
  stepId,
  actionId,
  disabled,
  sourceTypeMap,
  expressionContext,
  referenceBrowseContext,
  targetPhrase,
}) => {
  const { t } = useTranslation('msp/workflows');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const idPrefix = `update-patch-${stepId}`;

  const record = isRecordValue(value) ? value : {};
  const changeLabels = summarizeWorkflowPatchChanges(value);
  const hasChanges = changeLabels.length > 0;

  const childByName = useMemo(() => {
    const map = new Map<string, ActionInputField>();
    for (const child of patchField.children ?? []) {
      map.set(child.name, child);
    }
    return map;
  }, [patchField.children]);

  const catalogGroups = useMemo(() => {
    const groups = new Map<PatchCatalogGroupKey, ActionInputField[]>();
    for (const child of patchField.children ?? []) {
      const key = getCatalogGroupKey(child);
      const bucket = groups.get(key) ?? [];
      bucket.push(child);
      groups.set(key, bucket);
    }
    return CATALOG_GROUP_ORDER
      .filter((key) => (groups.get(key)?.length ?? 0) > 0)
      .map((key) => ({ key, fields: groups.get(key)! }));
  }, [patchField.children]);

  const emitRecord = useCallback((next: Record<string, MappingValue>) => {
    onChange(Object.keys(next).length > 0 ? next : undefined);
  }, [onChange]);

  const handleAddChange = useCallback((child: ActionInputField) => {
    if (Object.prototype.hasOwnProperty.call(record, child.name)) return;
    const defaultMode = getDefaultWorkflowActionInputSourceMode(child);
    emitRecord({
      ...record,
      [child.name]: createWorkflowActionInputValueForMode(child, undefined, defaultMode),
    });
  }, [emitRecord, record]);

  const handleRemoveChange = useCallback((name: string) => {
    const next = { ...record };
    delete next[name];
    emitRecord(next);
  }, [emitRecord, record]);

  const handleChangeValue = useCallback((name: string, nextValue: MappingValue | undefined) => {
    if (nextValue === undefined) {
      handleRemoveChange(name);
      return;
    }
    emitRecord({ ...record, [name]: nextValue });
  }, [emitRecord, handleRemoveChange, record]);

  const configuredNames = Object.keys(record);

  return (
    <>
      <Card className="p-3 space-y-2" data-automation-id={`${idPrefix}-summary`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <PencilLine className="h-4 w-4 shrink-0 text-gray-500" />
              <span className="text-sm font-medium text-gray-800">
                {t('inputMappingEditor.updatePatch.summaryTitle', { defaultValue: 'Fields to change' })}
              </span>
              {patchField.required && (
                <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {t('actionInputFieldInfo.required', { defaultValue: 'Required' })}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600">
              {t('inputMappingEditor.updatePatch.targetFraming', {
                defaultValue: 'This step updates {{target}}.',
                target: targetPhrase,
              })}
            </p>
            {hasChanges ? (
              <>
                <p className="text-xs text-gray-700">
                  {formatWorkflowPatchChangeSummary(t, changeLabels)}
                </p>
                <p className="text-[11px] text-gray-500">
                  {t('inputMappingEditor.updatePatch.unchangedNote', {
                    defaultValue: 'All other fields keep their current values.',
                  })}
                </p>
              </>
            ) : (
              <p className="text-xs text-amber-700">
                {t('inputMappingEditor.updatePatch.emptyGuidance', {
                  defaultValue: 'Add at least one field to change.',
                })}
              </p>
            )}
          </div>
          <Button
            id={`${idPrefix}-edit-changes`}
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={disabled}
            onClick={() => setIsDialogOpen(true)}
          >
            {t('inputMappingEditor.updatePatch.editChanges', { defaultValue: 'Edit changes…' })}
          </Button>
        </div>
      </Card>

      <Dialog
        id={`${idPrefix}-dialog`}
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        title={t('inputMappingEditor.updatePatch.dialogTitle', { defaultValue: 'Edit changes' })}
        className="max-w-5xl"
        footer={(
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-xs text-gray-500">
              {hasChanges
                ? t('inputMappingEditor.updatePatch.footerSummary', {
                  defaultValue: '{{count}} field(s) will change · everything else keeps its current value',
                  count: configuredNames.length,
                })
                : t('inputMappingEditor.updatePatch.emptyGuidance', {
                  defaultValue: 'Add at least one field to change.',
                })}
            </span>
            <Button
              id={`${idPrefix}-dialog-done`}
              type="button"
              onClick={() => setIsDialogOpen(false)}
            >
              {t('inputMappingEditor.updatePatch.done', { defaultValue: 'Done' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {t('inputMappingEditor.updatePatch.dialogDescription', {
                defaultValue: 'Updating {{target}}. Only the fields listed on the right will change; everything else keeps its current value.',
                target: targetPhrase,
              })}
            </p>
            <div className="grid grid-cols-[240px,1fr] gap-4">
              {/* Left: grouped field catalog */}
              <div
                className="max-h-[420px] space-y-3 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-2"
                data-automation-id={`${idPrefix}-catalog`}
              >
                {catalogGroups.map(({ key, fields }) => (
                  <div key={key} className="space-y-1">
                    <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      {getCatalogGroupLabel(t, key)}
                    </div>
                    {fields.map((child) => {
                      const isAdded = Object.prototype.hasOwnProperty.call(record, child.name);
                      return (
                        <button
                          key={child.name}
                          id={`${idPrefix}-catalog-${child.name}`}
                          type="button"
                          disabled={disabled || isAdded}
                          onClick={() => handleAddChange(child)}
                          className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                            isAdded
                              ? 'cursor-default bg-primary-50 text-primary-700'
                              : 'text-gray-700 hover:bg-white hover:text-gray-900'
                          }`}
                          title={child.description}
                        >
                          <span className="truncate">{humanizeWorkflowPatchFieldLabel(child.name)}</span>
                          {isAdded ? (
                            <Badge className="shrink-0 bg-primary-100 text-[10px] text-primary-700">
                              {t('inputMappingEditor.updatePatch.added', { defaultValue: 'Added ✓' })}
                            </Badge>
                          ) : (
                            <Plus className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Right: authored change rows */}
              <div
                className="max-h-[420px] space-y-2 overflow-y-auto pr-1"
                data-automation-id={`${idPrefix}-changes`}
              >
                {configuredNames.length === 0 && (
                  <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                    {t('inputMappingEditor.updatePatch.noChangesYet', {
                      defaultValue: 'No changes yet. Pick a field on the left to start.',
                    })}
                  </div>
                )}
                {configuredNames.map((name) => {
                  const child = childByName.get(name) ?? { name, type: 'unknown' };
                  return (
                    <div
                      key={name}
                      className="rounded-md border border-gray-200"
                      data-automation-id={`${idPrefix}-change-${name}`}
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
                        <span className="text-xs font-medium text-gray-700">
                          {t('inputMappingEditor.updatePatch.setFieldTo', {
                            defaultValue: 'Set {{field}} to',
                            field: humanizeWorkflowPatchFieldLabel(name),
                          })}
                        </span>
                        <Button
                          id={`${idPrefix}-remove-${name}`}
                          variant="ghost"
                          size="sm"
                          type="button"
                          disabled={disabled}
                          onClick={() => handleRemoveChange(name)}
                          className="h-7 px-2 text-gray-500 hover:text-destructive"
                          title={t('inputMappingEditor.updatePatch.removeChange', {
                            defaultValue: 'Stop changing this field (it keeps its current value)',
                          })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="p-2">
                        <MappingFieldEditor
                          field={child}
                          fieldPath={`patch.${name}`}
                          value={record[name]}
                          onChange={(nextValue) => handleChangeValue(name, nextValue)}
                          rootInputMapping={rootInputMapping}
                          fieldOptions={fieldOptions}
                          stepId={stepId}
                          actionId={actionId}
                          disabled={disabled}
                          sourceTypeMap={sourceTypeMap}
                          expressionContext={expressionContext}
                          referenceBrowseContext={referenceBrowseContext}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
