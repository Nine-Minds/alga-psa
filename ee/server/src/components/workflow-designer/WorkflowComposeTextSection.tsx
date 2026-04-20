'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Card } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import { type DataField, type DataTreeContext } from './mapping/SourceDataTree';
import { WorkflowComposeTextDocumentEditor, type WorkflowComposeTextDocumentEditorHandle } from './WorkflowComposeTextDocumentEditor';
import {
  buildComposeTextReferencePath,
  coerceComposeTextOutputs,
  createComposeTextOutput,
  isValidComposeTextStableKey,
  validateComposeTextOutputs,
} from './workflowComposeTextUtils';
import type { DataContext } from './workflowDataContext';
import type { ComposeTextOutput } from '@alga-psa/workflows/authoring';
import {
  ReferenceScopeSelector,
  buildReferenceSourceModel,
  type ReferenceSourceScope,
} from './workflowReferenceSelector';

type WorkflowComposeTextSectionProps = {
  stepId: string;
  config?: Record<string, unknown>;
  saveAs?: string;
  dataContext: DataContext;
  disabled?: boolean;
  onChange: (patch: {
    version: 1;
    outputs: ComposeTextOutput[];
  }) => void;
};

const convertSchemaFieldToDataField = (
  field: DataContext['payload'][number],
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
  ),
});

const buildDataTreeContext = (dataContext: DataContext): DataTreeContext => ({
  payload: dataContext.payload.map((field) =>
    convertSchemaFieldToDataField(field, 'payload', 'payload')
  ),
  vars: dataContext.steps.map((stepOutput) => ({
    stepId: stepOutput.stepId,
    stepName: stepOutput.stepName,
    saveAs: stepOutput.saveAs,
    fields: stepOutput.fields.map((field) =>
      convertSchemaFieldToDataField(field, `vars.${stepOutput.saveAs}`, 'vars')
    ),
  })),
  meta: dataContext.globals.meta.map((field) =>
    convertSchemaFieldToDataField(field, 'meta', 'meta')
  ),
  error: dataContext.inCatchBlock
    ? dataContext.globals.error.map((field) =>
        convertSchemaFieldToDataField(field, 'error', 'error')
      )
    : [],
  forEach: dataContext.forEach,
});

const getReferenceLabel = (path: string): string => {
  const parts = path.split('.');
  const last = parts[parts.length - 1];
  return last && last !== 'vars' ? last.replace(/\[\]$/u, '') : path;
};

const findOutputErrors = (
  outputId: string,
  errors: ReturnType<typeof validateComposeTextOutputs>
) => ({
  label: errors.filter((error) => error.outputId === outputId && error.field === 'label'),
  stableKey: errors.filter((error) => error.outputId === outputId && error.field === 'stableKey'),
  document: errors.filter((error) => error.outputId === outputId && error.field === 'document'),
});

