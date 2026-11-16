'use client';

/**
 * The one renderer for a service request form. The client portal renders the real thing with
 * it, and the MSP form builder's canvas renders the same component, so what an author arranges
 * is literally what a client sees. There is no second, hand-written copy.
 *
 * It owns layout (boxed measure, sections, half-width pairs, inline errors) and delegates every
 * control to the shared field type registry in `@alga-psa/ui/form-fields`.
 */
import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import { FieldInputControl, getFieldType } from '@alga-psa/ui/form-fields';
import {
  getBasicFormWidthClass,
  groupFormElementsBySection,
  type BasicFormField,
  type BasicFormSettings,
} from '../../lib/service-requests/formSchema';

export interface ServiceRequestFormRendererLabels {
  selectPlaceholder: string;
  datePlaceholder: string;
  /** Appended to a label to mark it required, e.g. "Full name *". */
  requiredMarker?: string;
}

export interface ServiceRequestFormRendererProps {
  fields: ReadonlyArray<BasicFormField>;
  settings?: BasicFormSettings;
  values: Record<string, unknown>;
  onValueChange: (key: string, value: unknown) => void;
  /** Already-localized error text per field key. */
  errors?: Record<string, string>;
  /** When present, a key missing from the set is not rendered at all. */
  visibleFieldKeys?: ReadonlySet<string> | null;
  labels: ServiceRequestFormRendererLabels;
  /** Posts answers as form fields. The builder canvas leaves this off. */
  postFieldNames?: boolean;
  /** Prefix for every element id; keeps a canvas and a live form distinct on one page. */
  idPrefix?: string;
  /** Renders the form at phone width, for the builder's mobile preview. */
  previewWidth?: 'desktop' | 'mobile';
  disabled?: boolean;
  /** Decorates each element with selection chrome. Used by the builder canvas only. */
  renderElement?: (element: BasicFormField, index: number, content: React.ReactNode) => React.ReactNode;
  /** Replaces the label text of an element, e.g. with an inline rename field. */
  renderLabelText?: (element: BasicFormField, defaultText: string) => React.ReactNode;
  /** Rendered after the last element, inside the boxed container (the submit row). */
  children?: React.ReactNode;
}

type RenderRow =
  | { kind: 'single'; element: BasicFormField; index: number }
  | { kind: 'pair'; elements: Array<{ element: BasicFormField; index: number }> };

/** Consecutive half-width inputs pair into one two-column row; everything else spans. */
function toRows(entries: Array<{ element: BasicFormField; index: number }>): RenderRow[] {
  const rows: RenderRow[] = [];
  let pending: { element: BasicFormField; index: number } | null = null;

  const flushPending = () => {
    if (pending) {
      rows.push({ kind: 'pair', elements: [pending] });
      pending = null;
    }
  };

  for (const entry of entries) {
    const isHalf = entry.element.layout?.width === 'half';
    if (!isHalf) {
      flushPending();
      rows.push({ kind: 'single', element: entry.element, index: entry.index });
      continue;
    }
    if (pending) {
      rows.push({ kind: 'pair', elements: [pending, entry] });
      pending = null;
    } else {
      pending = entry;
    }
  }
  flushPending();
  return rows;
}

const CALLOUT_VARIANT = {
  info: 'info',
  warning: 'warning',
  success: 'success',
} as const;

