'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { MappingValue } from '@alga-psa/workflows/runtime';

import { ExpressionPreview } from '../expression-editor/ExpressionPreview';
import { useCaretIntent } from '../caretIntent';
import { WorkflowInsertFieldPicker } from './WorkflowFieldPicker';
import {
  compileTextTemplate,
  isTextTemplateFieldPath,
  parseTextTemplate,
  type TextTemplateScope,
} from './textTemplate';

const TEXT_INPUT_CLASSES =
  'w-full rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 py-2 text-sm text-[rgb(var(--color-text-900))] focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60';

const OPEN_PLACEHOLDER_BEFORE_CARET = /\{\{\s*([A-Za-z_$][A-Za-z0-9_$.[\]-]*)?$/;

/**
 * Inserts `{{path}}` at the caret. A placeholder the user already started (`{{vars.cl`) is
 * completed instead of duplicated.
 */
export const insertTextTemplateField = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  path: string
): { text: string; caret: number } => {
  const before = text.slice(0, selectionStart);
  const open = selectionStart === selectionEnd ? OPEN_PLACEHOLDER_BEFORE_CARET.exec(before) : null;
  const start = open && (!open[1] || path.startsWith(open[1])) ? selectionStart - open[0].length : selectionStart;
  const token = `{{${path}}}`;
  const next = text.slice(0, start) + token + text.slice(selectionEnd);
  return { text: next, caret: start + token.length };
};

/** Rows for a one-line template: wraps up to four rows as it grows (about 48 characters a row). */
export const getSingleLineTemplateRows = (value: string): number =>
  Math.min(4, Math.max(1, Math.ceil(value.length / 48)));

const TemplateTextArea: React.FC<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  fieldOptions: SelectOption[];
  minRows: number;
  maxRows: number;
  placeholder: string;
  localNames?: ReadonlyArray<string>;
  disabled?: boolean;
  ariaLabel?: string;
}> = ({ id, value, onChange, fieldOptions, minRows, maxRows, placeholder, localNames, disabled, ariaLabel }) => {
  const textAreaRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const { intent: caretIntent, handlers: caretHandlers } = useCaretIntent(textAreaRef);
  const singleLine = maxRows <= 1;
  const rows = Math.min(maxRows, Math.max(minRows, value.split('\n').length + Math.floor(value.length / 60)));

  const insertField = (path: string) => {
    if (!path) return;
    const element = textAreaRef.current;
    // At the caret the author placed, otherwise at the end of the text.
    const { start, end } = caretIntent.insertionRange(element, value.length);
    const next = insertTextTemplateField(value, start, end, path);
    onChange(next.text);
    window.requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.caret, next.caret);
      // Refocusing isn't the author placing the caret, but the caret after the field is theirs.
      caretIntent.onInserted();
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex justify-end">
        <div className="w-56">
          <WorkflowInsertFieldPicker
            id={`${id}-insert-field`}
            fieldOptions={fieldOptions}
            localNames={localNames}
            onInsert={insertField}
            disabled={disabled}
          />
        </div>
      </div>
      {singleLine ? (
        // One line of text, but long templates wrap and the box grows instead of scrolling out of
        // sight; Enter never adds a line break.
        <textarea
          id={id}
          ref={(element) => { textAreaRef.current = element; }}
          value={value}
          rows={getSingleLineTemplateRows(value)}
          onChange={(event) => onChange(event.target.value.replace(/\r?\n/g, ' '))}
          {...caretHandlers}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
            caretHandlers.onKeyDown(event);
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          className={`${TEXT_INPUT_CLASSES} resize-none`}
        />
      ) : (
        <textarea
          id={id}
          ref={(element) => { textAreaRef.current = element; }}
          value={value}
          rows={rows}
          onChange={(event) => onChange(event.target.value)}
          {...caretHandlers}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          className={`${TEXT_INPUT_CLASSES} resize-y`}
        />
      )}
    </div>
  );
};

/**
 * Editor for "text with fields": type text and insert workflow fields as `{{payload.x}}` /
 * `{{vars.step.field}}` placeholders. Saves plain text, or an expression joining text and fields.
 */
