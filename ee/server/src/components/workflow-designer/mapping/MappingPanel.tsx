'use client';

/**
 * Mapping Panel - Composite Component for Visual Input Mapping
 *
 * Combines SourceDataTree and InputMappingEditor side by side
 * with integrated drag-and-drop and visual connection lines.
 *
 * §19 - Mapping Editor UX Enhancements
 */

import React, { useRef, useCallback, useMemo } from 'react';
import { SourceDataTree, type DataTreeContext, type DataField } from './SourceDataTree';
import { InputMappingEditor, type ActionInputField } from './InputMappingEditor';
import { useMappingDnd } from './useMappingDnd';
import { useMappingPositions } from './useMappingPositions';
import type { SelectOption } from '@/components/ui/CustomSelect';
import type { InputMapping } from '@shared/workflow/runtime';

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

  // §19.2 - Shared drag-and-drop state
  const [dndState, dndHandlers] = useMappingDnd({
    onCreateMapping: (targetFieldName, sourcePath) => {
      onChange({ ...value, [targetFieldName]: { $expr: sourcePath } });
    }
  });

  // §19.3 - Shared position tracking for connection lines
  const [positionsState, positionsHandlers] = useMappingPositions();

  // Register container ref
  React.useEffect(() => {
    positionsHandlers.setContainerRef(containerRef.current);
  }, [positionsHandlers]);

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

  // Build source positions map for InputMappingEditor
  const sourcePositions = useMemo(() => {
    const map = new Map<string, { centerY: number; right: number }>();
    positionsState.sourcePositions.forEach((rect, path) => {
      map.set(path, { centerY: rect.centerY, right: rect.right });
    });
    return map;
  }, [positionsState.sourcePositions]);

  return (
    <div ref={containerRef} className="relative">
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
            disabled={disabled}
            sourcePositions={sourcePositions}
          />
        </div>
      </div>
    </div>
  );
};

export default MappingPanel;
