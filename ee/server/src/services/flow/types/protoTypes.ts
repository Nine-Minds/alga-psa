import {
  SystemString,
  SystemInteger,
  SystemFloat,
  SystemBoolean,
  SystemType,
  TypedOutput,
  Input,
  Template,
  createSystemType,
  createOutput,
  createInput
} from './workflowTypes';

// Re-export types
export type { 
  SystemString,
  SystemInteger,
  SystemFloat,
  SystemBoolean,
  TypedOutput,
  Input,
  Template
};

// Helper type for system types
export type IntrinsicType = SystemType;

// Helper function to create system types
export const createIntrinsicType = createSystemType;

// Helper functions re-exported
export { createOutput, createInput };
