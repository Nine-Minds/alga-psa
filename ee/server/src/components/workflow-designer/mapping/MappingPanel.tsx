'use client';

/**
 * Mapping Panel - Composite Component for Visual Input Mapping
 *
 * Combines SourceDataTree and InputMappingEditor side by side
 * with integrated drag-and-drop and visual connection lines.
 *
 * §19 - Mapping Editor UX Enhancements
 */

import React, { useRef, useCallback, useMemo, useState, useEffect } from 'react';
import { SourceDataTree, type DataTreeContext, type DataField } from './SourceDataTree';
import { InputMappingEditor, type ActionInputField } from './InputMappingEditor';
import { useMappingDnd } from './useMappingDnd';
import { useMappingPositions } from './useMappingPositions';
import { MappingConnectionsOverlay, type ConnectionData } from './MappingConnectionsOverlay';
import { TypeCompatibility, getTypeCompatibility } from './typeCompatibility';
import type { SelectOption } from '@/components/ui/CustomSelect';
import type { Expr, InputMapping } from '@shared/workflow/runtime';

/**
 * Schema field type from WorkflowDesigner's DataContext
 */
type SchemaField = {
  name: string;
  type: string;
  required: boolean;
  nullable: boolean;
  description?: string;
  defaultValue?: unknown;
  children?: SchemaField[];
  constraints?: {
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
    examples?: unknown[];
  };
};

type StepOutputContext = {
  stepId: string;
  stepName: string;
  saveAs: string;
  outputSchema: unknown;
  fields: SchemaField[];
};

/**
 * WorkflowDesigner's DataContext type
 */
export interface WorkflowDataContext {
  payload: SchemaField[];
  payloadSchema: unknown;
  steps: StepOutputContext[];
  globals: {
    env: SchemaField[];
    secrets: SchemaField[];
    meta: SchemaField[];
    error: SchemaField[];
  };
  forEach?: {
    itemVar: string;
    indexVar: string;
    itemType?: string;
  };
  inCatchBlock?: boolean;
}

/**
 * Convert SchemaField to DataField for SourceDataTree
 */
const convertSchemaFieldToDataField = (
  field: SchemaField,
  basePath: string,
  source: DataField['source']
): DataField => ({
  name: field.name,
  path: basePath ? `${basePath}.${field.name}` : field.name,
  type: field.type,
  description: field.description,
  required: field.required,
  nullable: field.nullable,
  source,
  children: field.children?.map(child =>
    convertSchemaFieldToDataField(child, basePath ? `${basePath}.${field.name}` : field.name, source)
  )
});

/**
 * Convert WorkflowDataContext to DataTreeContext for SourceDataTree
 */
const convertToDataTreeContext = (ctx: WorkflowDataContext): DataTreeContext => ({
  payload: ctx.payload.map(field =>
    convertSchemaFieldToDataField(field, 'payload', 'payload')
  ),
  vars: ctx.steps.map(stepOutput => ({
    stepId: stepOutput.stepId,
    stepName: stepOutput.stepName,
    saveAs: stepOutput.saveAs,
    fields: stepOutput.fields.map(field =>
      convertSchemaFieldToDataField(field, `vars.${stepOutput.saveAs}`, 'vars')
    )
  })),
  meta: ctx.globals.meta.map(field =>
    convertSchemaFieldToDataField(field, 'meta', 'meta')
  ),
  error: ctx.globals.error.map(field =>
    convertSchemaFieldToDataField(field, 'error', 'error')
  ),
  forEach: ctx.forEach
});

const buildSourceTypeLookup = (ctx: WorkflowDataContext): Map<string, string> => {
  const map = new Map<string, string>();

  const addField = (field: SchemaField, basePath: string) => {
    const path = basePath ? `${basePath}.${field.name}` : field.name;
    if (field.type) {
      map.set(path, field.type);
    }
    field.children?.forEach(child => addField(child, path));
  };

  ctx.payload.forEach(field => addField(field, 'payload'));
  ctx.steps.forEach(stepOutput => {
    const basePath = `vars.${stepOutput.saveAs}`;
    stepOutput.fields.forEach(field => addField(field, basePath));
  });
  ctx.globals.meta.forEach(field => addField(field, 'meta'));
  ctx.globals.error.forEach(field => addField(field, 'error'));
  if (ctx.forEach?.itemVar) {
    map.set(ctx.forEach.itemVar, ctx.forEach.itemType ?? 'any');
  }
  if (ctx.forEach?.indexVar) {
    map.set(ctx.forEach.indexVar, 'number');
  }

  return map;
};

export interface MappingPanelProps {
  /**
   * Current input mapping value
   */
  value: InputMapping;

  /**
   * Callback when mapping changes
   */
  onChange: (mapping: InputMapping) => void;

  /**
   * Action input schema fields to map to
   */
  targetFields: ActionInputField[];

  /**
   * Available data context from WorkflowDesigner
   */
  dataContext: WorkflowDataContext;

  /**
   * Available data context options for expressions (for dropdown fallback)
   */
  fieldOptions: SelectOption[];

  /**
   * Step ID for unique element IDs
   */
  stepId: string;

  /**
   * Whether the panel is disabled
   */
  disabled?: boolean;

