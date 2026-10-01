import { getComponentSchema } from '../schema/componentSchema';
import type { DesignerInspectorField, DesignerInspectorVisibleWhen } from '../schema/inspectorSchema';
import type { DesignerNode } from '../state/designerStore';
import { resolveNewNodeBaseStyle } from '../state/designerStore';

/**
 * Reading inspector fields against a node: their values, whether they apply to it,
 * and whether the node sets them beyond a new block's defaults.
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIntegerKey = (key: string): boolean => key !== '' && String(Number.parseInt(key, 10)) === key;

export const getIn = (value: unknown, path: string[]): unknown => {
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

export const splitDotPath = (path: string): string[] => path.split('.').map((segment) => segment.trim()).filter(Boolean);

// Inspector schemas currently use legacy root-level paths like `metadata.foo` and `layout.display`.
// The canonical node shape stores authored values under `props.*`.
export const normalizeInspectorPath = (input: string): string => {
  const path = input.trim();
  if (path.startsWith('props.')) return path;
  if (path === 'name') return 'props.name';
  if (path === 'metadata' || path.startsWith('metadata.')) return `props.${path}`;
  if (path === 'layout' || path.startsWith('layout.')) return `props.${path}`;
  if (path === 'style' || path.startsWith('style.')) return `props.${path}`;
  return path;
};

export const readFieldValue = (target: unknown, field: DesignerInspectorField): unknown =>
  'path' in field ? getIn(target, splitDotPath(normalizeInspectorPath(field.path))) : undefined;

export const isEmptyValue = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);

/** What a freshly added block of this type carries, to tell authored values from defaults. */
export const resolveDefaultNodeProps = (type: DesignerNode['type']) => {
  const schema = getComponentSchema(type);
  const size = schema.defaults.size ?? { width: 160, height: 64 };
  return {
    props: {
      metadata: schema.defaults.metadata ?? {},
      layout: schema.defaults.layout ?? {},
      style: { ...resolveNewNodeBaseStyle(type, size), ...(schema.defaults.style ?? {}) },
    },
  };
};

/** Set = the block carries a value that differs from a new block's default. */
export const isFieldSetOnNode = (node: DesignerNode, field: DesignerInspectorField): boolean => {
  if (field.kind === 'widget' || ('designerOnly' in field && field.designerOnly)) return false;
  const value = readFieldValue(node, field);
  if (isEmptyValue(value)) return false;
  const defaultValue = readFieldValue(resolveDefaultNodeProps(node.type), field);
  return JSON.stringify(value) !== JSON.stringify(defaultValue);
};

export const isRuleVisible = (
  rule: DesignerInspectorVisibleWhen | undefined,
  node: DesignerNode,
  parent: DesignerNode | null
): boolean => {
  if (!rule || rule.kind === 'always') return true;
  if (rule.kind === 'nodeIsContainer') {
    return Array.isArray(node.allowedChildren) && node.allowedChildren.length > 0;
  }
  if (rule.kind === 'nodeIsLeaf') {
    return !Array.isArray(node.allowedChildren) || node.allowedChildren.length === 0;
  }
  if (rule.kind === 'pathEquals') {
    return getIn(node, splitDotPath(normalizeInspectorPath(rule.path))) === rule.value;
  }
  if (rule.kind === 'parentPathEquals') {
    return parent ? getIn(parent, splitDotPath(normalizeInspectorPath(rule.path))) === rule.value : false;
  }
  return true;
};

