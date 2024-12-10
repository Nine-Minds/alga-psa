// src/shared/types/protoTypes.ts
import { SystemTypes, ProtoNodeTypes, SystemTypes_String, SystemTypes_Integer, SystemTypes_Float, SystemTypes_Boolean, ProtoNodeTypes_TypedOutput, ProtoNodeTypes_Input } from '../../generated/workflow';

// Helper type for intrinsic types
export type IntrinsicType = 
  | SystemTypes_String
  | SystemTypes_Integer
  | SystemTypes_Float
  | SystemTypes_Boolean;

// Helper function to create intrinsic types
export function createIntrinsicType(type: 'String' | 'Integer' | 'Float' | 'Boolean', value: string | number | boolean): IntrinsicType {
  switch (type) {
    case 'String':
      return SystemTypes_String.create({ value: String(value) });
    case 'Integer':
      return SystemTypes_Integer.create({ value: Number(value) });
    case 'Float':
      return SystemTypes_Float.create({ value: Number(value) });
    case 'Boolean':
      return SystemTypes_Boolean.create({ value: Boolean(value) });
  }
}

// Helper function to create an Output
export function createOutput(id: string, label: string, type: string): ProtoNodeTypes_TypedOutput {
  return ProtoNodeTypes_TypedOutput.create({ id, label, type });
}

// Helper function to create an Input
export function createInput(id: string, label: string): ProtoNodeTypes_Input {
  return ProtoNodeTypes_Input.create({ id, label });
}
