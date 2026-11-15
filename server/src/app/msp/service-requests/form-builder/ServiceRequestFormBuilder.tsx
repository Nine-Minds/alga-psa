'use client';

/**
 * Form Studio: the full-screen, three-pane builder for a service request form.
 *
 * Left: "Add" (the palette, grouped by purpose) and "Outline" (the form as a tree).
 * Centre: the real portal renderer as canvas, with two modes — Edit, and Try it, where the form
 * runs live so the author can type answers and watch rules and validation respond.
 * Right: the inspector, where required-ness, validation and visibility are always visible.
 *
 * Every edit is local. One debounced save writes the whole schema through
 * `replaceServiceRequestFormSchemaAction`; the old per-field round trips are gone from the UI.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import * as Icons from 'lucide-react';
import { ArrowLeft, Monitor, Redo2, Settings, Smartphone, Undo2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import {
  DesignerPalette,
  DesignerPaletteTile,
  DesignerSaveStatus,
  DesignerShell,
  getDesignerSaveState,
  groupDesignerPaletteItemsByCategory,
  matchesDesignerPaletteQuery,
  readStoredDesignerSidebarWidth,
  storeDesignerSidebarWidth,
} from '@alga-psa/ui/components/designer';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { FieldTypeKey, FieldValidationIssue } from '@alga-psa/ui/form-fields';
import {
  collectElementVisibilityRules,
  computeVisibleFieldKeys,
  parseVisibilityRules,
} from '../../../../lib/service-requests/formVisibility';
import { collectFormFieldIssues } from '../../../../lib/service-requests/formValidation';
import { normalizeBasicFormSchema } from '../../../../lib/service-requests/formSchema';
import { ServiceRequestFormRenderer } from '../../../../components/service-requests/ServiceRequestFormRenderer';
import {
  publishServiceRequestDefinitionAction,
  replaceServiceRequestFormSchemaAction,
  validateServiceRequestDefinitionForPublishAction,
} from '../actions';
import { FormBuilderCanvas } from './FormBuilderCanvas';
import { FormBuilderInspector } from './FormBuilderInspector';
import { FormBuilderOutline } from './FormBuilderOutline';
import { FormBuilderTemplateGallery } from './FormBuilderTemplateGallery';
import {
  FORM_PALETTE_CATEGORY_ORDER,
  FORM_PALETTE_ENTRIES,
  buildPaletteElement,
} from './formBuilderPalette';
import { buildFormBuilderTemplates } from './formBuilderTemplates';
import {
  buildTryItValues,
  canRedo,
  canUndo,
  createFormBuilderState,
  deleteElement,
  duplicateElement,
  findElement,
  getDocument,
  indexOfElement,
  insertElement,
  moveElement,
  nudgeElement,
  redo,
  renameElementKey,
  replaceDocument,
  selectElement,
  undo,
  updateElement,
  updateSettings,
  type FormBuilderDocument,
} from './formBuilderState';

const SAVE_DEBOUNCE_MS = 900;
const SIDEBAR_NAMESPACE = 'serviceRequestFormBuilder';
const LEFT_TAB_STORAGE_KEY = 'alga.serviceRequestFormBuilder.leftTab';

export interface ServiceRequestFormBuilderProps {
  definitionId: string;
  definitionName: string;
  initialSchema: Record<string, unknown>;
  /**
   * The EE advanced form-behavior provider's own rule list, when that provider is on. The
   * builder never writes it — conditions it authors live on the elements — but Try it reads it
   * so a definition carrying legacy rules behaves here exactly as it does in the portal.
   */
  initialFormBehaviorConfig?: Record<string, unknown>;
  /** Where the back link goes; the definition page owns basics, execution, mapping and publish. */
  backHref: string;
}

type LeftTab = 'add' | 'outline';

