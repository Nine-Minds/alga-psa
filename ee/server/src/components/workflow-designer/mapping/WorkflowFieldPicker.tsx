'use client';

import React, { useContext, useMemo } from 'react';

import SearchableSelect, { type SelectOption as SearchableSelectOption } from '@alga-psa/ui/components/SearchableSelect';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import type { DataTreeContext } from './SourceDataTree';

/**
 * A workflow field someone can pick: from the trigger, an earlier step, the loop, the caught error,
 * or the workflow itself. One list of these feeds every field picker in the designer: the value
 * source of an input, Insert field in text and expression editors, and condition fields.
 */
export type WorkflowPickableField = {
  path: string;
  /** Friendly field label, e.g. "Ticket number (ticket.ticket_number)". */
  label: string;
  /** Where it comes from, e.g. "Find Ticket" or "Trigger". The picker groups by it. */
  sourceName: string;
  description?: string;
  type?: string;
  kind?: string;
};

export type WorkflowFieldOriginLabels = {
  trigger: string;
  loop: string;
  error: string;
  workflow: string;
};

const WORKFLOW_DATA_ROOT_NAMES = new Set(['payload', 'vars', 'meta', 'error']);

/** Workflow bookkeeping (run state, trace id, tags): listed after every business field. */
export const isWorkflowBookkeepingField = (path: string): boolean => path === 'meta' || path.startsWith('meta.');

/** Drops the emoji/arrow decorations some option labels carry ("📦 payload" → "payload"). */
export const stripOptionDecorations = (label: string): string => label.replace(/^[^\p{L}\p{N}$_]+\s*/u, '');

/** Who produced a field: the trigger, a step, the loop, the caught error, or the workflow itself. */
export const describeWorkflowFieldOrigin = (
  path: string,
  context: Pick<DataTreeContext, 'vars' | 'forEach'> | undefined,
  labels: WorkflowFieldOriginLabels
): string => {
  if (path.startsWith('payload.')) return labels.trigger;
  if (path.startsWith('error.')) return labels.error;
  if (isWorkflowBookkeepingField(path)) return labels.workflow;
  if (path.startsWith('vars.')) {
    const saveAs = path.split('.')[1];
    const step = context?.vars.find((entry) => entry.saveAs === saveAs);
    if (step) return step.stepName;
    if (context?.forEach && saveAs === context.forEach.itemVar) return labels.loop;
    return saveAs ?? '';
  }
  if (
    context?.forEach &&
    (path === context.forEach.itemVar ||
      path === context.forEach.indexVar ||
      path.startsWith(`${context.forEach.itemVar}.`))
  ) {
    return labels.loop;
  }
  return '';
};

/**
 * The pickable fields among reference options: everything below a data root, plus the loop item and
 * index. Bare roots (payload, vars…) are containers, not fields.
 */
export const buildWorkflowPickableFields = (
  fieldOptions: ReadonlyArray<SelectOption>,
  context: Pick<DataTreeContext, 'vars' | 'forEach'> | undefined,
  labels: WorkflowFieldOriginLabels,
  lookups: {
    typeOf?: (path: string) => string | undefined;
    kindOf?: (path: string) => string | undefined;
  } = {}
): WorkflowPickableField[] =>
  fieldOptions
    .filter((option) =>
      option.value.includes('.') ||
      (!WORKFLOW_DATA_ROOT_NAMES.has(option.value) &&
        (context?.forEach?.itemVar === option.value || context?.forEach?.indexVar === option.value))
    )
    .map((option) => ({
      path: option.value,
      label: stripOptionDecorations(typeof option.label === 'string' ? option.label : option.value),
      sourceName: describeWorkflowFieldOrigin(option.value, context, labels),
      type: lookups.typeOf?.(option.value),
      kind: lookups.kindOf?.(option.value),
    }));

/** Business fields in their given order, then workflow bookkeeping. */
export const orderWorkflowPickableFields = <T extends { path: string }>(fields: ReadonlyArray<T>): T[] => [
  ...fields.filter((field) => !isWorkflowBookkeepingField(field.path)),
  ...fields.filter((field) => isWorkflowBookkeepingField(field.path)),
];

/** Picker rows: grouped by source, searchable by label, path and source, compact when selected. */
export const toWorkflowFieldPickerOptions = (
  fields: ReadonlyArray<WorkflowPickableField>,
  options: {
    /** Overrides the group heading, e.g. to list the best matches first under "Suggested". */
    groupOf?: (field: WorkflowPickableField) => string | undefined;
    /** Muted second line; defaults to the path. */
    secondaryOf?: (field: WorkflowPickableField) => string | undefined;
  } = {}
): SearchableSelectOption[] =>
  fields.map((field) => ({
    value: field.path,
    label: field.label,
    group: options.groupOf ? options.groupOf(field) : field.sourceName || undefined,
    triggerLabel: field.sourceName ? `${field.sourceName} › ${field.label}` : field.label,
    secondaryLabel: options.secondaryOf?.(field) ?? field.description ?? field.path,
    keywords: `${field.path} ${field.sourceName}`,
  }));

/**
 * The fields an editor can read here, provided once by the input mapping editor so every picker
 * below it (value source, Insert field) labels and groups fields the same way.
 */