export const WorkflowComposeTextSection: React.FC<WorkflowComposeTextSectionProps> = ({
  stepId,
  config,
  saveAs,
  dataContext,
  disabled = false,
  onChange,
}) => {
  const { t } = useTranslation('msp/workflows');
  const outputs = useMemo(
    () => coerceComposeTextOutputs(config?.outputs),
    [config]
  );
  const [selectedOutputId, setSelectedOutputId] = useState<string | null>(outputs[0]?.id ?? null);
  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const [selectedReferenceScope, setSelectedReferenceScope] = useState<ReferenceSourceScope | ''>('');
  const [selectedReferenceStep, setSelectedReferenceStep] = useState('');
  const [selectedReferenceField, setSelectedReferenceField] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [insertError, setInsertError] = useState<string | null>(null);
  const editorRef = useRef<WorkflowComposeTextDocumentEditorHandle | null>(null);

  useEffect(() => {
    if (outputs.length === 0) {
      onChange({
        version: 1,
        outputs: [
          createComposeTextOutput('Text', [], uuidv4),
        ],
      });
      return;
    }

    if (!selectedOutputId || !outputs.some((output) => output.id === selectedOutputId)) {
      setSelectedOutputId(outputs[0]?.id ?? null);
    }
  }, [onChange, outputs, selectedOutputId]);

  const selectedOutput = outputs.find((output) => output.id === selectedOutputId) ?? outputs[0] ?? null;
  const validationErrors = useMemo(() => validateComposeTextOutputs(outputs), [outputs]);
  const selectedOutputErrors = selectedOutput
    ? findOutputErrors(selectedOutput.id, validationErrors)
    : { label: [], stableKey: [], document: [] };
  const referenceTreeContext = useMemo(() => buildDataTreeContext(dataContext), [dataContext]);
  const referenceSourceModel = useMemo(
    () => buildReferenceSourceModel(referenceTreeContext, [], dataContext.payloadSchema ?? undefined),
    [dataContext.payloadSchema, referenceTreeContext]
  );

  const resetReferenceSelection = useCallback(() => {
    setSelectedReferenceScope('');
    setSelectedReferenceStep('');
    setSelectedReferenceField(null);
  }, []);

  const emitOutputsChange = useCallback((nextOutputs: ComposeTextOutput[]) => {
    onChange({
      version: 1,
      outputs: nextOutputs,
    });
  }, [onChange]);

  const updateOutput = useCallback((outputId: string, updater: (output: ComposeTextOutput) => ComposeTextOutput) => {
    emitOutputsChange(outputs.map((output) => output.id === outputId ? updater(output) : output));
  }, [emitOutputsChange, outputs]);

  const addOutput = useCallback(() => {
    const nextLabel = `Output ${outputs.length + 1}`;
    const nextOutput = createComposeTextOutput(
      nextLabel,
      outputs.map((output) => output.stableKey),
      uuidv4
    );
    const nextOutputs = [...outputs, nextOutput];
    emitOutputsChange(nextOutputs);
    setSelectedOutputId(nextOutput.id);
  }, [emitOutputsChange, outputs]);

  const removeOutput = useCallback((outputId: string) => {
    if (outputs.length <= 1) {
      return;
    }
    const nextOutputs = outputs.filter((output) => output.id !== outputId);
    emitOutputsChange(nextOutputs);
    if (selectedOutputId === outputId) {
      setSelectedOutputId(nextOutputs[0]?.id ?? null);
    }
  }, [emitOutputsChange, outputs, selectedOutputId]);

  const moveOutput = useCallback((outputId: string, direction: -1 | 1) => {
    const currentIndex = outputs.findIndex((output) => output.id === outputId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= outputs.length) {
      return;
    }

    const nextOutputs = [...outputs];
    const [moved] = nextOutputs.splice(currentIndex, 1);
    nextOutputs.splice(nextIndex, 0, moved);
    emitOutputsChange(nextOutputs);
  }, [emitOutputsChange, outputs]);

  const handleCopyReferencePath = useCallback(async (stableKey: string) => {
    const path = buildComposeTextReferencePath(saveAs, stableKey);
    if (!path) {
      return;
    }

    await navigator.clipboard.writeText(path);
    setCopyFeedback(path);
    window.setTimeout(() => setCopyFeedback((current) => current === path ? null : current), 1500);
  }, [saveAs]);

  const handleReferenceSelect = useCallback((path: string) => {
    setSelectedReferenceField(path);
    const inserted = editorRef.current?.insertReference({
      path,
      label: getReferenceLabel(path),
    });

    if (inserted) {
      setInsertError(null);
      setShowReferencePicker(false);
      resetReferenceSelection();
      return;
    }

    setInsertError(t('composeText.errors.noCodeBlock', {
      defaultValue: 'References cannot be inserted inside code blocks. Move the cursor to another block and try again.',
    }));
  }, [resetReferenceSelection]);

  const handleReferencePickerToggle = useCallback(() => {
    setInsertError(null);
    setShowReferencePicker((current) => {
      const next = !current;
      if (next) {
        resetReferenceSelection();
      }
      return next;
    });
  }, [resetReferenceSelection]);

  const handleReferenceScopeChange = useCallback((scope: ReferenceSourceScope | '') => {
    setSelectedReferenceScope(scope);
    setSelectedReferenceStep('');
    setSelectedReferenceField(null);
  }, []);

  const handleReferenceStepChange = useCallback((step: string) => {
    setSelectedReferenceStep(step);
    setSelectedReferenceField(null);
  }, []);

  return (
    <div
      id={`workflow-step-compose-text-${stepId}`}
      className="mt-4 space-y-4 rounded-md border border-gray-200 bg-gray-50/60 p-4"
    >
      <div className="flex flex-col items-start gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-800">
            {t('composeText.heading', { defaultValue: 'Compose text outputs' })}
          </div>
          <p className="text-xs text-gray-500">
            {t('composeText.headingDescription', {
              defaultValue: 'Create one or more markdown outputs with stable downstream reference keys.',
            })}
          </p>
        </div>
        <Button
          id={`${stepId}-compose-text-add-output`}
          type="button"
          size="sm"
          disabled={disabled}
          onClick={addOutput}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('composeText.addOutput', { defaultValue: 'Add output' })}
        </Button>
      </div>

      <div className="space-y-4">
        <Card className="space-y-2 border border-gray-200 bg-white p-3">
          {outputs.map((output, index) => {
            const outputErrors = findOutputErrors(output.id, validationErrors);
            const isSelected = selectedOutput?.id === output.id;
            return (
              <div
                key={output.id}
                role="button"
                tabIndex={0}
                className={`w-full rounded-md border px-3 py-2 text-left transition ${
                  isSelected
                    ? 'border-primary-300 bg-primary-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
                onClick={() => setSelectedOutputId(output.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedOutputId(output.id);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-gray-800">
                      {output.label.trim() || t('composeText.untitled', { defaultValue: 'Untitled output' })}
                    </div>
                    <div className="truncate font-mono text-[11px] text-gray-500">
                      {output.stableKey || 'stable_key'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={t('composeText.moveUpAria', {
                        defaultValue: 'Move {{label}} up',
                        label: output.label || t('composeText.outputFallback', { defaultValue: 'output {{index}}', index: index + 1 }),
                      })}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100"
                      disabled={disabled || index === 0}
                      onClick={(event) => {
                        event.stopPropagation();
                        moveOutput(output.id, -1);
                      }}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('composeText.moveDownAria', {
                        defaultValue: 'Move {{label}} down',
                        label: output.label || t('composeText.outputFallback', { defaultValue: 'output {{index}}', index: index + 1 }),
                      })}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100"
                      disabled={disabled || index === outputs.length - 1}
                      onClick={(event) => {
                        event.stopPropagation();
                        moveOutput(output.id, 1);
                      }}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('composeText.deleteAria', {
                        defaultValue: 'Delete {{label}}',
                        label: output.label || t('composeText.outputFallback', { defaultValue: 'output {{index}}', index: index + 1 }),
                      })}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100"
                      disabled={disabled || outputs.length === 1}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeOutput(output.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {(outputErrors.label.length > 0 || outputErrors.stableKey.length > 0) && (
                  <div className="mt-2 space-y-1 text-[11px] text-red-600">
                    {[...outputErrors.label, ...outputErrors.stableKey].map((error, errorIndex) => (
                      <div key={`${output.id}-error-${errorIndex}`}>{error.message}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </Card>

        {selectedOutput && (
          <div className="space-y-4">
            <div className="space-y-4">
              <Input
                id={`${stepId}-compose-text-label`}
                label={t('composeText.outputLabel', { defaultValue: 'Output label' })}
                value={selectedOutput.label}
                disabled={disabled}
                onChange={(event) => {
                  const nextLabel = event.target.value;
                  updateOutput(selectedOutput.id, (output) => ({
                    ...output,
                    label: nextLabel,
                  }));
                }}
              />

              <div className="space-y-1">
                <Input
                  id={`${stepId}-compose-text-stable-key`}
                  label={t('composeText.stableKeyLabel', { defaultValue: 'Stable key' })}
                  value={selectedOutput.stableKey}
                  disabled={disabled}
                  onChange={(event) => {
                    const nextStableKey = event.target.value;
                    updateOutput(selectedOutput.id, (output) => ({
                      ...output,
                      stableKey: nextStableKey,
                    }));
                  }}
                />
                <div className="flex flex-col items-start gap-2 text-xs text-gray-500">
                  <span>
                    {isValidComposeTextStableKey(selectedOutput.stableKey)
                      ? t('composeText.keyHintSafe', { defaultValue: 'Downstream-safe key' })
                      : t('composeText.keyHintInvalid', { defaultValue: 'Use lowercase letters, numbers, and underscores only.' })}
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium text-primary-700 hover:text-primary-800"
                    disabled={disabled}
                    onClick={() => {
                      updateOutput(selectedOutput.id, (output) => ({
                        ...output,
                        stableKey: createComposeTextOutput(
                          output.label || 'Output',
                          outputs
                            .filter((candidate) => candidate.id !== output.id)
                            .map((candidate) => candidate.stableKey),
                          () => output.id
                        ).stableKey,
                      }));
                    }}
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    {t('composeText.regenerate', { defaultValue: 'Regenerate' })}
                  </button>
                </div>
              </div>
            </div>

            {(selectedOutputErrors.label.length > 0 || selectedOutputErrors.stableKey.length > 0) && (
              <Card className="border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <div className="font-semibold">{t('composeText.validationHeading', { defaultValue: 'Validation' })}</div>
                <ul className="mt-1 space-y-1">
                  {[...selectedOutputErrors.label, ...selectedOutputErrors.stableKey].map((error, index) => (
                    <li key={`${selectedOutput.id}-selected-error-${index}`}>{error.message}</li>
                  ))}
                </ul>
              </Card>
            )}

            <Card className="border border-gray-200 bg-white p-3">
              <div className="flex flex-col items-start gap-3">
                <div>
                  <div className="text-xs font-semibold text-gray-700">
                    {t('composeText.downstreamPathLabel', { defaultValue: 'Downstream reference path' })}
                  </div>
                  <div className="font-mono text-xs text-gray-600">
                    {buildComposeTextReferencePath(saveAs, selectedOutput.stableKey) ?? t('composeText.pathFallback', {
                      defaultValue: 'Save output to see a reference path.',
                    })}
                  </div>
                </div>
                <Button
                  id={`${stepId}-compose-text-copy-path`}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled || !buildComposeTextReferencePath(saveAs, selectedOutput.stableKey)}
                  onClick={() => void handleCopyReferencePath(selectedOutput.stableKey)}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  {copyFeedback === buildComposeTextReferencePath(saveAs, selectedOutput.stableKey)
                    ? t('composeText.copied', { defaultValue: 'Copied' })
                    : t('composeText.copyPath', { defaultValue: 'Copy path' })}
                </Button>
              </div>
            </Card>

            <Card className="space-y-3 border border-gray-200 bg-white p-3">
              <div className="flex flex-col items-start gap-3">
                <div>
                  <div className="text-xs font-semibold text-gray-700">
                    {t('composeText.contentHeading', { defaultValue: 'Compose content' })}
                  </div>
                  <p className="text-xs text-gray-500">
                    {t('composeText.contentDescription', {
                      defaultValue: 'Use markdown-safe formatting and inline workflow reference chips.',
                    })}
                  </p>
                </div>
                <Button
                  id={`${stepId}-compose-text-insert-reference`}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={handleReferencePickerToggle}
                >
                  {t('composeText.insertReference', { defaultValue: 'Insert reference' })}
                </Button>
              </div>

              {showReferencePicker && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <div className="mb-2 text-xs font-semibold text-gray-700">
                    {t('composeText.insertReferenceHeading', { defaultValue: 'Insert workflow reference' })}
                  </div>
                  <ReferenceScopeSelector
                    idPrefix={`${stepId}-compose-text`}
                    model={referenceSourceModel}
                    targetType={undefined}
                    selectedScope={selectedReferenceScope}
                    selectedStep={selectedReferenceStep}
                    selectedField={selectedReferenceField}
                    disabled={disabled}
                    onScopeChange={handleReferenceScopeChange}
                    onStepChange={handleReferenceStepChange}
                    onFieldChange={handleReferenceSelect}
                  />
                </div>
              )}

              {insertError && (
                <div className="text-xs text-red-600">{insertError}</div>
              )}

              <WorkflowComposeTextDocumentEditor
                key={selectedOutput.id}
                ref={editorRef}
                value={selectedOutput.document}
                disabled={disabled}
                onChange={(document) => {
                  updateOutput(selectedOutput.id, (output) => ({
                    ...output,
                    document,
                  }));
                }}
              />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};
