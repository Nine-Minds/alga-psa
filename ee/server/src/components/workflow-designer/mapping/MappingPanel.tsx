'use client';

/**
 * Mapping Panel - Composite Component for Visual Input Mapping
 *
 * Provides the full-width input editor for workflow mappings while
 * passing grouped source data for per-field browse interactions.
 *
 * §19 - Mapping Editor UX Enhancements
 */

import React, { useMemo } from 'react';
import { type DataTreeContext, type DataField } from './SourceDataTree';
import { InputMappingEditor, type ActionInputField } from './InputMappingEditor';
import type { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import type { InputMapping } from '@alga-psa/workflows/runtime';
import type { ExpressionContext } from '../expression-editor';
import {
  buildWorkflowReferenceExpressionContext,
  buildWorkflowReferenceSourceTypeLookup,
} from '../workflowReferenceContext';

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
  children: field.children?.map((child) =>
    convertSchemaFieldToDataField(
      child,
      basePath ? `${basePath}.${field.name}` : field.name,
      source
    )
  )
});

const convertToDataTreeContext = (
  ctx: WorkflowDataContext,
  payloadRootPath: string
): DataTreeContext => ({
  payload: ctx.payload.map((field) =>
    convertSchemaFieldToDataField(field, payloadRootPath, 'payload')
  ),
  vars: ctx.steps.map((stepOutput) => ({
    stepId: stepOutput.stepId,
    stepName: stepOutput.stepName,
    saveAs: stepOutput.saveAs,
    fields: stepOutput.fields.map((field) =>
      convertSchemaFieldToDataField(field, `vars.${stepOutput.saveAs}`, 'vars')
    )
  })),
  meta: ctx.globals.meta.map((field) =>
    convertSchemaFieldToDataField(field, 'meta', 'meta')
  ),
  error: ctx.inCatchBlock
    ? ctx.globals.error.map((field) =>
        convertSchemaFieldToDataField(field, 'error', 'error')
      )
    : [],
  forEach: ctx.forEach
});

export interface MappingPanelProps {
  value: InputMapping;
  onChange: (mapping: InputMapping) => void;
  targetFields: ActionInputField[];
  dataContext: WorkflowDataContext;
  fieldOptions: SelectOption[];
  stepId: string;
  disabled?: boolean;
  payloadRootPath?: string;
  expressionContextOverride?: ExpressionContext;
}

export const MappingPanel: React.FC<MappingPanelProps> = ({
  value,
  onChange,
  targetFields,
  dataContext,
  fieldOptions,
  stepId,
  disabled,
  payloadRootPath = 'payload',
  expressionContextOverride
}) => {
  const treeContext = useMemo(
    () => convertToDataTreeContext(dataContext, payloadRootPath),
    [dataContext, payloadRootPath]
  );
  const sourceTypeMap = useMemo(
    () => buildWorkflowReferenceSourceTypeLookup(dataContext, payloadRootPath),
    [dataContext, payloadRootPath]
  );

  const expressionContext = useMemo(() => {
    const ctx =
      expressionContextOverride ?? buildWorkflowReferenceExpressionContext(dataContext);
    console.log('[MappingPanel] Built expressionContext:', {
      hasPayloadSchema: !!ctx.payloadSchema,
      payloadSchemaType: ctx.payloadSchema?.type,
      payloadSchemaProps: ctx.payloadSchema?.properties
        ? Object.keys(ctx.payloadSchema.properties)
        : null,
      dataContextHasPayloadSchema: !!dataContext.payloadSchema,
    });
    return ctx;
  }, [dataContext, expressionContextOverride]);

  return (
    <div className="relative" data-automation-id={`mapping-panel-${stepId}`}>
      <InputMappingEditor
        value={value}
        onChange={onChange}
        targetFields={targetFields}
        fieldOptions={fieldOptions}
        stepId={stepId}
        sourceTypeMap={sourceTypeMap}
        disabled={disabled}
        expressionContext={expressionContext}
        referenceBrowseContext={treeContext}
      />
    </div>
  );
};

export default MappingPanel;