export const WorkflowTextTemplateEditor: React.FC<{
  idPrefix: string;
  /** Template text, as read by textTemplateFromValue. */
  template: string;
  onChange: (value: MappingValue) => void;
  fieldOptions: SelectOption[];
  sampleContext?: Record<string, unknown>;
  /** Names in scope besides the workflow data roots, e.g. the loop item and index. */
  scope?: TextTemplateScope;
  multiline?: boolean;
  label?: string;
  disabled?: boolean;
}> = ({ idPrefix, template, onChange, fieldOptions, sampleContext, scope, multiline = false, label, disabled }) => {
  const { t } = useTranslation('msp/workflows');
  const [isExpanded, setIsExpanded] = useState(false);

  // Every field the input can read is insertable: data fields, plus the loop item and index inside a
  // For Each (listed first there). Bare containers (payload, vars) are left out.
  const insertableFields = useMemo(() => {
    const localNames = new Set(scope?.localNames ?? []);
    const isLocal = (path: string) => localNames.has(path.split(/[.[]/)[0]);
    const insertable = fieldOptions.filter((option) =>
      isTextTemplateFieldPath(option.value, scope) && (option.value.includes('.') || isLocal(option.value))
    );
    return [
      ...insertable.filter((option) => isLocal(option.value)),
      ...insertable.filter((option) => !isLocal(option.value)),
    ];
  }, [fieldOptions, scope]);
  const labelByPath = useMemo(
    () => new Map(insertableFields.map((option) => [option.value, typeof option.label === 'string' ? option.label : option.value])),
    [insertableFields]
  );
  const usedFields = useMemo(
    () => Array.from(new Set(parseTextTemplate(template, scope)
      .flatMap((segment) => (segment.kind === 'field' ? [segment.path] : [])))),
    [scope, template]
  );
  const compiled = compileTextTemplate(template, scope);
  const previewExpression = typeof compiled === 'object' && compiled !== null && '$expr' in compiled
    ? String((compiled as { $expr: string }).$expr)
    : '';
  // Literal {{…}} placeholders are passed as values so i18n interpolation leaves them intact.
  const placeholder = t('textTemplateEditor.placeholder', {
    defaultValue: 'Type text. Use Insert field to add values, e.g. Contract ending for {{example}}',
    example: '{{vars.client.client.client_name}}',
    interpolation: { escapeValue: false },
  });
  const handleChange = (text: string) => onChange(compileTextTemplate(text, scope));
  const loopNames = scope?.localNames?.length ? scope.localNames.slice(0, 2) : [];

  return (
    <div className="space-y-2" id={`${idPrefix}-text-template`}>
      <TemplateTextArea
        id={`${idPrefix}-literal-str`}
        value={template}
        onChange={handleChange}
        fieldOptions={insertableFields}
        localNames={scope?.localNames}
        minRows={multiline ? 4 : 1}
        maxRows={multiline ? 12 : 1}
        placeholder={placeholder}
        disabled={disabled}
        ariaLabel={label}
      />

      {usedFields.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" id={`${idPrefix}-text-template-fields`}>
          <span className="text-[11px] text-[rgb(var(--color-text-500))]">
            {t('textTemplateEditor.fieldsUsed', { defaultValue: 'Fields:' })}
          </span>
          {usedFields.map((path) => (
            <span
              key={path}
              title={path}
              className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] text-primary-700 dark:border-primary-500/40 dark:bg-primary-500/20 dark:text-primary-300"
            >
              {labelByPath.get(path) ?? path}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] text-[rgb(var(--color-text-500))]">
          {loopNames.length > 0
            ? t('textTemplateEditor.hintInLoop', {
                defaultValue: 'Placeholders such as {{itemExample}}, {{indexExample}}, {{payloadExample}} or {{varsExample}} are filled in by the workflow. Other {{otherExample}} placeholders are kept as written, for example for an email template’s own data.',
                itemExample: `{{${loopNames[0]}}}`,
                indexExample: `{{${loopNames[1] ?? 'index'}}}`,
                payloadExample: '{{payload.x}}',
                varsExample: '{{vars.step.field}}',
                otherExample: '{{name}}',
                interpolation: { escapeValue: false },
              })
            : t('textTemplateEditor.hint', {
                defaultValue: 'Placeholders such as {{payloadExample}} or {{varsExample}} are filled in by the workflow. Other {{otherExample}} placeholders are kept as written, for example for an email template’s own data.',
                payloadExample: '{{payload.x}}',
                varsExample: '{{vars.step.field}}',
                otherExample: '{{name}}',
                interpolation: { escapeValue: false },
              })}
        </p>
        <Button
          id={`${idPrefix}-text-template-expand`}
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={() => setIsExpanded(true)}
          disabled={disabled}
        >
          <Maximize2 className="mr-1 h-3.5 w-3.5" />
          {t('textTemplateEditor.expand', { defaultValue: 'Expand' })}
        </Button>
      </div>

      {!isExpanded && (
        <ExpressionPreview idPrefix={`${idPrefix}-text-template`} expression={previewExpression} sampleContext={sampleContext} />
      )}

      <Dialog
        id={`${idPrefix}-text-template-dialog`}
        isOpen={isExpanded}
        onClose={() => setIsExpanded(false)}
        title={label || t('textTemplateEditor.expandedTitle', { defaultValue: 'Edit text' })}
        className="max-w-4xl"
        allowOverflow
        footer={(
          <div className="flex justify-end">
            <Button id={`${idPrefix}-text-template-done`} type="button" onClick={() => setIsExpanded(false)}>
              {t('textTemplateEditor.done', { defaultValue: 'Done' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-3">
            <TemplateTextArea
              id={`${idPrefix}-text-template-expanded`}
              value={template}
              onChange={handleChange}
              fieldOptions={insertableFields}
              localNames={scope?.localNames}
              minRows={14}
              maxRows={24}
              placeholder={placeholder}
              disabled={disabled}
              ariaLabel={label}
            />
            <ExpressionPreview
              idPrefix={`${idPrefix}-text-template-expanded`}
              expression={previewExpression}
              sampleContext={sampleContext}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WorkflowTextTemplateEditor;
