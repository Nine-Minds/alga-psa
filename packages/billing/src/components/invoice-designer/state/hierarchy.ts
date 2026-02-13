import type { DesignerComponentType } from './designerStore';
import { getComponentSchema } from '../schema/componentSchema';

export const getAllowedChildrenForType = (type: DesignerComponentType): DesignerComponentType[] =>
  getComponentSchema(type)?.hierarchy.allowedChildren ?? [];

export const getAllowedParentsForType = (type: DesignerComponentType): DesignerComponentType[] =>
  getComponentSchema(type)?.hierarchy.allowedParents ?? [];

export const canNestWithinParent = (childType: DesignerComponentType, parentType: DesignerComponentType): boolean =>
  getAllowedParentsForType(childType).includes(parentType);
