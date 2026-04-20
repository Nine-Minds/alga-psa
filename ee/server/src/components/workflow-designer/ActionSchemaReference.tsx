'use client';

import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  Eye,
  EyeOff,
  FileJson,
  Info,
} from 'lucide-react';

import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import {
  extractSchemaFields,
  type ActionRegistryItem,
  type JsonSchema,
  type SchemaField,
} from './workflowDataContext';

const SchemaFieldRow: React.FC<{
  field: SchemaField;
  pathPrefix: string;
  depth?: number;
  onCopyPath?: (path: string) => void;
}> = ({ field, pathPrefix, depth = 0, onCopyPath }) => {
  const { t } = useTranslation('msp/workflows');
  const [expanded, setExpanded] = useState(depth < 2);
  const [copied, setCopied] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const hasChildren = field.children && field.children.length > 0;
  const fullPath = pathPrefix ? `${pathPrefix}.${field.name}` : field.name;

  const handleCopy = () => {
    const exprPath = `\${${fullPath}}`;
    navigator.clipboard.writeText(exprPath);
    setCopied(true);
    onCopyPath?.(exprPath);
    setTimeout(() => setCopied(false), 2000);
  };

  const typeColor = {
    string: 'text-green-600',
    number: 'text-blue-600',
    integer: 'text-blue-600',
    boolean: 'text-purple-600',
    object: 'text-orange-600',
    array: 'text-cyan-600'
  }[field.type] ?? 'text-gray-600';

  const hasConstraints = field.constraints && Object.keys(field.constraints).length > 0;
  const constraintLines: string[] = [];
  if (field.constraints) {
    if (field.constraints.enum) {
      const preview = field.constraints.enum.slice(0, 5).map(v => JSON.stringify(v)).join(', ');
      const suffix = field.constraints.enum.length > 5 ? '...' : '';
      constraintLines.push(t('schemaReference.constraints.values', {
        defaultValue: 'Values: {{list}}{{suffix}}',
        list: preview,
        suffix,
      }));
    }
    if (field.constraints.minimum !== undefined) {
      constraintLines.push(t('schemaReference.constraints.min', {
        defaultValue: 'Min: {{value}}',
        value: field.constraints.minimum,
      }));
    }
    if (field.constraints.maximum !== undefined) {
      constraintLines.push(t('schemaReference.constraints.max', {
        defaultValue: 'Max: {{value}}',
        value: field.constraints.maximum,
      }));
    }
    if (field.constraints.minLength !== undefined) {
      constraintLines.push(t('schemaReference.constraints.minLength', {
        defaultValue: 'Min length: {{value}}',
        value: field.constraints.minLength,
      }));
    }
    if (field.constraints.maxLength !== undefined) {
      constraintLines.push(t('schemaReference.constraints.maxLength', {
        defaultValue: 'Max length: {{value}}',
        value: field.constraints.maxLength,
      }));
    }
    if (field.constraints.pattern) {
      constraintLines.push(t('schemaReference.constraints.pattern', {
        defaultValue: 'Pattern: {{value}}',
        value: field.constraints.pattern,
      }));
    }
    if (field.constraints.format) {
      constraintLines.push(t('schemaReference.constraints.format', {
        defaultValue: 'Format: {{value}}',
        value: field.constraints.format,
      }));
    }
    if (field.constraints.examples) {
      constraintLines.push(t('schemaReference.constraints.examples', {
        defaultValue: 'Examples: {{list}}',
        list: field.constraints.examples.slice(0, 3).map(v => JSON.stringify(v)).join(', '),
      }));
    }
  }
  if (field.defaultValue !== undefined) {
    constraintLines.push(t('schemaReference.constraints.default', {
      defaultValue: 'Default: {{value}}',
      value: JSON.stringify(field.defaultValue),
    }));
  }

  return (
    <div className="text-xs">
      <div
        className={`flex items-center gap-1 py-1 px-1 rounded hover:bg-gray-50 group ${depth > 0 ? 'ml-3' : ''}`}
        style={{ paddingLeft: depth > 0 ? `${depth * 12}px` : undefined }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 hover:bg-gray-200 rounded"
          >
            {expanded ? (
              <ChevronDown className="w-3 h-3 text-gray-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-gray-500" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <span className="font-medium text-gray-800">{field.name}</span>
        {field.required && <span className="text-destructive">*</span>}
        <span
          className={`${typeColor} font-mono relative ${hasConstraints || field.defaultValue !== undefined ? 'cursor-help underline decoration-dotted' : ''}`}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {field.type}
          {showTooltip && constraintLines.length > 0 && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-gray-900 text-white text-[10px] px-2 py-1.5 rounded shadow-lg whitespace-nowrap">
              {constraintLines.map((line, index) => (
                <div key={`${field.name}-constraint-${index}`}>{line}</div>
              ))}
            </div>
          )}
        </span>
        {field.nullable && (
          <span className="text-gray-400">
            {t('schemaReference.nullableSuffix', { defaultValue: '| null' })}
          </span>
        )}

        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-200 rounded transition-opacity"
          title={t('schemaReference.copyPathTitle', {
            defaultValue: 'Copy {{path}}',
            path: fullPath,
          })}
        >
          {copied ? (
            <Check className="w-3 h-3 text-green-600" />
          ) : (
            <Copy className="w-3 h-3 text-gray-500" />
          )}
        </button>
      </div>

      {field.description && (
        <div className="text-gray-500 text-[10px] ml-6 pl-1" style={{ paddingLeft: depth > 0 ? `${depth * 12 + 12}px` : undefined }}>
          {field.description}
        </div>
      )}

      {hasChildren && expanded && (
        <div className="border-l border-gray-200 ml-2">
          {(field.children ?? []).map((child) => (
            <SchemaFieldRow
              key={child.name}
              field={child}
              pathPrefix={fullPath}
              depth={depth + 1}
              onCopyPath={onCopyPath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const SchemaReferenceSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  fields: SchemaField[];
  pathPrefix: string;
  defaultExpanded?: boolean;
  emptyMessage?: string;
  onCopyPath?: (path: string) => void;
  headerExtra?: React.ReactNode;
}> = ({ title, icon, fields, pathPrefix, defaultExpanded = false, emptyMessage, onCopyPath, headerExtra }) => {
  const { t } = useTranslation('msp/workflows');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copiedAll, setCopiedAll] = useState(false);
  const resolvedEmptyMessage = emptyMessage ?? t('schemaReference.noFields', { defaultValue: 'No fields' });

  const getAllPaths = (fieldList: SchemaField[], prefix: string): string[] => {
    const paths: string[] = [];
    for (const field of fieldList) {
      const fullPath = `\${${prefix}.${field.name}}`;
      paths.push(fullPath);
      if (field.children) {
        paths.push(...getAllPaths(field.children, `${prefix}.${field.name}`));
      }
    }
    return paths;
  };

  const handleCopyAllPaths = (event: React.MouseEvent) => {
    event.stopPropagation();
    const allPaths = getAllPaths(fields, pathPrefix);
    navigator.clipboard.writeText(allPaths.join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
    onCopyPath?.(t('schemaReference.pathsCopied', {
      defaultValue: '{{count}} paths copied',
      count: allPaths.length,
    }));
  };

  return (
    <div className="border border-gray-200 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        )}
        {icon}
        <span className="text-xs font-semibold text-gray-700">{title}</span>
        <Badge variant="default" className="ml-auto text-[10px] px-1.5 py-0">
          {fields.length}
        </Badge>
        {headerExtra}
      </button>

      {expanded && (
        <div className="px-2 py-2 bg-white dark:bg-[rgb(var(--color-card))] max-h-64 overflow-y-auto">
          {fields.length === 0 ? (
            <div className="text-xs text-gray-400 text-center py-2">{resolvedEmptyMessage}</div>
          ) : (
            <>
              <div className="flex justify-end mb-1">
                <button
                  type="button"
                  onClick={handleCopyAllPaths}
                  className="text-[10px] text-gray-500 hover:text-gray-700 flex items-center gap-1"
                  title={t('schemaReference.copyAllPathsTitle', { defaultValue: 'Copy all field paths' })}
                >
                  {copiedAll ? (
                    <>
                      <Check className="w-3 h-3 text-green-600" />
                      <span className="text-green-600">
                        {t('schemaReference.copied', { defaultValue: 'Copied!' })}
                      </span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>{t('schemaReference.copyAllPaths', { defaultValue: 'Copy all paths' })}</span>
                    </>
                  )}
                </button>
              </div>
              {fields.map((field) => (
                <SchemaFieldRow
                  key={field.name}
                  field={field}
                  pathPrefix={pathPrefix}
                  onCopyPath={onCopyPath}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export const ActionSchemaReference: React.FC<{
  action: ActionRegistryItem | undefined;
  saveAs?: string;
  outputSchemaOverride?: JsonSchema | null;
  onCopyPath?: (path: string) => void;
}> = ({ action, saveAs, outputSchemaOverride, onCopyPath }) => {
  const { t } = useTranslation('msp/workflows');
  const [showSchemaDetails, setShowSchemaDetails] = useState(false);
  const [showRawSchema, setShowRawSchema] = useState(false);

  useEffect(() => {
    if (!showSchemaDetails) {
      setShowRawSchema(false);
    }
  }, [showSchemaDetails]);

  if (!action) {
    return (
      <div className="text-xs text-gray-400 p-3 border border-dashed border-gray-200 rounded-md text-center">
        {t('schemaReference.selectAction', { defaultValue: 'Select an action to see its input/output schema' })}
      </div>
    );
  }

  const resolvedOutputSchema = outputSchemaOverride ?? action.outputSchema;
  const inputFields = extractSchemaFields(action.inputSchema, action.inputSchema);
  const outputFields = extractSchemaFields(resolvedOutputSchema, resolvedOutputSchema);

  return (
    <div className="space-y-3">
      {action.ui?.description && (
        <div className="text-xs text-gray-600 bg-blue-500/10 p-2 rounded-md flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
          <span>{action.ui.description}</span>
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          id={`workflow-step-schema-details-toggle-${action.id}`}
          type="button"
          onClick={() => setShowSchemaDetails((prev) => !prev)}
          className="text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          {showSchemaDetails ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {showSchemaDetails
            ? t('schemaReference.hideDetails', { defaultValue: 'Hide schema details' })
            : t('schemaReference.viewDetails', { defaultValue: 'View schema details' })}
        </button>
      </div>

      {showSchemaDetails && (
        <>
          <SchemaReferenceSection
            title={t('schemaReference.inputSchemaTitle', { defaultValue: 'Input Schema' })}
            icon={<Code className="w-3.5 h-3.5 text-gray-500" />}
            fields={inputFields}
            pathPrefix="input"
            defaultExpanded={false}
            emptyMessage={t('schemaReference.noInputParameters', { defaultValue: 'No input parameters' })}
            onCopyPath={onCopyPath}
          />

          <SchemaReferenceSection
            title={t('schemaReference.outputSchemaTitle', { defaultValue: 'Output Schema' })}
            icon={<FileJson className="w-3.5 h-3.5 text-gray-500" />}
            fields={outputFields}
            pathPrefix={saveAs ? `vars.${saveAs}` : 'output'}
            defaultExpanded={false}
            emptyMessage={t('schemaReference.noOutputFields', { defaultValue: 'No output fields' })}
            onCopyPath={onCopyPath}
            headerExtra={
              saveAs ? (
                <span className="text-[10px] text-gray-500 font-normal">
                  → vars.{saveAs}
                </span>
              ) : undefined
            }
          />

          {saveAs && (
            <div className="text-xs bg-success/10 border border-success/30 rounded-md p-2 flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-success" />
              <span className="text-success">
                {t('schemaReference.outputAvailablePrefix', { defaultValue: 'Output available at' })}{' '}
                <code className="bg-success/15 px-1 rounded">${`{vars.${saveAs}}`}</code>
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowRawSchema(!showRawSchema)}
              className="text-[10px] text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              {showRawSchema ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showRawSchema
                ? t('schemaReference.hideRawJson', { defaultValue: 'Hide raw JSON Schema' })
                : t('schemaReference.showRawJson', { defaultValue: 'Show raw JSON Schema' })}
            </button>

            <button
              type="button"
              onClick={() => {
                const schema = {
                  actionId: action.id,
                  version: action.version,
                  inputSchema: action.inputSchema,
                  outputSchema: resolvedOutputSchema
                };
                const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `${action.id}-schema.json`;
                anchor.click();
                URL.revokeObjectURL(url);
              }}
              className="text-[10px] text-blue-500 hover:text-blue-700 flex items-center gap-1"
              title={t('schemaReference.exportSchemaTitle', { defaultValue: 'Download schema as JSON file' })}
            >
              <FileJson className="w-3 h-3" />
              {t('schemaReference.exportSchema', { defaultValue: 'Export schema' })}
            </button>
          </div>

          {showRawSchema && (
            <div className="text-[10px] font-mono bg-gray-900 text-gray-100 p-2 rounded-md overflow-x-auto">
              <div className="text-gray-400 mb-1">{t('schemaReference.rawInputComment', { defaultValue: '// Input Schema' })}</div>
              <pre>{JSON.stringify(action.inputSchema, null, 2)}</pre>
              <div className="text-gray-400 mt-2 mb-1">{t('schemaReference.rawOutputComment', { defaultValue: '// Output Schema' })}</div>
              <pre>{JSON.stringify(resolvedOutputSchema, null, 2)}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
};
