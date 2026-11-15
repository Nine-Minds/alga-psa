'use client';

/**
 * The "Outline" tab: the whole form as a tree. Sections nest their questions, a bracket marks a
 * half-width pair, required and rule chips sit on the rows, rows drag to reorder (also across
 * sections), and selection stays in sync with the canvas in both directions.
 */
import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Asterisk, Eye, GripVertical } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getFieldType } from '@alga-psa/ui/form-fields';
import {
  groupFormElementsBySection,
  type BasicFormField,
} from '../../../../lib/service-requests/basicFormBuilder';
import { getFieldVisibilityRules } from '../fieldVisibilityModel';

export interface FormBuilderOutlineProps {
  elements: BasicFormField[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  formBehaviorConfig?: Record<string, unknown>;
}

function OutlineRow({
  element,
  index,
  isSelected,
  isPaired,
  onSelect,
  hasRule,
}: {
  element: BasicFormField;
  index: number;
  isSelected: boolean;
  isPaired: boolean;
  onSelect: (key: string) => void;
  hasRule: boolean;
}) {
  const { t } = useTranslation('msp/service-requests');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `outline:${element.key}`,
    data: { kind: 'element', elementKey: element.key },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `outline-drop:${index}`,
    data: { kind: 'insert', index },
  });
  const typeLabel = t(`editor.form.types.${element.type}`, { defaultValue: element.type });

  return (
    <li ref={setDropRef} className={isOver ? 'border-t-2 border-[rgb(var(--color-primary-400))]' : ''}>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        id={`service-request-form-outline-row-${element.key}`}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        aria-label={`${element.label || element.key} — ${typeLabel}`}
        onClick={() => onSelect(element.key)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(element.key);
          }
        }}
        className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs ${
          isSelected
            ? 'bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-text-900))] ring-1 ring-[rgb(var(--color-primary-300))]'
            : 'hover:bg-[rgb(var(--color-border-100))]'
        } ${isDragging ? 'opacity-50' : ''}`}
      >
        {isPaired ? (
          <span
            aria-hidden="true"
            title={t('formBuilder.outline.halfWidthPair')}
            className="w-1.5 shrink-0 self-stretch rounded-sm bg-[rgb(var(--color-primary-300))]"
          />
        ) : null}
        <GripVertical aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--color-text-400))]" />
        <span className="min-w-0 flex-1 truncate">{element.label || element.key}</span>
        {element.required ? (
          <Asterisk
            aria-label={t('formBuilder.outline.requiredChip')}
            className="h-3 w-3 shrink-0 text-[rgb(var(--color-text-500))]"
          />
        ) : null}
        {hasRule ? (
          <Eye
            aria-label={t('formBuilder.outline.ruleChip')}
            className="h-3 w-3 shrink-0 text-[rgb(var(--color-text-500))]"
          />
        ) : null}
      </div>
    </li>
  );
}

export function FormBuilderOutline({
  elements,
  selectedKey,
  onSelect,
  formBehaviorConfig,
}: FormBuilderOutlineProps): React.ReactElement {
  const { t } = useTranslation('msp/service-requests');
  const indexByKey = new Map(elements.map((element, index) => [element.key, index] as const));
  const groups = groupFormElementsBySection(elements);

  const hasRuleFor = (key: string): boolean =>
    formBehaviorConfig ? getFieldVisibilityRules(formBehaviorConfig, key).length > 0 : false;

  // A half-width element pairs with the next one, so both rows carry the bracket.
  const pairedKeys = new Set<string>();
  for (const group of groups) {
    let pending: BasicFormField | null = null;
    for (const element of group.elements) {
      if (element.layout?.width !== 'half') {
        pending = null;
        continue;
      }
      if (pending) {
        pairedKeys.add(pending.key);
        pairedKeys.add(element.key);
        pending = null;
      } else {
        pending = element;
      }
    }
  }

  if (elements.length === 0) {
    return (
      <p className="px-3 py-3 text-xs text-[rgb(var(--color-text-600))]">
        {t('formBuilder.outline.empty')}
      </p>
    );
  }

  return (
    <div id="service-request-form-outline" className="space-y-3 px-2 py-3">
      {groups.map((group, groupIndex) => (
        <div key={group.section?.key ?? `group-${groupIndex}`} className="space-y-0.5">
          {group.section ? (
            <ul className="list-none">
              <OutlineRow
                element={group.section}
                index={indexByKey.get(group.section.key) ?? 0}
                isSelected={selectedKey === group.section.key}
                isPaired={false}
                onSelect={onSelect}
                hasRule={hasRuleFor(group.section.key)}
              />
            </ul>
          ) : null}
          <ul className={`list-none space-y-0.5 ${group.section ? 'ml-3 border-l border-[rgb(var(--color-border-200))] pl-2' : ''}`}>
            {group.elements.map((element) => (
              <OutlineRow
                key={element.key}
                element={element}
                index={indexByKey.get(element.key) ?? 0}
                isSelected={selectedKey === element.key}
                isPaired={pairedKeys.has(element.key)}
                onSelect={onSelect}
                hasRule={hasRuleFor(element.key)}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** The type label shown on an outline row; exported for the canvas chips. */
export function getElementTypeGroup(element: BasicFormField): string {
  return getFieldType(element.type)?.group ?? 'text';
}
