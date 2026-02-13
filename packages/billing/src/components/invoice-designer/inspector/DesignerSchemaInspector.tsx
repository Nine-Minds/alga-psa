import React, { useCallback, useMemo } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { getComponentSchema } from '../schema/componentSchema';
import type { DesignerNode } from '../state/designerStore';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type {
  DesignerInspectorField,
  DesignerInspectorPanel,
  DesignerInspectorVisibleWhen,
} from '../schema/inspectorSchema';
import { TableEditorWidget } from './widgets/TableEditorWidget';

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
  nodesById: Map<string, DesignerNode>;
};

const normalizeCssLength = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  // Convenience: allow entering "12" and treat it as px.
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    return `${trimmed}px`;
  }
  return trimmed;
};

const normalizeCssColor = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const normalizeString = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : raw;
};

export const DesignerSchemaInspector: React.FC<Props> = ({ node, nodesById }) => {
  const setNodeProp = useInvoiceDesignerStore((state) => state.setNodeProp);
  const unsetNodeProp = useInvoiceDesignerStore((state) => state.unsetNodeProp);

  const schema = useMemo(() => getComponentSchema(node.type), [node.type]);
  const panels = schema.inspector?.panels ?? [];
  const parent = useMemo(
    () => (node.parentId ? nodesById.get(node.parentId) ?? null : null),
    [node.parentId, nodesById]
  );

  const resolveValue = useCallback(
    (field: DesignerInspectorField): unknown => getIn(node, splitDotPath(field.path)),
    [node]
  );

  const resolveVisibleWhenValue = useCallback(
    (rule: DesignerInspectorVisibleWhen | undefined): boolean => {
      if (!rule || rule.kind === 'always') return true;
      if (rule.kind === 'nodeIsContainer') {
        return Array.isArray(node.allowedChildren) && node.allowedChildren.length > 0;
      }
      if (rule.kind === 'pathEquals') {
        const value = getIn(node, splitDotPath(rule.path));
        return value === rule.value;
      }
      if (rule.kind === 'parentPathEquals') {
        if (!parent) return false;
        const value = getIn(parent, splitDotPath(rule.path));
        return value === rule.value;
      }
      return true;
    },
    [node, parent]
  );

  const applyNormalized = useCallback(
    (path: string, next: unknown, commit: boolean) => {
      if (typeof next === 'undefined') {
        unsetNodeProp(node.id, path, commit);
        return;
      }
      setNodeProp(node.id, path, next, commit);
    },
    [node.id, setNodeProp, unsetNodeProp]
  );

  const renderField = (panel: DesignerInspectorPanel, field: DesignerInspectorField) => {
    if (!resolveVisibleWhenValue(field.visibleWhen)) {
      return null;
    }
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
            onChange={(event) => applyNormalized(field.path, normalizeString(event.target.value), false)}
            onBlur={(event) => applyNormalized(field.path, normalizeString(event.target.value), true)}
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
            onChange={(event) => applyNormalized(field.path, normalizeString(event.target.value), false)}
            onBlur={(event) => applyNormalized(field.path, normalizeString(event.target.value), true)}
          />
        </div>
      );
    }

    if (field.kind === 'number') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-xs text-slate-500 block mb-1">
            {field.label}
          </label>
          <Input
            id={domId}
            type="number"
            value={valueAsString}
            placeholder={field.placeholder}
            onChange={(event) => {
              const trimmed = event.target.value.trim();
              if (trimmed.length === 0) {
                applyNormalized(field.path, undefined, false);
                return;
              }
              const parsed = Number(trimmed);
              if (!Number.isFinite(parsed)) return;
              applyNormalized(field.path, parsed, false);
            }}
            onBlur={(event) => {
              const trimmed = event.target.value.trim();
              if (trimmed.length === 0) {
                applyNormalized(field.path, undefined, true);
                return;
              }
              const parsed = Number(trimmed);
              if (!Number.isFinite(parsed)) return;
              applyNormalized(field.path, parsed, true);
            }}
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

    if (field.kind === 'css-length') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-[10px] text-slate-500 block mb-1">
            {field.label}
          </label>
          <Input
            id={domId}
            value={valueAsString}
            placeholder={field.placeholder}
            onChange={(event) => applyNormalized(field.path, normalizeCssLength(event.target.value), false)}
            onBlur={(event) => applyNormalized(field.path, normalizeCssLength(event.target.value), true)}
          />
        </div>
      );
    }

    if (field.kind === 'css-color') {
      const value = resolveValue(field);
      const valueAsString = typeof value === 'string' ? value : '';
      return (
        <div key={field.id}>
          <label htmlFor={domId} className="text-[10px] text-slate-500 block mb-1">
            {field.label}
          </label>
          <Input
            id={domId}
            value={valueAsString}
            placeholder={field.placeholder}
            onChange={(event) => applyNormalized(field.path, normalizeCssColor(event.target.value), false)}
            onBlur={(event) => applyNormalized(field.path, normalizeCssColor(event.target.value), true)}
          />
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

    if (field.kind === 'widget') {
      if (field.widget === 'table-editor') {
        return <TableEditorWidget key={field.id} node={node} />;
      }
      return null;
    }

    return null;
  };

  if (panels.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3" data-automation-id="designer-schema-inspector">
      {panels
        .filter((panel) => resolveVisibleWhenValue(panel.visibleWhen))
        .map((panel) => (
          <div key={panel.id} className="rounded border border-slate-200 bg-white px-3 py-2 space-y-2">
            <p className="text-xs font-semibold text-slate-700">{panel.title}</p>
            <div className="space-y-2">{panel.fields.map((field) => renderField(panel, field))}</div>
          </div>
        ))}
    </div>
  );
};
