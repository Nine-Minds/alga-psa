import type { DesignerContainerLayout, DesignerNode, DesignerNodeStyle } from '../state/designerStore';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const getNodeName = (node: DesignerNode): string => {
  const props = isPlainObject(node.props) ? node.props : {};
  if (typeof props.name === 'string') return props.name;
  // Back-compat during cutover: allow legacy nodes without props.
  return typeof node.name === 'string' ? node.name : '';
};

export const getNodeMetadata = (node: DesignerNode): Record<string, unknown> => {
  const props = isPlainObject(node.props) ? node.props : {};
  if (isPlainObject(props.metadata)) return props.metadata as Record<string, unknown>;
  // Back-compat during cutover: allow legacy nodes without props.
  return isPlainObject(node.metadata) ? (node.metadata as Record<string, unknown>) : {};
};

export const getNodeLayout = (node: DesignerNode): DesignerContainerLayout | undefined => {
  const props = isPlainObject(node.props) ? node.props : {};
  if (isPlainObject(props.layout)) return props.layout as DesignerContainerLayout;
  // Back-compat during cutover: allow legacy nodes without props.
  return node.layout;
};

export const getNodeStyle = (node: DesignerNode): DesignerNodeStyle | undefined => {
  const props = isPlainObject(node.props) ? node.props : {};
  if (isPlainObject(props.style)) return props.style as DesignerNodeStyle;
  // Back-compat during cutover: allow legacy nodes without props.
  return node.style;
};
