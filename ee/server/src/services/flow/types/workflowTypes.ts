// Basic system types
export interface SystemString {
  value: string;
}

export interface SystemInteger {
  value: number;
}

export interface SystemFloat {
  value: number;
}

export interface SystemBoolean {
  value: boolean;
}

export type SystemType = SystemString | SystemInteger | SystemFloat | SystemBoolean;

// Template type
export interface Template {
  template: string;
  type: SystemType;
}

// Common types used across nodes
export interface TypedOutput {
  id: string;
  label: string;
  type: string;
}

export interface Input {
  id: string;
  label: string;
}

// Condition types
export enum ConditionType {
  EQUALS = 'EQUALS',
  THRESHOLD = 'THRESHOLD',
  REGEX = 'REGEX'
}

export interface Condition {
  type: ConditionType;
  value: Template;
}

// Node specific types
export interface Office365ReceiverNodeData {
  label: string;
  outputs: TypedOutput[];
  clientId: Template;
  clientSecret: Template;
  tenantId: Template;
  userEmail: Template;
}

export interface ThinkingNodeData {
  label: string;
  outputs: TypedOutput[];
  thinkingProcess: Template;
}

export interface ActionNodeData {
  label: string;
  outputs: TypedOutput[];
  action: Template;
}

export interface ClassifierNodeData {
  label: string;
  source: Template;
  outputs: TypedOutput[];
  thinkingProcess: Template;
  classifications: Template[];
}

export interface TicketCreatorNodeData {
  label: string;
  outputs: TypedOutput[];
  ticketTitle: Template;
  ticketDescription: Template;
  ticketBoard: Template;
  ticketPriority: Template;
}

export interface DecisionNodeData {
  label: string;
  outputs: TypedOutput[];
  conditions: Record<string, Condition>;
  defaultOutput: Template;
}

export interface SelectorNodeData {
  label: string;
  outputs: TypedOutput[];
  inputs: Input[];
  defaultInput: Template;
}

export interface SpecialOperationNodeData {
  label: string;
  outputs: TypedOutput[];
  inputs: Input[];
}

// Data types
export interface Email {
  subject: string;
  body: string;
  from: string;
  to: string[];
  receivedAt: string;
  headers: Record<string, string>;
}

// Helper functions
export function createSystemType(type: 'String' | 'Integer' | 'Float' | 'Boolean', value: string | number | boolean): SystemType {
  switch (type) {
    case 'String':
      return { value: String(value) } as SystemString;
    case 'Integer':
      return { value: Number(value) } as SystemInteger;
    case 'Float':
      return { value: Number(value) } as SystemFloat;
    case 'Boolean':
      return { value: Boolean(value) } as SystemBoolean;
  }
}

export function createOutput(id: string, label: string, type: string): TypedOutput {
  return { id, label, type };
}

export function createInput(id: string, label: string): Input {
  return { id, label };
}
