'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { WorkflowFieldPicker, type WorkflowPickableField } from './mapping/WorkflowFieldPicker';
import { formatWorkflowFieldLabel } from './workflowFieldNames';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  conditionOperatorTakesList,
  conditionOperatorTakesValue,
  parseConditionExpression,
  serializeConditionGroup,
  type WorkflowConditionClause,
  type WorkflowConditionGroup,
  type WorkflowConditionLiteral,
  type WorkflowConditionOperator,
} from '@alga-psa/workflows/authoring';

import {
  WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES,
  WorkflowActionInputFixedPicker,
} from './WorkflowActionInputFixedPicker';
import type { WorkflowConditionField } from './workflowConditionFields';
import { useWorkflowEntityLabels, type WorkflowEntityLabelsState } from './workflowEntityLabels';
import {
  findAnyBoardStatusName,
  parseAnyBoardStatusValue,
  statusIdsForName,
  toAnyBoardStatusValue,
  type WorkflowStatusRef,
} from './workflowStatusGroups';

// Condition values have no picker dependencies; a shared constant keeps the picker's props stable.
const NO_DEPENDENCY_MAPPING = {};

type TFn = (key: string, options?: Record<string, unknown>) => string;

const OPERATOR_LABEL_DEFAULTS: Record<WorkflowConditionOperator, string> = {
  equals: 'is',
  not_equals: 'is not',
  in: 'is any of',
  not_in: 'is none of',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
  starts_with: 'starts with',
  ends_with: 'ends with',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

const operatorLabel = (t: TFn, operator: WorkflowConditionOperator): string =>
  t(`designer.conditionBuilder.operators.${operator}`, { defaultValue: OPERATOR_LABEL_DEFAULTS[operator] });

const hasEntityPicker = (field: WorkflowConditionField | undefined): boolean =>
  Boolean(field?.pickerKind && WORKFLOW_FIXED_PICKER_SUPPORTED_RESOURCES.has(field.pickerKind));

/** Operators that make sense for a field, most common first. */
export const getConditionOperatorsForField = (
  field: WorkflowConditionField | undefined
): WorkflowConditionOperator[] => {
  if (hasEntityPicker(field) || field?.enumValues?.length) {
    return ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'];
  }
  switch (field?.type) {
    case 'boolean':
      return ['equals', 'not_equals'];
    case 'number':
      return ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'];
    case 'string':
      return ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'in', 'not_in', 'is_empty', 'is_not_empty'];
    default:
      return ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'ends_with', 'in', 'not_in', 'is_empty', 'is_not_empty'];
  }
};

const defaultValueForField = (field: WorkflowConditionField | undefined): WorkflowConditionLiteral => {
  if (field?.type === 'boolean') return true;
  if (field?.enumValues?.length) return field.enumValues[0];
  return '';
};

const normalizeClauseValue = (
  operator: WorkflowConditionOperator,
  value: WorkflowConditionClause['value'],
  field: WorkflowConditionField | undefined
): WorkflowConditionClause['value'] => {
  if (!conditionOperatorTakesValue(operator)) return undefined;
  if (conditionOperatorTakesList(operator)) {
    if (Array.isArray(value)) return value;
    return value === undefined || value === '' ? [] : [value];
  }
  if (Array.isArray(value)) return value[0] ?? defaultValueForField(field);
  return value === undefined ? defaultValueForField(field) : value;
};

const isTicketStatusField = (field: WorkflowConditionField | undefined): boolean =>
  field?.pickerKind === 'ticket-status';

/**
 * "Awaiting Wisdom (any board)" is saved as an `in` list of every status id with that name. For
 * display, a list that exactly matches one shared name shows as "is" / "is not" with that choice.
 */
const toDisplayClause = (
  clause: WorkflowConditionClause,
  field: WorkflowConditionField | undefined,
  statuses: readonly WorkflowStatusRef[] | undefined
): WorkflowConditionClause => {
  if (!isTicketStatusField(field) || !conditionOperatorTakesList(clause.operator)) return clause;
  const name = findAnyBoardStatusName(statuses, Array.isArray(clause.value) ? clause.value : []);
  if (!name) return clause;
  return { ...clause, operator: clause.operator === 'not_in' ? 'not_equals' : 'equals', value: toAnyBoardStatusValue(name) };
};

