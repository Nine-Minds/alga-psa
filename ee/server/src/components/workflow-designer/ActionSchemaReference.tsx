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
      constraintLines.push(`Values: ${field.constraints.enum.slice(0, 5).map(v => JSON.stringify(v)).join(', ')}${field.constraints.enum.length > 5 ? '...' : ''}`);
    }
    if (field.constraints.minimum !== undefined) constraintLines.push(`Min: ${field.constraints.minimum}`);
    if (field.constraints.maximum !== undefined) constraintLines.push(`Max: ${field.constraints.maximum}`);
    if (field.constraints.minLength !== undefined) constraintLines.push(`Min length: ${field.constraints.minLength}`);
    if (field.constraints.maxLength !== undefined) constraintLines.push(`Max length: ${field.constraints.maxLength}`);
    if (field.constraints.pattern) constraintLines.push(`Pattern: ${field.constraints.pattern}`);
    if (field.constraints.format) constraintLines.push(`Format: ${field.constraints.format}`);
    if (field.constraints.examples) constraintLines.push(`Examples: ${field.constraints.examples.slice(0, 3).map(v => JSON.stringify(v)).join(', ')}`);
  }
  if (field.defaultValue !== undefined) {
    constraintLines.push(`Default: ${JSON.stringify(field.defaultValue)}`);
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
        {field.nullable && <span className="text-gray-400">| null</span>}

        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-200 rounded transition-opacity"
          title={`Copy ${fullPath}`}
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
}> = ({ title, icon, fields, pathPrefix, defaultExpanded = false, emptyMessage = 'No fields', onCopyPath, headerExtra }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copiedAll, setCopiedAll] = useState(false);

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
    onCopyPath?.(`${allPaths.length} paths copied`);
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
            <div className="text-xs text-gray-400 text-center py-2">{emptyMessage}</div>
          ) : (
            <>
              <div className="flex justify-end mb-1">
                <button
                  type="button"
                  onClick={handleCopyAllPaths}
                  className="text-[10px] text-gray-500 hover:text-gray-700 flex items-center gap-1"
                  title="Copy all field paths"
                >
                  {copiedAll ? (
                    <>
                      <Check className="w-3 h-3 text-green-600" />
                      <span className="text-green-600">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy all paths</span>
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
        Select an action to see its input/output schema
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
          {showSchemaDetails ? 'Hide schema details' : 'View schema details'}
        </button>
      </div>

      {showSchemaDetails && (
        <>
          <SchemaReferenceSection
            title="Input Schema"
            icon={<Code className="w-3.5 h-3.5 text-gray-500" />}
            fields={inputFields}
            pathPrefix="input"
            defaultExpanded={false}
            emptyMessage="No input parameters"
            onCopyPath={onCopyPath}
          />

          <SchemaReferenceSection
            title="Output Schema"
            icon={<FileJson className="w-3.5 h-3.5 text-gray-500" />}
            fields={outputFields}
            pathPrefix={saveAs ? `vars.${saveAs}` : 'output'}
            defaultExpanded={false}
            emptyMessage="No output fields"
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
                Output available at <code className="bg-success/15 px-1 rounded">${`{vars.${saveAs}}`}</code>
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
              {showRawSchema ? 'Hide' : 'Show'} raw JSON Schema
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
              title="Download schema as JSON file"
            >
              <FileJson className="w-3 h-3" />
              Export schema
            </button>
          </div>

          {showRawSchema && (
            <div className="text-[10px] font-mono bg-gray-900 text-gray-100 p-2 rounded-md overflow-x-auto">
              <div className="text-gray-400 mb-1">{'// Input Schema'}</div>
              <pre>{JSON.stringify(action.inputSchema, null, 2)}</pre>
              <div className="text-gray-400 mt-2 mb-1">{'// Output Schema'}</div>
              <pre>{JSON.stringify(resolvedOutputSchema, null, 2)}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
};