// Each state is its own class string so a foreground token never sits beside the background
// of the other state — that pairing is what the theme contrast contract measures.
const MODE_BUTTON_BASE = 'whitespace-nowrap px-2.5 py-1 text-xs';
const MODE_BUTTON_ON = `${MODE_BUTTON_BASE} bg-[rgb(var(--color-primary-500))] text-white`;
const MODE_BUTTON_OFF = `${MODE_BUTTON_BASE} text-[rgb(var(--color-text-700))]`;
const modeButtonClass = (active: boolean) => (active ? MODE_BUTTON_ON : MODE_BUTTON_OFF);

export function ServiceRequestFormBuilder({
  definitionId,
  definitionName,
  initialSchema,
  initialFormBehaviorConfig,
  backHref,
}: ServiceRequestFormBuilderProps): React.ReactElement {
  const { t } = useTranslation('msp/service-requests');

  const initialDocument = useMemo<FormBuilderDocument>(() => {
    const normalized = normalizeBasicFormSchema(initialSchema);
    return { elements: normalized.fields, settings: normalized.settings ?? {} };
  }, [initialSchema]);

  const [state, setState] = useState(() => createFormBuilderState(initialDocument));
  const [savedDocument, setSavedDocument] = useState<FormBuilderDocument>(initialDocument);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [mode, setMode] = useState<'edit' | 'try'>('edit');
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [leftTab, setLeftTab] = useState<LeftTab>('add');
  const [paletteSearch, setPaletteSearch] = useState('');
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [showFormSettings, setShowFormSettings] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(420);
  const [isLeftPaneCollapsed, setIsLeftPaneCollapsed] = useState(false);
  const [draggingPaletteType, setDraggingPaletteType] = useState<FieldTypeKey | null>(null);
  const [tryValues, setTryValues] = useState<Record<string, unknown>>({});
  const [tryErrors, setTryErrors] = useState<Record<string, string>>({});
  const [isPublishing, setIsPublishing] = useState(false);

  const document = getDocument(state);
  const selected = findElement(document, state.selectedKey);
  const templates = useMemo(() => buildFormBuilderTemplates(t), [t]);

  // The author's last tab wins, except that an empty form always opens on "Add".
  useEffect(() => {
    if (initialDocument.elements.length === 0) {
      setLeftTab('add');
      return;
    }
    try {
      const stored = window.localStorage.getItem(LEFT_TAB_STORAGE_KEY);
      if (stored === 'add' || stored === 'outline') setLeftTab(stored);
    } catch {
      // Storage unavailable: the default tab is fine.
    }
  }, [initialDocument.elements.length]);

  useEffect(() => {
    setInspectorWidth(readStoredDesignerSidebarWidth(SIDEBAR_NAMESPACE));
  }, []);

  const isDirty = useMemo(
    () => JSON.stringify(document) !== JSON.stringify(savedDocument),
    [document, savedDocument]
  );

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(
    async (next: FormBuilderDocument) => {
      setIsSaving(true);
      try {
        await replaceServiceRequestFormSchemaAction(
          definitionId,
          next.elements,
          Object.keys(next.settings).length > 0 ? next.settings : undefined
        );
        setSavedDocument(next);
        setLastSavedAt(Date.now());
      } catch (error) {
        console.error('Failed to save service request form schema', error);
        toast.error(t('formBuilder.messages.saveFailed'));
      } finally {
        setIsSaving(false);
      }
    },
    [definitionId, t]
  );

  // The timer is armed by an edit, never by an unrelated re-render: a render that does not
  // change the draft must not push the save further away.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!isDirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveRef.current(document);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [document, isDirty]);

  // Leaving with edits in flight would lose them; the browser asks first.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const paletteItems = useMemo(
    () =>
      FORM_PALETTE_ENTRIES.map((entry) => ({
        ...entry,
        label: t(`editor.form.types.${entry.id}`, { defaultValue: entry.id }),
        description: t(`formBuilder.types.${entry.id}.description`, { defaultValue: '' }),
        category: entry.category,
      })),
    [t]
  );

  const groupedPaletteItems = useMemo(() => {
    const query = paletteSearch.trim();
    const matching = query
      ? paletteItems.filter((item) =>
          matchesDesignerPaletteQuery(`${item.label} ${item.description} ${item.id}`, query)
        )
      : paletteItems;
    return groupDesignerPaletteItemsByCategory(matching, FORM_PALETTE_CATEGORY_ORDER);
  }, [paletteItems, paletteSearch]);

  const resolveInsertIndex = useCallback((): number => {
    if (insertIndex !== null) return insertIndex;
    const selectedIndex = indexOfElement(document, state.selectedKey);
    return selectedIndex >= 0 ? selectedIndex + 1 : document.elements.length;
  }, [document, insertIndex, state.selectedKey]);

  const addElement = useCallback(
    (type: FieldTypeKey, at?: number) => {
      const element = buildPaletteElement(
        type,
        t(`editor.form.types.${type}`, { defaultValue: type }),
        {
          optionOne: t('formBuilder.inspector.newChoice', { index: 1 }),
          optionTwo: t('formBuilder.inspector.newChoice', { index: 2 }),
        }
      );
      setState((previous) => insertElement(previous, element, at ?? resolveInsertIndex()));
      setInsertIndex(null);
      setShowFormSettings(false);
    },
    [resolveInsertIndex, t]
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    if (id.startsWith('palette:')) {
      setDraggingPaletteType(id.slice('palette:'.length) as FieldTypeKey);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingPaletteType(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overData = over.data.current as { kind?: string; index?: number } | undefined;

    if (activeId.startsWith('palette:')) {
      const type = activeId.slice('palette:'.length) as FieldTypeKey;
      addElement(type, overData?.kind === 'insert' ? overData.index : undefined);
      return;
    }

    const elementKey = (active.data.current as { elementKey?: string } | undefined)?.elementKey;
    if (!elementKey || overData?.kind !== 'insert' || typeof overData.index !== 'number') return;
    const fromIndex = indexOfElement(document, elementKey);
    // Dropping into the gap after the element itself is a no-op, not a shuffle.
    const toIndex = overData.index > fromIndex ? overData.index - 1 : overData.index;
    if (toIndex !== fromIndex) {
      setState((previous) => moveElement(previous, elementKey, toIndex));
    }
  };

  // Publishing snapshots what is stored, so a pending edit is written first.
  const publish = async () => {
    setIsPublishing(true);
    try {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (isDirty) {
        await save(document);
      }
      const validation = await validateServiceRequestDefinitionForPublishAction(definitionId);
      const errors = validation.errors ?? [];
      if (errors.length > 0) {
        toast.error(errors[0] ?? t('formBuilder.messages.publishBlocked'));
        return;
      }
      await publishServiceRequestDefinitionAction(definitionId);
      toast.success(t('formBuilder.messages.published'));
    } catch (error) {
      console.error('Failed to publish service request definition', error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('formBuilder.messages.publishFailed')
      );
    } finally {
      setIsPublishing(false);
    }
  };

  // Try it: the same evaluator and validator the portal runs, on the draft as it stands.
  const visibilityRules = useMemo(
    () => [
      ...collectElementVisibilityRules(document.elements),
      ...(initialFormBehaviorConfig ? (parseVisibilityRules(initialFormBehaviorConfig) ?? []) : []),
    ],
    [document.elements, initialFormBehaviorConfig]
  );
  const tryVisibleKeys = useMemo(() => {
    if (mode !== 'try' || visibilityRules.length === 0) return null;
    return new Set(
      computeVisibleFieldKeys(document.elements, visibilityRules, tryValues, {
        requesterUserId: 'preview-user',
        clientId: 'preview-client',
        contactId: null,
      })
    );
  }, [document.elements, mode, tryValues, visibilityRules]);

  const describeIssue = (issue: FieldValidationIssue): string => {
    if (issue.rule === 'required') return t('formBuilder.tryIt.required');
    if (issue.customMessage) return issue.customMessage;
    return t(`formBuilder.tryIt.validation.${issue.rule}`, {
      defaultValue: t('formBuilder.tryIt.invalid'),
      ...(issue.params ?? {}),
    });
  };

  const enterTryIt = () => {
    setTryValues(buildTryItValues(document));
    setTryErrors({});
    setMode('try');
  };

  const checkTryIt = () => {
    const issues = collectFormFieldIssues({
      fields: document.elements,
      values: tryValues,
      visibleFieldKeys: tryVisibleKeys,
    });
    setTryErrors(
      Object.fromEntries(issues.map((entry) => [entry.fieldKey, describeIssue(entry.issue)]))
    );
    if (issues.length === 0) {
      toast.success(t('formBuilder.tryIt.allGood'));
    }
  };

  // Undo / redo and keyboard reordering, while focus is not in a text field.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setState((previous) => (event.shiftKey ? redo(previous) : undo(previous)));
        return;
      }
      if (isTyping || !state.selectedKey) return;
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        setState((previous) =>
          nudgeElement(previous, state.selectedKey!, event.key === 'ArrowUp' ? -1 : 1)
        );
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.selectedKey]);

  const selectKey = (key: string | null) => {
    setState((previous) => selectElement(previous, key));
    if (key) setShowFormSettings(false);
  };

  const switchTab = (tab: LeftTab) => {
    setLeftTab(tab);
    try {
      window.localStorage.setItem(LEFT_TAB_STORAGE_KEY, tab);
    } catch {
      // Storage unavailable: the tab just isn't remembered.
    }
  };

  const precedingElements = useMemo(() => {
    const index = indexOfElement(document, state.selectedKey);
    return index > 0 ? document.elements.slice(0, index) : [];
  }, [document, state.selectedKey]);

  const rendererLabels = {
    selectPlaceholder: t('editor.form.selectOption'),
    datePlaceholder: t('formBuilder.canvas.datePlaceholder'),
  };

  const tabButton = (tab: LeftTab, label: string) => (
    <button
      id={`service-request-form-builder-tab-${tab}`}
      type="button"
      role="tab"
      aria-selected={leftTab === tab}
      onClick={() => switchTab(tab)}
      className={`flex-1 border-b-2 px-3 py-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-400))] ${
        leftTab === tab
          ? 'border-[rgb(var(--color-primary-500))] text-[rgb(var(--color-text-900))]'
          : 'border-transparent text-[rgb(var(--color-text-600))] hover:text-[rgb(var(--color-text-900))]'
      }`}
    >
      {label}
    </button>
  );

  const leftPaneHeader = (
    <div role="tablist" aria-label={t('formBuilder.leftPane.label')} className="flex border-b">
      {tabButton('add', t('formBuilder.leftPane.add'))}
      {tabButton('outline', t('formBuilder.leftPane.outline'))}
    </div>
  );

  const leftPane =
    mode === 'try' ? null : (
      <DesignerPalette
        i18nNamespace="msp/service-requests"
        idPrefix="service-request-form-builder"
        visible
        className="h-full"
        maxHeightClassName="max-h-full"
        isCollapsed={isLeftPaneCollapsed}
        onToggleCollapse={() => setIsLeftPaneCollapsed((previous) => !previous)}
        search={paletteSearch}
        onSearchChange={setPaletteSearch}
        registryError={false}
        draggingFromPalette={draggingPaletteType !== null}
        groupedPaletteItems={leftTab === 'add' ? groupedPaletteItems : {}}
        header={isLeftPaneCollapsed ? null : leftPaneHeader}
        insertionHint={
          insertIndex !== null ? t('formBuilder.leftPane.insertionHint') : undefined
        }
        renderItem={(item) => (
          <PaletteTile
            key={item.id}
            id={item.id}
            label={item.label}
            description={item.description}
            icon={item.icon}
            onClick={() => addElement(item.id)}
          />
        )}
      >
        {leftTab === 'outline' ? (
          <FormBuilderOutline
            elements={document.elements}
            selectedKey={state.selectedKey}
            onSelect={selectKey}
          />
        ) : undefined}
      </DesignerPalette>
    );

  const toolbar = (
    <>
      <Link
        id="service-request-form-builder-back"
        href={backHref}
        className="flex min-w-0 items-center gap-1.5 rounded px-1 py-1 text-sm text-[rgb(var(--color-text-700))] hover:text-[rgb(var(--color-text-900))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-400))]"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="max-w-[16rem] truncate">{definitionName}</span>
      </Link>
      <span className="h-5 w-px shrink-0 bg-[rgb(var(--color-border-200))]" />
      <Button
        id="service-request-form-builder-undo"
        variant="ghost"
        size="icon"
        tooltipText={t('formBuilder.toolbar.undo')}
        disabled={!canUndo(state)}
        onClick={() => setState(undo)}
      >
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button
        id="service-request-form-builder-redo"
        variant="ghost"
        size="icon"
        tooltipText={t('formBuilder.toolbar.redo')}
        disabled={!canRedo(state)}
        onClick={() => setState(redo)}
      >
        <Redo2 className="h-4 w-4" />
      </Button>
      <DesignerSaveStatus
        id="service-request-form-builder-save-status"
        i18nNamespace="msp/service-requests"
        state={getDesignerSaveState({
          hasDefinition: true,
          hasWorkflow: lastSavedAt !== null || !isDirty,
          isSaving,
          isDirty,
          lastSavedAt,
        })}
      />
      <span className="flex-1" />
      <div
        role="group"
        aria-label={t('formBuilder.toolbar.mode')}
        className="flex shrink-0 overflow-hidden rounded-md border border-[rgb(var(--color-border-200))]"
      >
        <button
          id="service-request-form-builder-mode-edit"
          type="button"
          aria-pressed={mode === 'edit'}
          onClick={() => setMode('edit')}
          className={modeButtonClass(mode === 'edit')}
        >
          {t('formBuilder.toolbar.edit')}
        </button>
        <button
          id="service-request-form-builder-mode-try"
          type="button"
          aria-pressed={mode === 'try'}
          onClick={enterTryIt}
          className={modeButtonClass(mode === 'try')}
        >
          {t('formBuilder.toolbar.tryIt')}
        </button>
      </div>
      <Button
        id="service-request-form-builder-preview-desktop"
        variant={previewWidth === 'desktop' ? 'soft' : 'ghost'}
        size="icon"
        tooltipText={t('formBuilder.toolbar.desktopWidth')}
        onClick={() => setPreviewWidth('desktop')}
      >
        <Monitor className="h-4 w-4" />
      </Button>
      <Button
        id="service-request-form-builder-preview-mobile"
        variant={previewWidth === 'mobile' ? 'soft' : 'ghost'}
        size="icon"
        tooltipText={t('formBuilder.toolbar.phoneWidth')}
        onClick={() => setPreviewWidth('mobile')}
      >
        <Smartphone className="h-4 w-4" />
      </Button>
      <Button
        id="service-request-form-builder-settings"
        variant={showFormSettings ? 'soft' : 'ghost'}
        size="icon"
        tooltipText={t('formBuilder.toolbar.formSettings')}
        onClick={() => setShowFormSettings((previous) => !previous)}
      >
        <Settings className="h-4 w-4" />
      </Button>
      <Button
        id="service-request-form-builder-publish"
        size="sm"
        className="shrink-0 whitespace-nowrap"
        disabled={isPublishing}
        onClick={() => void publish()}
      >
        {isPublishing ? t('editor.publishing') : t('editor.publish')}
      </Button>
    </>
  );

  const canvas =
    mode === 'try' ? (
      <div className="p-6">
        <div className="mx-auto mb-3 flex max-w-2xl items-center justify-between gap-2 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] px-3 py-2">
          <p className="text-xs text-[rgb(var(--color-text-600))]">
            {t('formBuilder.tryIt.banner')}
          </p>
          <div className="flex shrink-0 gap-1.5">
            <Button
              id="service-request-form-builder-try-check"
              variant="outline"
              size="sm"
              onClick={checkTryIt}
            >
              {t('formBuilder.tryIt.check')}
            </Button>
            <Button
              id="service-request-form-builder-try-reset"
              variant="ghost"
              size="sm"
              onClick={() => {
                setTryValues(buildTryItValues(document));
                setTryErrors({});
              }}
            >
              {t('formBuilder.tryIt.reset')}
            </Button>
          </div>
        </div>
        <ServiceRequestFormRenderer
          fields={document.elements}
          settings={document.settings}
          values={tryValues}
          onValueChange={(key, value) => {
            setTryValues((previous) => ({ ...previous, [key]: value }));
            setTryErrors((previous) => {
              if (!(key in previous)) return previous;
              const next = { ...previous };
              delete next[key];
              return next;
            });
          }}
          errors={tryErrors}
          visibleFieldKeys={tryVisibleKeys}
          labels={rendererLabels}
          idPrefix="service-request-form-try-field"
          previewWidth={previewWidth}
        />
      </div>
    ) : document.elements.length === 0 ? (
      <FormBuilderTemplateGallery
        templates={templates}
        onChoose={(template) => setState((previous) => replaceDocument(previous, template.build()))}
      />
    ) : (
      <FormBuilderCanvas
        elements={document.elements}
        settings={document.settings}
        selectedKey={state.selectedKey}
        onSelect={selectKey}
        onRenameLabel={(key, nextLabel) =>
          setState((previous) => updateElement(previous, key, { label: nextLabel }))
        }
        insertIndex={insertIndex}
        onInsertIndexChange={(index) => {
          setInsertIndex(index);
          if (index !== null) switchTab('add');
        }}
        previewWidth={previewWidth}
        renamingKey={renamingKey}
        onRenamingKeyChange={setRenamingKey}
        labels={rendererLabels}
      />
    );

  const inspector =
    mode === 'try' ? null : (
      <FormBuilderInspector
        element={selected}
        precedingElements={precedingElements}
        settings={document.settings}
        showFormSettings={showFormSettings}
        onChange={(patch, options) =>
          selected && setState((previous) => updateElement(previous, selected.key, patch, options))
        }
        onRenameKey={(nextKey) =>
          selected && setState((previous) => renameElementKey(previous, selected.key, nextKey))
        }
        onDuplicate={() =>
          selected && setState((previous) => duplicateElement(previous, selected.key))
        }
        onDelete={() => selected && setState((previous) => deleteElement(previous, selected.key))}
        onSettingsChange={(patch, options) =>
          setState((previous) => updateSettings(previous, patch, options))
        }
      />
    );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <DesignerShell
        idPrefix="service-request-form-builder"
        toolbar={toolbar}
        leftPane={leftPane}
        inspector={inspector}
        inspectorWidth={inspectorWidth}
        inspectorResizeLabel={t('formBuilder.inspector.resize')}
        onInspectorWidthChange={(width) => {
          setInspectorWidth(width);
          storeDesignerSidebarWidth(SIDEBAR_NAMESPACE, width);
        }}
      >
        {canvas}
      </DesignerShell>
    </DndContext>
  );
}

/** A palette tile that is both clickable and draggable onto an insert line. */
function PaletteTile({
  id,
  label,
  description,
  icon,
  onClick,
}: {
  id: FieldTypeKey;
  label: string;
  description: string;
  icon: string;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${id}`,
    data: { kind: 'palette' },
  });
  const Icon =
    (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[icon] ??
    Icons.Square;

  return (
    <DesignerPaletteTile
      item={{ id, label, description }}
      elementId={`service-request-form-builder-add-${id}`}
      icon={<Icon className="h-4 w-4" />}
      isDragging={isDragging}
      onClick={onClick}
      drag={{
        innerRef: setNodeRef,
        containerProps: attributes as unknown as Record<string, unknown>,
        handleProps: listeners as unknown as Record<string, unknown>,
      }}
    />
  );
}
