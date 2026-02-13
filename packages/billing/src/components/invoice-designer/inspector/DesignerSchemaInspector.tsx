import React, { useCallback, useMemo } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { getComponentSchema } from '../schema/componentSchema';
import type { DesignerNode } from '../state/designerStore';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerInspectorField, DesignerInspectorPanel } from '../schema/inspectorSchema';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIntegerKey = (key: string): boolean => key !== '' && String(Number.parseInt(key, 10)) === key;

const getIn = (value: unknown, path: string[]): unknown => {
  if (path.length === 0) return value;
  const [head, ...tail] = path;
  if (isIntegerKey(head)) {
    const index = Number.parseInt(head, 10);
    if (!Array.isArray(value)) return undefined;
    return getIn(value[index], tail);
  }
  if (!isPlainObject(value)) return undefined;
  return getIn(value[head], tail);
};

const splitDotPath = (path: string): string[] => path.split('.').map((segment) => segment.trim()).filter(Boolean);

type Props = {
  node: DesignerNode;
};

export const DesignerSchemaInspector: React.FC<Props> = ({ node }) => {
  const setNodeProp = useInvoiceDesignerStore((state) => state.setNodeProp);
  const unsetNodeProp = useInvoiceDesignerStore((state) => state.unsetNodeProp);

  const schema = useMemo(() => getComponentSchema(node.type), [node.type]);
  const panels = schema.inspector?.panels ?? [];

  const resolveValue = useCallback(
    (field: DesignerInspectorField): unknown => getIn(node, splitDotPath(field.path)),
    [node]
  );

  const applyStringLike = useCallback(
    (path: string, raw: string, commit: boolean) => {
      const next = raw;
      if (next.trim().length === 0) {
        unsetNodeProp(node.id, path, commit);
        return;
      }
      setNodeProp(node.id, path, next, commit);
    },
    [node.id, setNodeProp, unsetNodeProp]
  );

  const renderField = (panel: DesignerInspectorPanel, field: DesignerInspectorField) => {
    const domId = field.domId ?? `designer-inspector-${panel.id}-${field.id}`;

    if (field.kind === 'string') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {field.label}
          </label>
          <Input
            id={domId}
            value={valueAsString}
            placeholder={field.placeholder}
            onChange={(event) => applyStringLike(field.path, event.target.value, false)}
            onBlur={(event) => applyStringLike(field.path, event.target.value, true)}
          />
        </div>
      );
    }

    if (field.kind === 'textarea') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {field.label}
          </label>
          <textarea
            id={domId}
            className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
            value={valueAsString}
            placeholder={field.placeholder}
            onChange={(event) => applyStringLike(field.path, event.target.value, false)}
            onBlur={(event) => applyStringLike(field.path, event.target.value, true)}
          />
        </div>
      );
    }

    if (field.kind === 'enum') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : field.options[0]?.value ?? '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {field.label}
          </label>
          <select
            id={domId}
            className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
            value={valueAsString}
            onChange={(event) => setNodeProp(node.id, field.path, event.target.value, true)}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (field.kind === 'boolean') {
      const value = resolveValue(field);
      const checked = Boolean(value);
      return (
        <label key={field.id} className="flex items-center gap-2 text-xs text-slate-600">
          <input
            id={domId}
            type="checkbox"
            checked={checked}
            onChange={(event) => setNodeProp(node.id, field.path, event.target.checked, true)}
          />
          {field.label}
        </label>
      );
    }

    return null;
  };

  if (panels.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3" data-automation-id="designer-schema-inspector">
      {panels.map((panel) => (
        <div key={panel.id} className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-slate-700">{panel.title}</p>
          <div className="space-y-2">{panel.fields.map((field) => renderField(panel, field))}</div>
        </div>
      ))}
    </div>
  );
};