/** Turns any-board choices back into the status ids they stand for (the inverse of toDisplayClause). */
const toStoredClause = (
  clause: WorkflowConditionClause,
  field: WorkflowConditionField | undefined,
  statuses: readonly WorkflowStatusRef[] | undefined
): WorkflowConditionClause => {
  if (!isTicketStatusField(field) || !conditionOperatorTakesValue(clause.operator)) return clause;
  const values = Array.isArray(clause.value) ? clause.value : [clause.value ?? ''];
  if (!values.some((value) => parseAnyBoardStatusValue(value) !== null)) return clause;
  const ids = values.flatMap((value) => {
    const name = parseAnyBoardStatusValue(value);
    return name === null ? [value] : statusIdsForName(statuses, name);
  });
  const operator = clause.operator === 'not_equals' ? 'not_in' : clause.operator === 'equals' ? 'in' : clause.operator;
  return { ...clause, operator, value: Array.from(new Set(ids)) };
};

const humanizeSegment = (segment: string): string => {
  const withoutIdSuffix = segment.replace(/(_ids?|Ids?)$/, '') || segment;
  return withoutIdSuffix
    .replace(/\[-?\d+\]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();
};

/** "priority_id" → "priority", "assignedToUserId" → "assigned to user". */
export const humanizeConditionFieldName = (fieldLabel: string): string =>
  humanizeSegment(fieldLabel.split('.').pop() ?? fieldLabel);

/**
 * A field name with the record it belongs to, for summaries: `vars.recheck.ticket.is_closed` →
 * "ticket is closed", `payload.clientName` → "client name". The workflow root and step result
 * name are left out.
 */
export const describeConditionField = (path: string): string => {
  const segments = path.split('.');
  const relative = segments[0] === 'vars' ? segments.slice(2) : segments[0] === 'payload' || segments[0] === 'meta' ? segments.slice(1) : segments;
  const field = humanizeSegment(relative[relative.length - 1] ?? path);
  const parent = relative.length > 1 ? humanizeSegment(relative[relative.length - 2]) : '';
  if (!parent || field.startsWith(parent)) return field;
  return `${parent} ${field}`;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const formatLiteral = (
  t: TFn,
  value: WorkflowConditionLiteral,
  entityLabels: WorkflowEntityLabelsState,
  fieldName: string
): string => {
  if (value === null) return 'null';
  if (typeof value !== 'string') return String(value);
  // A ticket status is board-specific, so say which board's copy it is.
  const status = entityLabels.statuses?.find((candidate) => candidate.id === value);
  if (status?.board_name) {
    return t('designer.conditionBuilder.boardStatus', {
      defaultValue: '{{name}} ({{board}})',
      name: status.name,
      board: status.board_name,
    });
  }
  const name = entityLabels.labels.get(value);
  if (name) return name;
  if (!UUID_PATTERN.test(value)) return `"${value}"`;
  // An id: wait for names instead of flashing it, and never show a bare id once they've loaded.
  if (!entityLabels.loaded) return '…';
  return t('designer.conditionBuilder.unknownEntity', { defaultValue: 'unknown {{field}}', field: fieldName });
};

/** One-line, human-readable description of a condition, or null when it isn't builder-shaped. */
export const describeWorkflowCondition = (
  t: TFn,
  expression: string,
  entityLabels: WorkflowEntityLabelsState
): string | null => {
  const group = parseConditionExpression(expression);
  if (!group || group.clauses.length === 0) return null;
  const joinWord = group.join === 'and'
    ? t('designer.conditionBuilder.joinWords.and', { defaultValue: 'and' })
    : t('designer.conditionBuilder.joinWords.or', { defaultValue: 'or' });
  return group.clauses
    .map((clause) => {
      const fieldName = describeConditionField(clause.path);
      const operator = operatorLabel(t, clause.operator);
      if (!conditionOperatorTakesValue(clause.operator)) return `${fieldName} ${operator}`;
      const values = Array.isArray(clause.value) ? clause.value : [clause.value ?? ''];
      const anyBoardName = conditionOperatorTakesList(clause.operator)
        ? findAnyBoardStatusName(entityLabels.statuses, values)
        : null;
      if (anyBoardName) {
        const singleOperator = operatorLabel(t, clause.operator === 'not_in' ? 'not_equals' : 'equals');
        const anyBoard = t('designer.conditionBuilder.anyBoardStatus', { defaultValue: '{{name}} (any board)', name: anyBoardName });
        return `${fieldName} ${singleOperator} ${anyBoard}`;
      }
      return `${fieldName} ${operator} ${values.map((value) => formatLiteral(t, value, entityLabels, humanizeConditionFieldName(clause.path))).join(', ')}`;
    })
    .join(` ${joinWord} `);
};

/** Readable summary of an If step's condition for step cards; falls back to the raw expression. */
export const WorkflowConditionSummary: React.FC<{ expression: string }> = ({ expression }) => {
  const { t } = useTranslation('msp/workflows');
  const isBuilderShaped = useMemo(() => {
    const group = parseConditionExpression(expression);
    return Boolean(group && group.clauses.length > 0);
  }, [expression]);
  const entityLabels = useWorkflowEntityLabels(isBuilderShaped);
  const summary = useMemo(() => describeWorkflowCondition(t, expression, entityLabels), [entityLabels, expression, t]);
  const text = summary ?? expression.trim();

  if (!text) {
    return (
      <span className="text-xs text-[rgb(var(--color-text-500))] italic">
        {t('designer.conditionBuilder.noConditionSummary', { defaultValue: 'No condition set' })}
      </span>
    );
  }

  return (
    <span
      className={`text-xs text-[rgb(var(--color-text-600))] line-clamp-2 break-words ${summary ? '' : 'font-mono'}`}
      title={expression}
    >
      {text}
    </span>
  );
};

const ConditionValueInput: React.FC<{
  idPrefix: string;
  field: WorkflowConditionField | undefined;
  value: WorkflowConditionLiteral;
  onChange: (value: WorkflowConditionLiteral) => void;
  disabled?: boolean;
  /** Offer "<status> (any board)" choices; only for a single status, not a list of them. */
  allowAnyBoardStatus?: boolean;
}> = ({ idPrefix, field, value, onChange, disabled, allowAnyBoardStatus = false }) => {
  const { t } = useTranslation('msp/workflows');

  if (field && hasEntityPicker(field)) {
    return (
      <WorkflowActionInputFixedPicker
        idPrefix={idPrefix}
        field={{
          name: humanizeConditionFieldName(field.fieldLabel),
          editor: {
            kind: 'picker',
            picker: { resource: field.pickerKind as string },
            fixedValueHint: field.pickerFixedValueHint,
            allowsDynamicReference: false,
          },
        }}
        value={typeof value === 'string' && value ? value : null}
        onChange={(next) => onChange(next ?? '')}
        rootInputMapping={NO_DEPENDENCY_MAPPING}
        disabled={disabled}
        includeAnyBoardStatus={allowAnyBoardStatus && isTicketStatusField(field)}
      />
    );
  }

  if (field?.enumValues?.length) {
    return (
      <CustomSelect
        id={`${idPrefix}-enum`}
        options={field.enumValues.map((item) => ({ value: String(item), label: String(item) }))}
        value={value === null ? '' : String(value)}
        onValueChange={(next) => onChange(field.enumValues?.find((item) => String(item) === next) ?? next)}
        placeholder={t('designer.conditionBuilder.selectValue', { defaultValue: 'Select a value' })}
        disabled={disabled}
      />
    );
  }

  if (field?.type === 'boolean') {
    return (
      <CustomSelect
        id={`${idPrefix}-boolean`}
        options={[
          { value: 'true', label: t('designer.conditionBuilder.booleanTrue', { defaultValue: 'true' }) },
          { value: 'false', label: t('designer.conditionBuilder.booleanFalse', { defaultValue: 'false' }) },
        ]}
        value={value === false ? 'false' : 'true'}
        onValueChange={(next) => onChange(next === 'true')}
        disabled={disabled}
      />
    );
  }

  if (field?.type === 'number') {
    return (
      <Input
        id={`${idPrefix}-number`}
        type="number"
        value={typeof value === 'number' ? String(value) : ''}
        onChange={(event) => {
          const raw = event.target.value;
          const parsed = Number(raw);
          onChange(raw.trim() === '' || !Number.isFinite(parsed) ? '' : parsed);
        }}
        placeholder={t('designer.conditionBuilder.numberPlaceholder', { defaultValue: 'Number' })}
        disabled={disabled}
      />
    );
  }

  return (
    <Input
      id={`${idPrefix}-text`}
      value={value === null ? '' : String(value)}
      onChange={(event) => onChange(event.target.value)}
      placeholder={t('designer.conditionBuilder.textPlaceholder', { defaultValue: 'Value' })}
      disabled={disabled}
    />
  );
};

const ConditionValueEditor: React.FC<{
  idPrefix: string;
  field: WorkflowConditionField | undefined;
  clause: WorkflowConditionClause;
  onChange: (value: WorkflowConditionClause['value']) => void;
  disabled?: boolean;
}> = ({ idPrefix, field, clause, onChange, disabled }) => {
  const { t } = useTranslation('msp/workflows');
  if (!conditionOperatorTakesValue(clause.operator)) return null;

  if (!conditionOperatorTakesList(clause.operator)) {
    return (
      <ConditionValueInput
        idPrefix={idPrefix}
        field={field}
        value={Array.isArray(clause.value) ? clause.value[0] ?? '' : clause.value ?? ''}
        onChange={onChange}
        disabled={disabled}
        allowAnyBoardStatus
      />
    );
  }

  const values = Array.isArray(clause.value) ? clause.value : [];
  const rows = values.length > 0 ? values : [defaultValueForField(field)];
  return (
    <div className="space-y-2">
      {rows.map((item, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <ConditionValueInput
              idPrefix={`${idPrefix}-item-${index}`}
              field={field}
              value={item}
              onChange={(next) => {
                const nextValues = [...rows];
                nextValues[index] = next;
                onChange(nextValues);
              }}
              disabled={disabled}
            />
          </div>
          {rows.length > 1 && (
            <Button
              id={`${idPrefix}-item-${index}-remove`}
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2"
              onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
              disabled={disabled}
              aria-label={t('designer.conditionBuilder.removeValue', { defaultValue: 'Remove value' })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      <Button
        id={`${idPrefix}-add-value`}
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange([...rows, defaultValueForField(field)])}
        disabled={disabled}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t('designer.conditionBuilder.addValue', { defaultValue: 'Add value' })}
      </Button>
    </div>
  );
};

export type WorkflowConditionBuilderProps = {
  idPrefix: string;
  label: string;
  expression: string;
  onExpressionChange: (expression: string) => void;
  fields: WorkflowConditionField[];
  /** Renders the raw expression editor for Expression mode. */
  renderExpressionEditor: () => React.ReactNode;
  disabled?: boolean;
};

/**
 * Field / operator / value editor for conditions. It reads and writes the condition expression,
 * so the expression stays the source of truth and conditions the builder can't show stay editable
 * as expressions.
 */
export const WorkflowConditionBuilder: React.FC<WorkflowConditionBuilderProps> = ({
  idPrefix,
  label,
  expression,
  onExpressionChange,
  fields,
  renderExpressionEditor,
  disabled = false,
}) => {
  const { t } = useTranslation('msp/workflows');
  const parsed = useMemo(() => parseConditionExpression(expression), [expression]);
  const [mode, setMode] = useState<'builder' | 'expression'>(() => (parsed ? 'builder' : 'expression'));
  const canUseBuilder = parsed !== null;
  const effectiveMode = canUseBuilder ? mode : 'expression';
  const fieldsByPath = useMemo(() => new Map(fields.map((field) => [field.path, field])), [fields]);
  const { statuses } = useWorkflowEntityLabels();

  const writeGroup = (group: WorkflowConditionGroup) => {
    onExpressionChange(serializeConditionGroup(group));
  };

  // The same field picker as an input's source and Insert field: grouped by where each field comes
  // from. A clause on a field that's no longer listed still shows its path.
  const pickableFields = useMemo<WorkflowPickableField[]>(() => {
    const list: WorkflowPickableField[] = fields.map((field) => ({
      path: field.path,
      // The same plain-language label as every other field list: "Ticket number (ticket.ticket_number)".
      label: formatWorkflowFieldLabel(field.description, field.fieldLabel),
      sourceName: field.sourceLabel,
      description: field.path,
    }));
    for (const clause of parsed?.clauses ?? []) {
      if (!fieldsByPath.has(clause.path) && !list.some((field) => field.path === clause.path)) {
        list.push({ path: clause.path, label: clause.path, sourceName: '' });
      }
    }
    return list;
  }, [fields, fieldsByPath, parsed]);

  const updateClause = (index: number, patch: Partial<WorkflowConditionClause>) => {
    if (!parsed) return;
    const clauses = parsed.clauses.map((clause, clauseIndex) => {
      if (clauseIndex !== index) return clause;
      const next = { ...toDisplayClause(clause, fieldsByPath.get(clause.path), statuses), ...patch };
      const field = fieldsByPath.get(next.path);
      if (patch.path !== undefined && patch.path !== clause.path) {
        const allowed = getConditionOperatorsForField(field);
        next.operator = allowed.includes(next.operator) ? next.operator : allowed[0];
        next.value = defaultValueForField(field);
      }
      next.value = normalizeClauseValue(next.operator, next.value, field);
      return toStoredClause(next, field, statuses);
    });
    writeGroup({ ...parsed, clauses });
  };

  // "Add condition" opens a new row with the field picker open and nothing chosen. The condition is
  // written once a field is picked (a clause without a field can't be saved as an expression).
  const [pendingClause, setPendingClause] = useState(false);
  const addClause = () => setPendingClause(true);
  const addClauseForField = (path: string) => {
    if (!path) return;
    const group = parsed ?? { join: 'and' as const, clauses: [] };
    const field = fieldsByPath.get(path);
    const operator = getConditionOperatorsForField(field)[0];
    writeGroup({
      ...group,
      clauses: [...group.clauses, { path, operator, value: normalizeClauseValue(operator, undefined, field) }],
    });
    setPendingClause(false);
  };

  const modeButtons = (
    <div className="inline-flex rounded-md border border-[rgb(var(--color-border-200))] p-0.5" role="group">
      {(['builder', 'expression'] as const).map((option) => {
        const selected = effectiveMode === option;
        const optionDisabled = disabled || (option === 'builder' && !canUseBuilder);
        return (
          <button
            key={option}
            id={`${idPrefix}-mode-${option}`}
            type="button"
            aria-pressed={selected}
            disabled={optionDisabled}
            title={option === 'builder' && !canUseBuilder
              ? t('designer.conditionBuilder.builderUnavailable', {
                  defaultValue: 'The builder can only show conditions that are a list of field checks joined by all "and" or all "or".',
                })
              : undefined}
            onClick={() => setMode(option)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              selected
                ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300'
                : 'text-[rgb(var(--color-text-600))] hover:bg-[rgb(var(--color-border-100))]'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {option === 'builder'
              ? t('designer.conditionBuilder.modes.builder', { defaultValue: 'Builder' })
              : t('designer.conditionBuilder.modes.expression', { defaultValue: 'Expression' })}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-2" id={`${idPrefix}-condition-builder`}>
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {modeButtons}
      </div>

      {effectiveMode === 'expression' ? (
        <div className="space-y-2">
          {!canUseBuilder && expression.trim().length > 0 && (
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              {t('designer.conditionBuilder.expressionOnlyNotice', {
                defaultValue: 'This condition can only be edited as an expression. Clear it to start over in the builder.',
              })}
            </p>
          )}
          {renderExpressionEditor()}
        </div>
      ) : (
        <div className="space-y-2">
          {parsed && parsed.clauses.length > 1 && (
            <div className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-600))]">
              <span>{t('designer.conditionBuilder.matchPrefix', { defaultValue: 'Continue when' })}</span>
              <CustomSelect
                id={`${idPrefix}-join`}
                size="sm"
                className="w-24"
                options={[
                  { value: 'and', label: t('designer.conditionBuilder.joinAll', { defaultValue: 'all' }) },
                  { value: 'or', label: t('designer.conditionBuilder.joinAny', { defaultValue: 'any' }) },
                ]}
                value={parsed.join}
                onValueChange={(next) => writeGroup({ ...parsed, join: next === 'or' ? 'or' : 'and' })}
                disabled={disabled}
              />
              <span>{t('designer.conditionBuilder.matchSuffix', { defaultValue: 'of these are true' })}</span>
            </div>
          )}

          {parsed?.clauses.map((storedClause, index) => {
            const field = fieldsByPath.get(storedClause.path);
            const clause = toDisplayClause(storedClause, field, statuses);
            const operators = getConditionOperatorsForField(field);
            const operatorOptions = (operators.includes(clause.operator) ? operators : [...operators, clause.operator])
              .map((operator) => ({ value: operator, label: operatorLabel(t, operator) }));
            const clauseId = `${idPrefix}-clause-${index}`;
            return (
              <div
                key={index}
                id={clauseId}
                className="space-y-2 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-2"
              >
                <div className="flex items-start gap-2">
                  <div
                    className="min-w-0 flex-1"
                    title={field ? `${field.sourceLabel} › ${field.fieldLabel} (${field.path})` : clause.path}
                  >
                    <WorkflowFieldPicker
                      id={`${clauseId}-field`}
                      fields={pickableFields}
                      value={clause.path}
                      onChange={(path) => updateClause(index, { path })}
                      placeholder={t('designer.conditionBuilder.selectField', { defaultValue: 'Choose a field' })}
                      emptyMessage={t('designer.conditionBuilder.noFields', { defaultValue: 'No matching fields' })}
                      disabled={disabled}
                    />
                  </div>
                  <Button
                    id={`${clauseId}-remove`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2"
                    onClick={() => parsed && writeGroup({ ...parsed, clauses: parsed.clauses.filter((_, i) => i !== index) })}
                    disabled={disabled}
                    aria-label={t('designer.conditionBuilder.removeCondition', { defaultValue: 'Remove condition' })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <CustomSelect
                  id={`${clauseId}-operator`}
                  options={operatorOptions}
                  value={clause.operator}
                  onValueChange={(next) => updateClause(index, { operator: next as WorkflowConditionOperator })}
                  disabled={disabled}
                />
                <ConditionValueEditor
                  idPrefix={`${clauseId}-value`}
                  field={field}
                  clause={clause}
                  onChange={(value) => updateClause(index, { value })}
                  disabled={disabled}
                />
              </div>
            );
          })}

          {pendingClause && (
            <div
              id={`${idPrefix}-clause-new`}
              className="flex items-start gap-2 rounded-md border border-dashed border-[rgb(var(--color-border-300))] p-2"
            >
              <div className="min-w-0 flex-1">
                <WorkflowFieldPicker
                  id={`${idPrefix}-clause-new-field`}
                  fields={pickableFields}
                  value=""
                  onChange={addClauseForField}
                  placeholder={t('designer.conditionBuilder.selectField', { defaultValue: 'Choose a field' })}
                  emptyMessage={t('designer.conditionBuilder.noFields', { defaultValue: 'No matching fields' })}
                  disabled={disabled}
                  defaultOpen
                />
              </div>
              <Button
                id={`${idPrefix}-clause-new-cancel`}
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 px-2"
                onClick={() => setPendingClause(false)}
                aria-label={t('designer.conditionBuilder.cancelNewCondition', { defaultValue: 'Cancel new condition' })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}

          {parsed && parsed.clauses.length === 0 && !pendingClause && (
            <p className="text-xs text-[rgb(var(--color-text-500))]">
              {fields.length > 0
                ? t('designer.conditionBuilder.emptyHint', {
                    defaultValue: 'Add a condition to choose when the Then branch runs. Otherwise the Else branch runs.',
                  })
                : t('designer.conditionBuilder.noFieldsHint', {
                    defaultValue: 'No fields are available yet. Pick a trigger, or add a step before this one that saves its output.',
                  })}
            </p>
          )}

          <Button
            id={`${idPrefix}-add-condition`}
            type="button"
            variant="outline"
            size="sm"
            onClick={addClause}
            disabled={disabled || fields.length === 0 || pendingClause}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('designer.conditionBuilder.addCondition', { defaultValue: 'Add condition' })}
          </Button>
        </div>
      )}
    </div>
  );
};

export default WorkflowConditionBuilder;
