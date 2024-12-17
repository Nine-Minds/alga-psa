// src/shared/types/protoTypes.ts
import { 
  SystemString,
  SystemInteger,
  SystemFloat,
  SystemBoolean,
  SystemType,
  TypedOutput,
  Input,
  createSystemType,
  createOutput,
  createInput
} from '../../services/flow/types/workflowTypes';

// Helper type for intrinsic types
export type IntrinsicType = SystemType;

// Helper function to create intrinsic types
export const createIntrinsicType = createSystemType;

// Helper functions re-exported
export { createOutput, createInput };

// Re-export types
export type {
  SystemString,
  SystemInteger,
  SystemFloat,
  SystemBoolean,
  TypedOutput,
  Input
};
