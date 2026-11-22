'use client';

/**
 * The canvas is the real portal renderer. What the author arranges here is literally the
 * component a client sees; the builder only decorates each element with selection chrome, a
 * drag handle, rule and validation chips, and the insert lines between elements.
 */
import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Eye, GripVertical, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  BasicFormField,
  BasicFormSettings,
} from '../../../../lib/service-requests/formSchema';
import { ServiceRequestFormRenderer } from '../../../../components/service-requests/ServiceRequestFormRenderer';
import { InlineRenameLabel } from './InlineRenameLabel';

export interface FormBuilderCanvasProps {
  elements: BasicFormField[];
  settings: BasicFormSettings;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onRenameLabel: (key: string, nextLabel: string) => void;
  /** The gap a palette click will drop into; null means "after the selection". */
  insertIndex: number | null;
  onInsertIndexChange: (index: number | null) => void;
  previewWidth: 'desktop' | 'mobile';
  /** The element the author asked to rename from the keyboard. */
  renamingKey: string | null;
  onRenamingKeyChange: (key: string | null) => void;
  labels: { selectPlaceholder: string; datePlaceholder: string };
  /** Brings the template gallery back, for a form the author started blank. */
  onShowTemplates: () => void;
}

function InsertLine({
  index,
  isActive,
  onActivate,
  label,
}: {
  index: number;
  isActive: boolean;
  onActivate: () => void;
  label: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `canvas-insert:${index}`,
    data: { kind: 'insert', index },
  });

  return (
    <div ref={setNodeRef} className="group relative h-2">
      <div
        className={`absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded transition-opacity ${
          isOver || isActive
            ? 'bg-[rgb(var(--color-primary-400))] opacity-100'
            : 'bg-[rgb(var(--color-primary-300))] opacity-0 group-hover:opacity-60'
        }`}
      />
      <button
        id={`service-request-form-canvas-insert-${index}`}
        type="button"
        aria-label={label}
        aria-pressed={isActive}
        onClick={(event) => {
          event.stopPropagation();
          onActivate();
        }}
        className={`absolute left-1/2 top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[rgb(var(--color-border-300))] bg-[rgb(var(--color-card))] text-[rgb(var(--color-text-600))] transition-opacity focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-400))] ${
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

export function FormBuilderCanvas({
  elements,
  settings,
  selectedKey,
  onSelect,
  onRenameLabel,
  insertIndex,
  onInsertIndexChange,
  previewWidth,
  renamingKey,
  onRenamingKeyChange,
  labels,
  onShowTemplates,
}: FormBuilderCanvasProps): React.ReactElement {
  const { t } = useTranslation('msp/service-requests');

  const renderLabelText = (element: BasicFormField, defaultText: string) => (
    <InlineRenameLabel
      id={`service-request-form-canvas-label-${element.key}`}
      value={defaultText}
      editable={selectedKey === element.key}
      startEditing={renamingKey === element.key}
      onEditingChange={(editing) => {
        if (!editing && renamingKey === element.key) {
          onRenamingKeyChange(null);
        }
      }}
      onCommit={(next) => onRenameLabel(element.key, next)}
      renameHint={t('formBuilder.canvas.renameHint')}
    />
  );

  const renderElement = (element: BasicFormField, index: number, content: React.ReactNode) => {
    const isSelected = selectedKey === element.key;
    const isSection = element.type === 'section';
    const ruleCount = element.visibleWhen?.length ?? 0;
    const hasValidation = Boolean(element.validation && Object.keys(element.validation).length > 0);

    return (
      <>
        <InsertLine
          index={index}
          isActive={insertIndex === index}
          onActivate={() => onInsertIndexChange(insertIndex === index ? null : index)}
          label={t('formBuilder.canvas.insertHere')}
        />
        <CanvasElement
          element={element}
          isSelected={isSelected}
          isSection={isSection}
          ruleCount={ruleCount}
          hasValidation={hasValidation}
          onSelect={onSelect}
          onStartRename={() => onRenamingKeyChange(element.key)}
        >
          {content}
        </CanvasElement>
      </>
    );
  };

  return (
    <div
      id="service-request-form-canvas"
      className="min-h-full p-6"
      onClick={() => {
        onSelect(null);
        onInsertIndexChange(null);
      }}
    >
      <ServiceRequestFormRenderer
        fields={elements}
        settings={settings}
        values={{}}
        onValueChange={() => {}}
        labels={labels}
        idPrefix="service-request-form-canvas-field"
        previewWidth={previewWidth}
        disabled
        renderElement={renderElement}
        renderLabelText={renderLabelText}
      >
        {elements.length === 0 ? (
          <div className="space-y-2 rounded-md border border-dashed border-[rgb(var(--color-border-300))] p-6 text-center">
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {t('formBuilder.canvas.emptyHint')}
            </p>
            <Button
              id="service-request-form-canvas-show-templates"
              variant="outline"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onShowTemplates();
              }}
            >
              {t('formBuilder.canvas.showTemplates')}
            </Button>
          </div>
        ) : null}
        <InsertLine
          index={elements.length}
          isActive={insertIndex === elements.length}
          onActivate={() =>
            onInsertIndexChange(insertIndex === elements.length ? null : elements.length)
          }
          label={t('formBuilder.canvas.insertAtEnd')}
        />
      </ServiceRequestFormRenderer>
    </div>
  );
}

function CanvasElement({
  element,
  isSelected,
  isSection,
  ruleCount,
  hasValidation,
  onSelect,
  onStartRename,
  children,
}: {
  element: BasicFormField;
  isSelected: boolean;
  isSection: boolean;
  ruleCount: number;
  hasValidation: boolean;
  onSelect: (key: string) => void;
  onStartRename: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('msp/service-requests');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `canvas:${element.key}`,
    data: { kind: 'element', elementKey: element.key },
  });

  return (
    <div
      id={`service-request-form-canvas-element-${element.key}`}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={element.label || element.key}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(element.key);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          if (isSelected) {
            onStartRename();
          } else {
            onSelect(element.key);
          }
        } else if (event.key === 'F2' && isSelected) {
          event.preventDefault();
          event.stopPropagation();
          onStartRename();
        }
      }}
      className={`relative rounded-md p-2 transition-colors focus:outline-none ${
        isSelected
          ? 'ring-2 ring-[rgb(var(--color-primary-400))]'
          : 'ring-1 ring-transparent hover:ring-[rgb(var(--color-border-300))]'
      } ${isSection ? 'border border-dashed border-[rgb(var(--color-border-300))]' : ''} ${
        isDragging ? 'opacity-50' : ''
      } focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-400))]`}
    >
      <span
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t('formBuilder.canvas.dragHandle')}
        className={`absolute -left-5 top-2 cursor-grab text-[rgb(var(--color-text-400))] transition-opacity ${
          isSelected ? 'opacity-100' : 'opacity-0 hover:opacity-100 focus:opacity-100'
        }`}
      >
        <GripVertical className="h-4 w-4" />
      </span>
      {ruleCount > 0 || hasValidation ? (
        <span className="absolute right-2 top-1 flex items-center gap-1">
          {ruleCount > 0 ? (
            <span
              title={t('formBuilder.canvas.ruleChip', { count: ruleCount })}
              className="inline-flex items-center gap-0.5 rounded bg-[rgb(var(--color-border-100))] px-1 py-0.5 text-[10px] text-[rgb(var(--color-text-600))]"
            >
              <Eye className="h-3 w-3" />
              {ruleCount}
            </span>
          ) : null}
          {hasValidation ? (
            <span
              title={t('formBuilder.canvas.validationChip')}
              className="inline-flex items-center rounded bg-[rgb(var(--color-border-100))] px-1 py-0.5 text-[10px] text-[rgb(var(--color-text-600))]"
            >
              <ShieldCheck className="h-3 w-3" />
            </span>
          ) : null}
        </span>
      ) : null}
      {/* The renderer runs disabled here, so a click on a control selects rather than fills in.
          Labels stay clickable: that is how an inline rename starts. */}
      {children}
    </div>
  );
}