export const WorkflowPickableFieldsContext = React.createContext<WorkflowPickableField[] | undefined>(undefined);

export const useWorkflowFieldOriginLabels = (): WorkflowFieldOriginLabels => {
  const { t } = useTranslation('msp/workflows');
  return useMemo(
    () => ({
      trigger: t('valueSourceChooser.origin.trigger', { defaultValue: 'Trigger' }),
      loop: t('valueSourceChooser.origin.loop', { defaultValue: 'Current loop item' }),
      error: t('valueSourceChooser.origin.error', { defaultValue: 'Caught error' }),
      workflow: t('valueSourceChooser.origin.workflow', { defaultValue: 'Workflow run' }),
    }),
    [t]
  );
};

const NO_EXTRA_NAMES: ReadonlyArray<string> = [];

/**
 * The pickable fields among `fieldOptions`, labelled from the surrounding context when there is one
 * and from the options themselves otherwise.
 */
export const useWorkflowPickableFields = (
  fieldOptions: ReadonlyArray<SelectOption>,
  extraNames: ReadonlyArray<string> = NO_EXTRA_NAMES
): WorkflowPickableField[] => {
  const shared = useContext(WorkflowPickableFieldsContext);
  const labels = useWorkflowFieldOriginLabels();
  return useMemo(() => {
    const sharedByPath = new Map((shared ?? []).map((field) => [field.path, field]));
    const extra = new Set(extraNames);
    return fieldOptions
      .filter((option) => option.value.includes('.') || extra.has(option.value))
      .map((option) =>
        sharedByPath.get(option.value) ?? {
          path: option.value,
          label: stripOptionDecorations(typeof option.label === 'string' ? option.label : option.value),
          sourceName: extra.has(option.value.split(/[.[]/)[0])
            ? labels.loop
            : describeWorkflowFieldOrigin(option.value, undefined, labels),
        }
      );
  }, [extraNames, fieldOptions, labels, shared]);
};

/**
 * The designer's one field picker: searchable, grouped by where each field comes from, with
 * workflow bookkeeping (meta.*) last. Used to choose an input's source, to insert a field into text
 * or an expression, and to choose what a condition tests.
 */
export const WorkflowFieldPicker: React.FC<{
  id: string;
  fields: ReadonlyArray<WorkflowPickableField>;
  value: string;
  onChange: (path: string) => void;
  placeholder: string;
  /** Rows listed before the fields, e.g. "Choose a specific board…". */
  leadingOptions?: SearchableSelectOption[];
  /** Rows listed after the fields, e.g. "Write an expression…". */
  trailingOptions?: SearchableSelectOption[];
  groupOf?: (field: WorkflowPickableField) => string | undefined;
  secondaryOf?: (field: WorkflowPickableField) => string | undefined;
  /** Keep the given order instead of moving workflow bookkeeping last (e.g. ranked lists). */
  preserveOrder?: boolean;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Open the list on mount (e.g. a just-added condition row). */
  defaultOpen?: boolean;
}> = ({
  id,
  fields,
  value,
  onChange,
  placeholder,
  leadingOptions = [],
  trailingOptions = [],
  groupOf,
  secondaryOf,
  preserveOrder = false,
  emptyMessage,
  disabled,
  className,
  size,
  defaultOpen,
}) => {
  const { t } = useTranslation('msp/workflows');
  const options = useMemo(
    () => [
      ...leadingOptions,
      ...toWorkflowFieldPickerOptions(preserveOrder ? fields : orderWorkflowPickableFields(fields), { groupOf, secondaryOf }),
      ...trailingOptions,
    ],
    [fields, groupOf, leadingOptions, preserveOrder, secondaryOf, trailingOptions]
  );
  return (
    <SearchableSelect
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder={t('fieldPicker.searchPlaceholder', { defaultValue: 'Search fields' })}
      emptyMessage={emptyMessage ?? t('fieldPicker.noMatches', { defaultValue: 'No matching fields' })}
      dropdownMode="overlay"
      disabled={disabled}
      className={className}
      size={size}
      maxListHeight="20rem"
      defaultOpen={defaultOpen}
      // Field labels ("Find Ticket › Requester contact (ticket.contact_name_id)") outgrow the
      // narrow config panel; the list may be wider than its control.
      dropdownMinWidth={360}
    />
  );
};

/** "Insert field" for text and expression editors: the shared field picker, reset after each pick. */
export const WorkflowInsertFieldPicker: React.FC<{
  id: string;
  fieldOptions: ReadonlyArray<SelectOption>;
  onInsert: (path: string) => void;
  /** Names usable on their own besides dotted paths, e.g. the loop item and index. */
  localNames?: ReadonlyArray<string>;
  disabled?: boolean;
  className?: string;
}> = ({ id, fieldOptions, onInsert, localNames, disabled, className }) => {
  const { t } = useTranslation('msp/workflows');
  const fields = useWorkflowPickableFields(fieldOptions, localNames);
  return (
    <WorkflowFieldPicker
      id={id}
      fields={fields}
      value=""
      onChange={(path) => {
        if (path) onInsert(path);
      }}
      placeholder={t('textTemplateEditor.insertField', { defaultValue: 'Insert field' })}
      disabled={disabled || fields.length === 0}
      className={className}
      size="sm"
    />
  );
};

export default WorkflowFieldPicker;
