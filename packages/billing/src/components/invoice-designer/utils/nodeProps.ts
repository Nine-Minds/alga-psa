import type { DesignerContainerLayout, DesignerNode, DesignerNodeStyle } from '../state/designerStore';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const getNodeName = (node: DesignerNode): string => {
  const props = isPlainObject(node.props) ? node.props : {};
  if (typeof props.name === 'string') return props.name;
  return '';
};

export const getNodeMetadata = (node: DesignerNode): Record<string, unknown> => {
  const props = isPlainObject(node.props) ? node.props : {};
  if (isPlainObject(props.metadata)) return props.metadata as Record<string, unknown>;
  return {};
};

export const getNodeLayout = (node: DesignerNode): DesignerContainerLayout | undefined => {
  const props = isPlainObject(node.props) ? node.props : {};
  if (isPlainObject(props.layout)) return props.layout as unknown as DesignerContainerLayout;
  return undefined;
};

export const getNodeStyle = (node: DesignerNode): DesignerNodeStyle | undefined => {
  const props = isPlainObject(node.props) ? node.props : {};
  if (isPlainObject(props.style)) return props.style as unknown as DesignerNodeStyle;
  return undefined;
};