  /**
   * Maximum height for the source tree
   */
  sourceTreeMaxHeight?: string;
}

/**
 * MappingPanel component
 *
 * Provides a two-column layout with:
 * - Left: SourceDataTree for browsing available data
 * - Right: InputMappingEditor for configuring mappings
 *
 * Enables drag-and-drop from source fields to target fields
 * with visual connection lines and type compatibility indicators.
 */
export const MappingPanel: React.FC<MappingPanelProps> = ({
  value,
  onChange,
  targetFields,
  dataContext,
  fieldOptions,
  stepId,
  disabled,
  sourceTreeMaxHeight = '400px'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Convert WorkflowDataContext to DataTreeContext
  const treeContext = useMemo(
    () => convertToDataTreeContext(dataContext),
    [dataContext]
  );
  const sourceTypeMap = useMemo(() => buildSourceTypeLookup(dataContext), [dataContext]);

  // §19.2 - Shared drag-and-drop state
  const [dndState, dndHandlers] = useMappingDnd({
    onCreateMapping: (targetFieldName, sourcePath) => {
      onChange({ ...value, [targetFieldName]: { $expr: sourcePath } });
    }
  });

  // §19.3 - Shared position tracking for connection lines
  const [positionsState, positionsHandlers] = useMappingPositions();
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);

  // Register container ref
  React.useEffect(() => {
    positionsHandlers.setContainerRef(containerRef.current);
  }, [positionsHandlers.setContainerRef]);

  useEffect(() => {
    positionsHandlers.recalculatePositions();
  }, [value, positionsHandlers.recalculatePositions]);

  // Handle field selection from source tree (click to insert)
  const handleSelectField = useCallback((path: string) => {
    // Could be used to insert into a focused expression field
    // For now, just log or show selection
    console.log('Selected field:', path);
  }, []);

  // Get target type for compatibility highlighting based on current drop target
  const activeTargetType = useMemo(() => {
    if (!dndState.dropTarget) return undefined;
    const field = targetFields.find(f => f.name === dndState.dropTarget);
    return field?.type;
  }, [dndState.dropTarget, targetFields]);

  const connections: ConnectionData[] = useMemo(() => {
    const result: ConnectionData[] = [];

    for (const [fieldName, mappingValue] of Object.entries(value)) {
      if (typeof mappingValue !== 'object' || !mappingValue || !('$expr' in mappingValue)) {
        continue;
      }

      const expr = (mappingValue as Expr).$expr;
      if (!expr) continue;

      const sourcePath = expr.trim().split(/[\s+\-*/()[\]{}]+/)[0];
      if (!sourcePath) continue;

      const field = targetFields.find(f => f.name === fieldName);
      const sourceType = sourceTypeMap.get(sourcePath);
      const targetType = field?.type;
      const compatibility = getTypeCompatibility(sourceType, targetType);
      const sourceRect = positionsState.sourcePositions.get(sourcePath) || null;
      const targetRect = positionsState.targetPositions.get(fieldName) || null;

      result.push({
        id: `${sourcePath}->${fieldName}`,
        sourceId: sourcePath,
        targetId: fieldName,
        sourceRect,
        targetRect,
        sourceType,
        targetType,
        compatibility
      });
    }

    return result;
  }, [value, targetFields, positionsState.sourcePositions, positionsState.targetPositions]);

  const handleConnectionClick = useCallback((connectionId: string) => {
    setSelectedConnectionId(prev => (prev === connectionId ? null : connectionId));
  }, []);

  const handleConnectionDelete = useCallback((connectionId: string) => {
    const targetField = connectionId.split('->')[1];
    if (!targetField) return;
    const next = { ...value };
    delete next[targetField];
    onChange(next);
    setSelectedConnectionId(null);
  }, [onChange, value]);

  return (
    <div
      ref={containerRef}
      className="relative"
      data-automation-id={`mapping-panel-${stepId}`}
    >
      {positionsState.containerRect && connections.length > 0 && (
        <MappingConnectionsOverlay
          connections={connections}
          width={positionsState.containerRect.width}
          height={positionsState.containerRect.height}
          selectedConnectionId={selectedConnectionId}
          onConnectionClick={handleConnectionClick}
          onConnectionDelete={handleConnectionDelete}
          interactive={!disabled}
          disabled={disabled}
        />
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left panel: Source Data Tree */}
        <div className="min-w-0">
          <SourceDataTree
            context={treeContext}
            onSelectField={handleSelectField}
            disabled={disabled}
            maxHeight={sourceTreeMaxHeight}
            targetType={activeTargetType}
            dndHandlers={dndHandlers}
            onRegisterRef={positionsHandlers.registerSourceRef}
            onRegisterScrollContainer={positionsHandlers.registerScrollContainer}
            onUnregisterScrollContainer={positionsHandlers.unregisterScrollContainer}
          />
        </div>

        {/* Right panel: Input Mapping Editor */}
        <div className="min-w-0">
          <InputMappingEditor
            value={value}
            onChange={onChange}
            targetFields={targetFields}
            fieldOptions={fieldOptions}
            stepId={stepId}
            positionsHandlers={positionsHandlers}
            sourceTypeMap={sourceTypeMap}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
};

export default MappingPanel;