export function ServiceRequestFormRenderer({
  fields,
  settings,
  values,
  onValueChange,
  errors,
  visibleFieldKeys,
  labels,
  postFieldNames = false,
  idPrefix = 'request-service-field',
  previewWidth = 'desktop',
  disabled = false,
  renderElement,
  renderLabelText,
  children,
}: ServiceRequestFormRendererProps): React.ReactElement {
  const [collapsedSections, setCollapsedSections] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );

  const indexByElement = new Map<BasicFormField, number>();
  fields.forEach((field, index) => indexByElement.set(field, index));

  const isVisible = (element: BasicFormField): boolean =>
    !visibleFieldKeys || visibleFieldKeys.has(element.key);

  const renderLabel = (element: BasicFormField): React.ReactNode => {
    const text = element.label || element.key;
    const body = renderLabelText ? renderLabelText(element, text) : text;
    // The marker is part of the accessible name, as it has always been: a screen reader
    // announces "Reason star" rather than leaving required-ness unspoken.
    return element.required ? (
      <>
        {body} {labels.requiredMarker ?? '*'}
      </>
    ) : (
      <>{body}</>
    );
  };

  const renderContent = (element: BasicFormField): React.ReactNode => {
    const key = element.key;
    const elementId = `${idPrefix}-${key}`;
    const definition = getFieldType(element.type);
    const errorText = errors?.[key];
    const describedBy =
      [errorText ? `${elementId}-error` : null, element.helpText ? `${elementId}-help` : null]
        .filter(Boolean)
        .join(' ') || undefined;

    if (element.type === 'divider') {
      return <hr className="border-t border-[rgb(var(--color-border-200))]" />;
    }

    if (element.type === 'text') {
      return (
        <div className="space-y-1">
          {element.label ? (
            <p className="text-sm font-medium text-[rgb(var(--color-text-800))]">{renderLabel(element)}</p>
          ) : null}
          {element.helpText ? (
            <p className="whitespace-pre-line text-sm text-[rgb(var(--color-text-600))]">
              {element.helpText}
            </p>
          ) : null}
        </div>
      );
    }

    if (element.type === 'callout') {
      const tone = element.display?.tone ?? 'info';
      return (
        <Alert id={elementId} variant={CALLOUT_VARIANT[tone]}>
          <AlertDescription>
            <span className="font-medium">{renderLabel(element)}</span>
            {element.helpText ? (
              <span className="mt-0.5 block text-sm">{element.helpText}</span>
            ) : null}
          </AlertDescription>
        </Alert>
      );
    }

    // An input: label, control, help, error.
    const isCheckbox = element.type === 'checkbox';
    return (
      <div className="space-y-1">
        {isCheckbox ? null : (
          <label
            htmlFor={elementId}
            className="block text-sm font-medium text-[rgb(var(--color-text-700))]"
          >
            {renderLabel(element)}
          </label>
        )}
        <FieldInputControl
          id={elementId}
          type={element.type}
          value={values[key]}
          onChange={(next) => onValueChange(key, next)}
          options={element.options}
          placeholder={element.placeholder}
          required={Boolean(element.required)}
          disabled={disabled}
          name={postFieldNames ? key : undefined}
          label={isCheckbox ? renderLabel(element) : undefined}
          invalid={Boolean(errorText)}
          describedBy={describedBy}
          labels={{
            selectPlaceholder: labels.selectPlaceholder,
            datePlaceholder: labels.datePlaceholder,
          }}
        />
        {errorText ? (
          <p id={`${elementId}-error`} role="alert" className="text-sm text-destructive">
            {errorText}
          </p>
        ) : null}
        {element.helpText && definition?.supportsHelpText !== false ? (
          <p
            id={`${elementId}-help`}
            className={`text-xs text-[rgb(var(--color-text-600))] ${isCheckbox ? 'ml-6' : ''}`.trim()}
          >
            {element.helpText}
          </p>
        ) : null}
      </div>
    );
  };

  const renderEntry = (entry: { element: BasicFormField; index: number }): React.ReactNode => {
    const content = renderContent(entry.element);
    return renderElement ? renderElement(entry.element, entry.index, content) : content;
  };

  const renderRows = (entries: Array<{ element: BasicFormField; index: number }>) =>
    toRows(entries).map((row) =>
      row.kind === 'single' ? (
        <div key={row.element.key}>{renderEntry(row)}</div>
      ) : (
        <div
          key={row.elements.map((entry) => entry.element.key).join('|')}
          className={
            previewWidth === 'mobile'
              ? 'grid grid-cols-1 gap-4'
              : 'grid grid-cols-1 gap-4 sm:grid-cols-2'
          }
        >
          {row.elements.map((entry) => (
            <div key={entry.element.key} className="min-w-0">
              {renderEntry(entry)}
            </div>
          ))}
        </div>
      )
    );

  const groups = groupFormElementsBySection(fields.filter(isVisible));

  const containerClass =
    previewWidth === 'mobile'
      ? 'mx-auto w-full max-w-[26rem]'
      : getBasicFormWidthClass(settings);

  return (
    <div className={`${containerClass} space-y-6`}>
      {groups.map((group, groupIndex) => {
        const entries = group.elements.map((element) => ({
          element,
          index: indexByElement.get(element) ?? -1,
        }));

        if (!group.section) {
          return (
            <div key={`group-${groupIndex}`} className="space-y-4">
              {renderRows(entries)}
            </div>
          );
        }

        const sectionIndex = indexByElement.get(group.section) ?? -1;
        const sectionId = `${idPrefix}-section-${group.section.key}`;
        const collapsible = group.section.display?.collapsible === true;
        const isCollapsed = collapsible && collapsedSections.has(group.section.key);
        const sectionHeader = (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <h3
                id={`${sectionId}-title`}
                className="text-base font-semibold text-[rgb(var(--color-text-900))]"
              >
                {renderLabelText
                  ? renderLabelText(group.section, group.section.label || group.section.key)
                  : group.section.label || group.section.key}
              </h3>
              {group.section.helpText ? (
                <p className="text-sm text-[rgb(var(--color-text-600))]">{group.section.helpText}</p>
              ) : null}
            </div>
            {collapsible ? (
              <CollapseToggleButton
                id={`${sectionId}-toggle`}
                isCollapsed={Boolean(isCollapsed)}
                collapsedLabel={group.section.label || group.section.key}
                expandedLabel={group.section.label || group.section.key}
                tone="ghost"
                aria-expanded={!isCollapsed}
                aria-controls={`${sectionId}-body`}
                onClick={() =>
                  setCollapsedSections((previous) => {
                    const next = new Set(previous);
                    if (next.has(group.section!.key)) next.delete(group.section!.key);
                    else next.add(group.section!.key);
                    return next;
                  })
                }
              />
            ) : null}
          </div>
        );

        return (
          <section
            key={group.section.key}
            id={sectionId}
            aria-labelledby={`${sectionId}-title`}
            className="space-y-4 rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4"
          >
            {renderElement
              ? renderElement(group.section, sectionIndex, sectionHeader)
              : sectionHeader}
            {isCollapsed ? null : (
              <div id={`${sectionId}-body`} className="space-y-4">
                {renderRows(entries)}
              </div>
            )}
          </section>
        );
      })}
      {children}
    </div>
  );
}

export default ServiceRequestFormRenderer;
